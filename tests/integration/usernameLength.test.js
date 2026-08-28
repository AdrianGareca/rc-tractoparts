// =============================================================================
// tests/integration/usernameLength.test.js
// ALTO — createUser no validaba el largo de nombre_usuario, sólo el charset.
//
// EL BUG
// loginSchema (authValidator.js) exige nombre_usuario entre 3 y 50
// caracteres, pero createUser (userController.js) sólo corría USERNAME_REGEX
// (el charset). Un nombre de 1-2 caracteres se creaba (201) y después nunca
// podía loguearse (login siempre lo rechaza por el mínimo); uno de más de 50
// reventaba con un 500 al chocar contra el ancho de la columna en la base.
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

let tokenJefe;
let idJefe;
const createdUsernames = [];

const U_JEFE   = 'test_jefe_userlen';
const PASSWORD = 'TestUserLen01!';

beforeAll(async () => {
  await pool.execute('DELETE FROM usuarios WHERE nombre_usuario = ?', [U_JEFE]);

  const hash = await bcrypt.hash(PASSWORD, 10);
  const [res] = await pool.execute(
    `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo)
     VALUES (?, ?, ?, 3, 1)`,
    ['Test Jefe USERLEN', U_JEFE, hash]
  );
  idJefe = res.insertId;

  const login = await request(app)
    .post('/api/auth/login')
    .send({ nombre_usuario: U_JEFE, password: PASSWORD });
  expect(login.status).toBe(200);
  tokenJefe = login.body.data.token;
});

afterAll(async () => {
  if (createdUsernames.length > 0) {
    const placeholders = createdUsernames.map(() => '?').join(', ');
    await pool.execute(`DELETE FROM usuarios WHERE nombre_usuario IN (${placeholders})`, createdUsernames);
  }
  await pool.execute('DELETE FROM usuarios WHERE id = ?', [idJefe ?? 0]);
  await pool.end();
});

function crearBody(nombreUsuario) {
  return {
    nombre_completo: 'Usuario De Prueba',
    nombre_usuario:  nombreUsuario,
    password:        'ClaveValida01!',
    id_rol:          1,
  };
}

describe('USERLEN — largo mínimo/máximo de nombre_usuario en createUser', () => {

  test('USERLEN-01: un nombre_usuario de 2 caracteres es rechazado con 422 (no 201)', async () => {
    const username = 'ab';
    createdUsernames.push(username);

    const res = await request(app)
      .post('/api/usuarios')
      .set('Authorization', `Bearer ${tokenJefe}`)
      .send(crearBody(username));

    expect(res.status).toBe(422);

    const [rows] = await pool.execute('SELECT id FROM usuarios WHERE nombre_usuario = ?', [username]);
    expect(rows.length).toBe(0);
  });

  test('USERLEN-02: un nombre_usuario de 60 caracteres es rechazado con 422 (no un 500)', async () => {
    const username = 'a'.repeat(60);
    createdUsernames.push(username);

    const res = await request(app)
      .post('/api/usuarios')
      .set('Authorization', `Bearer ${tokenJefe}`)
      .send(crearBody(username));

    expect(res.status).toBe(422);

    const [rows] = await pool.execute('SELECT id FROM usuarios WHERE nombre_usuario = ?', [username]);
    expect(rows.length).toBe(0);
  });

  test('USERLEN-03: un nombre_usuario de 3 caracteres (el mínimo válido) se crea normalmente', async () => {
    const username = `u${Date.now()}`.slice(0, 3);
    createdUsernames.push(username);

    const res = await request(app)
      .post('/api/usuarios')
      .set('Authorization', `Bearer ${tokenJefe}`)
      .send(crearBody(username));

    expect(res.status).toBe(201);
  });

  test('USERLEN-04: un nombre_usuario de 50 caracteres (el máximo válido) se crea normalmente', async () => {
    const username = `userlen${Date.now()}`.padEnd(50, 'x').slice(0, 50);
    createdUsernames.push(username);

    const res = await request(app)
      .post('/api/usuarios')
      .set('Authorization', `Bearer ${tokenJefe}`)
      .send(crearBody(username));

    expect(res.status).toBe(201);
  });
});
