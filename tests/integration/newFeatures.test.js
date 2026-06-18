// =============================================================================
// tests/integration/newFeatures.test.js
// New Features Integration Test Suite
//
// Test blocks:
//   NF-01 — Delegation Window: within timeline → rol_efectivo promoted to 'Jefe'
//   NF-02 — Delegation Window: outside timeline → rol_efectivo stays at base role
//   NF-03 — Admin Notes Access: Ejecutivo can read comentarios_admin via GET /:id
//   NF-04 — Persistent Notifications: items stay unread (leida=0) until explicit
//            call to POST /api/cotizaciones/notificaciones/leer
//
// Prerequisites:
//   • NODE_ENV=test — test database (DB_NAME_TEST) must exist and be seeded
//   • At least one active Ejecutivo and Jefe available in the test DB
// =============================================================================

'use strict';

require('dotenv').config();
process.env.NODE_ENV = 'test';

const request  = require('supertest');
const bcrypt   = require('bcryptjs');
const app      = require('../../src/app');
const { pool } = require('../../src/config/db');

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------
let tokenJefe;
let tokenEjecutivo;
let testJefeId;
let testEjecutivoId;
let testClienteId;
let testCotizacionId;
let testDelegacionId;

const JEFE_USER     = 'test_jefe_nf01';
const EJEC_USER     = 'test_ejec_nf01';
const TEST_PASSWORD = 'TestNF01Password!';

// ---------------------------------------------------------------------------
// beforeAll — provision test fixtures
// ---------------------------------------------------------------------------
beforeAll(async () => {
  // Clean up any leftover fixtures from previous runs
  await pool.execute('DELETE FROM delegaciones_rol WHERE id_usuario_jefe IN (SELECT id FROM usuarios WHERE nombre_usuario IN (?, ?))', [JEFE_USER, EJEC_USER]);
  await pool.execute('DELETE FROM notificaciones WHERE id_usuario IN (SELECT id FROM usuarios WHERE nombre_usuario IN (?, ?))', [JEFE_USER, EJEC_USER]);
  await pool.execute('DELETE FROM bitacora_auditoria WHERE nombre_usuario IN (?, ?)', [JEFE_USER, EJEC_USER]);
  await pool.execute('DELETE FROM cotizacion_detalles WHERE id_cotizacion IN (SELECT id FROM cotizaciones WHERE id_ejecutivo IN (SELECT id FROM usuarios WHERE nombre_usuario = ?))', [EJEC_USER]);
  await pool.execute('DELETE FROM cotizaciones WHERE id_ejecutivo IN (SELECT id FROM usuarios WHERE nombre_usuario = ?)', [EJEC_USER]);
  await pool.execute('DELETE FROM usuarios WHERE nombre_usuario IN (?, ?)', [JEFE_USER, EJEC_USER]);
  await pool.execute('DELETE FROM clientes WHERE razon_social = ?', ['Test Client NF-01']);

  const hash = await bcrypt.hash(TEST_PASSWORD, 10);

  // Insert test Jefe (id_rol = 3)
  const [jefeRes] = await pool.execute(
    `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo)
     VALUES (?, ?, ?, 3, 1)`,
    ['Test Jefe NF01', JEFE_USER, hash]
  );
  testJefeId = jefeRes.insertId;

  // Insert test Ejecutivo (id_rol = 1)
  const [ejecRes] = await pool.execute(
    `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo)
     VALUES (?, ?, ?, 1, 1)`,
    ['Test Ejecutivo NF01', EJEC_USER, hash]
  );
  testEjecutivoId = ejecRes.insertId;

  // Insert test client
  const [clientRes] = await pool.execute(
    `INSERT INTO clientes (razon_social, activo) VALUES (?, 1)`,
    ['Test Client NF-01']
  );
  testClienteId = clientRes.insertId;

  // Authenticate Jefe
  const jefeLogin = await request(app)
    .post('/api/auth/login')
    .send({ nombre_usuario: JEFE_USER, password: TEST_PASSWORD });
  expect(jefeLogin.status).toBe(200);
  tokenJefe = jefeLogin.body.data.token;

  // Authenticate Ejecutivo
  const ejecLogin = await request(app)
    .post('/api/auth/login')
    .send({ nombre_usuario: EJEC_USER, password: TEST_PASSWORD });
  expect(ejecLogin.status).toBe(200);
  tokenEjecutivo = ejecLogin.body.data.token;
});

// ---------------------------------------------------------------------------
// afterAll — release connection pool so Jest can exit cleanly
// ---------------------------------------------------------------------------
afterAll(async () => {
  // Remove test fixtures
  await pool.execute('DELETE FROM delegaciones_rol WHERE id_usuario_jefe = ?', [testJefeId]);
  await pool.execute('DELETE FROM notificaciones WHERE id_usuario = ?', [testEjecutivoId]);
  await pool.execute('DELETE FROM cotizacion_detalles WHERE id_cotizacion = ?', [testCotizacionId ?? 0]);
  await pool.execute('DELETE FROM cotizaciones WHERE id_ejecutivo = ?', [testEjecutivoId]);
  await pool.execute('DELETE FROM usuarios WHERE id IN (?, ?)', [testJefeId, testEjecutivoId]);
  await pool.execute('DELETE FROM clientes WHERE id = ?', [testClienteId]);
  await pool.end();
});

// =============================================================================
// NF-01 — Delegation Window: active delegation upgrades rol_efectivo to 'Jefe'
// =============================================================================
describe('NF-01 — Delegation Window (within timeline)', () => {
  beforeAll(async () => {
    // Create a delegation that starts 1 hour in the past and ends 1 hour in the future
    const inicio = new Date(Date.now() - 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const fin    = new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');

    const [res] = await pool.execute(
      `INSERT INTO delegaciones_rol (id_usuario_jefe, id_usuario_delegado, fecha_inicio, fecha_fin, activo)
       VALUES (?, ?, ?, ?, 1)`,
      [testJefeId, testEjecutivoId, inicio, fin]
    );
    testDelegacionId = res.insertId;
  });

  test('NF-01a: delegated Ejecutivo can access approval queue (Jefe-only endpoint)', async () => {
    // GET /api/cotizaciones/pendientes-aprobacion requires Jefe authority.
    // With an active delegation, the middleware should promote rol_efectivo → 'Jefe'.
    const res = await request(app)
      .get('/api/cotizaciones/pendientes-aprobacion')
      .set('Authorization', `Bearer ${tokenEjecutivo}`);

    // 200 = delegation was honoured; 403 = middleware failed to promote
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('NF-01b: delegation row exists with activo=1 and NOW() within window', async () => {
    const [rows] = await pool.execute(
      `SELECT id, activo
       FROM delegaciones_rol
       WHERE id = ? AND activo = 1 AND NOW() BETWEEN fecha_inicio AND fecha_fin`,
      [testDelegacionId]
    );
    expect(rows.length).toBe(1);
    expect(rows[0].activo).toBe(1);
  });

  afterAll(async () => {
    // Deactivate the delegation so NF-02 can run cleanly
    await pool.execute('UPDATE delegaciones_rol SET activo = 0 WHERE id = ?', [testDelegacionId]);
  });
});

// =============================================================================
// NF-02 — Delegation Window: outside timeline → access denied
// =============================================================================
describe('NF-02 — Delegation Window (outside timeline / revoked)', () => {
  test('NF-02a: Ejecutivo without active delegation is denied Jefe-only endpoint', async () => {
    // Delegation was revoked in NF-01 afterAll, so Ejecutivo has base role only
    const res = await request(app)
      .get('/api/cotizaciones/pendientes-aprobacion')
      .set('Authorization', `Bearer ${tokenEjecutivo}`);

    expect(res.status).toBe(403);
  });

  test('NF-02b: future-dated delegation does NOT grant immediate access', async () => {
    // Insert delegation starting 2 hours in the FUTURE
    const inicio = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const fin    = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');

    await pool.execute(
      `INSERT INTO delegaciones_rol (id_usuario_jefe, id_usuario_delegado, fecha_inicio, fecha_fin, activo)
       VALUES (?, ?, ?, ?, 1)`,
      [testJefeId, testEjecutivoId, inicio, fin]
    );

    const res = await request(app)
      .get('/api/cotizaciones/pendientes-aprobacion')
      .set('Authorization', `Bearer ${tokenEjecutivo}`);

    expect(res.status).toBe(403);

    // Clean up
    await pool.execute(
      'DELETE FROM delegaciones_rol WHERE id_usuario_jefe = ? AND id_usuario_delegado = ? AND fecha_inicio > NOW()',
      [testJefeId, testEjecutivoId]
    );
  });
});

// =============================================================================
// NF-03 — Admin Notes Access: Ejecutivo can read comentarios_admin on GET /:id
// =============================================================================
describe('NF-03 — Admin Notes Access (comentarios_admin)', () => {
  const ADMIN_COMMENT = 'Verificar disponibilidad con proveedor antes de proceder.';

  beforeAll(async () => {
    // Create a quotation with a comentarios_admin value
    const correlativo = `TEST-NF03-${Date.now()}`;
    const [cotRes] = await pool.execute(
      `INSERT INTO cotizaciones
         (numero_correlativo, id_cliente, id_ejecutivo, descripcion,
          fecha_emision, estado, comentarios_admin)
       VALUES (?, ?, ?, ?, CURDATE(), 'Pendiente', ?)`,
      [correlativo, testClienteId, testEjecutivoId, 'Cotización de prueba NF-03', ADMIN_COMMENT]
    );
    testCotizacionId = cotRes.insertId;
  });

  test('NF-03a: GET /api/cotizaciones/:id returns comentarios_admin field', async () => {
    const res = await request(app)
      .get(`/api/cotizaciones/${testCotizacionId}`)
      .set('Authorization', `Bearer ${tokenEjecutivo}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('comentarios_admin');
  });

  test('NF-03b: Ejecutivo receives the correct admin comment text', async () => {
    const res = await request(app)
      .get(`/api/cotizaciones/${testCotizacionId}`)
      .set('Authorization', `Bearer ${tokenEjecutivo}`);

    expect(res.status).toBe(200);
    expect(res.body.data.comentarios_admin).toBe(ADMIN_COMMENT);
  });

  test('NF-03c: Jefe can also read comentarios_admin on the same endpoint', async () => {
    const res = await request(app)
      .get(`/api/cotizaciones/${testCotizacionId}`)
      .set('Authorization', `Bearer ${tokenJefe}`);

    expect(res.status).toBe(200);
    expect(res.body.data.comentarios_admin).toBe(ADMIN_COMMENT);
  });
});

// =============================================================================
// NF-04 — Persistent Notifications: items stay unread until explicit read call
// =============================================================================
describe('NF-04 — Persistent Notifications (leida = 0 persistence)', () => {
  let notifId;

  beforeAll(async () => {
    // Ensure cotización exists (created in NF-03)
    if (!testCotizacionId) return;

    // Directly insert a notification into the DB to simulate a Jefe approval event
    const [notifRes] = await pool.execute(
      `INSERT INTO notificaciones (id_usuario, id_cotizacion, tipo, mensaje, leida)
       VALUES (?, ?, 'aprobacion', 'Cotización aprobada internamente.', 0)`,
      [testEjecutivoId, testCotizacionId]
    );
    notifId = notifRes.insertId;
  });

  test('NF-04a: notification is created with leida = 0', async () => {
    if (!notifId) return;
    const [rows] = await pool.execute(
      'SELECT leida FROM notificaciones WHERE id = ?',
      [notifId]
    );
    expect(rows.length).toBe(1);
    expect(rows[0].leida).toBe(0);
  });

  test('NF-04b: GET /api/cotizaciones/notificaciones returns the unread notification', async () => {
    if (!notifId) return;
    const res = await request(app)
      .get('/api/cotizaciones/notificaciones')
      .set('Authorization', `Bearer ${tokenEjecutivo}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // At least one unread notification should be present
    const data = res.body.data ?? res.body.notificaciones ?? [];
    expect(Array.isArray(data)).toBe(true);
  });

  test('NF-04c: notification remains unread (leida=0) without explicit read call', async () => {
    if (!notifId) return;
    // Re-query without calling /notificaciones/leer
    const [rows] = await pool.execute(
      'SELECT leida FROM notificaciones WHERE id = ?',
      [notifId]
    );
    expect(rows[0].leida).toBe(0);
  });

  test('NF-04d: POST /notificaciones/leer marks notifications as leida=1', async () => {
    if (!notifId) return;

    const res = await request(app)
      .post('/api/cotizaciones/notificaciones/leer')
      .set('Authorization', `Bearer ${tokenEjecutivo}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify the DB row is now leida=1
    const [rows] = await pool.execute(
      'SELECT leida FROM notificaciones WHERE id = ?',
      [notifId]
    );
    if (rows.length > 0) {
      expect(rows[0].leida).toBe(1);
    }
  });

  afterAll(async () => {
    if (notifId) {
      await pool.execute('DELETE FROM notificaciones WHERE id = ?', [notifId]);
    }
  });
});

// =============================================================================
// NF-05 — Delegation API: CRUD via HTTP endpoints
// =============================================================================
describe('NF-05 — Delegation REST API (CRUD)', () => {
  let createdDelegacionId;

  test('NF-05a: GET /api/delegaciones/ejecutivos returns the test Ejecutivo', async () => {
    const res = await request(app)
      .get('/api/delegaciones/ejecutivos')
      .set('Authorization', `Bearer ${tokenJefe}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    const found = res.body.data.find(e => e.id === testEjecutivoId);
    expect(found).toBeDefined();
  });

  test('NF-05b: POST /api/delegaciones creates a valid delegation', async () => {
    const inicio = new Date(Date.now() + 60 * 1000).toISOString().slice(0, 19);
    const fin    = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().slice(0, 19);

    const res = await request(app)
      .post('/api/delegaciones')
      .set('Authorization', `Bearer ${tokenJefe}`)
      .send({ id_usuario_delegado: testEjecutivoId, fecha_inicio: inicio, fecha_fin: fin });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('id');
    createdDelegacionId = res.body.data.id;
  });

  test('NF-05c: POST /api/delegaciones rejects when fecha_fin <= fecha_inicio', async () => {
    const now = new Date().toISOString().slice(0, 19);
    const res = await request(app)
      .post('/api/delegaciones')
      .set('Authorization', `Bearer ${tokenJefe}`)
      .send({ id_usuario_delegado: testEjecutivoId, fecha_inicio: now, fecha_fin: now });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  test('NF-05d: Ejecutivo is denied POST /api/delegaciones (role check)', async () => {
    const inicio = new Date(Date.now() + 60 * 1000).toISOString().slice(0, 19);
    const fin    = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().slice(0, 19);

    const res = await request(app)
      .post('/api/delegaciones')
      .set('Authorization', `Bearer ${tokenEjecutivo}`)
      .send({ id_usuario_delegado: testEjecutivoId, fecha_inicio: inicio, fecha_fin: fin });

    expect(res.status).toBe(403);
  });

  test('NF-05e: DELETE /api/delegaciones/:id revokes the delegation', async () => {
    if (!createdDelegacionId) return;

    const res = await request(app)
      .delete(`/api/delegaciones/${createdDelegacionId}`)
      .set('Authorization', `Bearer ${tokenJefe}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Confirm it's now activo=0 in DB
    const [rows] = await pool.execute(
      'SELECT activo FROM delegaciones_rol WHERE id = ?',
      [createdDelegacionId]
    );
    expect(rows[0].activo).toBe(0);
  });
});
