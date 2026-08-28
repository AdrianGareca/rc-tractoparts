// =============================================================================
// tests/integration/clienteOrigenInvalido.test.js
// ALTO — id_origen_cliente inválido reventaba con 500 en vez de 422.
//
// EL BUG
// POST /api/clientes y PUT /api/clientes/:id con un id_origen_cliente que no
// existe en origenes_cliente llegaban hasta el INSERT/UPDATE, y la
// restricción de clave foránea los rechazaba con una excepción sin capturar:
// HTTP 500 genérico en vez de un 422 claro. Mismo patrón ya resuelto para
// id_cliente/id_licitacion en cotizaciones (clienteLinkGuard.js).
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

let tokenAdmin;
let idAdmin;
let idOrigenValido;
const createdClientes = [];

const ADMIN_USER    = 'test_admin_origeninv';
const TEST_PASSWORD = 'TestOrigenInv01!';
const ID_ORIGEN_INEXISTENTE = 999999;

beforeAll(async () => {
  await pool.execute('DELETE FROM usuarios WHERE nombre_usuario = ?', [ADMIN_USER]);

  const hash = await bcrypt.hash(TEST_PASSWORD, 10);
  const [adminRes] = await pool.execute(
    `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo)
     VALUES (?, ?, ?, 2, 1)`,
    ['Test Admin ORIGENINV', ADMIN_USER, hash]
  );
  idAdmin = adminRes.insertId;

  const [origenRows] = await pool.execute('SELECT id FROM origenes_cliente LIMIT 1');
  idOrigenValido = origenRows[0].id;

  const login = await request(app)
    .post('/api/auth/login')
    .send({ nombre_usuario: ADMIN_USER, password: TEST_PASSWORD });
  expect(login.status).toBe(200);
  tokenAdmin = login.body.data.token;
});

afterAll(async () => {
  if (createdClientes.length > 0) {
    const placeholders = createdClientes.map(() => '?').join(', ');
    await pool.execute(`DELETE FROM clientes WHERE id IN (${placeholders})`, createdClientes);
  }
  await pool.execute('DELETE FROM usuarios WHERE id = ?', [idAdmin ?? 0]);
  await pool.end();
});

describe('ORIGENINV — id_origen_cliente inválido devuelve 422, no 500', () => {

  test('ORIGENINV-01: POST /api/clientes con id_origen_cliente inexistente devuelve 422', async () => {
    const res = await request(app)
      .post('/api/clientes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ razon_social: 'Cliente Origen Invalido POST', id_origen_cliente: ID_ORIGEN_INEXISTENTE });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  test('ORIGENINV-02: POST /api/clientes con id_origen_cliente válido se crea normalmente (201)', async () => {
    const res = await request(app)
      .post('/api/clientes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ razon_social: 'Cliente Origen Valido POST', id_origen_cliente: idOrigenValido });

    expect(res.status).toBe(201);
    createdClientes.push(res.body.data.id);
  });

  test('ORIGENINV-03: PUT /api/clientes/:id con id_origen_cliente inexistente devuelve 422 (no 500)', async () => {
    const [createRes] = await pool.execute(
      `INSERT INTO clientes (razon_social, activo) VALUES (?, 1)`,
      ['Cliente Origen Invalido PUT']
    );
    const id = createRes.insertId;
    createdClientes.push(id);

    const res = await request(app)
      .put(`/api/clientes/${id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ razon_social: 'Cliente Origen Invalido PUT', id_origen_cliente: ID_ORIGEN_INEXISTENTE });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  test('ORIGENINV-04: PUT que omite id_origen_cliente conserva el valor ya guardado (no lo valida de nuevo)', async () => {
    const [createRes] = await pool.execute(
      `INSERT INTO clientes (razon_social, activo, id_origen_cliente) VALUES (?, 1, ?)`,
      ['Cliente Origen Omitido PUT', idOrigenValido]
    );
    const id = createRes.insertId;
    createdClientes.push(id);

    const res = await request(app)
      .put(`/api/clientes/${id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ razon_social: 'Cliente Origen Omitido PUT Renombrado' });

    expect(res.status).toBe(200);

    const [rows] = await pool.execute('SELECT id_origen_cliente FROM clientes WHERE id = ?', [id]);
    expect(rows[0].id_origen_cliente).toBe(idOrigenValido);
  });
});
