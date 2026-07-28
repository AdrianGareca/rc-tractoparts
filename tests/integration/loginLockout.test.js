// =============================================================================
// tests/integration/loginLockout.test.js
// Bloqueo por intentos fallidos de login.
//
// BUG QUE ESTO ARREGLA — el bloqueo se volvía prácticamente permanente.
//
// `intentos_fallidos` sólo se reseteaba en un login EXITOSO. Así que después del
// primer bloqueo el contador quedaba clavado en el máximo, y cuando el bloqueo
// de 15 minutos expiraba, UN SOLO error volvía a disparar otros 15 minutos —
// indefinidamente. El usuario quedaba con un intento cada cuarto de hora.
//
// El agravante: no hay flujo de recuperación de contraseña, y cambiarla desde el
// panel de administración tampoco tocaba el contador. Un usuario que olvidaba su
// clave podía quedar efectivamente fuera del sistema aunque un Jefe se la
// reseteara: bastaba con que la tipeara mal una vez.
//
// Prerequisitos: NODE_ENV=test — la base DB_NAME_TEST debe existir.
// =============================================================================

'use strict';

require('dotenv').config();
process.env.NODE_ENV = 'test';

const request  = require('supertest');
const bcrypt   = require('bcryptjs');
const app      = require('../../src/app');
const { pool } = require('../../src/config/db');

const USER      = 'test_lockout_user';
const PASSWORD  = 'TestLockout01!';
const MAX_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS, 10) || 3;

let userId;

/** Estado de bloqueo tal como está en la base. */
async function estado() {
  const [rows] = await pool.execute(
    'SELECT intentos_fallidos, bloqueado_hasta FROM usuarios WHERE id = ?',
    [userId]
  );
  return rows[0];
}

/** Un intento de login con contraseña incorrecta. */
const loginMal = () => request(app)
  .post('/api/auth/login')
  .send({ nombre_usuario: USER, password: 'ContrasenaIncorrecta9!' });

/** Un intento con la contraseña correcta. */
const loginBien = () => request(app)
  .post('/api/auth/login')
  .send({ nombre_usuario: USER, password: PASSWORD });

/** Simula que pasaron los minutos del bloqueo. */
async function expirarBloqueo() {
  await pool.execute(
    'UPDATE usuarios SET bloqueado_hasta = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = ?',
    [userId]
  );
}

beforeAll(async () => {
  await pool.execute('DELETE FROM usuarios WHERE nombre_usuario = ?', [USER]);
  const hash = await bcrypt.hash(PASSWORD, 10);
  const [res] = await pool.execute(
    `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo)
     VALUES (?, ?, ?, 1, 1)`,
    ['Test Lockout', USER, hash]
  );
  userId = res.insertId;
});

afterAll(async () => {
  await pool.execute('DELETE FROM usuarios WHERE nombre_usuario = ?', [USER]);
  await pool.end();
});

beforeEach(async () => {
  // Cada test arranca de una cuenta limpia.
  await pool.execute(
    'UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?',
    [userId]
  );
});

describe('bloqueo tras los intentos permitidos', () => {
  test(`bloquea recién al fallo número ${MAX_ATTEMPTS}`, async () => {
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      await loginMal();
      const e = await estado();
      expect(e.intentos_fallidos).toBe(i);
      expect(e.bloqueado_hasta).toBeNull();
    }

    await loginMal();
    const e = await estado();
    expect(e.intentos_fallidos).toBe(MAX_ATTEMPTS);
    expect(e.bloqueado_hasta).not.toBeNull();
  });

  // ── El bloqueo REALMENTE impide entrar ──────────────────────────────────────
  // Esto es lo que no funcionaba: la cuenta se marcaba como bloqueada en la
  // base, pero el controller comparaba `new Date(bloqueado_hasta) > new Date()`
  // en JavaScript. MySQL corre en hora local (Bolivia, UTC-4) y el driver la
  // lee como UTC, así que la fecha llegaba cuatro horas en el pasado y la
  // comparación daba SIEMPRE false: se podían probar contraseñas sin límite.
  test('con la cuenta bloqueada, la contraseña CORRECTA no entra', async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) await loginMal();

    const res = await loginBien();

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/locked/i);
  });

  test('el mensaje dice cuántos minutos faltan', async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) await loginMal();

    const res = await loginBien();

    expect(res.body.message).toMatch(/\d+ minute/i);
  });

  test('seguir intentando con la cuenta bloqueada no la desbloquea', async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) await loginMal();
    for (let i = 0; i < 3; i++) await loginMal();

    expect((await loginBien()).status).toBe(401);
  });

  test('un login exitoso limpia el contador y el bloqueo', async () => {
    await loginMal();
    await loginBien();

    const e = await estado();
    expect(e.intentos_fallidos).toBe(0);
    expect(e.bloqueado_hasta).toBeNull();
  });
});

describe('cuando el bloqueo expira, empieza una tanda nueva', () => {
  test('un solo fallo después de expirar NO vuelve a bloquear', async () => {
    // 1. Se gana el bloqueo.
    for (let i = 0; i < MAX_ATTEMPTS; i++) await loginMal();
    expect((await estado()).bloqueado_hasta).not.toBeNull();

    // 2. Pasan los 15 minutos.
    await expirarBloqueo();

    // 3. El usuario vuelve y se equivoca UNA vez.
    await loginMal();

    // Antes: intentos_fallidos pasaba de 3 a 4 y volvía a bloquear al instante.
    // Ahora: es el primer fallo de una tanda nueva.
    const e = await estado();
    expect(e.intentos_fallidos).toBe(1);
    expect(e.bloqueado_hasta).toBeNull();
  });

  test('tras expirar, vuelve a tener los intentos completos', async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) await loginMal();
    await expirarBloqueo();

    // Se consume la tanda nueva entera: recién el último vuelve a bloquear.
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      await loginMal();
      expect((await estado()).bloqueado_hasta).toBeNull();
    }
    await loginMal();
    expect((await estado()).bloqueado_hasta).not.toBeNull();
  });

  test('con el bloqueo expirado, la contraseña correcta entra', async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) await loginMal();
    await expirarBloqueo();

    const res = await loginBien();
    expect(res.status).toBe(200);
  });
});
