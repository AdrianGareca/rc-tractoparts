// =============================================================================
// tests/integration/correlativo.concurrencia.test.js
// Concurrency Test CC-01 — Serial Number Uniqueness Under Concurrent Load
// (Section 3.11.3 — Prueba de concurrencia)
//
// Verifies that N simultaneous POST /api/cotizaciones requests each receive a
// unique, non-duplicated correlativo. This is the critical correctness guarantee
// of the SELECT ... FOR UPDATE transaction in QuotationModel.generateCorrelativo.
//
// Prerequisites before running:
//   1. A test database (DB_NAME_TEST) must exist and be initialized with init.sql
//   2. At least 1 active cliente and 1 active Ejecutivo must exist in the test DB
//   3. NODE_ENV=test must be set (the pool automatically switches to DB_NAME_TEST)
//
// Run: npm test tests/integration/correlativo.concurrencia.test.js
// =============================================================================

'use strict';

require('dotenv').config();
process.env.NODE_ENV = 'test'; // Ensure the test database is used

const request    = require('supertest');
const bcrypt     = require('bcryptjs');
const app        = require('../../src/app');
const { pool }   = require('../../src/config/db');

// -----------------------------------------------------------------------
// Test configuration
// -----------------------------------------------------------------------
const N = 20; // Number of simultaneous quotation requests (see Section 3.11.3)

let tokenEjecutivo; // JWT for the Ejecutivo test user
let testClienteId;  // ID of the seeded client

// -----------------------------------------------------------------------
// beforeAll — seed the test database with the minimum required data
// -----------------------------------------------------------------------
beforeAll(async () => {
  // Clean up any previous test run residue
  await pool.execute('DELETE FROM bitacora_auditoria');
  await pool.execute('DELETE FROM cotizacion_detalles');
  await pool.execute('DELETE FROM cotizaciones');
  await pool.execute('DELETE FROM cotizaciones_correlativo');
  await pool.execute('DELETE FROM clientes WHERE razon_social = ?', ['Test Client CC-01']);
  await pool.execute('DELETE FROM usuarios WHERE nombre_usuario = ?', ['test_ejecutivo_cc01']);

  // Insert a test client
  const [clientResult] = await pool.execute(
    "INSERT INTO clientes (razon_social, activo) VALUES (?, 1)",
    ['Test Client CC-01']
  );
  testClienteId = clientResult.insertId;

  // Insert a test Ejecutivo user with a known password
  const passwordHash = await bcrypt.hash('TestPassword123!', 10);
  await pool.execute(
    `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo)
     VALUES (?, ?, ?, 1, 1)`,
    ['Test Ejecutivo CC01', 'test_ejecutivo_cc01', passwordHash]
  );

  // Authenticate and capture the JWT
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ nombre_usuario: 'test_ejecutivo_cc01', password: 'TestPassword123!' });

  expect(loginRes.status).toBe(200);
  tokenEjecutivo = loginRes.body.data.token;
});

// -----------------------------------------------------------------------
// afterAll — release the pool so Jest can exit cleanly
// -----------------------------------------------------------------------
afterAll(async () => {
  await pool.end();
});

// -----------------------------------------------------------------------
// CC-01 — Core concurrency test
// -----------------------------------------------------------------------
describe('CC-01: Correlativo uniqueness under concurrent access', () => {

  test(`${N} simultaneous quotation requests all receive unique correlativos`, async () => {
    // Explicit generous timeout: this test fires N real HTTP requests, each
    // running a full DB transaction plus synchronous PDF generation, against
    // a connection pool of DB_CONNECTION_LIMIT. Jest's global 5000ms default
    // is unrealistic here regardless of hardware — on constrained CI/dev
    // hardware the PDF rendering alone can take multiple seconds per request.
    // Build N request payloads (distinct descriptions to avoid duplicate-detection warnings)
    const payloads = Array.from({ length: N }, (_, i) => ({
      id_cliente:    testClienteId,
      descripcion:   `Concurrent test item #${i + 1} — CC-01`,
      fecha_emision: new Date().toISOString().split('T')[0], // Today's date: YYYY-MM-DD
      monto_total:   1000.00,
      moneda:        'USD',
      detalles: [
        {
          descripcion_item: `Repuesto de prueba CC-01 #${i + 1}`,
          cantidad:         2,
          precio_unitario:  500.00,
        },
      ],
    }));

    // Fire all N requests simultaneously — Promise.all resolves when all settle
    const responses = await Promise.all(
      payloads.map((body) =>
        request(app)
          .post('/api/cotizaciones')
          .set('Authorization', `Bearer ${tokenEjecutivo}`)
          .send(body)
      )
    );

    // --- Assertion 1: all requests returned HTTP 201 ---
    const statusCodes = responses.map((r) => r.status);
    const failedRequests = statusCodes.filter((code) => code !== 201);
    expect(failedRequests).toHaveLength(0);

    // --- Assertion 2: extract all assigned correlativos ---
    const correlativos = responses.map((r) => r.body.data.numero_correlativo);

    // None should be null or undefined (every response must include the serial)
    correlativos.forEach((corr, idx) => {
      expect(corr).toBeTruthy();
      expect(typeof corr).toBe('string');
      expect(corr).toMatch(/^SC-\d{4}\/\d{6}$/); // Format: SC-YYYY/NNNNNN
    });

    // --- Assertion 3: all correlativos are unique (no duplicates) ---
    const uniqueSet = new Set(correlativos);
    expect(uniqueSet.size).toBe(N); // If any duplicate existed, set.size < N

    // --- Assertion 4: the counter in the DB reflects exactly N increments ---
    const currentYear = new Date().getFullYear();
    const [counterRows] = await pool.execute(
      'SELECT ultimo_nro FROM cotizaciones_correlativo WHERE anio = ?',
      [currentYear]
    );
    expect(counterRows).toHaveLength(1);
    expect(counterRows[0].ultimo_nro).toBe(N);

    // --- Assertion 5: exactly N quotation rows were created in the database ---
    const [countRows] = await pool.execute(
      'SELECT COUNT(*) AS total FROM cotizaciones WHERE id_cliente = ?',
      [testClienteId]
    );
    expect(countRows[0].total).toBe(N);
  }, 120000);
});
