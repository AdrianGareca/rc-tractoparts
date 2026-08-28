// =============================================================================
// tests/integration/licitacionFiltrosListado.test.js
//
// Hallazgo BAJO — GET /api/licitaciones con filtros inválidos respondía 200
// vacío en vez de 422.
//
// buildWhereClause (LicitacionModel.js) arma el WHERE a partir de `estado` e
// `id_responsable` tal como llegan, sin validarlos: un `estado=NoExiste` o un
// `id_responsable=abc` produce un WHERE que ninguna fila cumple, y el listado
// responde `200 { total: 0, data: [] }` — indistinguible de "no hay
// licitaciones con ese filtro válido". validateListFilters (en
// licitacionValidator.js) ahora corta esto ANTES de tocar la base.
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

jest.setTimeout(30000);

const USERNAME = 'test_lic_filtros';
const PASSWORD = 'TestLicFiltro01!';

let token;

beforeAll(async () => {
  await pool.execute('DELETE FROM usuarios WHERE nombre_usuario = ?', [USERNAME]);
  const hash = await bcrypt.hash(PASSWORD, 10);
  await pool.execute(
    `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo)
     VALUES (?, ?, ?, 3, 1)`, // Jefe
    ['Test Jefe Filtros LIC', USERNAME, hash]
  );

  const login = await request(app)
    .post('/api/auth/login')
    .send({ nombre_usuario: USERNAME, password: PASSWORD });
  expect(login.status).toBe(200);
  token = login.body.data.token;
});

afterAll(async () => {
  await pool.execute('DELETE FROM usuarios WHERE nombre_usuario = ?', [USERNAME]);
  await pool.end();
});

describe('LICFILT — filtros de listado inválidos → 422', () => {

  test('LICFILT-01: estado inexistente → 422', async () => {
    const res = await request(app)
      .get('/api/licitaciones?estado=NoExiste')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  test('LICFILT-02: id_responsable no numérico → 422', async () => {
    const res = await request(app)
      .get('/api/licitaciones?id_responsable=abc')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  test('LICFILT-03: estado válido → 200, sigue funcionando', async () => {
    const res = await request(app)
      .get('/api/licitaciones?estado=Cotizando')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('LICFILT-04: sin filtros → 200, comportamiento normal sin cambios', async () => {
    const res = await request(app)
      .get('/api/licitaciones')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
