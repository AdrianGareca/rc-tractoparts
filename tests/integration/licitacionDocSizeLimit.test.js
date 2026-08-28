// =============================================================================
// tests/integration/licitacionDocSizeLimit.test.js
// Subir un documento de licitación demasiado grande debe responder 413, y el
// límite documentado (MAX_PDF_SIZE_MB, en MB exactos) debe ser el máximo
// ACEPTADO — no uno menos.
//
// HALLAZGO 3 — código de estado inconsistente
// Un PDF de cotización demasiado grande responde 413 (pasa por el manejador
// GLOBAL de src/app.js). Un documento de licitación demasiado grande
// respondía 422: el router de licitaciones tiene su propio manejador de
// errores que interceptaba TODO multer.MulterError —incluido
// LIMIT_FILE_SIZE— antes de que llegara al handler global. Arreglado en
// licitacionRoutes.js: LIMIT_FILE_SIZE ahora responde 413 igual que el
// handler global; el resto de los MulterError (tipo de archivo inválido,
// demasiados archivos) sigue siendo 422.
//
// HALLAZGO 4 — off-by-one en el límite máximo
// Un archivo de EXACTAMENTE MAX_PDF_SIZE_MB*1024*1024 bytes se rechazaba
// como "demasiado grande"; uno de un byte menos se aceptaba. La causa está
// en busboy (la librería que usa multer por debajo): dispara su evento
// 'limit' en cuanto los bytes recibidos LLEGAN al límite configurado, no
// cuando lo SUPERAN. licitacionRoutes.js ahora configura
// `limits.fileSize = MAX_PDF_SIZE_MB*1024*1024 + 1`, así que el primer
// tamaño que dispara el límite es MAX_PDF_SIZE_MB*1024*1024 + 1 — el límite
// documentado en MB exactos queda como el máximo ACEPTADO.
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

// Los buffers de ~10 MB tardan un poco más que el resto de la suite en subir
// dentro del proceso (sin red real, pero igual hay que escribirlos a disco).
jest.setTimeout(30000);

let token, jefeId, clienteId, licitacionId;

const USUARIO  = 'test_jefe_docsize';
const PASSWORD = 'TestDocSize01!';
const CLIENTE  = 'Test Client DOCSIZE';

// Mismo cálculo que src/routes/licitacionRoutes.js — el límite DOCUMENTADO,
// en bytes exactos (sin el +1 del fix, que es un detalle interno de config).
const MAX_DOC_MB    = parseInt(process.env.MAX_PDF_SIZE_MB, 10) || 10;
const LIMITE_BYTES  = MAX_DOC_MB * 1024 * 1024;

/** Un buffer PDF válido (magic-number) del tamaño exacto pedido, en bytes. */
function bufferPdfDeTamano(bytes) {
  const buf = Buffer.alloc(bytes, 0x20); // relleno de espacios, contenido irrelevante
  buf.write('%PDF-1.4\n', 0, 'ascii');   // magic-number al inicio
  return buf;
}

beforeAll(async () => {
  await pool.execute('DELETE FROM licitaciones WHERE nombre = ?', ['Licitación DOCSIZE']);
  await pool.execute('DELETE FROM usuarios WHERE nombre_usuario = ?', [USUARIO]);
  await pool.execute('DELETE FROM clientes WHERE razon_social = ?', [CLIENTE]);

  const hash = await bcrypt.hash(PASSWORD, 10);
  const [u] = await pool.execute(
    // id_rol = 3 → Jefe: puede subir documentos a CUALQUIER licitación sin
    // tener que ser su responsable (ver licitacionDocumentController.js).
    `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo)
     VALUES (?, ?, ?, 3, 1)`,
    ['Test Jefe DOCSIZE', USUARIO, hash]
  );
  jefeId = u.insertId;

  const [c] = await pool.execute(
    `INSERT INTO clientes (razon_social, activo) VALUES (?, 1)`, [CLIENTE]
  );
  clienteId = c.insertId;

  const [lic] = await pool.execute(
    `INSERT INTO licitaciones (codigo, nombre, id_cliente, estado, id_responsable)
     VALUES (?, ?, ?, 'Cotizando', ?)`,
    [`LIC-DOCSIZE-${Date.now()}`.slice(0, 20), 'Licitación DOCSIZE', clienteId, jefeId]
  );
  licitacionId = lic.insertId;

  const login = await request(app).post('/api/auth/login')
    .send({ nombre_usuario: USUARIO, password: PASSWORD });
  expect(login.status).toBe(200);
  token = login.body.data.token;
});

afterAll(async () => {
  await pool.execute('DELETE FROM licitacion_documentos WHERE id_licitacion = ?', [licitacionId ?? 0]);
  await pool.execute('DELETE FROM licitaciones WHERE id = ?', [licitacionId ?? 0]);
  await pool.execute('DELETE FROM usuarios WHERE id = ?', [jefeId ?? 0]);
  await pool.execute('DELETE FROM clientes WHERE id = ?', [clienteId ?? 0]);
  await pool.end();
});

describe('DOCSIZE — límite de tamaño de archivo en documentos de licitación', () => {

  test('DOC-01: un archivo de EXACTAMENTE el límite documentado se acepta', async () => {
    const res = await request(app)
      .post(`/api/licitaciones/${licitacionId}/documentos`)
      .set('Authorization', `Bearer ${token}`)
      .attach('documentos', bufferPdfDeTamano(LIMITE_BYTES), 'exacto.pdf');

    expect(res.status).toBe(201);
  });

  test('DOC-02: un archivo de límite + 1 byte responde 413 (no 422)', async () => {
    const res = await request(app)
      .post(`/api/licitaciones/${licitacionId}/documentos`)
      .set('Authorization', `Bearer ${token}`)
      .attach('documentos', bufferPdfDeTamano(LIMITE_BYTES + 1), 'muy_grande.pdf');

    expect(res.status).toBe(413);
    expect(res.body.success).toBe(false);
  });

  test('DOC-03: un tipo de archivo no permitido sigue respondiendo 422 (el fix de LIMIT_FILE_SIZE no rompe esto)', async () => {
    const res = await request(app)
      .post(`/api/licitaciones/${licitacionId}/documentos`)
      .set('Authorization', `Bearer ${token}`)
      .attach('documentos', Buffer.from('contenido irrelevante'), 'archivo.exe');

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });
});
