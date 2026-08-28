// =============================================================================
// tests/integration/userRoleEscalation.test.js
// CRÍTICO — Administracion podía auto-ascenderse a Jefe.
//
// EL BUG
// _validarPermisoSobreSysAdmin() en userController.js sólo restringía el
// salto hacia/desde SysAdmin. No había ninguna regla para:
//   1. Que un usuario se edite A SÍ MISMO el id_rol (con cualquier rol).
//   2. El salto Administracion→Jefe (Administracion podía promoverse a sí
//      mismo, o a cualquier otra cuenta, al rol "Jefe" — que aprueba
//      cotizaciones y gestiona usuarios).
//
// Este archivo también cubre el mismo hueco en createUser: crear una cuenta
// nueva directamente con id_rol=Jefe es el mismo salto de autoridad.
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

let tokenAdmin, tokenAdmin2, tokenJefe;
let idAdmin, idAdmin2, idJefe;

const U_ADMIN   = 'test_admin_rolesc';
const U_ADMIN2  = 'test_admin2_rolesc';
const U_JEFE    = 'test_jefe_rolesc';
const PASSWORD  = 'TestRolEsc01!';

const ID_ROL_EJECUTIVO     = 1;
const ID_ROL_ADMINISTACION = 2;
const ID_ROL_JEFE          = 3;

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

beforeAll(async () => {
  for (const u of [U_ADMIN, U_ADMIN2, U_JEFE]) {
    await pool.execute('DELETE FROM usuarios WHERE nombre_usuario = ?', [u]);
  }

  idAdmin  = await crearUsuario(U_ADMIN,  ID_ROL_ADMINISTACION);
  idAdmin2 = await crearUsuario(U_ADMIN2, ID_ROL_ADMINISTACION);
  idJefe   = await crearUsuario(U_JEFE,   ID_ROL_JEFE);

  tokenAdmin  = await login(U_ADMIN);
  tokenAdmin2 = await login(U_ADMIN2);
  tokenJefe   = await login(U_JEFE);
});

afterAll(async () => {
  for (const id of [idAdmin, idAdmin2, idJefe]) {
    await pool.execute('DELETE FROM usuarios WHERE id = ?', [id ?? 0]);
  }
  await pool.end();
});

describe('ROLESC — anti-escalación de roles en gestión de usuarios', () => {

  test('ROLESC-01: Administracion NO puede auto-ascenderse a Jefe (PUT sobre sí mismo)', async () => {
    const res = await request(app)
      .put(`/api/usuarios/${idAdmin}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ id_rol: ID_ROL_JEFE });

    expect(res.status).toBe(403);

    const [rows] = await pool.execute('SELECT id_rol FROM usuarios WHERE id = ?', [idAdmin]);
    expect(rows[0].id_rol).toBe(ID_ROL_ADMINISTACION);
  });

  test('ROLESC-02: Administracion NO puede ascender a OTRA cuenta a Jefe', async () => {
    const res = await request(app)
      .put(`/api/usuarios/${idAdmin2}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ id_rol: ID_ROL_JEFE });

    expect(res.status).toBe(403);

    const [rows] = await pool.execute('SELECT id_rol FROM usuarios WHERE id = ?', [idAdmin2]);
    expect(rows[0].id_rol).toBe(ID_ROL_ADMINISTACION);
  });

  test('ROLESC-03: NINGÚN usuario puede cambiarse su PROPIO id_rol, ni siquiera un Jefe', async () => {
    const res = await request(app)
      .put(`/api/usuarios/${idJefe}`)
      .set('Authorization', `Bearer ${tokenJefe}`)
      .send({ id_rol: ID_ROL_ADMINISTACION });

    expect(res.status).toBe(403);

    const [rows] = await pool.execute('SELECT id_rol FROM usuarios WHERE id = ?', [idJefe]);
    expect(rows[0].id_rol).toBe(ID_ROL_JEFE);
  });

  test('ROLESC-04: un Jefe SÍ puede ascender a OTRA cuenta a Jefe (comportamiento intacto)', async () => {
    const res = await request(app)
      .put(`/api/usuarios/${idAdmin2}`)
      .set('Authorization', `Bearer ${tokenJefe}`)
      .send({ id_rol: ID_ROL_JEFE });

    expect(res.status).toBe(200);

    const [rows] = await pool.execute('SELECT id_rol FROM usuarios WHERE id = ?', [idAdmin2]);
    expect(rows[0].id_rol).toBe(ID_ROL_JEFE);

    // Se revierte para no interferir con otros tests del mismo archivo.
    await pool.execute('UPDATE usuarios SET id_rol = ? WHERE id = ?', [ID_ROL_ADMINISTACION, idAdmin2]);
  });

  test('ROLESC-05: Administracion NO puede crear una cuenta nueva directamente con id_rol=Jefe', async () => {
    const res = await request(app)
      .post('/api/usuarios')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre_completo: 'Nuevo Jefe Colado',
        nombre_usuario:  'test_jefe_colado_rolesc',
        password:        'ClaveValida01!',
        id_rol:          ID_ROL_JEFE,
      });

    expect(res.status).toBe(403);

    await pool.execute('DELETE FROM usuarios WHERE nombre_usuario = ?', ['test_jefe_colado_rolesc']);
  });

  test('ROLESC-07: auto-edición SIN cambiar el rol (reenviando el mismo id_rol) sí funciona', async () => {
    // BUG encontrado por Adrian en vivo el mismo día del fix: el frontend
    // (userCrudModals.js) siempre manda id_rol en el body del PUT —el valor
    // ya seleccionado en el desplegable—, incluso si sólo se está cambiando
    // la contraseña o el nombre. El chequeo original bloqueaba esto con 403
    // sólo por la PRESENCIA de id_rol en el body, sin fijarse si el valor
    // pedido coincidía con el que la cuenta ya tenía. Reproduce exactamente
    // ese caso: Administracion se edita a sí misma reenviando su propio
    // id_rol sin cambiarlo, junto con un cambio real (nombre).
    const res = await request(app)
      .put(`/api/usuarios/${idAdmin}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ id_rol: ID_ROL_ADMINISTACION, nombre_completo: 'Test Admin Renombrado' });

    expect(res.status).toBe(200);

    const [rows] = await pool.execute('SELECT id_rol, nombre_completo FROM usuarios WHERE id = ?', [idAdmin]);
    expect(rows[0].id_rol).toBe(ID_ROL_ADMINISTACION);
    expect(rows[0].nombre_completo).toBe('Test Admin Renombrado');
  });

  test('ROLESC-06: Administracion SÍ puede crear cuentas con roles que no son Jefe/SysAdmin (comportamiento intacto)', async () => {
    const res = await request(app)
      .post('/api/usuarios')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre_completo: 'Nuevo Ejecutivo OK',
        nombre_usuario:  'test_ejec_ok_rolesc',
        password:        'ClaveValida01!',
        id_rol:          ID_ROL_EJECUTIVO,
      });

    expect(res.status).toBe(201);

    await pool.execute('DELETE FROM usuarios WHERE nombre_usuario = ?', ['test_ejec_ok_rolesc']);
  });

  // Al final a propósito: cambiar la propia contraseña invalida tokenAdmin
  // (token_version), así que ningún test de arriba puede depender de que
  // ese token siga sirviendo después de este.
  test('ROLESC-09: auto-edición de la PROPIA contraseña, reenviando el id_rol sin cambiar, sí funciona', async () => {
    const nuevaPassword = 'NuevaPasswordOK01!';
    const res = await request(app)
      .put(`/api/usuarios/${idAdmin}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ id_rol: ID_ROL_ADMINISTACION, password: nuevaPassword });

    expect(res.status).toBe(200);

    // La contraseña realmente cambió: login con la vieja falla, con la nueva funciona.
    const loginVieja = await request(app).post('/api/auth/login')
      .send({ nombre_usuario: U_ADMIN, password: PASSWORD });
    expect(loginVieja.status).toBe(401);

    const loginNueva = await request(app).post('/api/auth/login')
      .send({ nombre_usuario: U_ADMIN, password: nuevaPassword });
    expect(loginNueva.status).toBe(200);
  });
});
