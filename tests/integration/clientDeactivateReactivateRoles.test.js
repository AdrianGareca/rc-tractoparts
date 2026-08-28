// =============================================================================
// tests/integration/clientDeactivateReactivateRoles.test.js
// MEDIO — cualquier rol autenticado podía desactivar/reactivar cualquier cliente.
//
// EL BUG
// Los 5 roles (Ejecutivo, Administracion, Jefe, Proyectos, SysAdmin) tenían el
// mismo permiso para DELETE (desactivar) y para el PUT de reactivación
// (activo:true) que para crear/editar/listar/ver clientes. Se restringen esos
// dos verbos a Administracion/Jefe/SysAdmin; Ejecutivo y Proyectos conservan
// acceso normal al resto del CRUD.
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

let tokenEjecutivo, tokenProyectos, tokenAdmin;
let idEjecutivo, idProyectos, idAdmin;
const createdClientes = [];

const U_EJEC  = 'test_ejec_deactroles';
const U_PROY  = 'test_proy_deactroles';
const U_ADMIN = 'test_admin_deactroles';
const PASSWORD = 'TestDeactRoles01!';

async function crearUsuario(nombreUsuario, idRol) {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const [res] = await pool.execute(
    `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo)
     VALUES (?, ?, ?, ?, 1)`,
    [`Test ${nombreUsuario}`, nombreUsuario, hash, idRol]
  );
  return res.insertId;
}

async function login(nombreUsuario) {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ nombre_usuario: nombreUsuario, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.data.token;
}

async function crearCliente(razonSocial, activo = 1) {
  const [res] = await pool.execute(
    `INSERT INTO clientes (razon_social, activo) VALUES (?, ?)`,
    [razonSocial, activo]
  );
  createdClientes.push(res.insertId);
  return res.insertId;
}

beforeAll(async () => {
  for (const u of [U_EJEC, U_PROY, U_ADMIN]) {
    await pool.execute('DELETE FROM usuarios WHERE nombre_usuario = ?', [u]);
  }

  idEjecutivo = await crearUsuario(U_EJEC, 1);
  idProyectos = await crearUsuario(U_PROY, 5);
  idAdmin     = await crearUsuario(U_ADMIN, 2);

  tokenEjecutivo = await login(U_EJEC);
  tokenProyectos = await login(U_PROY);
  tokenAdmin     = await login(U_ADMIN);
});

afterAll(async () => {
  if (createdClientes.length > 0) {
    const placeholders = createdClientes.map(() => '?').join(', ');
    await pool.execute(`DELETE FROM clientes WHERE id IN (${placeholders})`, createdClientes);
  }
  for (const id of [idEjecutivo, idProyectos, idAdmin]) {
    await pool.execute('DELETE FROM usuarios WHERE id = ?', [id ?? 0]);
  }
  await pool.end();
});

describe('CLIROLES — desactivar/reactivar cliente restringido a Administracion/Jefe/SysAdmin', () => {

  test('CLIROLES-01: Ejecutivo recibe 403 en DELETE /api/clientes/:id', async () => {
    const id = await crearCliente('Cliente CLIROLES Ejec Delete');

    const res = await request(app)
      .delete(`/api/clientes/${id}`)
      .set('Authorization', `Bearer ${tokenEjecutivo}`);

    expect(res.status).toBe(403);

    const [rows] = await pool.execute('SELECT activo FROM clientes WHERE id = ?', [id]);
    expect(rows[0].activo).toBe(1);
  });

  test('CLIROLES-02: Proyectos recibe 403 en DELETE /api/clientes/:id', async () => {
    const id = await crearCliente('Cliente CLIROLES Proy Delete');

    const res = await request(app)
      .delete(`/api/clientes/${id}`)
      .set('Authorization', `Bearer ${tokenProyectos}`);

    expect(res.status).toBe(403);
  });

  test('CLIROLES-03: Ejecutivo recibe 403 al intentar REACTIVAR vía PUT (activo:true)', async () => {
    const id = await crearCliente('Cliente CLIROLES Ejec Reactivar', 0);

    const res = await request(app)
      .put(`/api/clientes/${id}`)
      .set('Authorization', `Bearer ${tokenEjecutivo}`)
      .send({ razon_social: 'Cliente CLIROLES Ejec Reactivar', activo: true });

    expect(res.status).toBe(403);

    const [rows] = await pool.execute('SELECT activo FROM clientes WHERE id = ?', [id]);
    expect(rows[0].activo).toBe(0);
  });

  test('CLIROLES-04: Proyectos recibe 403 al intentar REACTIVAR vía PUT (activo:true)', async () => {
    const id = await crearCliente('Cliente CLIROLES Proy Reactivar', 0);

    const res = await request(app)
      .put(`/api/clientes/${id}`)
      .set('Authorization', `Bearer ${tokenProyectos}`)
      .send({ razon_social: 'Cliente CLIROLES Proy Reactivar', activo: true });

    expect(res.status).toBe(403);
  });

  test('CLIROLES-05: Ejecutivo SÍ puede seguir editando datos normales de un cliente activo (comportamiento intacto)', async () => {
    const id = await crearCliente('Cliente CLIROLES Ejec Editar');

    const res = await request(app)
      .put(`/api/clientes/${id}`)
      .set('Authorization', `Bearer ${tokenEjecutivo}`)
      .send({ razon_social: 'Cliente CLIROLES Ejec Editado' });

    expect(res.status).toBe(200);
  });

  test('CLIROLES-06: Administracion SÍ puede desactivar y reactivar un cliente (comportamiento intacto)', async () => {
    const id = await crearCliente('Cliente CLIROLES Admin OK');

    const resDelete = await request(app)
      .delete(`/api/clientes/${id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resDelete.status).toBe(200);

    const resReactivar = await request(app)
      .put(`/api/clientes/${id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ razon_social: 'Cliente CLIROLES Admin OK', activo: true });
    expect(resReactivar.status).toBe(200);

    const [rows] = await pool.execute('SELECT activo FROM clientes WHERE id = ?', [id]);
    expect(rows[0].activo).toBe(1);
  });
});
