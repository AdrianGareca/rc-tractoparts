// =============================================================================
// tests/integration/clienteItemAlcance.test.js
// El reporte por cliente/ítem no puede mostrarle a un ejecutivo la cartera ajena.
//
// EL AGUJERO
// `GET /api/reportes/cliente-item` llevaba sólo `authenticate`, sin `authorize`,
// y el controlador tomaba `id_ejecutivo` directo de `req.query` sin pasar por
// `resolveEjecutivoScope` — que es, según su propio comentario, «el ÚNICO lugar
// donde se toma esa decisión de autorización», y que sí usan /progreso,
// /advanced y /mis-metricas.
//
// QUÉ SE FILTRABA
// Cualquier usuario autenticado —incluido un Ejecutivo, o un Proyectos que ni
// siquiera cotiza— podía pedir el reporte sin parámetros y recibir la tabla
// completa: qué repuestos, en qué cantidades y a qué clientes le cotizó CADA
// vendedor de la empresa. Con `?id_ejecutivo=7` miraba la cartera de un
// compañero puntual.
//
// En una empresa donde los ejecutivos compiten por comisión, eso es la lista de
// clientes y el detalle de precios de todos, servida por la API.
//
// LA REGLA QUE SE APLICA
// La misma que el resto de los reportes: quien no es rol de gestión ve SÓLO lo
// suyo, sin importar qué mande en la consulta. Un rol de gestión ve todo, y
// puede acotar por vendedor a propósito.
//
// Prerequisitos: NODE_ENV=test — la base de pruebas debe existir y estar migrada.
// =============================================================================

'use strict';

require('dotenv').config();
process.env.NODE_ENV = 'test';

const request  = require('supertest');
const bcrypt   = require('bcryptjs');
const app      = require('../../src/app');
const { pool } = require('../../src/config/db');

jest.setTimeout(30000);

let tokenAna, tokenBruno, tokenJefe;
let anaId, brunoId, jefeId, clienteId;

const ANA   = 'test_ana_alcance';
const BRUNO = 'test_bruno_alcance';
const JEFE  = 'test_jefe_alcance';
const PASS  = 'TestAlcance01!';
const CLIENTE = 'Test Client ALCANCE';

/** El ítem que sólo cotiza Bruno. Si Ana lo ve, hay fuga. */
const ITEM_DE_BRUNO = 'FILTRO SECRETO DE BRUNO';

const crearUsuario = async (usuario, nombre, idRol) => {
  const hash = await bcrypt.hash(PASS, 10);
  const [r] = await pool.execute(
    `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo)
     VALUES (?, ?, ?, ?, 1)`,
    [nombre, usuario, hash, idRol]
  );
  return r.insertId;
};

const login = async (usuario) => {
  const r = await request(app).post('/api/auth/login')
    .send({ nombre_usuario: usuario, password: PASS });
  expect(r.status).toBe(200);
  return r.body.data.token;
};

const crearCotizacion = async (ejecId, item) => {
  const [c] = await pool.execute(
    `INSERT INTO cotizaciones (numero_correlativo, id_cliente, id_ejecutivo, descripcion,
                               fecha_emision, estado, moneda, monto_total)
     VALUES (?, ?, ?, ?, CURDATE(), 'Confirmada', 'BOB', 500.00)`,
    [`ALC-${Date.now()}-${ejecId}`.slice(0, 20), clienteId, ejecId, 'Cotización de alcance']
  );
  await pool.execute(
    `INSERT INTO cotizacion_detalles (id_cotizacion, descripcion_item, cantidad, precio_unitario, subtotal, unidad)
     VALUES (?, ?, 1, 500.00, 500.00, 'UND')`,
    [c.insertId, item]
  );
  return c.insertId;
};

beforeAll(async () => {
  const usuarios = [ANA, BRUNO, JEFE];
  await pool.execute(
    `DELETE FROM cotizacion_detalles WHERE id_cotizacion IN
       (SELECT id FROM cotizaciones WHERE id_ejecutivo IN
         (SELECT id FROM usuarios WHERE nombre_usuario IN (?, ?, ?)))`, usuarios);
  await pool.execute(
    `DELETE FROM cotizaciones WHERE id_ejecutivo IN
       (SELECT id FROM usuarios WHERE nombre_usuario IN (?, ?, ?))`, usuarios);
  await pool.execute('DELETE FROM usuarios WHERE nombre_usuario IN (?, ?, ?)', usuarios);
  await pool.execute('DELETE FROM clientes WHERE razon_social = ?', [CLIENTE]);

  anaId   = await crearUsuario(ANA,   'Ana Alcance',   1);   // Ejecutivo
  brunoId = await crearUsuario(BRUNO, 'Bruno Alcance', 1);   // Ejecutivo
  jefeId  = await crearUsuario(JEFE,  'Jefe Alcance',  3);   // Jefe

  const [cl] = await pool.execute(
    `INSERT INTO clientes (razon_social, activo) VALUES (?, 1)`, [CLIENTE]
  );
  clienteId = cl.insertId;

  await crearCotizacion(anaId,   'REPUESTO COMUN DE ANA');
  await crearCotizacion(brunoId, ITEM_DE_BRUNO);

  [tokenAna, tokenBruno, tokenJefe] = await Promise.all(
    [ANA, BRUNO, JEFE].map(login)
  );
});

afterAll(async () => {
  const ids = [anaId, brunoId, jefeId].filter(Boolean);
  if (ids.length) {
    const marcas = ids.map(() => '?').join(',');
    await pool.execute(
      `DELETE FROM cotizacion_detalles WHERE id_cotizacion IN
         (SELECT id FROM cotizaciones WHERE id_ejecutivo IN (${marcas}))`, ids);
    await pool.execute(`DELETE FROM cotizaciones WHERE id_ejecutivo IN (${marcas})`, ids);
    await pool.execute(`DELETE FROM usuarios WHERE id IN (${marcas})`, ids);
  }
  await pool.execute('DELETE FROM clientes WHERE id = ?', [clienteId ?? 0]);
  await pool.end();
});

/** El texto completo de la respuesta, para buscar el ítem ajeno adentro. */
const cuerpoComoTexto = (res) => JSON.stringify(res.body);

describe('ALC — alcance del reporte por cliente/ítem', () => {

  test('ALC-01: un ejecutivo NO ve los ítems cotizados por otro', async () => {
    const res = await request(app)
      .get('/api/reportes/cliente-item')
      .set('Authorization', `Bearer ${tokenAna}`);

    expect(res.status).toBe(200);

    // Si esto falla, Ana está leyendo la cartera de Bruno: qué repuestos le
    // cotizó, a qué clientes y por cuánto.
    expect(cuerpoComoTexto(res)).not.toContain(ITEM_DE_BRUNO);
  });

  test('ALC-02: un ejecutivo SÍ ve lo suyo — el reporte le sigue sirviendo', async () => {
    // El arreglo no puede ser «bloquear a los ejecutivos»: el reporte se hizo
    // para que ellos lo generen y el Jefe lo mire.
    const res = await request(app)
      .get('/api/reportes/cliente-item')
      .set('Authorization', `Bearer ${tokenAna}`);

    expect(res.status).toBe(200);
    expect(cuerpoComoTexto(res)).toContain('REPUESTO COMUN DE ANA');
  });

  test('ALC-03: pedir explícitamente el id de otro ejecutivo NO lo devuelve', async () => {
    // El intento directo: Ana pide la cartera de Bruno por id.
    const res = await request(app)
      .get(`/api/reportes/cliente-item?id_ejecutivo=${brunoId}`)
      .set('Authorization', `Bearer ${tokenAna}`);

    expect(res.status).toBe(200);
    expect(cuerpoComoTexto(res)).not.toContain(ITEM_DE_BRUNO);
    // Y lo que ve sigue siendo lo suyo, no una lista vacía: el parámetro se
    // ignora, no rompe la pantalla.
    expect(cuerpoComoTexto(res)).toContain('REPUESTO COMUN DE ANA');
  });

  test('ALC-04: el Jefe SÍ ve a los dos — el reporte de gestión no se rompe', async () => {
    const res = await request(app)
      .get('/api/reportes/cliente-item')
      .set('Authorization', `Bearer ${tokenJefe}`);

    expect(res.status).toBe(200);
    const texto = cuerpoComoTexto(res);
    expect(texto).toContain(ITEM_DE_BRUNO);
    expect(texto).toContain('REPUESTO COMUN DE ANA');
  });

  test('ALC-05: el Jefe puede acotar por vendedor a propósito', async () => {
    const res = await request(app)
      .get(`/api/reportes/cliente-item?id_ejecutivo=${brunoId}`)
      .set('Authorization', `Bearer ${tokenJefe}`);

    expect(res.status).toBe(200);
    const texto = cuerpoComoTexto(res);
    expect(texto).toContain(ITEM_DE_BRUNO);
    expect(texto).not.toContain('REPUESTO COMUN DE ANA');
  });

  test('ALC-06: un id_ejecutivo inválido del Jefe se rechaza con 422', async () => {
    // Mismo criterio que el resto de los reportes: un valor basura no se
    // ignora en silencio, porque eso devolvería la empresa entera cuando el
    // Jefe creía estar filtrando por una persona.
    const res = await request(app)
      .get('/api/reportes/cliente-item?id_ejecutivo=abc')
      .set('Authorization', `Bearer ${tokenJefe}`);

    expect(res.status).toBe(422);
  });
});
