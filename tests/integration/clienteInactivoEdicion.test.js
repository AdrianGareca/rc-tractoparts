// =============================================================================
// tests/integration/clienteInactivoEdicion.test.js
// MEDIO — desactivar un cliente trababa la edición de sus cotizaciones YA
// EXISTENTES.
//
// EL BUG
// clienteLinkGuard.js (verificarCliente) corría el mismo chequeo de
// "cliente activo" en creación y en edición. Si un cliente con una
// cotización 'Pendiente' se desactivaba, esa cotización quedaba imposible de
// editar —aunque la edición no tocara el cliente— hasta reactivarlo.
//
// LA REGLA QUE QUEDA
//   • Crear una cotización nueva para un cliente inactivo sigue bloqueado.
//   • Editar una cotización CAMBIANDO el cliente a uno inactivo sigue
//     bloqueado.
//   • Editar una cotización EXISTENTE sin cambiar su id_cliente ya NO se
//     bloquea sólo porque ese cliente esté inactivo.
//
// Prerequisites: NODE_ENV=test — test database (DB_NAME_TEST) must exist.
// =============================================================================

'use strict';

require('dotenv').config();
process.env.NODE_ENV = 'test';

const request  = require('supertest');
const bcrypt   = require('bcryptjs');
const app      = require('../../src/app');
const { pool } = require('../../src/config/db');

jest.setTimeout(30000); // updateQuotation/createQuotation regeneran el PDF (lento)

let tokenEjec;
let ejecId;
let clienteActivoId, clienteInactivoId, clienteInactivo2Id;
const cotizacionesCreadas = [];

const EJEC_USER     = 'test_ejec_cliinact';
const TEST_PASSWORD = 'TestCliInact01!';

const detalleBase = [
  { descripcion_item: 'Repuesto de prueba', cantidad: 1, precio_unitario: 100 },
];

beforeAll(async () => {
  await pool.execute('DELETE FROM cotizacion_detalles WHERE id_cotizacion IN (SELECT id FROM cotizaciones WHERE id_ejecutivo IN (SELECT id FROM usuarios WHERE nombre_usuario = ?))', [EJEC_USER]);
  await pool.execute('DELETE FROM cotizaciones WHERE id_ejecutivo IN (SELECT id FROM usuarios WHERE nombre_usuario = ?)', [EJEC_USER]);
  await pool.execute('DELETE FROM usuarios WHERE nombre_usuario = ?', [EJEC_USER]);
  await pool.execute('DELETE FROM clientes WHERE razon_social LIKE ?', ['Test Cliente CLIINACT%']);

  const hash = await bcrypt.hash(TEST_PASSWORD, 10);
  const [ejecRes] = await pool.execute(
    `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo)
     VALUES (?, ?, ?, 1, 1)`,
    ['Test Ejecutivo CLIINACT', EJEC_USER, hash]
  );
  ejecId = ejecRes.insertId;

  const [cliActivoRes] = await pool.execute(
    `INSERT INTO clientes (razon_social, activo) VALUES (?, 1)`,
    ['Test Cliente CLIINACT Activo']
  );
  clienteActivoId = cliActivoRes.insertId;

  const [cliInactivoRes] = await pool.execute(
    `INSERT INTO clientes (razon_social, activo) VALUES (?, 0)`,
    ['Test Cliente CLIINACT Inactivo']
  );
  clienteInactivoId = cliInactivoRes.insertId;

  const [cliInactivo2Res] = await pool.execute(
    `INSERT INTO clientes (razon_social, activo) VALUES (?, 0)`,
    ['Test Cliente CLIINACT Inactivo2']
  );
  clienteInactivo2Id = cliInactivo2Res.insertId;

  const login = await request(app)
    .post('/api/auth/login')
    .send({ nombre_usuario: EJEC_USER, password: TEST_PASSWORD });
  expect(login.status).toBe(200);
  tokenEjec = login.body.data.token;
});

afterAll(async () => {
  for (const id of cotizacionesCreadas) {
    await pool.execute('DELETE FROM cotizacion_detalles WHERE id_cotizacion = ?', [id]);
    await pool.execute('DELETE FROM cotizaciones WHERE id = ?', [id]);
  }
  await pool.execute('DELETE FROM usuarios WHERE id = ?', [ejecId ?? 0]);
  await pool.execute('DELETE FROM clientes WHERE id IN (?, ?, ?)', [
    clienteActivoId ?? 0, clienteInactivoId ?? 0, clienteInactivo2Id ?? 0,
  ]);
  await pool.end();
});

describe('CLIINACT — desactivar un cliente no traba la edición de sus cotizaciones existentes', () => {

  test('CLIINACT-01: crear una cotización NUEVA con cliente inactivo sigue bloqueado (422)', async () => {
    const res = await request(app)
      .post('/api/cotizaciones')
      .set('Authorization', `Bearer ${tokenEjec}`)
      .send({
        id_cliente:    clienteInactivoId,
        descripcion:   'Cotización CLIINACT cliente inactivo',
        fecha_emision: '2026-07-24',
        detalles:      detalleBase,
      });

    expect(res.status).toBe(422);
  });

  test('CLIINACT-02: editar una cotización SIN cambiar el cliente, ahora inactivo, se permite (200)', async () => {
    // Se crea con el cliente todavía ACTIVO.
    const createRes = await request(app)
      .post('/api/cotizaciones')
      .set('Authorization', `Bearer ${tokenEjec}`)
      .send({
        id_cliente:    clienteActivoId,
        descripcion:   'Cotización CLIINACT edición propia',
        fecha_emision: '2026-07-24',
        detalles:      detalleBase,
      });
    expect(createRes.status).toBe(201);
    const cotizacionId = createRes.body.data.id;
    cotizacionesCreadas.push(cotizacionId);

    // El cliente se desactiva DESPUÉS de asignado a la cotización.
    await pool.execute('UPDATE clientes SET activo = 0 WHERE id = ?', [clienteActivoId]);

    // La edición no toca id_cliente (lo manda igual) — no debe bloquearse.
    const updateRes = await request(app)
      .put(`/api/cotizaciones/${cotizacionId}`)
      .set('Authorization', `Bearer ${tokenEjec}`)
      .send({
        id_cliente:    clienteActivoId,
        descripcion:   'Cotización CLIINACT edición propia (editada)',
        fecha_emision: '2026-07-24',
        detalles:      detalleBase,
      });

    expect(updateRes.status).toBe(200);

    // Se reactiva para no afectar otros tests que puedan reusar este cliente.
    await pool.execute('UPDATE clientes SET activo = 1 WHERE id = ?', [clienteActivoId]);
  });

  test('CLIINACT-03: editar CAMBIANDO el cliente a uno inactivo sigue bloqueado (422)', async () => {
    const createRes = await request(app)
      .post('/api/cotizaciones')
      .set('Authorization', `Bearer ${tokenEjec}`)
      .send({
        id_cliente:    clienteActivoId,
        descripcion:   'Cotización CLIINACT cambio de cliente',
        fecha_emision: '2026-07-24',
        detalles:      detalleBase,
      });
    expect(createRes.status).toBe(201);
    const cotizacionId = createRes.body.data.id;
    cotizacionesCreadas.push(cotizacionId);

    const updateRes = await request(app)
      .put(`/api/cotizaciones/${cotizacionId}`)
      .set('Authorization', `Bearer ${tokenEjec}`)
      .send({
        id_cliente:    clienteInactivo2Id,
        descripcion:   'Cotización CLIINACT cambio de cliente (editada)',
        fecha_emision: '2026-07-24',
        detalles:      detalleBase,
      });

    expect(updateRes.status).toBe(422);

    const [rows] = await pool.execute('SELECT id_cliente FROM cotizaciones WHERE id = ?', [cotizacionId]);
    expect(rows[0].id_cliente).toBe(clienteActivoId);
  });
});
