// =============================================================================
// tests/integration/seguridadAuditoria2026-08-28.test.js
// Dos hallazgos BAJOS de la auditoría de seguridad (Fase 2, 2026-08-28):
//
// 1. Un body JSON malformado dejaba pasar el mensaje crudo del parser de V8
//    ("Unexpected end of JSON input") a través de la rama genérica de relay
//    4xx del manejador global (src/app.js) — no es texto de la aplicación,
//    así que no cumplía el criterio de "seguro para mostrar" que el propio
//    código documenta. Ahora `err.type === 'entity.parse.failed'` responde
//    un mensaje genérico, igual que ya hacía 'entity.too.large'.
//
// 2. PATCH /:id/comentario-admin (el endpoint standalone) no tenía ningún
//    límite de longitud, a diferencia de comentario_admin vía
//    updateStatusSchema (Zod, .max(4000)) — mismo campo (comentarios_admin
//    en la base), dos caminos, uno sin tope. Ahora el standalone también
//    corta en 4000.
//
// Prerequisitos: NODE_ENV=test — la base de pruebas debe existir y estar migrada.
// =============================================================================

'use strict';

require('dotenv').config();
process.env.NODE_ENV = 'test';

const request = require('supertest');
const bcrypt  = require('bcryptjs');
const app     = require('../../src/app');
const { pool } = require('../../src/config/db');

let adminToken, adminId, ejecId, clienteId, cotizacionId;

const ADMIN_USER = 'test_admin_secaudit';
const EJEC_USER  = 'test_ejec_secaudit';
const PASSWORD   = 'TestSecAudit01!';
const CLIENTE    = 'Test Client SECAUDIT';

beforeAll(async () => {
  await pool.execute('DELETE FROM cotizacion_detalles WHERE id_cotizacion IN (SELECT id FROM cotizaciones WHERE id_ejecutivo IN (SELECT id FROM usuarios WHERE nombre_usuario IN (?, ?)))', [ADMIN_USER, EJEC_USER]);
  await pool.execute('DELETE FROM cotizaciones WHERE id_ejecutivo IN (SELECT id FROM usuarios WHERE nombre_usuario IN (?, ?))', [ADMIN_USER, EJEC_USER]);
  await pool.execute('DELETE FROM usuarios WHERE nombre_usuario IN (?, ?)', [ADMIN_USER, EJEC_USER]);
  await pool.execute('DELETE FROM clientes WHERE razon_social = ?', [CLIENTE]);

  const hash = await bcrypt.hash(PASSWORD, 10);
  const [a] = await pool.execute(
    `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo)
     VALUES (?, ?, ?, 2, 1)`,
    ['Test Admin SECAUDIT', ADMIN_USER, hash]
  );
  adminId = a.insertId;

  const [e] = await pool.execute(
    `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo)
     VALUES (?, ?, ?, 1, 1)`,
    ['Test Ejecutivo SECAUDIT', EJEC_USER, hash]
  );
  ejecId = e.insertId;

  const [c] = await pool.execute(
    `INSERT INTO clientes (razon_social, activo) VALUES (?, 1)`, [CLIENTE]
  );
  clienteId = c.insertId;

  const [q] = await pool.execute(
    `INSERT INTO cotizaciones (numero_correlativo, id_cliente, id_ejecutivo, descripcion, fecha_emision, estado)
     VALUES (?, ?, ?, ?, CURDATE(), 'Pendiente')`,
    [`SEC-${Date.now()}`.slice(0, 20), clienteId, ejecId, 'Cotización de prueba SECAUDIT']
  );
  cotizacionId = q.insertId;

  const login = await request(app).post('/api/auth/login')
    .send({ nombre_usuario: ADMIN_USER, password: PASSWORD });
  expect(login.status).toBe(200);
  adminToken = login.body.data.token;
});

afterAll(async () => {
  await pool.execute('DELETE FROM cotizacion_detalles WHERE id_cotizacion = ?', [cotizacionId ?? 0]);
  await pool.execute('DELETE FROM cotizaciones WHERE id = ?', [cotizacionId ?? 0]);
  await pool.execute('DELETE FROM usuarios WHERE id IN (?, ?)', [adminId ?? 0, ejecId ?? 0]);
  await pool.execute('DELETE FROM clientes WHERE id = ?', [clienteId ?? 0]);
  await pool.end();
});

describe('SEC1 — JSON malformado no filtra el mensaje crudo del parser', () => {
  test('SEC1-01: body JSON roto responde un mensaje genérico, no el de V8', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"nombre_usuario": ');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Malformed request body. Expected valid JSON.');
    expect(res.body.message).not.toMatch(/unexpected|json input|position \d/i);
  });
});

describe('SEC2 — comentario_admin standalone respeta el mismo tope que updateStatus', () => {
  test('SEC2-01: 4000 caracteres exactos se acepta', async () => {
    const res = await request(app)
      .patch(`/api/cotizaciones/${cotizacionId}/comentario-admin`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ comentario_admin: 'x'.repeat(4000) });

    expect(res.status).toBe(200);
  });

  test('SEC2-02: 4001 caracteres responde 422', async () => {
    const res = await request(app)
      .patch(`/api/cotizaciones/${cotizacionId}/comentario-admin`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ comentario_admin: 'x'.repeat(4001) });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/4000/);
  });
});
