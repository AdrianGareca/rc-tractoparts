// =============================================================================
// tests/integration/misMetricas.test.js
// GET /api/reportes/mis-metricas — el reporte propio del ejecutivo.
//
// POR QUE EXISTE
// El tablero del ejecutivo mostraba dos tablas y UNA fila con sus totales. Para
// alguien que quiere ver como viene su trabajo, era un resumen de un renglon.
//
// LA METRICA PRINCIPAL ES LA CONVERSION, y como se calcula NO es obvio:
// el denominador son las cotizaciones que YA SALIERON al cliente (enviadas,
// confirmadas y rechazadas), no el total. Dividir por el total castigaria a
// quien tiene trabajo en curso — una cotizacion creada hoy no es una venta
// perdida, y con esa cuenta un ejecutivo aplicado tendria peor numero que uno
// que cotiza poco.
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

let tokenEjec, tokenJefe, idEjec, idOtro, idJefe, idCliente;
const creadas = [];

const U_EJEC = 'test_ejec_mm';
const U_OTRO = 'test_otro_mm';
const U_JEFE = 'test_jefe_mm';
const PASSWORD = 'TestMisMetricas2026!';
const CLIENTE  = 'Test Cliente MM';

/**
 * Escenario del ejecutivo bajo prueba:
 *   2 Pendiente            → en proceso, NO cuentan para la conversion
 *   1 Enviada al cliente   → en la cancha, todavia sin respuesta
 *   3 Confirmada           → cerradas
 *   2 Rechazada            → en la cancha, respuesta negativa
 *
 * En la cancha = 1 + 3 + 2 = 6.  Cerradas = 3.  Conversion = 50.0 %
 * Si se dividiera por el TOTAL (8), daria 37.5 % — castigando las 2 pendientes.
 */
const ESCENARIO = [
  ['Pendiente', 2], ['Enviada al cliente', 1], ['Confirmada', 3], ['Rechazada', 2],
];
const EN_LA_CANCHA = 6;
const CERRADAS     = 3;
const TOTAL        = 8;

// Aparte del escenario: dos Archivada, creadas directo desde Pendiente —
// nunca llegaron a enviarse al cliente. Antes de la correccion, `en_proceso`
// las sumaba junto con las Pendiente genuinas (total - en_la_cancha), asi que
// el PDF individual las mostraba como "en preparación" cuando en realidad
// estan muertas. Deben contarse en su propio campo `archivadas` y quedar
// AFUERA de `en_proceso`.
const ARCHIVADAS = 2;

async function crear(estado, idEjecutivo, moneda = 'USD', monto = 100) {
  const correlativo = `MM-${Date.now() % 100000}-${creadas.length}`;
  // Las confirmadas llevan fecha_confirmacion 5 dias despues de creado_en para
  // que el promedio de dias de cierre sea comprobable.
  const cerrada = ['Confirmada', 'Aceptada'].includes(estado);
  const [res] = await pool.execute(
    `INSERT INTO cotizaciones
       (numero_correlativo, id_cliente, id_ejecutivo, descripcion, fecha_emision,
        estado, monto_total, moneda, creado_en, fecha_confirmacion)
     VALUES (?, ?, ?, 'Cotizacion MM', CURDATE(), ?, ?, ?,
             DATE_SUB(NOW(), INTERVAL 10 DAY),
             ${cerrada ? 'DATE_SUB(NOW(), INTERVAL 5 DAY)' : 'NULL'})`,
    [correlativo.slice(0, 20), idCliente, idEjecutivo, estado, monto, moneda]
  );
  creadas.push(res.insertId);
  return res.insertId;
}

const pedir = (token, query = '') => request(app)
  .get(`/api/reportes/mis-metricas${query ? '?' + query : ''}`)
  .set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  const us = [U_EJEC, U_OTRO, U_JEFE];
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
  idEjec = await nuevo('Test Ejecutivo MM', U_EJEC, 1);
  idOtro = await nuevo('Test Otro MM',      U_OTRO, 1);
  idJefe = await nuevo('Test Jefe MM',      U_JEFE, 3);

  const [cli] = await pool.execute(
    'INSERT INTO clientes (razon_social, activo) VALUES (?, 1)', [CLIENTE]);
  idCliente = cli.insertId;

  for (const [estado, veces] of ESCENARIO) {
    for (let i = 0; i < veces; i++) await crear(estado, idEjec);
  }
  // Una en bolivianos, para verificar que los montos no se sumen entre monedas.
  await crear('Confirmada', idEjec, 'BOB', 700);

  // Dos Archivada: nunca salieron al cliente, y no deben contarse como "en
  // proceso" (ver ARCHIVADAS arriba).
  for (let i = 0; i < ARCHIVADAS; i++) await crear('Archivada', idEjec);

  // Y una del OTRO ejecutivo, que nunca debe aparecer en las metricas del primero.
  await crear('Confirmada', idOtro);

  const login = async (u) => (await request(app).post('/api/auth/login')
    .send({ nombre_usuario: u, password: PASSWORD })).body.data.token;
  tokenEjec = await login(U_EJEC);
  tokenJefe = await login(U_JEFE);
});

afterAll(async () => {
  if (creadas.length > 0) {
    const m = creadas.map(() => '?').join(', ');
    await pool.execute(`DELETE FROM cotizaciones WHERE id IN (${m})`, creadas);
  }
  await pool.execute('DELETE FROM usuarios WHERE id IN (?, ?, ?)', [idEjec, idOtro, idJefe]);
  if (idCliente) await pool.execute('DELETE FROM clientes WHERE id = ?', [idCliente]);
  await pool.end();
});

// =============================================================================
describe('MM — la conversion, que es LA metrica', () => {

  test('MM-01: se calcula sobre lo que salio al cliente, no sobre el total', async () => {
    const res = await pedir(tokenEjec);

    expect(res.status).toBe(200);
    // 3 cerradas (+1 en BOB) sobre 7 en la cancha = 57.1 %
    expect(res.body.data.en_la_cancha).toBe(EN_LA_CANCHA + 1);
    expect(res.body.data.cerradas).toBe(CERRADAS + 1);
    expect(res.body.data.conversion).toBeCloseTo(57.1, 1);
  });

  test('MM-02: las que siguen en preparacion NO bajan la conversion', async () => {
    const res = await pedir(tokenEjec);
    const d = res.body.data;

    // Con el total como denominador daria bastante menos.
    const siFueraSobreElTotal = (d.cerradas / d.total) * 100;
    expect(d.conversion).toBeGreaterThan(siFueraSobreElTotal);
    // Las DOS Pendiente, y nada mas: si las Archivada se colaran aca (el bug
    // que corrige este archivo), este numero seria 4 y no 2.
    expect(d.en_proceso).toBe(2);
  });

  // «0 % de conversion» y «todavia no enviaste nada» son cosas distintas.
  // Mostrarle un 0 % rojo a alguien que recien arranca es informacion falsa.
  test('MM-03: sin nada enviado, la conversion es null y no 0', async () => {
    const login = await request(app).post('/api/auth/login')
      .send({ nombre_usuario: U_OTRO, password: PASSWORD });
    // El otro ejecutivo solo tiene una Confirmada; se filtra a un rango vacio.
    const res = await pedir(login.body.data.token, 'fecha_desde=2000-01-01&fecha_hasta=2000-12-31');

    expect(res.body.data.conversion).toBeNull();
    expect(res.body.data.conversion).not.toBe(0);
  });
});

// =============================================================================
// Hallazgo (BAJO): las Archivada que nunca salieron al cliente se contaban
// como "en proceso" — el PDF individual las mostraba con el texto "en
// preparación", que es lo opuesto de un estado terminal.
// =============================================================================
describe('MM — las Archivada no son "en proceso"', () => {

  test('MM-19: las archivadas se cuentan en su propio campo', async () => {
    const res = await pedir(tokenEjec);
    expect(res.body.data.archivadas).toBe(ARCHIVADAS);
  });

  test('MM-20: no inflan "en proceso" ni "en la cancha"', async () => {
    const res = await pedir(tokenEjec);
    const d = res.body.data;

    // Si el bug siguiera presente, en_proceso incluiria las 2 archivadas
    // ademas de las 2 Pendiente genuinas, y daria 4 en vez de 2.
    expect(d.en_proceso).toBe(2);
    // Tampoco cuentan como "salieron al cliente": nunca llegaron a enviarse.
    expect(d.en_la_cancha).toBe(EN_LA_CANCHA + 1);
  });

  test('MM-21: total = en_la_cancha + archivadas + en_proceso', async () => {
    const res = await pedir(tokenEjec);
    const d = res.body.data;

    expect(d.en_la_cancha + d.archivadas + d.en_proceso).toBe(d.total);
  });
});

// =============================================================================
describe('MM — el desglose por estado', () => {

  test('MM-04: una fila por estado, con su conteo', async () => {
    const res = await pedir(tokenEjec);
    const porEstado = res.body.data.por_estado;

    const cantidadDe = (e) => porEstado.find((f) => f.estado === e)?.cantidad ?? 0;
    expect(cantidadDe('Pendiente')).toBe(2);
    expect(cantidadDe('Enviada al cliente')).toBe(1);
    expect(cantidadDe('Confirmada')).toBe(4);   // 3 en USD + 1 en BOB
    expect(cantidadDe('Rechazada')).toBe(2);
    expect(cantidadDe('Archivada')).toBe(ARCHIVADAS);
  });

  test('MM-05: las cantidades del desglose suman el total', async () => {
    const res = await pedir(tokenEjec);
    const suma = res.body.data.por_estado.reduce((a, f) => a + f.cantidad, 0);

    expect(suma).toBe(res.body.data.total);
  });

  // El error que ya aparecio dos veces en este proyecto: sumar USD con Bs.
  test('MM-06: los montos van separados por moneda, nunca sumados', async () => {
    const res = await pedir(tokenEjec);
    const confirmadas = res.body.data.por_estado.find((f) => f.estado === 'Confirmada');

    expect(Number(confirmadas.monto_usd)).toBe(300);   // 3 x 100
    expect(Number(confirmadas.monto_bob)).toBe(700);   // 1 x 700
  });
});

// =============================================================================
describe('MM — tiempos y ticket', () => {

  test('MM-07: promedia los dias de cierre solo de las que cerraron', async () => {
    const res = await pedir(tokenEjec);
    // Todas las confirmadas se crearon 10 dias atras y cerraron 5 dias atras.
    expect(res.body.data.dias_cierre).toBeCloseTo(5, 0);
  });

  test('MM-08: el ticket promedio tambien va por moneda', async () => {
    const res = await pedir(tokenEjec);

    expect(Number(res.body.data.ticket_usd)).toBe(100);
    expect(Number(res.body.data.ticket_bob)).toBe(700);
  });

  test('MM-09: sin cierres, los tiempos vienen null en vez de 0', async () => {
    const res = await pedir(tokenEjec, 'fecha_desde=2000-01-01&fecha_hasta=2000-12-31');

    expect(res.body.data.dias_cierre).toBeNull();
    expect(res.body.data.ticket_usd).toBeNull();
  });
});

// =============================================================================
describe('MM — evolucion mes a mes', () => {

  test('MM-10: trae emitidas y cerradas por mes', async () => {
    const res = await pedir(tokenEjec);
    const meses = res.body.data.por_mes;

    expect(meses.length).toBeGreaterThan(0);
    expect(meses[0]).toHaveProperty('mes');
    expect(meses[0]).toHaveProperty('emitidas');
    expect(meses[0]).toHaveProperty('cerradas');
  });

  test('MM-11: nunca hay mas cerradas que emitidas en un mes', async () => {
    const res = await pedir(tokenEjec);
    for (const m of res.body.data.por_mes) {
      expect(m.cerradas).toBeLessThanOrEqual(m.emitidas);
    }
  });
});

// =============================================================================
describe('MM — alcance: cada uno ve lo suyo', () => {

  test('MM-12: no se cuelan las cotizaciones de otro ejecutivo', async () => {
    const res = await pedir(tokenEjec);
    // El otro tiene 1 confirmada; si se colara, el total seria distinto.
    expect(res.body.data.total).toBe(TOTAL + 1 + ARCHIVADAS);
  });

  // Si un Ejecutivo pudiera pasar id_ejecutivo, cualquiera veria el desempeno
  // de sus companeros — que no es lo mismo que ver el propio.
  test('MM-13: un Ejecutivo NO puede pedir las metricas de otro', async () => {
    const res = await pedir(tokenEjec, `id_ejecutivo=${idOtro}`);

    expect(res.status).toBe(200);
    expect(res.body.id_ejecutivo).toBe(idEjec);      // se ignoro el parametro
    expect(res.body.data.total).toBe(TOTAL + 1 + ARCHIVADAS);   // siguen siendo las suyas
  });

  test('MM-14: un Jefe SI puede mirar las de un ejecutivo', async () => {
    const res = await pedir(tokenJefe, `id_ejecutivo=${idEjec}`);

    expect(res.status).toBe(200);
    expect(res.body.id_ejecutivo).toBe(idEjec);
    expect(res.body.data.total).toBe(TOTAL + 1 + ARCHIVADAS);
  });

  test('MM-15: sin id_ejecutivo, el Jefe ve las suyas (que son ninguna)', async () => {
    const res = await pedir(tokenJefe);

    expect(res.body.id_ejecutivo).toBe(idJefe);
    expect(res.body.data.total).toBe(0);
  });
});

// =============================================================================
describe('MM — entradas invalidas', () => {

  test('MM-16: sin token, 401', async () => {
    const res = await request(app).get('/api/reportes/mis-metricas');
    expect(res.status).toBe(401);
  });

  test('MM-17: una fecha mal formada se rechaza con 422', async () => {
    const res = await pedir(tokenEjec, 'fecha_desde=ayer');
    expect(res.status).toBe(422);
  });

  test('MM-18: un id_ejecutivo no numerico de un Jefe se rechaza con 422', async () => {
    const res = await pedir(tokenJefe, 'id_ejecutivo=abc');
    expect(res.status).toBe(422);
  });
});
