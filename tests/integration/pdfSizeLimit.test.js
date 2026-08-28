// =============================================================================
// tests/integration/pdfSizeLimit.test.js
// HALLAZGO 4 (ronda de estrés 2026-08-26) — off-by-one en el límite máximo de
// tamaño de archivo, en la subida de Excel de cotizaciones (POST /:id/upload).
//
// Un archivo de EXACTAMENTE MAX_PDF_SIZE_MB*1024*1024 bytes se rechazaba como
// "demasiado grande"; uno de un byte menos se aceptaba. La causa es una
// particularidad de busboy (la librería que usa multer por debajo): dispara
// su evento 'limit' — y por lo tanto LIMIT_FILE_SIZE — en cuanto los bytes
// recibidos LLEGAN a `limits.fileSize`, no cuando lo SUPERAN
// (node_modules/busboy/lib/types/multipart.js). quotationRoutes.js ahora
// configura `limits.fileSize = MAX_PDF_SIZE_MB*1024*1024 + 1`, así que el
// primer tamaño que dispara el límite es el byte siguiente al documentado.
//
// NOTA (2026-08-28): este test apuntaba originalmente a POST /:id/pdf, la
// subida manual de PDF que se sacó por completo ese día — ningún botón de la
// aplicación real la disparaba nunca (ver quotationPdfController.js). El
// límite de tamaño en sí sigue existiendo, ahora sólo para el campo 'excel'
// de POST /:id/upload, así que el test se reescribió contra esa ruta para
// seguir cubriendo el mismo fix.
//
// Prerequisitos: NODE_ENV=test — la base de pruebas debe existir y estar migrada.
// =============================================================================

'use strict';

require('dotenv').config();
process.env.NODE_ENV = 'test';

const fs      = require('fs');
const path    = require('path');
const request = require('supertest');
const bcrypt  = require('bcryptjs');
const app     = require('../../src/app');
const { pool } = require('../../src/config/db');

jest.setTimeout(30000); // buffers de ~10 MB

let token, ejecId, clienteId, cotizacionId;

const USUARIO  = 'test_ejec_pdfsize';
const PASSWORD = 'TestPdfSize01!';
const CLIENTE  = 'Test Client PDFSIZE';

const MAX_MB       = parseInt(process.env.MAX_PDF_SIZE_MB, 10) || 10;
const LIMITE_BYTES = MAX_MB * 1024 * 1024;

// Cabecera ZIP (PK\x03\x04) — necesaria para pasar el chequeo de magic-number
// del controller independientemente del tamaño total del archivo.
function bufferXlsxDeTamano(bytes) {
  const buf = Buffer.alloc(bytes, 0x20);
  buf[0] = 0x50; buf[1] = 0x4B; buf[2] = 0x03; buf[3] = 0x04;
  return buf;
}

beforeAll(async () => {
  await pool.execute('DELETE FROM cotizacion_detalles WHERE id_cotizacion IN (SELECT id FROM cotizaciones WHERE id_ejecutivo IN (SELECT id FROM usuarios WHERE nombre_usuario = ?))', [USUARIO]);
  await pool.execute('DELETE FROM cotizaciones WHERE id_ejecutivo IN (SELECT id FROM usuarios WHERE nombre_usuario = ?)', [USUARIO]);
  await pool.execute('DELETE FROM usuarios WHERE nombre_usuario = ?', [USUARIO]);
  await pool.execute('DELETE FROM clientes WHERE razon_social = ?', [CLIENTE]);

  const hash = await bcrypt.hash(PASSWORD, 10);
  const [u] = await pool.execute(
    `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo)
     VALUES (?, ?, ?, 1, 1)`,
    ['Test Ejecutivo PDFSIZE', USUARIO, hash]
  );
  ejecId = u.insertId;

  const [c] = await pool.execute(
    `INSERT INTO clientes (razon_social, activo) VALUES (?, 1)`, [CLIENTE]
  );
  clienteId = c.insertId;

  const [q] = await pool.execute(
    `INSERT INTO cotizaciones (numero_correlativo, id_cliente, id_ejecutivo, descripcion, fecha_emision, estado)
     VALUES (?, ?, ?, ?, CURDATE(), 'Pendiente')`,
    [`PSZ-${Date.now()}`.slice(0, 20), clienteId, ejecId, 'Cotización de prueba PDFSIZE']
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
  const [rows] = await pool.execute('SELECT excel_ruta FROM cotizaciones WHERE id = ?', [cotizacionId ?? 0]);
  if (rows[0]?.excel_ruta) {
    await fs.promises.unlink(path.resolve(process.cwd(), rows[0].excel_ruta)).catch(() => {});
  }
  await pool.execute('DELETE FROM cotizacion_detalles WHERE id_cotizacion = ?', [cotizacionId ?? 0]);
  await pool.execute('DELETE FROM cotizaciones WHERE id = ?', [cotizacionId ?? 0]);
  await pool.execute('DELETE FROM usuarios WHERE id = ?', [ejecId ?? 0]);
  await pool.execute('DELETE FROM clientes WHERE id = ?', [clienteId ?? 0]);
  await pool.end();
});

describe('PDFSIZE — límite de tamaño en la subida de Excel de cotizaciones', () => {

  test('PSZ-01: un Excel de EXACTAMENTE el límite documentado se acepta', async () => {
    const res = await request(app)
      .post(`/api/cotizaciones/${cotizacionId}/upload`)
      .set('Authorization', `Bearer ${token}`)
      .attach('excel', bufferXlsxDeTamano(LIMITE_BYTES), 'exacto.xlsx');

    expect(res.status).toBe(200);
  });

  test('PSZ-02: un Excel de límite + 1 byte responde 413', async () => {
    const res = await request(app)
      .post(`/api/cotizaciones/${cotizacionId}/upload`)
      .set('Authorization', `Bearer ${token}`)
      .attach('excel', bufferXlsxDeTamano(LIMITE_BYTES + 1), 'muy_grande.xlsx');

    expect(res.status).toBe(413);
    expect(res.body.success).toBe(false);
  });
});
