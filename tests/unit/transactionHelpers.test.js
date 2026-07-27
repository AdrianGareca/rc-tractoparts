// =============================================================================
// tests/unit/transactionHelpers.test.js
// Red de seguridad del reintento ante deadlocks y del manejo de la conexión.
//
// Lo que se protege acá no es el camino feliz: es que la conexión se DEVUELVA
// al pool por todos los caminos. Una conexión filtrada por request agota el
// pool bajo carga y la app se cuelga entera, sin error visible — el mismo
// auto-bloqueo que el comentario del helper describe.
// =============================================================================

'use strict';

const mockPool = { getConnection: jest.fn() };
jest.mock('../../src/config/db', () => ({ pool: mockPool }));

const { withDeadlockRetry, MAX_DEADLOCK_RETRIES } =
  require('../../src/controllers/quotation/transactionHelpers');

/** Conexión falsa que registra cada operación. */
function fakeConn() {
  const c = {
    ops: [],
    beginTransaction: jest.fn(async () => { c.ops.push('begin'); }),
    commit:           jest.fn(async () => { c.ops.push('commit'); }),
    rollback:         jest.fn(async () => { c.ops.push('rollback'); }),
    release:          jest.fn(() => { c.ops.push('release'); }),
  };
  return c;
}

const deadlock = () => Object.assign(new Error('Deadlock found'), { code: 'ER_LOCK_DEADLOCK' });

describe('withDeadlockRetry — camino feliz', () => {
  beforeEach(() => {
    // mockReset (no clearAllMocks): clearAllMocks NO vacia la cola de
    // mockResolvedValueOnce, y las conexiones encoladas de un test previo se
    // consumirian en el siguiente.
    mockPool.getConnection.mockReset();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  test('abre, ejecuta, commitea y libera', async () => {
    const c = fakeConn();
    mockPool.getConnection.mockResolvedValue(c);

    const r = await withDeadlockRetry(async () => 'listo');

    expect(r).toBe('listo');
    expect(c.ops).toEqual(['begin', 'commit', 'release']);
  });

  test('le pasa la conexión al trabajo', async () => {
    const c = fakeConn();
    mockPool.getConnection.mockResolvedValue(c);

    let recibida = null;
    await withDeadlockRetry(async (conn) => { recibida = conn; });

    expect(recibida).toBe(c);
  });

  test('no reintenta cuando todo sale bien', async () => {
    mockPool.getConnection.mockResolvedValue(fakeConn());

    await withDeadlockRetry(async () => 1);

    expect(mockPool.getConnection).toHaveBeenCalledTimes(1);
  });
});

describe('withDeadlockRetry — deadlocks', () => {
  beforeEach(() => {
    // mockReset (no clearAllMocks): clearAllMocks NO vacia la cola de
    // mockResolvedValueOnce, y las conexiones encoladas de un test previo se
    // consumirian en el siguiente.
    mockPool.getConnection.mockReset();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  test('reintenta y termina bien al segundo intento', async () => {
    const c1 = fakeConn(); const c2 = fakeConn();
    mockPool.getConnection.mockResolvedValueOnce(c1).mockResolvedValueOnce(c2);

    let intento = 0;
    const r = await withDeadlockRetry(async () => {
      if (++intento === 1) throw deadlock();
      return 'ok al segundo';
    });

    expect(r).toBe('ok al segundo');
    expect(c1.ops).toEqual(['begin', 'rollback', 'release']);
    expect(c2.ops).toEqual(['begin', 'commit', 'release']);
  });

  test('se rinde tras agotar los reintentos y propaga el error', async () => {
    const conns = Array.from({ length: MAX_DEADLOCK_RETRIES }, fakeConn);
    conns.forEach((c) => mockPool.getConnection.mockResolvedValueOnce(c));

    await expect(withDeadlockRetry(async () => { throw deadlock(); }))
      .rejects.toThrow('Deadlock found');

    expect(mockPool.getConnection).toHaveBeenCalledTimes(MAX_DEADLOCK_RETRIES);
    conns.forEach((c) => expect(c.release).toHaveBeenCalled());
  });

  test('un error que NO es deadlock no se reintenta', async () => {
    const c = fakeConn();
    mockPool.getConnection.mockResolvedValue(c);

    await expect(withDeadlockRetry(async () => { throw new Error('columna invalida'); }))
      .rejects.toThrow('columna invalida');

    expect(mockPool.getConnection).toHaveBeenCalledTimes(1);
    expect(c.ops).toEqual(['begin', 'rollback', 'release']);
  });

  test('respeta un maxRetries personalizado', async () => {
    Array.from({ length: 5 }, fakeConn).forEach((c) => mockPool.getConnection.mockResolvedValueOnce(c));

    await expect(withDeadlockRetry(async () => { throw deadlock(); }, { maxRetries: 2 }))
      .rejects.toThrow();

    expect(mockPool.getConnection).toHaveBeenCalledTimes(2);
  });
});

describe('withDeadlockRetry — la conexión SIEMPRE vuelve al pool', () => {
  beforeEach(() => {
    // mockReset (no clearAllMocks): clearAllMocks NO vacia la cola de
    // mockResolvedValueOnce, y las conexiones encoladas de un test previo se
    // consumirian en el siguiente.
    mockPool.getConnection.mockReset();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  test('la libera al terminar bien (antes del PDF y la auditoría)', async () => {
    const c = fakeConn();
    mockPool.getConnection.mockResolvedValue(c);

    await withDeadlockRetry(async () => 1);

    expect(c.release).toHaveBeenCalledTimes(1);
  });

  test('la libera cuando el trabajo falla', async () => {
    const c = fakeConn();
    mockPool.getConnection.mockResolvedValue(c);

    await expect(withDeadlockRetry(async () => { throw new Error('x'); })).rejects.toThrow();

    expect(c.release).toHaveBeenCalledTimes(1);
  });

  test('la libera aunque el propio rollback falle', async () => {
    const c = fakeConn();
    c.rollback.mockRejectedValue(new Error('conexion muerta'));
    mockPool.getConnection.mockResolvedValue(c);

    await expect(withDeadlockRetry(async () => { throw new Error('x'); })).rejects.toThrow('x');

    expect(c.release).toHaveBeenCalledTimes(1);
  });

  test('la libera cuando falla el commit', async () => {
    const c = fakeConn();
    c.commit.mockRejectedValue(new Error('commit fallido'));
    mockPool.getConnection.mockResolvedValue(c);

    await expect(withDeadlockRetry(async () => 1)).rejects.toThrow('commit fallido');

    expect(c.release).toHaveBeenCalledTimes(1);
  });

  test('si el pool no da conexión, propaga sin intentar liberar', async () => {
    mockPool.getConnection.mockRejectedValue(new Error('pool agotado'));

    await expect(withDeadlockRetry(async () => 1)).rejects.toThrow('pool agotado');
  });
});
