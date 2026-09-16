// =============================================================================
// tests/integration/colaAprobacionPaginada.test.js
// GET /api/cotizaciones/pendientes-aprobacion — la cola del Jefe, por páginas.
//
// POR QUÉ EXISTE
// Hasta la ronda de estrés del 2026-09-15 este endpoint devolvía la cola
// ENTERA. Con 40.000 cotizaciones eran 11.630 filas y 3,7 MB por carga, y la
// cola crece sola porque lo que nadie archiva se queda en Pendiente. Adrian
// decidió paginarla como los demás listados.
//
// Lo que se protege:
//   1. el bloque `pagination` y los topes de `limit`, igual que el resto;
//   2. que `total` siga siendo el tamaño de la COLA, no el de la página;
//   3. que recorrer las páginas no repita ni pierda filas — con dos
//      cotizaciones creadas en el mismo segundo, sin desempate por id, MySQL
//      puede ordenarlas distinto en cada página;
//   4. que sólo entren los tres estados que esperan una decisión.
// =============================================================================

'use strict';

require('dotenv').config();
process.env.NODE_ENV = 'test';

const request  = require('supertest');
const bcrypt   = require('bcryptjs');
const app      = require('../../src/app');
const { pool } = require('../../src/config/db');

jest.setTimeout(30000);

const PASSWORD = 'TestColaPag2026!';
const U_JEFE   = 'test_jefe_colapag';
const U_EJEC   = 'test_ejec_colapag';
const CLIENTE  = 'Test Cliente COLAPAG';

let tokenJefe, tokenEjec, idJefe, idEjec, idCliente;
const cotizaciones = {};

async function crearCotizacion(clave, estado, creadoEn) {
  const [r] = await pool.execute(
    `INSERT INTO cotizaciones
       (numero_correlativo, id_cliente, id_ejecutivo, descripcion, fecha_emision, estado, monto_total, moneda, creado_en)
     VALUES (?, ?, ?, 'Cola paginada', '2001-01-01', ?, 10.00, 'BOB', ?)`,
    [`CPAG-${clave}-${Date.now() % 100000}`.slice(0, 20), idCliente, idEjec, estado, creadoEn]);
  cotizaciones[clave] = r.insertId;
}

beforeAll(async () => {
  await pool.execute('DELETE FROM cotizaciones WHERE descripcion = ?', ['Cola paginada']);
  await pool.execute('DELETE FROM usuarios WHERE nombre_usuario IN (?, ?)', [U_JEFE, U_EJEC]);
  await pool.execute('DELETE FROM clientes WHERE razon_social = ?', [CLIENTE]);

  const hash = await bcrypt.hash(PASSWORD, 10);
  const [j] = await pool.execute(
    'INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo) VALUES (?, ?, ?, 3, 1)',
    ['Test Jefe COLAPAG', U_JEFE, hash]);
  idJefe = j.insertId;
  const [e] = await pool.execute(
    'INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo) VALUES (?, ?, ?, 1, 1)',
    ['Test Ejecutivo COLAPAG', U_EJEC, hash]);
  idEjec = e.insertId;
  const [c] = await pool.execute('INSERT INTO clientes (razon_social, activo) VALUES (?, 1)', [CLIENTE]);
  idCliente = c.insertId;

  // Fechas del año 2000: van primeras en la cola, delante de cualquier dato
  // que otras suites hayan dejado. B y C comparten el mismo segundo a propósito.
  await crearCotizacion('A', 'Pendiente',   '2000-01-01 08:00:00');
  await crearCotizacion('B', 'En revision', '2000-01-02 08:00:00');
  await crearCotizacion('C', 'En espera',   '2000-01-02 08:00:00');
  await crearCotizacion('D', 'Pendiente',   '2000-01-03 08:00:00');
  await crearCotizacion('X', 'Confirmada',  '2000-01-01 07:00:00');   // no espera decisión

  const lj = await request(app).post('/api/auth/login').send({ nombre_usuario: U_JEFE, password: PASSWORD });
  tokenJefe = lj.body.data.token;
  const le = await request(app).post('/api/auth/login').send({ nombre_usuario: U_EJEC, password: PASSWORD });
  tokenEjec = le.body.data.token;
});

afterAll(async () => {
  const ids = Object.values(cotizaciones);
  if (ids.length) await pool.execute(`DELETE FROM cotizaciones WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  await pool.execute('DELETE FROM usuarios WHERE id IN (?, ?)', [idJefe ?? 0, idEjec ?? 0]);
  if (idCliente) await pool.execute('DELETE FROM clientes WHERE id = ?', [idCliente]);
  await pool.end();
});

const pedir = (query = '', token = tokenJefe) => request(app)
  .get(`/api/cotizaciones/pendientes-aprobacion${query ? '?' + query : ''}`)
  .set('Authorization', `Bearer ${token}`);

/** Recorre todas las páginas y devuelve los ids en el orden en que llegaron. */
async function recorrer(limit) {
  const ids = [];
  for (let page = 1; page < 1000; page++) {
    const res = await pedir(`page=${page}&limit=${limit}`);
    expect(res.status).toBe(200);
    ids.push(...res.body.data.map((f) => f.id));
    if (!res.body.pagination.hasNext) break;
  }
  return ids;
}

describe('CPAG — la cola llega por páginas', () => {
  test('CPAG-01: respeta el limit pedido y trae el bloque pagination', async () => {
    const res = await pedir('page=1&limit=2');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 2 });
    expect(res.body.pagination.totalRecords).toBeGreaterThanOrEqual(4);
  });

  test('CPAG-02: `total` es el tamaño de la cola, no el de la página', async () => {
    const res = await pedir('page=1&limit=2');
    expect(res.body.total).toBe(res.body.pagination.totalRecords);
    expect(res.body.total).toBeGreaterThan(res.body.data.length);
  });

  test('CPAG-03: sin parámetros, 50 por página; más de 100 se recorta a 100', async () => {
    expect((await pedir()).body.pagination.limit).toBe(50);
    expect((await pedir('limit=500')).body.pagination.limit).toBe(100);
  });

  test('CPAG-04: de la más antigua a la más nueva, y a igual segundo desempata el id', async () => {
    const res = await pedir('page=1&limit=4');
    const nuestras = res.body.data.map((f) => f.id);
    expect(nuestras).toEqual([cotizaciones.A, cotizaciones.B, cotizaciones.C, cotizaciones.D]);
  });

  test('CPAG-05: recorrer las páginas no repite ni pierde ninguna cotización', async () => {
    const deAUna   = await recorrer(100);
    const deADos   = await recorrer(2);

    expect(new Set(deADos).size).toBe(deADos.length);   // sin repetidas
    expect(deADos).toEqual(deAUna);                       // mismas y en el mismo orden
  });

  test('CPAG-06: sólo entran los estados que esperan una decisión', async () => {
    const ids = await recorrer(100);
    expect(ids).not.toContain(cotizaciones.X);
  });

  test('CPAG-07: un Ejecutivo no puede ver la cola', async () => {
    const res = await pedir('page=1', tokenEjec);
    expect(res.status).toBe(403);
  });
});
