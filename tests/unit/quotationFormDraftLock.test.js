// =============================================================================
// tests/unit/quotationFormDraftLock.test.js
// Red de seguridad del draft-lock del formulario.
//
// Cubre las dos cosas que pueden salir mal acá:
//   1. El texto del aviso, que interpola el NOMBRE de otro usuario en innerHTML.
//   2. El ciclo de vida del socket — que es donde vivía el Bug B: si el modal
//      se cierra mientras connectSocket() está en vuelo, el socket que llega
//      tarde tiene que cerrarse, no adoptarse (si no, queda un lock huérfano
//      y todos ven un "está redactando" que ya no es cierto).
// =============================================================================

'use strict';

jest.mock('../../public/js/services/socketClient.js', () => ({
  __esModule: true,
  connectSocket: jest.fn(),
}));

import { connectSocket } from '../../public/js/services/socketClient.js';
import {
  buildLockBannerHtml,
  DraftLockController,
  ACK_TIMEOUT_MS,
} from '../../public/js/views/quotationForm/draftLock.js';

/** Socket falso con ack configurable. */
function fakeSocket({ ack = { success: true, mine: true, numero_correlativo: 'SC-2026/000042' } } = {}) {
  return {
    connected:  true,
    disconnected: false,
    handlers:   {},
    emitted:    [],
    on(evt, fn) { this.handlers[evt] = fn; },
    timeout()   { return this; },
    emit(evt, payload, cb) {
      this.emitted.push(evt);
      if (typeof cb === 'function') cb(null, ack);
    },
    disconnect() { this.disconnected = true; this.connected = false; },
  };
}

/** Contenedor mínimo con el banner y el badge del correlativo. */
function fakeContainer() {
  const banner = {
    innerHTML: '', classes: new Set(['alert-warning']),
    classList: {
      add(...c) { c.forEach(x => banner.classes.add(x)); },
      remove(...c) { c.forEach(x => banner.classes.delete(x)); },
    },
  };
  const badge = { textContent: '' };
  return {
    banner, badge,
    querySelector(sel) {
      if (sel === '#qf-lock-banner') return banner;
      if (sel.includes('correlativo-preview')) return badge;
      return null;
    },
  };
}

const flush = () => new Promise((r) => setImmediate(r));

describe('buildLockBannerHtml', () => {
  test('nombra al ejecutivo y el número que tiene reservado', () => {
    const { html } = buildLockBannerHtml({
      ejecutivo: { nombre: 'Ana Quiroga' },
      numero_correlativo: 'SC-2026/000123',
    });

    expect(html).toContain('Ana Quiroga');
    expect(html).toContain('SC-2026/000123');
  });

  test('ofrece el siguiente número aproximado', () => {
    const { html, proximo } = buildLockBannerHtml({
      ejecutivo: { nombre: 'Ana' }, numero_correlativo: 'SC-2026/000123',
    });

    expect(proximo).toBe('SC-2026/000124');
    expect(html).toContain('SC-2026/000124');
    expect(html).toContain('aprox.');
  });

  test('sin número parseable no promete un serial concreto', () => {
    const { html, proximo } = buildLockBannerHtml({
      ejecutivo: { nombre: 'Ana' }, numero_correlativo: 'SIN-NUMERO',
    });

    expect(proximo).toBeNull();
    expect(html).toContain('el siguiente número disponible.');
    expect(html).not.toContain('aprox.');
  });

  test('cae a "otro ejecutivo" si el nombre no vino', () => {
    expect(buildLockBannerHtml({ numero_correlativo: 'SC-1' }).html)
      .toContain('otro ejecutivo');
    expect(buildLockBannerHtml({}).html).toContain('otro ejecutivo');
  });

  test('escapa el nombre del ejecutivo (viene de la BD, se inyecta en innerHTML)', () => {
    const { html } = buildLockBannerHtml({
      ejecutivo: { nombre: '<img src=x onerror=alert(1)>' },
      numero_correlativo: 'SC-1',
    });

    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  test('escapa el número de correlativo', () => {
    const { html } = buildLockBannerHtml({
      ejecutivo: { nombre: 'Ana' }, numero_correlativo: '<script>alert(1)</script>',
    });

    expect(html).not.toContain('<script>');
  });
});

describe('DraftLockController — ciclo de vida', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  test('al reservar el número, lo muestra en el badge', async () => {
    const container = fakeContainer();
    connectSocket.mockResolvedValue(fakeSocket());

    const ctl = new DraftLockController(container);
    await ctl.init();

    expect(ctl.hasLock()).toBe(true);
    expect(container.badge.textContent).toBe('SC-2026/000042');
  });

  test('si otro tiene la reserva, muestra el aviso y NO se declara dueño', async () => {
    const container = fakeContainer();
    connectSocket.mockResolvedValue(fakeSocket({
      ack: {
        success: true, mine: false,
        numero_correlativo: 'SC-2026/000042',
        ejecutivo: { nombre: 'Ana' },
      },
    }));

    const ctl = new DraftLockController(container);
    await ctl.init();

    expect(ctl.hasLock()).toBe(false);
    expect(container.banner.innerHTML).toContain('Ana');
    expect(container.banner.classes.has('alert-info')).toBe(true);
    expect(container.badge.textContent).toBe('SC-2026/000043 (aprox.)');
  });

  test('cerrar el form antes de que conecte desconecta el socket tardío', async () => {
    const container = fakeContainer();
    const socket = fakeSocket();
    connectSocket.mockResolvedValue(socket);

    const ctl = new DraftLockController(container);
    const pending = ctl.init();
    ctl.release();              // el usuario cierra el modal mientras conecta
    await pending;
    await flush();

    expect(socket.disconnected).toBe(true);
    expect(socket.emitted).not.toContain('cotizacion:draft:join');
    expect(ctl.hasLock()).toBe(false);
  });

  test('release marca destroyed aunque nunca haya habido socket', () => {
    const ctl = new DraftLockController(fakeContainer());

    expect(ctl.isDestroyed()).toBe(false);
    ctl.release();
    expect(ctl.isDestroyed()).toBe(true);
  });

  test('release avisa "leave" sólo si esta pestaña era la dueña', async () => {
    const container = fakeContainer();
    const socket = fakeSocket();
    connectSocket.mockResolvedValue(socket);

    const ctl = new DraftLockController(container);
    await ctl.init();
    socket.emitted.length = 0;

    ctl.release();

    expect(socket.emitted).toContain('cotizacion:draft:leave');
    expect(socket.disconnected).toBe(true);
  });

  test('release es idempotente', async () => {
    const container = fakeContainer();
    const socket = fakeSocket();
    connectSocket.mockResolvedValue(socket);

    const ctl = new DraftLockController(container);
    await ctl.init();

    ctl.release();
    socket.emitted.length = 0;
    expect(() => ctl.release()).not.toThrow();
    expect(socket.emitted).toHaveLength(0);   // no reemite el leave
  });

  test('si connectSocket falla, el form sigue funcionando', async () => {
    connectSocket.mockRejectedValue(new Error('sin red'));

    const ctl = new DraftLockController(fakeContainer());
    await expect(ctl.init()).resolves.toBeUndefined();
    expect(ctl.hasLock()).toBe(false);
  });

  test('un ack fallido no marca la reserva como propia', async () => {
    connectSocket.mockResolvedValue(fakeSocket({ ack: { success: false } }));

    const ctl = new DraftLockController(fakeContainer());
    await ctl.init();

    expect(ctl.hasLock()).toBe(false);
  });
});

describe('DraftLockController — liberación de otro ejecutivo', () => {
  beforeEach(() => jest.clearAllMocks());

  test('al liberarse el número, limpia el aviso e intenta reclamarlo', async () => {
    const container = fakeContainer();
    const socket = fakeSocket({
      ack: { success: true, mine: false, numero_correlativo: 'SC-1', ejecutivo: { nombre: 'Ana' } },
    });
    connectSocket.mockResolvedValue(socket);

    const ctl = new DraftLockController(container);
    await ctl.init();
    expect(container.banner.innerHTML).not.toBe('');

    // Ahora el otro suelta la reserva y el ack pasa a ser "es tuya".
    socket.emit = function (evt, payload, cb) {
      this.emitted.push(evt);
      if (cb) cb(null, { success: true, mine: true, numero_correlativo: 'SC-1' });
    };
    ctl.renderLockState({ locked: false });

    expect(container.banner.innerHTML).toBe('');
    expect(container.banner.classes.has('alert-info')).toBe(false);
    expect(ctl.hasLock()).toBe(true);
    expect(container.badge.textContent).toBe('SC-1');
  });

  test('quien ya es dueño no vuelve a pedir la reserva', async () => {
    const container = fakeContainer();
    const socket = fakeSocket();
    connectSocket.mockResolvedValue(socket);

    const ctl = new DraftLockController(container);
    await ctl.init();
    socket.emitted.length = 0;

    ctl.renderLockState({ locked: false });

    expect(socket.emitted).toHaveLength(0);
  });

  test('sin banner en el DOM no explota', () => {
    const ctl = new DraftLockController({ querySelector: () => null });
    expect(() => ctl.renderLockState({ locked: true })).not.toThrow();
  });
});

describe('constantes', () => {
  test('los acks tienen timeout (Socket.IO no trae uno por defecto)', () => {
    expect(ACK_TIMEOUT_MS).toBe(5000);
  });
});
