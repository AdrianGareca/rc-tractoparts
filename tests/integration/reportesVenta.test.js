// =============================================================================
// tests/integration/reportesVenta.test.js
// GET /api/reportes/advanced y GET /api/reportes/progreso — dos hallazgos del
// stress-test que comparten archivo (analyticsRepository.js) y causa raiz.
//
// HALLAZGO 1 (ALTO): el leaderboard y el volumen por ejecutivo sumaban
// cotizaciones que nunca se vendieron.
//
// La definicion de "venta" vive en un solo lugar (constants.ESTADOS_VENTA:
// Confirmada + su alias legado Aceptada — ver tests/unit/estadosVenta.test.js)
// y ya se aplicaba correctamente en `top_clientes`. El leaderboard de
// `getAdvancedReports` y el `por_ejecutivo` de `getProgreso` NO aplicaban ese
// mismo filtro: sumaban el monto de CUALQUIER estado dentro del rango de
// fechas, incluidas Archivada y Rechazada. Resultado: el mismo ejecutivo
// aparecia con un volumen distinto en el leaderboard que en top_clientes, y
// una cotizacion rechazada inflaba el ranking de quien la perdio.
//
// HALLAZGO 2 (MEDIO): un solo limite de fecha se ignoraba en /advanced, pero
// la respuesta decia que se habia aplicado.
//
// `getAdvancedReports` solo armaba el filtro de fecha cuando LOS DOS bounds
// estaban presentes (`fechaDesde != null && fechaHasta != null`). Pedir el
// reporte con solo `fecha_desde` no filtraba nada — traia el historico
// completo — pero el campo `rango` de la respuesta ecoaba el limite recibido
// como si se hubiera aplicado, dejando al usuario leyendo mal la tabla.
//
// Prerequisito: NODE_ENV=test — la base de pruebas debe existir y estar migrada.
// =============================================================================

'use strict';

require('dotenv').config();
process.env.NODE_ENV = 'test';

const request  = require('supertest');
const bcrypt   = require('bcryptjs');
const app      = require('../../src/app');
const { pool } = require('../../src/config/db');

jest.setTimeout(30000);

let tokenJefe, tokenEjec, idJefe, idEjec, idCliente;
const cotizaciones = [];

const U_JEFE = 'test_jefe_venta';
const U_EJEC = 'test_ejec_venta';
const PASSWORD = 'TestVenta2026!';
const CLIENTE  = 'Test Cliente VENTA';

async function crearCotizacion(estado, monto, fechaEmision) {
  const correlativo = `VTA-${Date.now() % 100000}-${cotizaciones.length}`;
  const [res] = await pool.execute(
    `INSERT INTO cotizaciones
       (numero_correlativo, id_cliente, id_ejecutivo, descripcion, fecha_emision,
        estado, monto_total, moneda)
     VALUES (?, ?, ?, 'Cotizacion VENTA', ?, ?, ?, 'USD')`,
    [correlativo.slice(0, 20), idCliente, idEjec, fechaEmision, estado, monto]
  );
  cotizaciones.push(res.insertId);
  return res.insertId;
}

beforeAll(async () => {
  const us = [U_JEFE, U_EJEC];
  const m  = us.map(() => '?').join(', ');
  await pool.execute(
    `DELETE FROM cotizaciones WHERE id_ejecutivo IN
       (SELECT id FROM usuarios WHERE nombre_usuario IN (${m}))`, us);
  await pool.execute(`DELETE FROM usuarios WHERE nombre_usuario IN (${m})`, us);
  await pool.execute('DELETE FROM clientes WHERE razon_social = ?', [CLIENTE]);

  const hash = await bcrypt.hash(PASSWORD, 10);
  const nuevo = async (nombre, usuario, rol) => {
    const [r] = await pool.execute(
      `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo)
       VALUES (?, ?, ?, ?, 1)`, [nombre, usuario, hash, rol]);
    return r.insertId;
  };
  idJefe = await nuevo('Test Jefe Venta', U_JEFE, 3);
  idEjec = await nuevo('Test Ejecutivo Venta', U_EJEC, 1);

  const [cli] = await pool.execute(
    'INSERT INTO clientes (razon_social, activo) VALUES (?, 1)', [CLIENTE]);
  idCliente = cli.insertId;

  // Las tres, todas dentro del mismo rango de fechas (HOY): una vendida de
  // verdad, y dos que NO deberian sumar como venta.
  await crearCotizacion('Confirmada', 500, new Date().toISOString().slice(0, 10));
  await crearCotizacion('Archivada',  900, new Date().toISOString().slice(0, 10));
  await crearCotizacion('Rechazada',  700, new Date().toISOString().slice(0, 10));

  // Una cuarta, VIEJA (fuera del rango que usan los tests de fecha parcial),
  // tambien Confirmada, para poder distinguir "se aplico el filtro de fecha"
  // de "no se aplico nada".
  await crearCotizacion('Confirmada', 300, '2000-01-15');

  const login = async (u) => (await request(app).post('/api/auth/login')
    .send({ nombre_usuario: u, password: PASSWORD })).body.data.token;
  tokenJefe = await login(U_JEFE);
  tokenEjec = await login(U_EJEC);
});

afterAll(async () => {
  if (cotizaciones.length > 0) {
    const m = cotizaciones.map(() => '?').join(', ');
    await pool.execute(`DELETE FROM cotizaciones WHERE id IN (${m})`, cotizaciones);
  }
  await pool.execute('DELETE FROM usuarios WHERE id IN (?, ?)', [idJefe, idEjec]);
  if (idCliente) await pool.execute('DELETE FROM clientes WHERE id = ?', [idCliente]);
  await pool.end();
});

const filaDe = (leaderboard) => leaderboard.find((f) => f.ejecutivo === 'Test Ejecutivo Venta');

// =============================================================================
describe('VTA1 — el leaderboard solo suma lo CONFIRMADO (hallazgo ALTO)', () => {

  test('VTA1-01: el volumen del ejecutivo en /advanced es solo la Confirmada', async () => {
    const res = await request(app)
      .get('/api/reportes/advanced?fecha_desde=1900-01-01&fecha_hasta=2100-01-01')
      .set('Authorization', `Bearer ${tokenJefe}`);

    expect(res.status).toBe(200);
    const fila = filaDe(res.body.data.leaderboard);
    expect(fila).toBeDefined();
    // Si la Archivada (900) o la Rechazada (700) se colaran, esto daria 2100
    // o mas. Solo debe contar la Confirmada de HOY (500) — la vieja de
    // 2000-01-15 (300) tambien es Confirmada y SI entra porque el rango
    // pedido aca es amplio a proposito.
    expect(Number(fila.total_usd)).toBe(800);
  });

  test('VTA1-02: total_creadas sigue contando TODAS, para no esconder actividad', async () => {
    const res = await request(app)
      .get('/api/reportes/advanced?fecha_desde=1900-01-01&fecha_hasta=2100-01-01')
      .set('Authorization', `Bearer ${tokenJefe}`);

    const fila = filaDe(res.body.data.leaderboard);
    // Las 4 cotizaciones del ejecutivo, sin importar el estado: total_creadas
    // mide actividad, no venta, y no es parte de este hallazgo.
    expect(fila.total_creadas).toBe(4);
  });

  test('VTA1-03: por_ejecutivo de /progreso tampoco suma la Archivada ni la Rechazada', async () => {
    const hoy = new Date().toISOString().slice(0, 10);
    const res = await request(app)
      .get(`/api/reportes/progreso?fecha_desde=${hoy}&fecha_hasta=${hoy}`)
      .set('Authorization', `Bearer ${tokenJefe}`);

    expect(res.status).toBe(200);
    const fila = res.body.data.por_ejecutivo.find((f) => f.ejecutivo === 'Test Ejecutivo Venta');
    expect(fila).toBeDefined();
    // De las 3 de HOY (500 Confirmada + 900 Archivada + 700 Rechazada), el
    // volumen solo puede ser la Confirmada.
    expect(Number(fila.volumen_usd)).toBe(500);
    // Pero el CONTEO por estado si tiene que seguir viendo las tres.
    expect(Number(fila.total)).toBe(3);
    expect(Number(fila.rechazadas)).toBe(1);
  });
});

// =============================================================================
describe('VTA2 — un solo limite de fecha se aplica igual que los dos (hallazgo MEDIO)', () => {

  test('VTA2-01: solo fecha_desde excluye lo anterior a ese limite', async () => {
    const res = await request(app)
      .get('/api/reportes/advanced?fecha_desde=2020-01-01')
      .set('Authorization', `Bearer ${tokenJefe}`);

    expect(res.status).toBe(200);
    const fila = filaDe(res.body.data.leaderboard);
    // Sin la vieja de 2000-01-15 (300), pero con la Confirmada de hoy (500):
    // si el bug siguiera presente, este total seria 800 (las dos Confirmadas).
    expect(Number(fila.total_usd)).toBe(500);
  });

  test('VTA2-02: el rango devuelto refleja lo que realmente se aplico', async () => {
    const res = await request(app)
      .get('/api/reportes/advanced?fecha_desde=2020-01-01')
      .set('Authorization', `Bearer ${tokenJefe}`);

    expect(res.body.rango).toEqual({ desde: '2020-01-01', hasta: null });
  });

  test('VTA2-03: solo fecha_hasta excluye lo posterior a ese limite', async () => {
    const res = await request(app)
      .get('/api/reportes/advanced?fecha_hasta=2020-01-01')
      .set('Authorization', `Bearer ${tokenJefe}`);

    expect(res.status).toBe(200);
    const fila = filaDe(res.body.data.leaderboard);
    // Solo la vieja Confirmada (300) queda antes de ese limite; la de hoy (500)
    // debe quedar afuera. Si el bug siguiera presente, traeria las dos (800).
    expect(Number(fila.total_usd)).toBe(300);
  });

  test('VTA2-04: sin ningun limite, sigue siendo historico completo', async () => {
    const res = await request(app)
      .get('/api/reportes/advanced')
      .set('Authorization', `Bearer ${tokenJefe}`);

    expect(res.status).toBe(200);
    const fila = filaDe(res.body.data.leaderboard);
    expect(Number(fila.total_usd)).toBe(800);   // las dos Confirmadas, sin recortar
  });

  test('VTA2-05: el reporte individual del ejecutivo tambien respeta un solo limite', async () => {
    const res = await request(app)
      .get('/api/reportes/advanced?fecha_desde=2020-01-01')
      .set('Authorization', `Bearer ${tokenEjec}`);

    expect(res.status).toBe(200);
    // El propio ejecutivo, viendo solo su cartera: mismo criterio de fecha.
    const totalUsd = res.body.data.top_clientes.reduce((a, c) => a + Number(c.total_usd), 0);
    expect(totalUsd).toBe(500);
  });
});
