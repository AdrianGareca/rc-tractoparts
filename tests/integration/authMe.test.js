// =============================================================================
// tests/integration/authMe.test.js
// Bug 5.3 — GET /api/auth/me: return the CURRENT user fresh from the DB.
//
// canApproveQuotations() on the SPA read the user cached in localStorage at
// login, so granting/revoking the delegation flag mid-session left the UI stale
// (showing or hiding delegated actions) until the next login. This endpoint lets
// the dashboard re-hydrate AuthSession from the DB on load. The flag is NOT in
// the JWT, so /me MUST read it from the database — this test flips it after login
// and asserts /me reflects the new value.
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

let token;
let ejecId;

const EJEC_USER     = 'test_ejec_authme';
const TEST_PASSWORD = 'TestAuthMe01!';

beforeAll(async () => {
  await pool.execute('DELETE FROM usuarios WHERE nombre_usuario = ?', [EJEC_USER]);
  const hash = await bcrypt.hash(TEST_PASSWORD, 10);
  // Ejecutivo WITHOUT delegation at login time.
  const [res] = await pool.execute(
    `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo, can_approve_quotations)
     VALUES (?, ?, ?, 1, 1, 0)`,
    ['Test Ejecutivo AUTHME', EJEC_USER, hash]
  );
  ejecId = res.insertId;

  const login = await request(app)
    .post('/api/auth/login')
    .send({ nombre_usuario: EJEC_USER, password: TEST_PASSWORD });
  expect(login.status).toBe(200);
  token = login.body.data.token;
  // At login the flag is false.
  expect(login.body.data.user.can_approve_quotations).toBe(false);
});

afterAll(async () => {
  await pool.execute('DELETE FROM usuarios WHERE id = ?', [ejecId ?? 0]);
  await pool.end();
});

describe('AUTHME — GET /api/auth/me', () => {
  test('AUTHME-01: without a token returns 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('AUTHME-02: returns the current user in the same shape as login', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const u = res.body.data.user;
    expect(u.id).toBe(ejecId);
    expect(u.nombre_usuario).toBe(EJEC_USER);
    expect(u.rol).toBe('Ejecutivo');
    expect(u).toHaveProperty('can_approve_quotations');
  });

  test('AUTHME-03: reflects a delegation flag flipped in the DB AFTER login (fresh, not from the JWT)', async () => {
    // Grant delegation directly in the DB — the existing token predates this.
    await pool.execute('UPDATE usuarios SET can_approve_quotations = 1 WHERE id = ?', [ejecId]);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user.can_approve_quotations).toBe(true);
  });
});
