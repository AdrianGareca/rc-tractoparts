// =============================================================================
// tests/integration/licitacionCorrelativoConcurrencia.test.js
// N creaciones de licitación simultáneas: todas tienen que salir bien y con un
// código distinto.
//
// POR QUÉ ESTE ARCHIVO EXISTE
// Cotizaciones tenía esta prueba desde hace tiempo
// (correlativo.concurrencia.test.js) y licitaciones no, aunque el mecanismo es
// el mismo: `LicitacionModel.generateCorrelativo` toma la fila del contador con
// SELECT … FOR UPDATE, así que dos creaciones a la vez se serializan sobre esa
// fila. Eso garantiza que los códigos no se repitan.
//
// Lo que NO estaba garantizado es que las dos TERMINEN BIEN. Bajo contención
// real, InnoDB puede declarar un deadlock legítimo (ER_LOCK_DEADLOCK) y abortar
// una de las dos transacciones; la guía de MySQL dice que el cliente debe
// reintentarla. Cotizaciones lo hace desde hace rato con `withDeadlockRetry`.
// createLicitacion manejaba la transacción a mano, sin reintento, así que en
// ese caso devolvía un 500 opaco a alguien que no hizo nada mal.
//
// QUÉ PRUEBA ESTE ARCHIVO Y QUÉ NO
// Prueba el invariante observable: N peticiones simultáneas → N respuestas 201
// con N códigos distintos. Es una prueba de regresión honesta y valiosa.
//
// Lo que NO puede hacer es *forzar* un deadlock: depende del entrelazado real
// de InnoDB y no se reproduce a pedido. O sea que esta prueba puede pasar tanto
// con reintento como sin él. La garantía del reintento es estructural (el
// código ahora reintenta donde antes no lo hacía) y quien la cubre de verdad es
// tests/unit/transactionHelpers.test.js, que sí simula el ER_LOCK_DEADLOCK.
// Esta prueba es la red de abajo: si alguien rompe la serialización del
// contador, acá se ve enseguida.
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

jest.setTimeout(60000);

// Suficientes para que compitan de verdad por la fila del contador sin volver
// la suite lenta. Cotizaciones usa 20 por el mismo criterio.
const N = 15;

const PASSWORD = 'TestLicConc01!';
const USUARIO  = 'test_lic_conc_proy';
const CLIENTE  = 'Test Cliente LICCONC';

let token;
let usuarioId;
let clienteId;

beforeAll(async () => {
  // Limpieza de una corrida previa cortada a la mitad.
  await pool.execute('DELETE FROM licitaciones WHERE nombre LIKE ?', ['Licitación concurrente %']);
  await pool.execute('DELETE FROM usuarios WHERE nombre_usuario = ?', [USUARIO]);
  await pool.execute('DELETE FROM clientes WHERE razon_social = ?', [CLIENTE]);

  const hash = await bcrypt.hash(PASSWORD, 10);
  const [u] = await pool.execute(
    `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo)
     VALUES (?, ?, ?, 5, 1)`,                    // id_rol 5 = Proyectos
    ['Test Proyectos LICCONC', USUARIO, hash]
  );
  usuarioId = u.insertId;

  const [c] = await pool.execute(
    'INSERT INTO clientes (razon_social, activo) VALUES (?, 1)', [CLIENTE]
  );
  clienteId = c.insertId;

  const login = await request(app).post('/api/auth/login')
    .send({ nombre_usuario: USUARIO, password: PASSWORD });
  expect(login.status).toBe(200);
  token = login.body.data.token;
});

afterAll(async () => {
  await pool.execute('DELETE FROM licitaciones WHERE id_responsable = ?', [usuarioId ?? 0]);
  await pool.execute('DELETE FROM usuarios WHERE id = ?', [usuarioId ?? 0]);
  await pool.execute('DELETE FROM clientes WHERE id = ?', [clienteId ?? 0]);
  await pool.end();
});

describe(`LICCONC — ${N} licitaciones creadas al mismo tiempo`, () => {
  test('todas responden 201 y ninguna repite el código', async () => {
    const peticiones = Array.from({ length: N }, (_, i) =>
      request(app)
        .post('/api/licitaciones')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre:     `Licitación concurrente ${i}`,
          id_cliente: clienteId,
        })
    );

    const respuestas = await Promise.all(peticiones);

    // 1. Ninguna se cayó. Este es el punto que el reintento protege: sin él,
    //    un deadlock legítimo de InnoDB le devuelve un 500 a alguien que hizo
    //    todo bien.
    const fallidas = respuestas
      .filter((r) => r.status !== 201)
      .map((r) => `${r.status} ${r.body?.message ?? ''}`);
    expect(fallidas).toEqual([]);

    // 2. Los códigos son todos distintos. Esto es lo que garantiza el
    //    SELECT … FOR UPDATE sobre la fila del contador.
    const codigos = respuestas.map((r) => r.body.data.codigo);
    expect(new Set(codigos).size).toBe(N);

    // 3. Y quedaron efectivamente guardadas: el correlativo no se entregó dos
    //    veces ni se saltó ninguna fila.
    const [filas] = await pool.execute(
      'SELECT codigo FROM licitaciones WHERE id_responsable = ?', [usuarioId]
    );
    expect(filas).toHaveLength(N);
    expect(new Set(filas.map((f) => f.codigo)).size).toBe(N);
  });
});
