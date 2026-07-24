// =============================================================================
// tests/integration/clientUpdatePreserve.test.js
// Partial client update must PRESERVE fields the caller omitted.
//
// Bug: ClientController.update applied the "keep existing value when the field
// is omitted (undefined)" rule only to direccion/ciudad/id_origen_cliente, while
// ClientModel.update unconditionally overwrites every column (falsy → NULL). So
// a request that legitimately omits contacto/email/telefono/nit — e.g. the
// reactivate button or a rename-only action, which post a fixed field list —
// silently wiped that client's stored contact info.
//
// These tests pin the rule: an OMITTED field is preserved; an explicitly-sent
// empty string still clears it on purpose.
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
let testAdminId;
const createdClientes = [];

const ADMIN_USER    = 'test_admin_cliupd';
const TEST_PASSWORD = 'TestCliUpd01!';

async function createClienteFull() {
  const [res] = await pool.execute(
    `INSERT INTO clientes (razon_social, nit, contacto, email, telefono, direccion, ciudad, activo)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    ['Cliente Full CLIUPD', `NIT-${Date.now()}`, 'Juan Contacto', 'juan@example.com', '77712345', 'Av. Siempre Viva 123', 'Santa Cruz']
  );
  createdClientes.push(res.insertId);
  return res.insertId;
}

beforeAll(async () => {
  await pool.execute('DELETE FROM usuarios WHERE nombre_usuario = ?', [ADMIN_USER]);
  await pool.execute('DELETE FROM clientes WHERE razon_social = ?', ['Cliente Full CLIUPD']);

  const hash = await bcrypt.hash(TEST_PASSWORD, 10);
  const [adminRes] = await pool.execute(
    `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo)
     VALUES (?, ?, ?, 2, 1)`,
    ['Test Admin CLIUPD', ADMIN_USER, hash]
  );
  testAdminId = adminRes.insertId;

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
  await pool.execute('DELETE FROM usuarios WHERE id = ?', [testAdminId]);
  await pool.end();
});

describe('CLIUPD — partial client update preserves omitted fields', () => {

  test('CLIUPD-01: reactivate-only update (razon_social + activo) preserves contacto/email/telefono/nit', async () => {
    const id = await createClienteFull();

    const res = await request(app)
      .put(`/api/clientes/${id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ razon_social: 'Cliente Full CLIUPD', activo: true });

    expect(res.status).toBe(200);

    const [rows] = await pool.execute(
      'SELECT contacto, email, telefono, nit FROM clientes WHERE id = ?',
      [id]
    );
    expect(rows[0].contacto).toBe('Juan Contacto');
    expect(rows[0].email).toBe('juan@example.com');
    expect(rows[0].telefono).toBe('77712345');
    expect(rows[0].nit).toMatch(/^NIT-/);
  });

  test('CLIUPD-02: rename-only update preserves the other contact fields', async () => {
    const id = await createClienteFull();

    const res = await request(app)
      .put(`/api/clientes/${id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ razon_social: 'Cliente Renombrado CLIUPD' });

    expect(res.status).toBe(200);

    const [rows] = await pool.execute(
      'SELECT razon_social, contacto, email, telefono FROM clientes WHERE id = ?',
      [id]
    );
    expect(rows[0].razon_social).toBe('Cliente Renombrado CLIUPD');
    expect(rows[0].contacto).toBe('Juan Contacto');
    expect(rows[0].email).toBe('juan@example.com');
    expect(rows[0].telefono).toBe('77712345');
  });

  test('CLIUPD-03: explicitly sending empty strings STILL clears those fields (intentional erase)', async () => {
    const id = await createClienteFull();

    const res = await request(app)
      .put(`/api/clientes/${id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ razon_social: 'Cliente Full CLIUPD', contacto: '', email: '', telefono: '' });

    expect(res.status).toBe(200);

    const [rows] = await pool.execute(
      'SELECT contacto, email, telefono FROM clientes WHERE id = ?',
      [id]
    );
    expect(rows[0].contacto).toBeNull();
    expect(rows[0].email).toBeNull();
    expect(rows[0].telefono).toBeNull();
  });

  test('CLIUPD-04: a provided value still updates the field', async () => {
    const id = await createClienteFull();

    const res = await request(app)
      .put(`/api/clientes/${id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ razon_social: 'Cliente Full CLIUPD', contacto: 'Nuevo Contacto' });

    expect(res.status).toBe(200);

    const [rows] = await pool.execute('SELECT contacto FROM clientes WHERE id = ?', [id]);
    expect(rows[0].contacto).toBe('Nuevo Contacto');
  });
});
