// =============================================================================
// tests/integration/pdfManualSobrevive.test.js
// Editar una cotización NO puede borrar un PDF subido a mano.
//
// EL BUG
// PUT /api/cotizaciones/:id (updateQuotation) llamaba SIEMPRE a
// regenerateQuotationPdf() con purga incondicional del pdf_ruta existente —
// sin distinguir si ese archivo lo había subido a mano un ejecutivo (POST
// /:id/upload o /:id/pdf) o si lo había generado el propio sistema. El
// Excel, en cambio, ya sobrevivía intacto a una edición (updateQuotation
// nunca toca excel_ruta). Encontrado en la ronda de estrés del 2026-08-26.
//
// EL ARREGLO
// cotizaciones.pdf_origen ('sistema' | 'manual') distingue el origen. Un PDF
// 'manual' se deja intacto al editar (mismo trato que excel_ruta); uno
// 'sistema' se sigue regenerando exactamente como antes.
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

jest.setTimeout(30000); // el PUT puede regenerar el PDF con PDFKit

let token, ejecId, clienteId;
let cotManualId, cotSistemaId, cotUploadId;

const USUARIO  = 'test_ejec_pdforigen';
const PASSWORD = 'TestPdfOrigen01!';
const CLIENTE  = 'Test Client PDFORIGEN';

const FAKE_MANUAL_PATH = 'storage/cotizaciones/FAKE-MANUAL-PDFORIGEN.pdf';

/** Buffer mínimo que pasa el chequeo de magic-number ("%PDF-") de uploadPdf. */
const pdfBufferValido = () => Buffer.from('%PDF-1.4\n%%FAKE-TEST-PDF%%\n%%EOF');

const cuerpoMinimo = (overrides = {}) => ({
  id_cliente:    clienteId,
  descripcion:   'Cotización de prueba PDFORIGEN',
  fecha_emision: '2026-07-24',
  detalles: [
    { descripcion_item: 'Repuesto de prueba', cantidad: 1, precio_unitario: 100 },
  ],
  ...overrides,
});

/** Borra del disco cualquier pdf_ruta real dejado por una regeneración. */
async function limpiarArchivoDe(id) {
  const [rows] = await pool.execute('SELECT pdf_ruta FROM cotizaciones WHERE id = ?', [id]);
  const ruta = rows[0]?.pdf_ruta;
  if (ruta) {
    await fs.promises.unlink(path.resolve(process.cwd(), ruta)).catch(() => {});
  }
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
    ['Test Ejecutivo PDFORIGEN', USUARIO, hash]
  );
  ejecId = u.insertId;

  const [c] = await pool.execute(
    `INSERT INTO clientes (razon_social, activo) VALUES (?, 1)`, [CLIENTE]
  );
  clienteId = c.insertId;

  // ── Cotización con PDF MANUAL (marcada directo en la base, como si un
  // ejecutivo hubiera subido el archivo antes de esta prueba) ────────────────
  const [qManual] = await pool.execute(
    `INSERT INTO cotizaciones
       (numero_correlativo, id_cliente, id_ejecutivo, descripcion, fecha_emision,
        estado, pdf_ruta, pdf_origen)
     VALUES (?, ?, ?, ?, CURDATE(), 'Pendiente', ?, 'manual')`,
    [`PMN-${Date.now()}`.slice(0, 20), clienteId, ejecId, 'Cotización con PDF manual', FAKE_MANUAL_PATH]
  );
  cotManualId = qManual.insertId;
  await pool.execute(
    `INSERT INTO cotizacion_detalles (id_cotizacion, descripcion_item, cantidad, precio_unitario, subtotal, unidad)
     VALUES (?, 'Repuesto de prueba', 1, 100.00, 100.00, 'UND')`,
    [cotManualId]
  );

  // ── Cotización de control con PDF de SISTEMA (default), sin PDF todavía ────
  const [qSistema] = await pool.execute(
    `INSERT INTO cotizaciones
       (numero_correlativo, id_cliente, id_ejecutivo, descripcion, fecha_emision, estado)
     VALUES (?, ?, ?, ?, CURDATE(), 'Pendiente')`,
    [`PSI-${Date.now()}`.slice(0, 20), clienteId, ejecId, 'Cotización con PDF de sistema']
  );
  cotSistemaId = qSistema.insertId;
  await pool.execute(
    `INSERT INTO cotizacion_detalles (id_cotizacion, descripcion_item, cantidad, precio_unitario, subtotal, unidad)
     VALUES (?, 'Repuesto de prueba', 1, 100.00, 100.00, 'UND')`,
    [cotSistemaId]
  );

  // ── Cotización para el flujo end-to-end real: subir con POST /:id/pdf y
  // recién después editar ─────────────────────────────────────────────────
  const [qUpload] = await pool.execute(
    `INSERT INTO cotizaciones
       (numero_correlativo, id_cliente, id_ejecutivo, descripcion, fecha_emision, estado)
     VALUES (?, ?, ?, ?, CURDATE(), 'Pendiente')`,
    [`PUP-${Date.now()}`.slice(0, 20), clienteId, ejecId, 'Cotización para subida real']
  );
  cotUploadId = qUpload.insertId;
  await pool.execute(
    `INSERT INTO cotizacion_detalles (id_cotizacion, descripcion_item, cantidad, precio_unitario, subtotal, unidad)
     VALUES (?, 'Repuesto de prueba', 1, 100.00, 100.00, 'UND')`,
    [cotUploadId]
  );

  const login = await request(app).post('/api/auth/login')
    .send({ nombre_usuario: USUARIO, password: PASSWORD });
  expect(login.status).toBe(200);
  token = login.body.data.token;
});

afterAll(async () => {
  await limpiarArchivoDe(cotSistemaId);
  await limpiarArchivoDe(cotUploadId);

  const ids = [cotManualId, cotSistemaId, cotUploadId].filter(Boolean);
  if (ids.length > 0) {
    await pool.execute(`DELETE FROM cotizacion_detalles WHERE id_cotizacion IN (${ids.map(() => '?').join(',')})`, ids);
    await pool.execute(`DELETE FROM cotizaciones WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  }
  await pool.execute('DELETE FROM usuarios WHERE id = ?', [ejecId ?? 0]);
  await pool.execute('DELETE FROM clientes WHERE id = ?', [clienteId ?? 0]);
  await pool.end();
});

const leerPdf = async (id) => {
  const [rows] = await pool.execute('SELECT pdf_ruta, pdf_origen FROM cotizaciones WHERE id = ?', [id]);
  return rows[0];
};

describe('PDFORIGEN — editar una cotización respeta el origen del PDF', () => {

  test('PDF-01: editar una cotización con PDF MANUAL deja el archivo y la ruta intactos', async () => {
    const antes = await leerPdf(cotManualId);
    expect(antes.pdf_ruta).toBe(FAKE_MANUAL_PATH);
    expect(antes.pdf_origen).toBe('manual');

    const res = await request(app)
      .put(`/api/cotizaciones/${cotManualId}`)
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpoMinimo());

    expect(res.status).toBe(200);

    const despues = await leerPdf(cotManualId);
    expect(despues.pdf_ruta).toBe(FAKE_MANUAL_PATH);
    expect(despues.pdf_origen).toBe('manual');
  });

  test('PDF-02: editar una cotización con PDF de SISTEMA sigue regenerándolo (comportamiento previo intacto)', async () => {
    const antes = await leerPdf(cotSistemaId);
    expect(antes.pdf_ruta).toBeNull();
    expect(antes.pdf_origen).toBe('sistema');

    const res = await request(app)
      .put(`/api/cotizaciones/${cotSistemaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpoMinimo());

    expect(res.status).toBe(200);

    const despues = await leerPdf(cotSistemaId);
    expect(despues.pdf_ruta).not.toBeNull();
    expect(despues.pdf_origen).toBe('sistema');
  });

  test('PDF-03: subir un PDF a mano marca pdf_origen = "manual"', async () => {
    const res = await request(app)
      .post(`/api/cotizaciones/${cotUploadId}/pdf`)
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', pdfBufferValido(), 'manual.pdf');

    expect(res.status).toBe(200);

    const despues = await leerPdf(cotUploadId);
    expect(despues.pdf_ruta).not.toBeNull();
    expect(despues.pdf_origen).toBe('manual');
  });

  test('PDF-04: end-to-end — editar DESPUÉS de una subida manual real no toca el archivo', async () => {
    const antes = await leerPdf(cotUploadId);
    expect(antes.pdf_origen).toBe('manual'); // confirmado por PDF-03

    const res = await request(app)
      .put(`/api/cotizaciones/${cotUploadId}`)
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpoMinimo());

    expect(res.status).toBe(200);

    const despues = await leerPdf(cotUploadId);
    expect(despues.pdf_ruta).toBe(antes.pdf_ruta);
    expect(despues.pdf_origen).toBe('manual');

    // El archivo subido en PDF-03 sigue existiendo en disco: no se purgó.
    const existe = await fs.promises.access(path.resolve(process.cwd(), despues.pdf_ruta)).then(() => true).catch(() => false);
    expect(existe).toBe(true);
  });
});
