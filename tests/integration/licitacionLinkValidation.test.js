// =============================================================================
// tests/integration/licitacionLinkValidation.test.js
// Bug 4.3 — updateQuotation must validate id_licitacion like createQuotation does.
//
// createQuotation pre-checks that a linked licitación exists and returns a clean
// 422; updateQuotation passed req.body.id_licitacion straight through, so a
// non-existent id produced a raw FK-violation 500 ("Failed to update quotation")
// instead of an actionable validation error.
//
// This file also acts as the regression guard for the Tanda-4 deletions of the
// dead "column-missing" fallbacks in readRepository.findById / findAll: it
// exercises GET /:id (findById) and GET /?id_licitacion=X (findAll + the
// id_licitacion filter) against the fully-migrated test DB, so a broken query
// after the simplification would fail here.
//
// Prerequisites: NODE_ENV=test — test database (DB_NAME_TEST) must exist & be migrated.
// =============================================================================

'use strict';

require('dotenv').config();
process.env.NODE_ENV = 'test';

const request  = require('supertest');
const bcrypt   = require('bcryptjs');
const app      = require('../../src/app');
const { pool } = require('../../src/config/db');

jest.setTimeout(30000); // updateQuotation may regenerate the PDF (slow)

let tokenEjec;
let ejecId;
let clienteId;
let licitacionId;
let cotizacionId;

const EJEC_USER     = 'test_ejec_liclink';
const TEST_PASSWORD = 'TestLicLink01!';
const CLIENT_NAME   = 'Test Client LICLINK';

const validBody = (overrides = {}) => ({
  id_cliente:    clienteId,
  descripcion:   'Cotización de prueba LICLINK',
  fecha_emision: '2026-07-24',
  detalles: [
    { descripcion_item: 'Repuesto de prueba', cantidad: 1, precio_unitario: 100 },
  ],
  ...overrides,
});

beforeAll(async () => {
  await pool.execute('DELETE FROM cotizacion_detalles WHERE id_cotizacion IN (SELECT id FROM cotizaciones WHERE id_ejecutivo IN (SELECT id FROM usuarios WHERE nombre_usuario = ?))', [EJEC_USER]);
  await pool.execute('DELETE FROM cotizaciones WHERE id_ejecutivo IN (SELECT id FROM usuarios WHERE nombre_usuario = ?)', [EJEC_USER]);
  await pool.execute('DELETE FROM licitaciones WHERE nombre = ?', ['Licitación LICLINK']);
  await pool.execute('DELETE FROM usuarios WHERE nombre_usuario = ?', [EJEC_USER]);
  await pool.execute('DELETE FROM clientes WHERE razon_social = ?', [CLIENT_NAME]);

  const hash = await bcrypt.hash(TEST_PASSWORD, 10);
  const [ejecRes] = await pool.execute(
    `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo)
     VALUES (?, ?, ?, 1, 1)`,
    ['Test Ejecutivo LICLINK', EJEC_USER, hash]
  );
  ejecId = ejecRes.insertId;

  const [clientRes] = await pool.execute(
    `INSERT INTO clientes (razon_social, activo) VALUES (?, 1)`,
    [CLIENT_NAME]
  );
  clienteId = clientRes.insertId;

  const [licRes] = await pool.execute(
    `INSERT INTO licitaciones (codigo, nombre, id_cliente, estado, id_responsable)
     VALUES (?, ?, ?, 'Cotizando', ?)`,
    [`LIC-CHK-${Date.now()}`.slice(0, 20), 'Licitación LICLINK', clienteId, ejecId]
  );
  licitacionId = licRes.insertId;

  const [cotRes] = await pool.execute(
    `INSERT INTO cotizaciones (numero_correlativo, id_cliente, id_ejecutivo, descripcion, fecha_emision, estado)
     VALUES (?, ?, ?, ?, CURDATE(), 'Pendiente')`,
    [`LL-${Date.now()}`.slice(0, 20), clienteId, ejecId, 'Cotización de prueba LICLINK']
  );
  cotizacionId = cotRes.insertId;
  await pool.execute(
    `INSERT INTO cotizacion_detalles (id_cotizacion, descripcion_item, cantidad, precio_unitario, subtotal, unidad)
     VALUES (?, 'Repuesto de prueba', 1, 100.00, 100.00, 'UND')`,
    [cotizacionId]
  );

  const login = await request(app)
    .post('/api/auth/login')
    .send({ nombre_usuario: EJEC_USER, password: TEST_PASSWORD });
  expect(login.status).toBe(200);
  tokenEjec = login.body.data.token;
});

afterAll(async () => {
  await pool.execute('DELETE FROM cotizacion_detalles WHERE id_cotizacion = ?', [cotizacionId ?? 0]);
  await pool.execute('DELETE FROM cotizaciones WHERE id = ?', [cotizacionId ?? 0]);
  await pool.execute('DELETE FROM licitaciones WHERE id = ?', [licitacionId ?? 0]);
  await pool.execute('DELETE FROM usuarios WHERE id = ?', [ejecId ?? 0]);
  await pool.execute('DELETE FROM clientes WHERE id = ?', [clienteId ?? 0]);
  await pool.end();
});

describe('TR4 — id_licitacion validation + read-path regression', () => {

  test('TR4-01: PUT /:id with a NON-EXISTENT id_licitacion returns 422 (not a raw 500)', async () => {
    const res = await request(app)
      .put(`/api/cotizaciones/${cotizacionId}`)
      .set('Authorization', `Bearer ${tokenEjec}`)
      .send(validBody({ id_licitacion: 999999999 }));

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  test('TR4-02: PUT /:id with a REAL id_licitacion links successfully (200)', async () => {
    const res = await request(app)
      .put(`/api/cotizaciones/${cotizacionId}`)
      .set('Authorization', `Bearer ${tokenEjec}`)
      .send(validBody({ id_licitacion: licitacionId }));

    expect(res.status).toBe(200);
    const [rows] = await pool.execute('SELECT id_licitacion FROM cotizaciones WHERE id = ?', [cotizacionId]);
    expect(rows[0].id_licitacion).toBe(licitacionId);
  });

  test('TR4-03: GET /:id returns the quotation with its id_licitacion (findById happy path)', async () => {
    const res = await request(app)
      .get(`/api/cotizaciones/${cotizacionId}`)
      .set('Authorization', `Bearer ${tokenEjec}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id_licitacion).toBe(licitacionId);
  });

  test('TR4-04: GET /?id_licitacion=X lists the linked quotation (findAll + filter happy path)', async () => {
    const res = await request(app)
      .get(`/api/cotizaciones?id_licitacion=${licitacionId}`)
      .set('Authorization', `Bearer ${tokenEjec}`);

    expect(res.status).toBe(200);
    const ids = (res.body.data ?? []).map(r => r.id);
    expect(ids).toContain(cotizacionId);
  });

  test('TR4-05: PUT /:id with id_licitacion = null UNLINKS the quotation (200)', async () => {
    const res = await request(app)
      .put(`/api/cotizaciones/${cotizacionId}`)
      .set('Authorization', `Bearer ${tokenEjec}`)
      .send(validBody({ id_licitacion: null }));

    expect(res.status).toBe(200);
    const [rows] = await pool.execute('SELECT id_licitacion FROM cotizaciones WHERE id = ?', [cotizacionId]);
    expect(rows[0].id_licitacion).toBeNull();
  });
});
