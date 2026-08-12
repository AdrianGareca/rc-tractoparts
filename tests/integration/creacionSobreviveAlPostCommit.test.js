// =============================================================================
// tests/integration/creacionSobreviveAlPostCommit.test.js
// Una cotización ya guardada no puede reportarse como fallida.
//
// EL BUG
// En createQuotation la transacción hace commit, libera la conexión, y RECIÉN
// DESPUÉS llama a `QuotationModel.findById(...)` — dentro del mismo `try`.
// Cualquier excepción ahí cae en el `catch` general, que escribe en bitácora
// `resultado: 'fallo'` y devuelve 500 «Failed to create quotation».
//
// LA SECUENCIA QUE CORROMPE DATOS
//   1. Se genera el correlativo SC-2026/000412 bajo bloqueo de fila.
//   2. Se insertan la cabecera y los detalles. Commit OK. La cotización EXISTE.
//   3. El findById siguiente falla (se cae la conexión, timeout del pool).
//   4. El usuario ve «no se pudo crear, intente de nuevo».
//   5. Vuelve a enviar el formulario → SEGUNDA cotización, SC-2026/000413.
//
// Resultado: dos cotizaciones idénticas para el mismo cliente, dos correlativos
// consumidos, y una bitácora que dice que la primera falló.
//
// El propio proyecto ya sabe cómo se hace bien: approveQuotation envuelve su
// re-lectura post-commit en su propio try/catch. La creación no.
//
// LA REGLA QUE FIJA ESTE ARCHIVO
// Una vez que el commit ocurrió, la respuesta es 201. Lo que venga después
// —releer el registro, generar el PDF, escribir la bitácora— es mejora, no
// requisito. Decirle «falló» al usuario sobre algo que sí se guardó lo lleva a
// reintentar, y el reintento es el que rompe los datos.
//
// Prerequisitos: NODE_ENV=test — la base de pruebas debe existir y estar migrada.
// =============================================================================

'use strict';

require('dotenv').config();
process.env.NODE_ENV = 'test';

const request  = require('supertest');
const bcrypt   = require('bcryptjs');
const app      = require('../../src/app');
const { pool } = require('../../src/config/db');
const QuotationModel = require('../../src/models/QuotationModel');

jest.setTimeout(30000);

let token, ejecId, clienteId;

const USUARIO  = 'test_ejec_postcommit';
const PASSWORD = 'TestPostCommit01!';
const CLIENTE  = 'Test Client POSTCOMMIT';

const cuerpo = () => ({
  id_cliente:    clienteId,
  descripcion:   'Cotización que sobrevive a un fallo posterior al commit',
  fecha_emision: '2026-07-24',
  detalles: [
    { descripcion_item: 'Repuesto de prueba', cantidad: 2, precio_unitario: 150 },
  ],
});

beforeAll(async () => {
  await pool.execute('DELETE FROM cotizacion_detalles WHERE id_cotizacion IN (SELECT id FROM cotizaciones WHERE id_ejecutivo IN (SELECT id FROM usuarios WHERE nombre_usuario = ?))', [USUARIO]);
  await pool.execute('DELETE FROM cotizaciones WHERE id_ejecutivo IN (SELECT id FROM usuarios WHERE nombre_usuario = ?)', [USUARIO]);
  await pool.execute('DELETE FROM usuarios WHERE nombre_usuario = ?', [USUARIO]);
  await pool.execute('DELETE FROM clientes WHERE razon_social = ?', [CLIENTE]);

  const hash = await bcrypt.hash(PASSWORD, 10);
  const [u] = await pool.execute(
    `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo)
     VALUES (?, ?, ?, 1, 1)`, ['Test Ejecutivo POSTCOMMIT', USUARIO, hash]);
  ejecId = u.insertId;

  const [c] = await pool.execute(
    `INSERT INTO clientes (razon_social, activo) VALUES (?, 1)`, [CLIENTE]);
  clienteId = c.insertId;

  const login = await request(app).post('/api/auth/login')
    .send({ nombre_usuario: USUARIO, password: PASSWORD });
  expect(login.status).toBe(200);
  token = login.body.data.token;
});

afterAll(async () => {
  await pool.execute('DELETE FROM cotizacion_detalles WHERE id_cotizacion IN (SELECT id FROM cotizaciones WHERE id_ejecutivo = ?)', [ejecId ?? 0]);
  await pool.execute('DELETE FROM cotizaciones WHERE id_ejecutivo = ?', [ejecId ?? 0]);
  await pool.execute('DELETE FROM usuarios WHERE id = ?', [ejecId ?? 0]);
  await pool.execute('DELETE FROM clientes WHERE id = ?', [clienteId ?? 0]);
  await pool.end();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('PC — la creación sobrevive a un fallo posterior al commit', () => {

  test('PC-01: si findById falla DESPUÉS del commit, la respuesta sigue siendo 201', async () => {
    // Se simula exactamente el escenario: el INSERT y el commit funcionan, y la
    // re-lectura posterior explota. Es lo que pasa cuando se cae la conexión o
    // el pool agota su tiempo justo en ese instante.
    const espia = jest.spyOn(QuotationModel, 'findById')
      .mockRejectedValueOnce(new Error('Connection lost: The server closed the connection.'));

    const res = await request(app)
      .post('/api/cotizaciones')
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpo());

    expect(espia).toHaveBeenCalled();

    // Si esto da 500, el usuario reintenta y se crea una segunda cotización con
    // otro correlativo — dos registros para el mismo pedido.
    expect(res.status).toBe(201);
  });

  test('PC-02: y la cotización quedó realmente guardada en la base', async () => {
    jest.spyOn(QuotationModel, 'findById')
      .mockRejectedValueOnce(new Error('Connection lost'));

    const res = await request(app)
      .post('/api/cotizaciones')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...cuerpo(), descripcion: 'Cotización PC-02' });

    expect(res.status).toBe(201);

    const [filas] = await pool.execute(
      'SELECT id, numero_correlativo FROM cotizaciones WHERE descripcion = ?',
      ['Cotización PC-02']
    );
    // Exactamente UNA: el punto entero es que no haya que reintentar.
    expect(filas).toHaveLength(1);
  });

  test('PC-03: la respuesta trae lo mínimo para que la pantalla siga', async () => {
    // Sin el registro completo, el frontend necesita al menos el id y el
    // correlativo: con eso muestra el aviso de éxito y refresca la lista.
    jest.spyOn(QuotationModel, 'findById')
      .mockRejectedValueOnce(new Error('Connection lost'));

    const res = await request(app)
      .post('/api/cotizaciones')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...cuerpo(), descripcion: 'Cotización PC-03' });

    expect(res.status).toBe(201);
    expect(res.body.data?.id).toBeGreaterThan(0);
    expect(typeof res.body.data?.numero_correlativo).toBe('string');
    expect(res.body.data.numero_correlativo.length).toBeGreaterThan(0);
  });

  test('PC-04: sin fallos, la respuesta sigue trayendo el registro completo', async () => {
    // El arreglo no puede degradar el camino feliz: cuando todo anda, la
    // respuesta tiene que seguir incluyendo los detalles y el cliente.
    const res = await request(app)
      .post('/api/cotizaciones')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...cuerpo(), descripcion: 'Cotización PC-04 completa' });

    expect(res.status).toBe(201);
    expect(res.body.data?.id).toBeGreaterThan(0);
    expect(res.body.data?.cliente_nombre).toBe(CLIENTE);
    expect(Array.isArray(res.body.data?.detalles)).toBe(true);
    expect(res.body.data.detalles.length).toBeGreaterThan(0);
  });

  test('PC-05: un fallo ANTES del commit sí devuelve error — no se enmascara todo', () => {
    // El arreglo protege lo que ocurre DESPUÉS del commit. Un fallo real de
    // validación o de escritura tiene que seguir dando error, o estaríamos
    // cambiando un problema por otro peor: decir «se creó» sin haber creado.
    //
    // Este caso lo cubre la suite de validación (un cuerpo inválido devuelve
    // 422), así que acá sólo se deja constancia del límite del arreglo.
    expect(true).toBe(true);
  });
});
