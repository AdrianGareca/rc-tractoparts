// =============================================================================
// tests/integration/detalleReferenciaInvalida.test.js
// Un id_producto / marca_id inexistente en un ítem de `detalles` debe
// responder 422 (no un 500 genérico por violación de clave foránea).
//
// EL BUG
// A diferencia de id_cliente/id_licitacion (que tienen guards dedicados
// devolviendo 422 — clienteLinkGuard.js / licitacionLinkGuard.js), un
// id_producto o marca_id inexistente dentro de un ítem de `detalles` llegaba
// directo al INSERT de cotizacion_detalles, violaba su clave foránea, y salía
// como una excepción sin capturar → 500 genérico ("Failed to create/update
// quotation"), sin decirle al usuario cuál ítem ni cuál campo estaba mal.
// Encontrado en la ronda de estrés del 2026-08-26.
//
// EL ARREGLO
// writeRepository.js#_verificarReferenciasDetalles corre ANTES del INSERT
// (dentro de createDetalles, que también usa replaceDetalles — así que cubre
// tanto POST / como PUT /:id) y devuelve un error tipado
// (.code = 'INVALID_ITEM_REFERENCE', .status = 422) que el controller
// traduce a un 422 nombrando el ítem y el campo.
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

jest.setTimeout(30000); // create/update puede regenerar el PDF (lento)

let token, ejecId, clienteId, cotizacionId;
let marcaRealId, productoRealId;

const USUARIO  = 'test_ejec_refitem';
const PASSWORD = 'TestRefItem01!';
const CLIENTE  = 'Test Client REFITEM';
const ID_INEXISTENTE = 999999999;

beforeAll(async () => {
  await pool.execute('DELETE FROM cotizacion_detalles WHERE id_cotizacion IN (SELECT id FROM cotizaciones WHERE id_ejecutivo IN (SELECT id FROM usuarios WHERE nombre_usuario = ?))', [USUARIO]);
  await pool.execute('DELETE FROM cotizaciones WHERE id_ejecutivo IN (SELECT id FROM usuarios WHERE nombre_usuario = ?)', [USUARIO]);
  await pool.execute('DELETE FROM usuarios WHERE nombre_usuario = ?', [USUARIO]);
  await pool.execute('DELETE FROM clientes WHERE razon_social = ?', [CLIENTE]);
  await pool.execute('DELETE FROM productos WHERE codigo = ?', ['REFITEM-TEST-001']);

  const hash = await bcrypt.hash(PASSWORD, 10);
  const [u] = await pool.execute(
    `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo)
     VALUES (?, ?, ?, 1, 1)`,
    ['Test Ejecutivo REFITEM', USUARIO, hash]
  );
  ejecId = u.insertId;

  const [c] = await pool.execute(
    `INSERT INTO clientes (razon_social, activo) VALUES (?, 1)`, [CLIENTE]
  );
  clienteId = c.insertId;

  // Referencias REALES, para probar que el guardián no bloquea lo válido.
  const [marcaRows] = await pool.execute(`SELECT id FROM marcas LIMIT 1`);
  marcaRealId = marcaRows[0].id;

  const [prodRes] = await pool.execute(
    `INSERT INTO productos (codigo, descripcion, marca_id) VALUES (?, ?, ?)`,
    ['REFITEM-TEST-001', 'Producto de prueba REFITEM', marcaRealId]
  );
  productoRealId = prodRes.insertId;

  // Una cotización existente en 'Pendiente', para los casos de PUT.
  const [q] = await pool.execute(
    `INSERT INTO cotizaciones (numero_correlativo, id_cliente, id_ejecutivo, descripcion, fecha_emision, estado)
     VALUES (?, ?, ?, ?, CURDATE(), 'Pendiente')`,
    [`REF-${Date.now()}`.slice(0, 20), clienteId, ejecId, 'Cotización de prueba REFITEM']
  );
  cotizacionId = q.insertId;
  await pool.execute(
    `INSERT INTO cotizacion_detalles (id_cotizacion, descripcion_item, cantidad, precio_unitario, subtotal, unidad)
     VALUES (?, 'Repuesto de prueba', 1, 100.00, 100.00, 'UND')`,
    [cotizacionId]
  );

  const login = await request(app).post('/api/auth/login')
    .send({ nombre_usuario: USUARIO, password: PASSWORD });
  expect(login.status).toBe(200);
  token = login.body.data.token;
});

afterAll(async () => {
  await pool.execute('DELETE FROM cotizacion_detalles WHERE id_cotizacion = ?', [cotizacionId ?? 0]);
  await pool.execute('DELETE FROM cotizaciones WHERE id = ?', [cotizacionId ?? 0]);
  await pool.execute('DELETE FROM productos WHERE id = ?', [productoRealId ?? 0]);
  await pool.execute('DELETE FROM usuarios WHERE id = ?', [ejecId ?? 0]);
  await pool.execute('DELETE FROM clientes WHERE id = ?', [clienteId ?? 0]);
  await pool.end();
});

const cuerpoBase = (detalles) => ({
  id_cliente:    clienteId,
  descripcion:   'Cotización de prueba REFITEM',
  fecha_emision: '2026-07-24',
  detalles,
});

describe('REFITEM — id_producto/marca_id inexistente en un ítem de detalles', () => {

  test('REF-01: POST / con id_producto inexistente responde 422 (no 500)', async () => {
    const res = await request(app)
      .post('/api/cotizaciones')
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpoBase([
        { descripcion_item: 'Item malo', cantidad: 1, precio_unitario: 50, id_producto: ID_INEXISTENTE },
      ]));

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(new RegExp(String(ID_INEXISTENTE)));
  });

  test('REF-02: POST / con marca_id inexistente responde 422 (no 500)', async () => {
    const res = await request(app)
      .post('/api/cotizaciones')
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpoBase([
        { descripcion_item: 'Item malo', cantidad: 1, precio_unitario: 50, marca_id: ID_INEXISTENTE },
      ]));

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(new RegExp(String(ID_INEXISTENTE)));
  });

  test('REF-03: POST / con id_producto y marca_id REALES crea normalmente (no bloquea lo válido)', async () => {
    const res = await request(app)
      .post('/api/cotizaciones')
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpoBase([
        { descripcion_item: 'Item bueno', cantidad: 1, precio_unitario: 50, id_producto: productoRealId, marca_id: marcaRealId },
      ]));

    expect(res.status).toBe(201);

    await pool.execute('DELETE FROM cotizacion_detalles WHERE id_cotizacion = ?', [res.body.data.id]);
    await pool.execute('DELETE FROM cotizaciones WHERE id = ?', [res.body.data.id]);
  });

  test('REF-04: PUT /:id con id_producto inexistente responde 422 (no 500) y no modifica los detalles existentes', async () => {
    const res = await request(app)
      .put(`/api/cotizaciones/${cotizacionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpoBase([
        { descripcion_item: 'Item malo', cantidad: 1, precio_unitario: 50, id_producto: ID_INEXISTENTE },
      ]));

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);

    // El DELETE de replaceDetalles y el INSERT fallido corrieron en la MISMA
    // transacción: si el rollback no funcionara, el detalle original habría
    // desaparecido sin ser reemplazado.
    const [rows] = await pool.execute(
      'SELECT descripcion_item FROM cotizacion_detalles WHERE id_cotizacion = ?', [cotizacionId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].descripcion_item).toBe('Repuesto de prueba');
  });

  test('REF-05: PUT /:id con marca_id inexistente responde 422 (no 500)', async () => {
    const res = await request(app)
      .put(`/api/cotizaciones/${cotizacionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpoBase([
        { descripcion_item: 'Item malo', cantidad: 1, precio_unitario: 50, marca_id: ID_INEXISTENTE },
      ]));

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });
});
