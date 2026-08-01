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

let token, idEjec, idEjec2, idClienteA, idClienteB, idProducto, idMarca;
const cotizaciones = [];

const U_EJEC   = 'test_ejec_repci';
const U_EJEC2  = 'test_ejec2_repci';
const MARCA_NOMBRE = 'Test Marca REPCI';
const PASSWORD = 'TestRepCI2026!';
const CLI_A    = 'Test Agropecuaria REPCI';
const CLI_B    = 'Test Transportes REPCI';
const COD_CAT  = 'REPCI-CAT-1';    // codigo del catalogo (productos.codigo)

// ---------------------------------------------------------------------------
async function crearCotizacion(idCliente, estado, lineas, ejecutivo = null) {
  const correlativo = `RCI-${Date.now() % 100000}-${cotizaciones.length}`;
  const [res] = await pool.execute(
    `INSERT INTO cotizaciones
       (numero_correlativo, id_cliente, id_ejecutivo, descripcion, fecha_emision, estado, monto_total, moneda)
     VALUES (?, ?, ?, 'Cotizacion REPCI', CURDATE(), ?, 100.00, 'USD')`,
    [correlativo.slice(0, 20), idCliente, ejecutivo ?? idEjec, estado]
  );
  const id = res.insertId;
  cotizaciones.push(id);

  for (const l of lineas) {
    await pool.execute(
      `INSERT INTO cotizacion_detalles
         (id_cotizacion, id_producto, descripcion_item, cantidad, precio_unitario, subtotal, codigo_parte, unidad, marca_id)
       VALUES (?, ?, ?, ?, 10.00, ?, ?, ?, ?)`,
      [id, l.id_producto ?? null, l.descripcion, l.cantidad, l.cantidad * 10,
       l.codigo_parte ?? null, l.unidad ?? 'UND', l.marca_id ?? null]
    );
  }
  return id;
}

beforeAll(async () => {
  await pool.execute(
    `DELETE FROM cotizaciones WHERE id_ejecutivo IN
       (SELECT id FROM usuarios WHERE nombre_usuario IN (?, ?))`, [U_EJEC, U_EJEC2]);
  await pool.execute('DELETE FROM usuarios WHERE nombre_usuario IN (?, ?)', [U_EJEC, U_EJEC2]);
  await pool.execute('DELETE FROM marcas WHERE nombre = ?', [MARCA_NOMBRE]);
  await pool.execute('DELETE FROM clientes WHERE razon_social IN (?, ?)', [CLI_A, CLI_B]);
  await pool.execute('DELETE FROM productos WHERE codigo = ?', [COD_CAT]);

  const hash = await bcrypt.hash(PASSWORD, 10);
  const [u] = await pool.execute(
    `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo)
     VALUES (?, ?, ?, 1, 1)`, ['Test Ejecutivo REPCI', U_EJEC, hash]);
  idEjec = u.insertId;

  const [u2] = await pool.execute(
    `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo)
     VALUES (?, ?, ?, 1, 1)`, ['Test Ejecutivo2 REPCI', U_EJEC2, hash]);
  idEjec2 = u2.insertId;

  const [mk] = await pool.execute('INSERT INTO marcas (nombre) VALUES (?)', [MARCA_NOMBRE]);
  idMarca = mk.insertId;

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
    { codigo_parte: 'RI-100', descripcion: 'Rodillo inferior', cantidad: 4, marca_id: idMarca },
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

  // Mismo cliente y mismo codigo, pero cargado por OTRO ejecutivo: en la vista
  // de detalle tiene que salir en su propia fila; en la vista por item, sumado.
  await crearCotizacion(idClienteB, 'Confirmada', [
    { id_producto: idProducto, descripcion: 'Filtro de aceite', cantidad: 5 },
  ], idEjec2);

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
  await pool.execute('DELETE FROM usuarios WHERE id IN (?, ?)', [idEjec, idEjec2]);
  if (idMarca) await pool.execute('DELETE FROM marcas WHERE id = ?', [idMarca]);
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

  // POR QUE LA FECHA Y NO LA CANTIDAD.
  // El orden por cantidad ordena por importancia, pero la gente BUSCA por
  // cuando: «esto lo cotice la semana pasada». Con el orden por cantidad, lo
  // recien cotizado cae en cualquier parte de la lista y parece que no esta —
  // que fue exactamente lo que reporto ventas («no aparecen los items de una
  // cotizacion»). La cantidad sigue disponible a un clic, pero es secundaria.
  test('RCI-13: por defecto ordena por fecha, lo mas reciente primero', async () => {
    const res = await pedir('limit=100');
    const fechas = res.body.data.map((f) => new Date(f.ultima_vez).getTime());

    for (let i = 1; i < fechas.length; i++) {
      expect(fechas[i - 1]).toBeGreaterThanOrEqual(fechas[i]);
    }
  });

  // «La cantidad esta bien pero tendria que ser secundario»: dentro de una
  // misma fecha, lo mas grande arriba.
  test('RCI-13b: a igual fecha, desempata por cantidad de mayor a menor', async () => {
    const res = await pedir('limit=100');
    const filas = res.body.data;

    for (let i = 1; i < filas.length; i++) {
      if (filas[i - 1].ultima_vez === filas[i].ultima_vez) {
        expect(Number(filas[i - 1].cantidad_total))
          .toBeGreaterThanOrEqual(Number(filas[i].cantidad_total));
      }
    }
  });

  test('RCI-13c: la cantidad sigue disponible como orden explicito', async () => {
    const res = await pedir('sort_by=cantidad&sort_order=DESC&limit=100');
    const cantidades = res.body.data.map((f) => Number(f.cantidad_total));

    for (let i = 1; i < cantidades.length; i++) {
      expect(cantidades[i - 1]).toBeGreaterThanOrEqual(cantidades[i]);
    }
  });

  test('RCI-13d: se puede ordenar por fecha ascendente (lo mas viejo primero)', async () => {
    const res = await pedir('sort_by=fecha&sort_order=ASC&limit=100');
    const fechas = res.body.data.map((f) => new Date(f.ultima_vez).getTime());

    for (let i = 1; i < fechas.length; i++) {
      expect(fechas[i - 1]).toBeLessThanOrEqual(fechas[i]);
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

// =============================================================================
// SEGUNDA TANDA — lo que reporto ventas despues de usarlo:
//   1. «parece que no agarra todos los items de una cotizacion»
//   2. «mezclo las cotizaciones de todos los vendedores, se ve muy raro»
//   3. faltan las marcas
//
// Y sobre todo, PARA QUE SIRVE: la empresa cotiza todo lo que le mandan, y
// muchas piezas chicas no valen la pena de importar de a una. El reporte tiene
// que dejar ver que repuesto se pide seguido y entre CUANTOS clientes distintos,
// para decidir traer un lote y stockearlo. Esa pregunta se contesta SUMANDO
// entre clientes — al reves de separar por ejecutivo, que tambien hace falta
// pero para otra cosa.
// =============================================================================

describe('RCI2 — no se pierde ninguna linea', () => {

  // La denuncia era «no agarra todos los items». Esta es la prueba de
  // conservacion: lo que entra tiene que salir. Si el GROUP BY o algun JOIN
  // descartara lineas, las dos sumas no coincidirian.
  test('RCI2-01: la suma del reporte es igual a la suma de las lineas cargadas', async () => {
    const res = await pedir(`id_cliente=${idClienteA}&limit=200`);
    expect(res.status).toBe(200);

    const delReporte = res.body.data
      .reduce((acc, f) => acc + Number(f.cantidad_total), 0);

    const [filas] = await pool.execute(
      `SELECT COALESCE(SUM(d.cantidad), 0) AS total
         FROM cotizacion_detalles d
         INNER JOIN cotizaciones c ON c.id = d.id_cotizacion
        WHERE c.id_cliente = ?`, [idClienteA]);

    expect(delReporte).toBe(Number(filas[0].total));
  });

  test('RCI2-02: aparecen TODOS los codigos distintos del cliente', async () => {
    const res = await pedir(`id_cliente=${idClienteA}&limit=200`);

    // Cliente A tiene dos repuestos distintos: el del catalogo y RI-100.
    const codigos = new Set(res.body.data.map((f) => f.codigo));
    expect(codigos.has(COD_CAT)).toBe(true);
    expect(codigos.has('RI-100')).toBe(true);
  });
});

// =============================================================================
describe('RCI2 — separado por ejecutivo', () => {

  test('RCI2-03: cada fila dice que ejecutivo la cargo', async () => {
    const res = await pedir('limit=200');
    const fila = res.body.data.find((f) => f.cliente_nombre === CLI_A);

    expect(fila.id_ejecutivo).toBe(idEjec);
    expect(fila.ejecutivo_nombre).toContain('REPCI');
  });

  test('RCI2-04: se puede filtrar por ejecutivo', async () => {
    const res = await pedir(`id_ejecutivo=${idEjec}&limit=200`);
    expect(res.status).toBe(200);
    expect(res.body.data.every((f) => f.id_ejecutivo === idEjec)).toBe(true);
  });

  test('RCI2-05: dos ejecutivos sobre el mismo cliente y codigo no se mezclan', async () => {
    const res = await pedir(`id_cliente=${idClienteB}&limit=200`);
    const delOtro = res.body.data.filter((f) => f.id_ejecutivo === idEjec2);
    const delNuestro = res.body.data.filter((f) => f.id_ejecutivo === idEjec);

    // El segundo ejecutivo cargo 5 del mismo codigo sobre el mismo cliente:
    // tiene que salir en su propia fila, no sumado a la del primero.
    expect(delOtro.find((f) => f.codigo === COD_CAT)).toBeDefined();
    expect(Number(delOtro.find((f) => f.codigo === COD_CAT).cantidad_total)).toBe(5);
    expect(Number(delNuestro.find((f) => f.codigo === COD_CAT).cantidad_total)).toBe(7);
  });
});

// =============================================================================
describe('RCI2 — marcas', () => {

  test('RCI2-06: cada fila trae la marca del repuesto', async () => {
    const res = await pedir(`id_cliente=${idClienteA}&limit=200`);
    const fila = res.body.data.find((f) => f.codigo === 'RI-100');

    expect(fila.marca_nombre).toBe(MARCA_NOMBRE);
  });

  test('RCI2-07: una linea sin marca no desaparece', async () => {
    const res = await pedir(`id_cliente=${idClienteA}&limit=200`);
    const fila = res.body.data.find((f) => f.codigo === COD_CAT);

    expect(fila).toBeDefined();
    expect(fila.marca_nombre).toBeNull();
  });
});

// =============================================================================
// LA VISTA QUE CONTESTA LA PREGUNTA DEL NEGOCIO.
// «¿Conviene traer un lote de este repuesto?» se responde mirando cuanto se
// pide EN TOTAL y entre cuantos clientes DISTINTOS. Un repuesto que piden 5
// clientes distintos es mejor candidato a stock que uno que pidio 5 veces el
// mismo cliente, aunque la cantidad sea igual.
// =============================================================================
describe('RCI2 — vista por item, para decidir el stock', () => {

  test('RCI2-08: agrupa el mismo codigo entre todos los clientes', async () => {
    const res = await pedir('agrupar=item&limit=200');
    expect(res.status).toBe(200);

    const fila = res.body.data.find((f) => f.codigo === COD_CAT);
    // 15 del cliente A + 7 del cliente B + 5 del segundo ejecutivo = 27
    expect(Number(fila.cantidad_total)).toBe(27);
  });

  test('RCI2-09: dice entre cuantos clientes distintos se reparte', async () => {
    const res = await pedir('agrupar=item&limit=200');
    const fila = res.body.data.find((f) => f.codigo === COD_CAT);

    expect(Number(fila.clientes)).toBe(2);
  });

  test('RCI2-10: en esta vista no hay una fila por cliente', async () => {
    const res = await pedir('agrupar=item&limit=200');
    const conEseCodigo = res.body.data.filter((f) => f.codigo === COD_CAT);

    expect(conEseCodigo).toHaveLength(1);
  });

  test('RCI2-11: tambien arranca por fecha, y la cantidad queda a un clic', async () => {
    const porDefecto = await pedir('agrupar=item&limit=200');
    const fechas = porDefecto.body.data.map((f) => new Date(f.ultima_vez).getTime());
    for (let i = 1; i < fechas.length; i++) {
      expect(fechas[i - 1]).toBeGreaterThanOrEqual(fechas[i]);
    }

    const porCantidad = await pedir('agrupar=item&sort_by=cantidad&limit=200');
    const cantidades = porCantidad.body.data.map((f) => Number(f.cantidad_total));
    for (let i = 1; i < cantidades.length; i++) {
      expect(cantidades[i - 1]).toBeGreaterThanOrEqual(cantidades[i]);
    }
  });

  test('RCI2-12: se puede ordenar por cantidad de clientes distintos', async () => {
    const res = await pedir('agrupar=item&sort_by=clientes&sort_order=DESC&limit=200');
    expect(res.status).toBe(200);

    const clientes = res.body.data.map((f) => Number(f.clientes));
    for (let i = 1; i < clientes.length; i++) {
      expect(clientes[i - 1]).toBeGreaterThanOrEqual(clientes[i]);
    }
  });

  test('RCI2-13: la paginacion cuenta items, no combinaciones cliente-item', async () => {
    const [detalle, porItem] = await Promise.all([
      pedir('limit=1'),
      pedir('agrupar=item&limit=1'),
    ]);

    // Agrupar por item no puede dar MAS filas que agrupar por cliente+item.
    expect(porItem.body.pagination.totalRecords)
      .toBeLessThanOrEqual(detalle.body.pagination.totalRecords);
  });

  test('RCI2-14: un agrupar invalido se rechaza', async () => {
    const res = await pedir('agrupar=loquesea');
    expect(res.status).toBe(422);
  });
});
