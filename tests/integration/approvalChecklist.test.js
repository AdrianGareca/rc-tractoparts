// =============================================================================
// tests/integration/approvalChecklist.test.js
// Pre-submission checklist enforcement across ALL approval entry points.
//
// Business rule (Section 4.3): a quotation must have ≥1 line item, monto_total
// set, and fecha_validez set BEFORE it can move into the approval pipeline.
// This checklist (QuotationModel.validateForReview) was historically enforced
// ONLY on the 'En revision' transition, so a Jefe/SysAdmin (or a delegated
// Ejecutivo) could bypass it entirely by:
//   • PUT /:id/estado straight to 'Aprobada internamente' or 'Enviada al cliente'
//   • POST /:id/aprobar (the dedicated approval endpoint) — which never called it
// These tests pin the checklist to EVERY entry point.
//
// Guard-rails (must NOT over-block):
//   • Rejection of an incomplete quote is allowed (you reject BECAUSE it's bad).
//   • A complete quote still approves normally (happy path preserved).
//
// Prerequisites:
//   • NODE_ENV=test — test database (DB_NAME_TEST) must exist and be seeded.
// =============================================================================

'use strict';

require('dotenv').config();
process.env.NODE_ENV = 'test';

const request  = require('supertest');
const bcrypt   = require('bcryptjs');
const app      = require('../../src/app');
const { pool } = require('../../src/config/db');

// A full approve/reject also regenerates the quotation PDF on disk, which can
// take several seconds — comfortably above Jest's 5 s default. Bump it so the
// happy-path assertions aren't flagged as timeouts.
jest.setTimeout(30000);

let tokenJefe;
let testJefeId;
let testEjecutivoId;
let testClienteId;
const createdCotizaciones = [];

const JEFE_USER     = 'test_jefe_chk';
const EJEC_USER     = 'test_ejec_chk';
const TEST_PASSWORD = 'TestChecklist01!';
const CLIENT_NAME   = 'Test Client CHK';

// ---------------------------------------------------------------------------
// Fixture helpers — create Pendiente quotations in various completeness states.
// ---------------------------------------------------------------------------
async function createIncompleteQuotation() {
  // Pendiente, NO monto_total, NO fecha_validez, NO line items → fails checklist.
  const correlativo = `CHK-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const [res] = await pool.execute(
    `INSERT INTO cotizaciones
       (numero_correlativo, id_cliente, id_ejecutivo, descripcion, fecha_emision, estado,
        monto_total, fecha_validez)
     VALUES (?, ?, ?, ?, CURDATE(), 'Pendiente', NULL, NULL)`,
    [correlativo.slice(0, 20), testClienteId, testEjecutivoId, 'Cotización incompleta CHK']
  );
  createdCotizaciones.push(res.insertId);
  return res.insertId;
}

async function createCompleteQuotation() {
  // Pendiente with monto_total, fecha_validez, and one line item → passes checklist.
  const correlativo = `CHKOK-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const [res] = await pool.execute(
    `INSERT INTO cotizaciones
       (numero_correlativo, id_cliente, id_ejecutivo, descripcion, fecha_emision, estado,
        monto_total, fecha_validez)
     VALUES (?, ?, ?, ?, CURDATE(), 'Pendiente', 300.00, DATE_ADD(CURDATE(), INTERVAL 15 DAY))`,
    [correlativo.slice(0, 20), testClienteId, testEjecutivoId, 'Cotización completa CHK']
  );
  const id = res.insertId;
  createdCotizaciones.push(id);
  await pool.execute(
    `INSERT INTO cotizacion_detalles
       (id_cotizacion, descripcion_item, cantidad, precio_unitario, subtotal, unidad)
     VALUES (?, 'Repuesto de prueba', 2, 150.00, 300.00, 'UND')`,
    [id]
  );
  return id;
}

// ---------------------------------------------------------------------------
beforeAll(async () => {
  // Clean leftover fixtures from prior runs
  await pool.execute('DELETE FROM cotizacion_detalles WHERE id_cotizacion IN (SELECT id FROM cotizaciones WHERE id_ejecutivo IN (SELECT id FROM usuarios WHERE nombre_usuario = ?))', [EJEC_USER]);
  await pool.execute('DELETE FROM cotizaciones WHERE id_ejecutivo IN (SELECT id FROM usuarios WHERE nombre_usuario = ?)', [EJEC_USER]);
  await pool.execute('DELETE FROM usuarios WHERE nombre_usuario IN (?, ?)', [JEFE_USER, EJEC_USER]);
  await pool.execute('DELETE FROM clientes WHERE razon_social = ?', [CLIENT_NAME]);

  const hash = await bcrypt.hash(TEST_PASSWORD, 10);

  const [jefeRes] = await pool.execute(
    `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo)
     VALUES (?, ?, ?, 3, 1)`,
    ['Test Jefe CHK', JEFE_USER, hash]
  );
  testJefeId = jefeRes.insertId;

  const [ejecRes] = await pool.execute(
    `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo)
     VALUES (?, ?, ?, 1, 1)`,
    ['Test Ejecutivo CHK', EJEC_USER, hash]
  );
  testEjecutivoId = ejecRes.insertId;

  const [clientRes] = await pool.execute(
    `INSERT INTO clientes (razon_social, activo) VALUES (?, 1)`,
    [CLIENT_NAME]
  );
  testClienteId = clientRes.insertId;

  const jefeLogin = await request(app)
    .post('/api/auth/login')
    .send({ nombre_usuario: JEFE_USER, password: TEST_PASSWORD });
  expect(jefeLogin.status).toBe(200);
  tokenJefe = jefeLogin.body.data.token;
});

afterAll(async () => {
  if (createdCotizaciones.length > 0) {
    const placeholders = createdCotizaciones.map(() => '?').join(', ');
    await pool.execute(`DELETE FROM cotizacion_detalles WHERE id_cotizacion IN (${placeholders})`, createdCotizaciones);
    await pool.execute(`DELETE FROM cotizaciones WHERE id IN (${placeholders})`, createdCotizaciones);
  }
  await pool.execute('DELETE FROM usuarios WHERE id IN (?, ?)', [testJefeId, testEjecutivoId]);
  await pool.execute('DELETE FROM clientes WHERE id = ?', [testClienteId]);
  await pool.end();
});

// =============================================================================
// The bug: these approval entry points must NOT accept an incomplete quotation.
// =============================================================================
describe('CHK — Pre-submission checklist is enforced on every approval entry point', () => {

  test('CHK-01: POST /:id/aprobar (aprobado=true) rejects an incomplete quotation with 422', async () => {
    const id = await createIncompleteQuotation();
    const res = await request(app)
      .post(`/api/cotizaciones/${id}/aprobar`)
      .set('Authorization', `Bearer ${tokenJefe}`)
      .send({ aprobado: true });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);

    // Confirm the quotation was NOT actually approved in the DB.
    const [rows] = await pool.execute('SELECT estado FROM cotizaciones WHERE id = ?', [id]);
    expect(rows[0].estado).toBe('Pendiente');
  });

  test('CHK-02: PUT /:id/estado direct to "Aprobada internamente" rejects an incomplete quotation with 422', async () => {
    const id = await createIncompleteQuotation();
    const res = await request(app)
      .put(`/api/cotizaciones/${id}/estado`)
      .set('Authorization', `Bearer ${tokenJefe}`)
      .send({ nuevo_estado: 'Aprobada internamente' });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);

    const [rows] = await pool.execute('SELECT estado FROM cotizaciones WHERE id = ?', [id]);
    expect(rows[0].estado).toBe('Pendiente');
  });

  test('CHK-03: PUT /:id/estado direct to "Enviada al cliente" rejects an incomplete quotation with 422', async () => {
    const id = await createIncompleteQuotation();
    const res = await request(app)
      .put(`/api/cotizaciones/${id}/estado`)
      .set('Authorization', `Bearer ${tokenJefe}`)
      .send({ nuevo_estado: 'Enviada al cliente' });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);

    const [rows] = await pool.execute('SELECT estado FROM cotizaciones WHERE id = ?', [id]);
    expect(rows[0].estado).toBe('Pendiente');
  });

  // ── Guard-rails: the fix must not over-block legitimate flows ───────────────

  test('CHK-04: POST /:id/aprobar (aprobado=false) still allows REJECTING an incomplete quotation', async () => {
    const id = await createIncompleteQuotation();
    const res = await request(app)
      .post(`/api/cotizaciones/${id}/aprobar`)
      .set('Authorization', `Bearer ${tokenJefe}`)
      .send({ aprobado: false, observaciones: 'Faltan datos; se rechaza.' });

    expect(res.status).toBe(200);
    const [rows] = await pool.execute('SELECT estado FROM cotizaciones WHERE id = ?', [id]);
    expect(rows[0].estado).toBe('Rechazada');
  });

  test('CHK-05: a COMPLETE quotation still approves normally via POST /:id/aprobar', async () => {
    const id = await createCompleteQuotation();
    const res = await request(app)
      .post(`/api/cotizaciones/${id}/aprobar`)
      .set('Authorization', `Bearer ${tokenJefe}`)
      .send({ aprobado: true });

    expect(res.status).toBe(200);
    const [rows] = await pool.execute('SELECT estado FROM cotizaciones WHERE id = ?', [id]);
    expect(rows[0].estado).toBe('Aprobada internamente');
  });

  test('CHK-06: a COMPLETE quotation still approves via PUT /:id/estado direct transition', async () => {
    const id = await createCompleteQuotation();
    const res = await request(app)
      .put(`/api/cotizaciones/${id}/estado`)
      .set('Authorization', `Bearer ${tokenJefe}`)
      .send({ nuevo_estado: 'Aprobada internamente' });

    expect(res.status).toBe(200);
    const [rows] = await pool.execute('SELECT estado FROM cotizaciones WHERE id = ?', [id]);
    expect(rows[0].estado).toBe('Aprobada internamente');
  });
});
