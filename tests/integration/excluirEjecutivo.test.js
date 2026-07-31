// =============================================================================
// tests/integration/excluirEjecutivo.test.js
// El filtro `excluir_ejecutivo` de GET /api/cotizaciones.
//
// PARA QUÉ EXISTE
// El tablero del Ejecutivo tiene dos solapas: «Mis Cotizaciones» y
// «Cotizaciones del Equipo». Hasta ahora las armaba pidiendo TODO en una sola
// consulta y partiendo el array en el navegador — con un `limit=200` que llevaba
// el comentario «espeja el tope de la API» cuando el tope real es 100
// (MAX_LIMIT en quotationFilters.js). O sea: el servidor recortaba a 100 en
// silencio, las cotizaciones 101 en adelante eran invisibles para el ejecutivo,
// y el contador «N en total» mentía.
//
// Para paginar de verdad hace falta que el SERVIDOR sepa separar las dos
// solapas. «Las mías» ya se podía (id_ejecutivo); «las del equipo» es la
// negación, y no existía. Eso agrega este filtro.
//
// Prerrequisito: NODE_ENV=test y la base de test creada (npm run db:init:test).
// =============================================================================

'use strict';

require('dotenv').config();
process.env.NODE_ENV = 'test';

const request  = require('supertest');
const bcrypt   = require('bcryptjs');
const app      = require('../../src/app');
const { pool } = require('../../src/config/db');

jest.setTimeout(30000);

let token, idA, idB, idCliente;
const creadas = [];

const U_A = 'test_excl_a';
const U_B = 'test_excl_b';
const PASSWORD = 'TestExcluir2026!';
const CLIENTE  = 'Test Cliente EXCL';

const MIAS   = 4;
const EQUIPO = 6;

async function crearCotizacion(idEjecutivo, n) {
  const correlativo = `EXC-${Date.now() % 100000}-${n}`;
  const [res] = await pool.execute(
    `INSERT INTO cotizaciones
       (numero_correlativo, id_cliente, id_ejecutivo, descripcion, fecha_emision, estado, monto_total)
     VALUES (?, ?, ?, ?, CURDATE(), 'Pendiente', 100.00)`,
    [correlativo.slice(0, 20), idCliente, idEjecutivo, `Cotizacion EXCL ${n}`]
  );
  creadas.push(res.insertId);
  return res.insertId;
}

beforeAll(async () => {
  const usuarios = [U_A, U_B];
  const m = usuarios.map(() => '?').join(', ');
  await pool.execute(
    `DELETE FROM cotizaciones WHERE id_ejecutivo IN
       (SELECT id FROM usuarios WHERE nombre_usuario IN (${m}))`, usuarios);
  await pool.execute(`DELETE FROM usuarios WHERE nombre_usuario IN (${m})`, usuarios);
  await pool.execute('DELETE FROM clientes WHERE razon_social = ?', [CLIENTE]);

  const hash = await bcrypt.hash(PASSWORD, 10);
  const nuevo = async (nombre, usuario) => {
    const [r] = await pool.execute(
      `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo)
       VALUES (?, ?, ?, 1, 1)`, [nombre, usuario, hash]);
    return r.insertId;
  };
  idA = await nuevo('Test Ejecutivo A EXCL', U_A);
  idB = await nuevo('Test Ejecutivo B EXCL', U_B);

  const [cli] = await pool.execute(
    'INSERT INTO clientes (razon_social, activo) VALUES (?, 1)', [CLIENTE]);
  idCliente = cli.insertId;

  for (let i = 0; i < MIAS; i++)   await crearCotizacion(idA, `a${i}`);
  for (let i = 0; i < EQUIPO; i++) await crearCotizacion(idB, `b${i}`);

  const login = await request(app).post('/api/auth/login')
    .send({ nombre_usuario: U_A, password: PASSWORD });
  expect(login.status).toBe(200);
  token = login.body.data.token;
});

afterAll(async () => {
  if (creadas.length > 0) {
    const m = creadas.map(() => '?').join(', ');
    await pool.execute(`DELETE FROM cotizacion_detalles WHERE id_cotizacion IN (${m})`, creadas);
    await pool.execute(`DELETE FROM cotizaciones WHERE id IN (${m})`, creadas);
  }
  await pool.execute('DELETE FROM usuarios WHERE id IN (?, ?)', [idA, idB]);
  if (idCliente) await pool.execute('DELETE FROM clientes WHERE id = ?', [idCliente]);
  await pool.end();
});

const pedir = (query) => request(app)
  .get(`/api/cotizaciones?${query}`)
  .set('Authorization', `Bearer ${token}`);

// =============================================================================
describe('EXCL — el filtro separa las dos solapas', () => {

  test('EXCL-01: id_ejecutivo trae SOLO las mías', async () => {
    const res = await pedir(`id_ejecutivo=${idA}&limit=100`);

    expect(res.status).toBe(200);
    const propias = res.body.data.filter((c) => creadas.includes(c.id));
    expect(propias).toHaveLength(MIAS);
    expect(propias.every((c) => c.id_ejecutivo === idA)).toBe(true);
  });

  test('EXCL-02: excluir_ejecutivo trae todo MENOS las mías', async () => {
    const res = await pedir(`excluir_ejecutivo=${idA}&limit=100`);

    expect(res.status).toBe(200);
    const nuestras = res.body.data.filter((c) => creadas.includes(c.id));
    expect(nuestras).toHaveLength(EQUIPO);
    expect(nuestras.every((c) => c.id_ejecutivo === idB)).toBe(true);
  });

  test('EXCL-03: ninguna cotización cae en las dos solapas ni queda afuera', async () => {
    // La propiedad que importa: las dos solapas juntas son el total, sin
    // superposición. Si el filtro estuviera mal, un registro podría aparecer
    // dos veces o desaparecer, y nadie lo notaría hasta un cierre de mes.
    const [mias, equipo] = await Promise.all([
      pedir(`id_ejecutivo=${idA}&limit=100`),
      pedir(`excluir_ejecutivo=${idA}&limit=100`),
    ]);

    const idsMias   = mias.body.data.map((c) => c.id).filter((id) => creadas.includes(id));
    const idsEquipo = equipo.body.data.map((c) => c.id).filter((id) => creadas.includes(id));

    expect(idsMias.filter((id) => idsEquipo.includes(id))).toEqual([]);       // sin cruce
    expect([...idsMias, ...idsEquipo].sort()).toEqual([...creadas].sort());   // sin faltantes
  });
});

// =============================================================================
describe('EXCL — cuenta y pagina bien', () => {

  test('EXCL-04: totalRecords refleja el filtro, no la tabla entera', async () => {
    const propio = await pedir(`id_ejecutivo=${idA}&limit=1`);
    const ajeno  = await pedir(`excluir_ejecutivo=${idA}&limit=1`);

    // El contador de la solapa sale de acá: si contara de más, el badge diría
    // un número que no coincide con lo que se puede abrir.
    expect(propio.body.pagination.totalRecords).toBe(MIAS);
    expect(ajeno.body.pagination.totalRecords).toBeGreaterThanOrEqual(EQUIPO);
  });

  test('EXCL-05: paginar dentro del filtro no mezcla las solapas', async () => {
    const res = await pedir(`excluir_ejecutivo=${idA}&limit=2&page=2`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
    for (const c of res.body.data) {
      expect(c.id_ejecutivo).not.toBe(idA);
    }
  });

  test('EXCL-06: se combina con otros filtros', async () => {
    const res = await pedir(`excluir_ejecutivo=${idA}&estado=Pendiente&limit=100`);

    expect(res.status).toBe(200);
    for (const c of res.body.data) {
      expect(c.id_ejecutivo).not.toBe(idA);
      expect(c.estado).toBe('Pendiente');
    }
  });
});

// =============================================================================
describe('EXCL — entradas raras no rompen nada', () => {

  // Rechazar es mejor que ignorar: un filtro que se descarta en silencio
  // devuelve un listado MÁS grande del que se pidió, y quien lo mira asume que
  // el filtro se aplicó. Además es lo mismo que ya hacía id_ejecutivo, así que
  // los dos hermanos se comportan igual.
  test('EXCL-07: un valor no numérico se rechaza con 422, igual que id_ejecutivo', async () => {
    const nuevo  = await pedir('excluir_ejecutivo=abc&limit=5');
    const viejo  = await pedir('id_ejecutivo=abc&limit=5');

    expect(nuevo.status).toBe(422);
    expect(nuevo.status).toBe(viejo.status);
    expect(nuevo.body.success).toBe(false);
  });

  test('EXCL-08: sin el filtro, el listado sigue devolviendo de todos', async () => {
    const res = await pedir('limit=100');
    const nuestras = res.body.data.filter((c) => creadas.includes(c.id));
    expect(nuestras).toHaveLength(MIAS + EQUIPO);
  });
});

// =============================================================================
describe('EXCL — el tope de la API', () => {

  // El bug que motivó todo esto: el tablero pedía limit=200 con un comentario
  // que decía «espeja el tope de la API». El tope es 100, así que el servidor
  // recortaba en silencio y las cotizaciones 101+ eran invisibles.
  test('EXCL-09: pedir más de 100 devuelve 100, sin avisar', async () => {
    const res = await pedir('limit=200');

    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(100);
    expect(res.body.data.length).toBeLessThanOrEqual(100);
  });
});
