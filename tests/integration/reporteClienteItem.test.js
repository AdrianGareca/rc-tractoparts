// =============================================================================
// tests/integration/reporteClienteItem.test.js
// GET /api/reportes/cliente-item — que consume cada cliente, por codigo de item.
//
// PARA QUE SIRVE
// Todos los reportes que existian miran la CABECERA de la cotizacion (montos
// por ejecutivo, por cliente, por estado). Este es el primero que baja al nivel
// de linea: cruza cliente x codigo de item x cantidad, para saber que repuestos
// consume cada cliente — para stockear, o para ir a buscarlo antes de que pida.
//
// LAS TRES TRAMPAS QUE SE PIN-EAN ACA
//
//   1. El codigo vive en DOS lados. Puede venir del catalogo (id_producto ->
//      productos.codigo) o escrito a mano en la linea (codigo_parte). Si el
//      reporte no los unifica, el MISMO repuesto aparece partido en dos filas
//      segun como lo cargo cada ejecutivo, y los dos numeros estan mal.
//
//   2. El mismo codigo se repite DENTRO de una cotizacion. El esquema lo dice
//      explicitamente: no hay restriccion unica, y juntar lineas iguales es una
//      regla que se aplica del lado del navegador. Hay que sumar dentro de la
//      cotizacion, no solo entre cotizaciones.
//
//   3. La unidad. Sumar 5 UND con 3 KG da 8 de nada. Se agrupa tambien por
//      unidad: en el caso normal (un codigo, una unidad) no cambia nada, y
//      cuando los datos vienen sucios lo muestra en vez de esconderlo.
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

let token, idEjec, idClienteA, idClienteB, idProducto;
const cotizaciones = [];

const U_EJEC   = 'test_ejec_repci';
const PASSWORD = 'TestRepCI2026!';
const CLI_A    = 'Test Agropecuaria REPCI';
const CLI_B    = 'Test Transportes REPCI';
const COD_CAT  = 'REPCI-CAT-1';    // codigo del catalogo (productos.codigo)

// ---------------------------------------------------------------------------
async function crearCotizacion(idCliente, estado, lineas) {
  const correlativo = `RCI-${Date.now() % 100000}-${cotizaciones.length}`;
  const [res] = await pool.execute(
    `INSERT INTO cotizaciones
       (numero_correlativo, id_cliente, id_ejecutivo, descripcion, fecha_emision, estado, monto_total, moneda)
     VALUES (?, ?, ?, 'Cotizacion REPCI', CURDATE(), ?, 100.00, 'USD')`,
    [correlativo.slice(0, 20), idCliente, idEjec, estado]
  );
  const id = res.insertId;
  cotizaciones.push(id);

  for (const l of lineas) {
    await pool.execute(
      `INSERT INTO cotizacion_detalles
         (id_cotizacion, id_producto, descripcion_item, cantidad, precio_unitario, subtotal, codigo_parte, unidad)
       VALUES (?, ?, ?, ?, 10.00, ?, ?, ?)`,
      [id, l.id_producto ?? null, l.descripcion, l.cantidad, l.cantidad * 10,
       l.codigo_parte ?? null, l.unidad ?? 'UND']
    );
  }
  return id;
}

beforeAll(async () => {
  await pool.execute(
    `DELETE FROM cotizaciones WHERE id_ejecutivo IN
       (SELECT id FROM usuarios WHERE nombre_usuario = ?)`, [U_EJEC]);
  await pool.execute('DELETE FROM usuarios WHERE nombre_usuario = ?', [U_EJEC]);
  await pool.execute('DELETE FROM clientes WHERE razon_social IN (?, ?)', [CLI_A, CLI_B]);
  await pool.execute('DELETE FROM productos WHERE codigo = ?', [COD_CAT]);

  const hash = await bcrypt.hash(PASSWORD, 10);
  const [u] = await pool.execute(
    `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo)
     VALUES (?, ?, ?, 1, 1)`, ['Test Ejecutivo REPCI', U_EJEC, hash]);
  idEjec = u.insertId;

  const [a] = await pool.execute('INSERT INTO clientes (razon_social, activo) VALUES (?, 1)', [CLI_A]);
  const [b] = await pool.execute('INSERT INTO clientes (razon_social, activo) VALUES (?, 1)', [CLI_B]);
  idClienteA = a.insertId; idClienteB = b.insertId;

  const [prod] = await pool.execute(
    'INSERT INTO productos (codigo, descripcion) VALUES (?, ?)',
    [COD_CAT, 'Filtro de aceite catalogado']);
  idProducto = prod.insertId;

  // ── Escenario ────────────────────────────────────────────────────────────
  // Cliente A, cotizacion 1: el MISMO codigo del catalogo en DOS lineas (3+2),
  // mas un codigo suelto escrito a mano.
  await crearCotizacion(idClienteA, 'Confirmada', [
    { id_producto: idProducto, descripcion: 'Filtro de aceite', cantidad: 3 },
    { id_producto: idProducto, descripcion: 'Filtro de aceite', cantidad: 2 },
    { codigo_parte: 'RI-100', descripcion: 'Rodillo inferior', cantidad: 4 },
  ]);

  // Cliente A, cotizacion 2: el MISMO repuesto pero cargado a mano, con el
  // codigo del catalogo escrito en codigo_parte. Tiene que sumar con las de
  // arriba, no aparecer como una fila distinta.
  await crearCotizacion(idClienteA, 'Rechazada', [
    { codigo_parte: COD_CAT, descripcion: 'Filtro de aceite', cantidad: 10 },
  ]);

  // Cliente B: el mismo codigo del catalogo, y una linea SIN codigo.
  await crearCotizacion(idClienteB, 'Confirmada', [
    { id_producto: idProducto, descripcion: 'Filtro de aceite', cantidad: 7 },
    { descripcion: 'Manguera a medida', cantidad: 6 },
  ]);

  const login = await request(app).post('/api/auth/login')
    .send({ nombre_usuario: U_EJEC, password: PASSWORD });
  expect(login.status).toBe(200);
  token = login.body.data.token;
});

afterAll(async () => {
  if (cotizaciones.length > 0) {
    const m = cotizaciones.map(() => '?').join(', ');
    await pool.execute(`DELETE FROM cotizacion_detalles WHERE id_cotizacion IN (${m})`, cotizaciones);
    await pool.execute(`DELETE FROM cotizaciones WHERE id IN (${m})`, cotizaciones);
  }
  await pool.execute('DELETE FROM usuarios WHERE id = ?', [idEjec]);
  await pool.execute('DELETE FROM clientes WHERE id IN (?, ?)', [idClienteA, idClienteB]);
  await pool.execute('DELETE FROM productos WHERE id = ?', [idProducto]);
  await pool.end();
});

const pedir = (query = '') => request(app)
  .get(`/api/reportes/cliente-item${query ? '?' + query : ''}`)
  .set('Authorization', `Bearer ${token}`);

/** Fila del reporte para un cliente y un codigo. */
const buscar = (filas, cliente, codigo) =>
  filas.find((f) => f.cliente_nombre === cliente && f.codigo === codigo);

// =============================================================================
describe('RCI — la suma de cantidades', () => {

  test('RCI-01: suma las lineas repetidas del mismo codigo dentro de una cotizacion', async () => {
    const res = await pedir('limit=100');
    expect(res.status).toBe(200);

    // Cliente A: 3 + 2 (dos lineas del catalogo) + 10 (cargado a mano) = 15
    const fila = buscar(res.body.data, CLI_A, COD_CAT);
    expect(fila).toBeDefined();
    expect(Number(fila.cantidad_total)).toBe(15);
  });

  // LA TRAMPA PRINCIPAL: el mismo repuesto entra por el catalogo en una
  // cotizacion y a mano en otra. Si no se unifican, salen dos filas de 5 y 10
  // en vez de una de 15, y las dos son incorrectas.
  test('RCI-02: unifica el codigo del catalogo con el escrito a mano', async () => {
    const res = await pedir('limit=100');
    const delClienteA = res.body.data.filter((f) => f.cliente_nombre === CLI_A);

    const conEseCodigo = delClienteA.filter((f) => f.codigo === COD_CAT);
    expect(conEseCodigo).toHaveLength(1);          // UNA fila, no dos
    expect(Number(conEseCodigo[0].cantidad_total)).toBe(15);
  });

  test('RCI-03: no mezcla clientes distintos', async () => {
    const res = await pedir('limit=100');

    expect(Number(buscar(res.body.data, CLI_A, COD_CAT).cantidad_total)).toBe(15);
    expect(Number(buscar(res.body.data, CLI_B, COD_CAT).cantidad_total)).toBe(7);
  });

  test('RCI-04: cuenta en cuantas cotizaciones aparece el item', async () => {
    const res = await pedir('limit=100');
    const fila = buscar(res.body.data, CLI_A, COD_CAT);

    // Dos cotizaciones distintas, aunque en una haya dos lineas.
    expect(Number(fila.cotizaciones)).toBe(2);
  });
});

// =============================================================================
describe('RCI — las lineas sin codigo no se pierden', () => {

  test('RCI-05: aparecen agrupadas por descripcion', async () => {
    const res = await pedir('limit=100');

    const manguera = res.body.data.find(
      (f) => f.cliente_nombre === CLI_B && /Manguera/i.test(f.descripcion));

    expect(manguera).toBeDefined();
    expect(Number(manguera.cantidad_total)).toBe(6);
  });

  test('RCI-06: vienen marcadas, para no confundirlas con un codigo real', async () => {
    const res = await pedir('limit=100');
    const manguera = res.body.data.find(
      (f) => f.cliente_nombre === CLI_B && /Manguera/i.test(f.descripcion));

    expect(manguera.sin_codigo).toBe(1);
    const conCodigo = buscar(res.body.data, CLI_B, COD_CAT);
    expect(conCodigo.sin_codigo).toBe(0);
  });
});

// =============================================================================
describe('RCI — filtros', () => {

  test('RCI-07: por defecto cuenta TODAS las cotizaciones, incluso las rechazadas', async () => {
    const res = await pedir('limit=100');
    // Los 10 del cliente A estan en una cotizacion Rechazada.
    expect(Number(buscar(res.body.data, CLI_A, COD_CAT).cantidad_total)).toBe(15);
  });

  test('RCI-08: se puede estrechar por estado', async () => {
    const res = await pedir('estado=Confirmada&limit=100');
    // Sin la rechazada quedan 3 + 2 = 5.
    expect(Number(buscar(res.body.data, CLI_A, COD_CAT).cantidad_total)).toBe(5);
  });

  test('RCI-09: busca por nombre de cliente', async () => {
    const res = await pedir(`q=${encodeURIComponent('Transportes REPCI')}&limit=100`);
    const nuestras = res.body.data.filter((f) => [CLI_A, CLI_B].includes(f.cliente_nombre));

    expect(nuestras.length).toBeGreaterThan(0);
    expect(nuestras.every((f) => f.cliente_nombre === CLI_B)).toBe(true);
  });

  test('RCI-10: busca por codigo de item', async () => {
    const res = await pedir(`q=${COD_CAT}&limit=100`);
    const nuestras = res.body.data.filter((f) => [CLI_A, CLI_B].includes(f.cliente_nombre));

    expect(nuestras.length).toBeGreaterThan(0);
    expect(nuestras.every((f) => f.codigo === COD_CAT)).toBe(true);
  });

  test('RCI-11: un rango de fechas fuera del periodo devuelve vacio', async () => {
    const res = await pedir('fecha_desde=2000-01-01&fecha_hasta=2000-12-31&limit=100');
    const nuestras = res.body.data.filter((f) => [CLI_A, CLI_B].includes(f.cliente_nombre));
    expect(nuestras).toHaveLength(0);
  });

  test('RCI-12: una fecha mal formada se rechaza con 422', async () => {
    const res = await pedir('fecha_desde=ayer');
    expect(res.status).toBe(422);
  });
});

// =============================================================================
describe('RCI — orden y paginacion', () => {

  test('RCI-13: por defecto ordena por cantidad, de mayor a menor', async () => {
    const res = await pedir('limit=100');
    const cantidades = res.body.data.map((f) => Number(f.cantidad_total));

    for (let i = 1; i < cantidades.length; i++) {
      expect(cantidades[i - 1]).toBeGreaterThanOrEqual(cantidades[i]);
    }
  });

  test('RCI-14: se puede ordenar por cliente', async () => {
    const res = await pedir('sort_by=cliente&sort_order=ASC&limit=100');
    expect(res.status).toBe(200);

    const nombres = res.body.data.map((f) => f.cliente_nombre);
    expect([...nombres]).toEqual([...nombres].sort((a, b) => a.localeCompare(b, 'es')));
  });

  test('RCI-15: un sort_by inventado se rechaza en vez de inyectarse', async () => {
    const res = await pedir('sort_by=cantidad;DROP TABLE cotizaciones');
    expect(res.status).toBe(422);
  });

  test('RCI-16: devuelve la paginacion que el control del front necesita', async () => {
    const res = await pedir('limit=2&page=1');

    expect(res.body.data.length).toBeLessThanOrEqual(2);
    expect(res.body.pagination).toMatchObject({
      page: 1, limit: 2,
    });
    expect(typeof res.body.pagination.totalRecords).toBe('number');
    expect(res.body.pagination.totalPages).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
describe('RCI — acceso', () => {

  test('RCI-17: sin token, 401', async () => {
    const res = await request(app).get('/api/reportes/cliente-item');
    expect(res.status).toBe(401);
  });

  test('RCI-18: un Ejecutivo puede verlo (el reporte es para todos)', async () => {
    const res = await pedir('limit=5');
    expect(res.status).toBe(200);
  });
});
