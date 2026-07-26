// =============================================================================
// tests/integration/nitConflictInactive.test.js
// Bug 5.2 — findByNit filtered WHERE activo = 1, but the clientes.nit UNIQUE
// index is table-wide (active or not). So when a NEW client collided on the NIT
// of a DEACTIVATED client, MySQL raised ER_DUP_ENTRY, the controller called
// findByNit to reveal the conflicting client for the "select this one instead"
// flow — and got null, leaving the 409 response with no conflictingClient data.
// The reactivation-by-NIT workflow silently failed for exactly the case it exists for.
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

let tokenAdmin;
let adminId;
let inactiveClientId;
const DUP_NIT = `NIT-INACT-${Date.now()}`.slice(0, 20);

const ADMIN_USER    = 'test_admin_nitconf';
const TEST_PASSWORD = 'TestNitConf01!';

beforeAll(async () => {
  await pool.execute('DELETE FROM usuarios WHERE nombre_usuario = ?', [ADMIN_USER]);
  await pool.execute('DELETE FROM clientes WHERE nit = ?', [DUP_NIT]);

  const hash = await bcrypt.hash(TEST_PASSWORD, 10);
  const [adminRes] = await pool.execute(
    `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo)
     VALUES (?, ?, ?, 2, 1)`,
    ['Test Admin NITCONF', ADMIN_USER, hash]
  );
  adminId = adminRes.insertId;

  // A DEACTIVATED client that owns the NIT.
  const [cliRes] = await pool.execute(
    `INSERT INTO clientes (razon_social, nit, activo) VALUES (?, ?, 0)`,
    ['Cliente Inactivo NITCONF', DUP_NIT]
  );
  inactiveClientId = cliRes.insertId;

  const login = await request(app)
    .post('/api/auth/login')
    .send({ nombre_usuario: ADMIN_USER, password: TEST_PASSWORD });
  expect(login.status).toBe(200);
  tokenAdmin = login.body.data.token;
});

afterAll(async () => {
  await pool.execute('DELETE FROM clientes WHERE nit = ?', [DUP_NIT]);
  await pool.execute('DELETE FROM usuarios WHERE id = ?', [adminId ?? 0]);
  await pool.end();
});

describe('NITCONF — NIT conflict reveals a DEACTIVATED client', () => {
  test('creating a client with an inactive client\'s NIT returns 409 WITH the conflicting client', async () => {
    const res = await request(app)
      .post('/api/clientes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ razon_social: 'Cliente Nuevo NITCONF', nit: DUP_NIT });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    // The whole point of the fix: the deactivated owner is surfaced so the UI
    // can offer "reactivate/select this client instead".
    expect(res.body.data).toBeDefined();
    expect(res.body.data.conflictingClient).toBeDefined();
    expect(res.body.data.conflictingClient.id).toBe(inactiveClientId);
    expect(res.body.data.conflictingClient.nit).toBe(DUP_NIT);
  });
});
