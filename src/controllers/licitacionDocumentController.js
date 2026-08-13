// =============================================================================
// src/controllers/licitacionDocumentController.js
// Licitación Document Controller — multi-file attachments (PDF, Word, Excel,
// images) that Proyectos uploads for the delegated commercial executive (and
// Jefe/SysAdmin) to review.
//
//   uploadDocumentos   — POST   /:id/documentos       (responsable, Jefe, SysAdmin)
//   getDocumentos      — GET    /:id/documentos       (todos los autenticados)
//   downloadDocumento  — GET    /:id/documentos/:docId (todos los autenticados)
//   deleteDocumento    — DELETE /:id/documentos/:docId (responsable, Jefe, SysAdmin)
//
// Security model mirrors quotationPdfController.js exactly:
//   • Magic-number verification AFTER multer writes the file (OWASP A08) —
//     the extension allowlist in the route's fileFilter is a fast first pass,
//     never the sole guard.
//   • mime_type persisted in the DB is derived from the verified signature,
//     never trusted from the client's declared Content-Type.
//   • Any file failing verification is deleted immediately; nothing reaches
//     the database on rejection.
// =============================================================================

'use strict';

const fs                         = require('fs');
const path                       = require('path');
const LicitacionModel            = require('../models/LicitacionModel');
const LicitacionDocumentModel    = require('../models/LicitacionDocumentModel');
const { logEvent, AuditActions } = require('../utils/auditLog');
// Lectura del id de la URL, compartida: estaba escrita a mano 28 veces
// con el mensaje en dos idiomas distintos.
const { parseId } = require('../utils/parseId');
// La cabecera de descarga, con el nombre en castellano intacto.
const { cabeceraDeDescarga } = require('../utils/nombreDeDescarga');
// El guardado de las filas: todas o ninguna, con vuelta atrás propia.
const { persistirDocumentos } = require('./licitacion/persistirDocumentos');

// ---------------------------------------------------------------------------
// Magic-number signatures per allowed extension. Mirrors the PDF ("%PDF-")
// and Excel (PK ZIP) checks already used in quotationPdfController.js —
// extended here to cover legacy Office (OLE2 compound file) and images.
// ---------------------------------------------------------------------------
const MIME_BY_EXT = {
  pdf:  'application/pdf',
  doc:  'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls:  'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  png:  'image/png',
};

const isZip  = (buf) => buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04;
const isOle2 = (buf) => buf[0] === 0xD0 && buf[1] === 0xCF && buf[2] === 0x11 && buf[3] === 0xE0 &&
                         buf[4] === 0xA1 && buf[5] === 0xB1 && buf[6] === 0x1A && buf[7] === 0xE1;

const MAGIC_CHECKS = {
  pdf:  (buf) => buf.toString('ascii', 0, 5) === '%PDF-',
  doc:  isOle2,
  xls:  isOle2,
  docx: isZip,
  xlsx: isZip,
  jpg:  (buf) => buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF,
  jpeg: (buf) => buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF,
  png:  (buf) => buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 &&
                 buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A,
};

function extOf(originalname) {
  return path.extname(originalname).toLowerCase().replace('.', '');
}

async function verifyMagicNumber(absPath, ext) {
  const check = MAGIC_CHECKS[ext];
  if (!check) return false; // unknown extension — never reached if fileFilter did its job, but defense-in-depth
  try {
    const fd  = await fs.promises.open(absPath, 'r');
    const buf = Buffer.alloc(8);
    await fd.read(buf, 0, 8, 0);
    await fd.close();
    return check(buf);
  } catch {
    return false;
  }
}

const unlink = (absPath) => fs.promises.unlink(absPath).catch(() => {});

// ---------------------------------------------------------------------------
// canManageDocuments — same ownership rule as LicitacionController.updateLicitacion:
// the responsable Proyectos, or Jefe/SysAdmin. Delegated executives can VIEW
// documents but never upload/delete them — only Proyectos "prepares" them.
// ---------------------------------------------------------------------------
function canManageDocuments(user, licitacion) {
  if (user.rol === 'Jefe' || user.rol === 'SysAdmin') return true;
  return user.rol === 'Proyectos' && user.id === licitacion.id_responsable;
}

const LicitacionDocumentController = {

  // ---------------------------------------------------------------------------
  // uploadDocumentos — POST /api/licitaciones/:id/documentos
  // Accepts multiple files under the 'documentos' field (see licitacionRoutes.js
  // for the multer configuration and extension allowlist).
  // ---------------------------------------------------------------------------
  async uploadDocumentos(req, res) {
    const { id, error: idError } = parseId(req.params.id, 'licitación');
    const clientIp = req.ip || req.socket?.remoteAddress || null;
    const files    = req.files || [];

    const cleanupAll = () => Promise.all(files.map((f) => unlink(path.resolve(process.cwd(), f.path))));

    // El error de parseId se usa tal como viene: trae el 400 y el mensaje en
    // castellano ya armados. Antes se calculaba `idError` y se descartaba, y el
    // control real era `isNaN(id) || id < 1` — que funcionaba de casualidad,
    // porque parseId devuelve null y `null < 1` es cierto. Un cambio a
    // `id: undefined` lo habria roto en silencio (`undefined < 1` es falso).
    if (idError) {
      // La limpieza va PRIMERO: multer ya escribio los archivos en disco antes
      // de llegar aca, y salir sin borrarlos los deja acumulandose sin dueño.
      await cleanupAll();
      return res.status(idError.status).json(idError.body);
    }

    if (files.length === 0) {
      return res.status(422).json({ success: false, message: 'No se recibió ningún archivo. Use el campo "documentos".' });
    }

    try {
      const licitacion = await LicitacionModel.findById(id);
      if (!licitacion) {
        await cleanupAll();
        return res.status(404).json({ success: false, message: `No se encontró la licitación con ID ${id}.` });
      }

      if (!canManageDocuments(req.user, licitacion)) {
        await cleanupAll();
        return res.status(403).json({
          success: false,
          message: 'Solo el responsable de la licitación (o Jefe/SysAdmin) puede subir documentos.',
        });
      }

      // ── Magic-number verification (defense-in-depth after the route's
      // extension-based fileFilter) ──────────────────────────────────────────
      for (const file of files) {
        const ext     = extOf(file.originalname);
        const absPath = path.resolve(process.cwd(), file.path);
        const valid   = await verifyMagicNumber(absPath, ext);
        if (!valid) {
          await cleanupAll();
          return res.status(422).json({
            success: false,
            message: `El archivo "${file.originalname}" no coincide con su tipo declarado (falló la verificación de contenido). Subida rechazada.`,
          });
        }
      }

      // ── Una fila por archivo: todas, o ninguna ──────────────────────────────
      // Antes era un bucle a secas, y una falla en el archivo 3 de 5 dejaba las
      // filas 1 y 2 en la base mientras el catch de abajo borraba los cinco
      // archivos del disco: dos documentos visibles en la pantalla que al
      // descargarse contestaban «ya no está disponible», para siempre.
      // Ver src/controllers/licitacion/persistirDocumentos.js.
      const created = await persistirDocumentos({
        files,
        idLicitacion: id,
        usuario:      req.user,
        modelo:       LicitacionDocumentModel,
        // El MIME sale de la extensión YA VERIFICADA contra el número mágico
        // unas líneas más arriba, nunca del Content-Type que declaró el cliente.
        mimeDe:       (file) => MIME_BY_EXT[extOf(file.originalname)] || 'application/octet-stream',
        borrarDeDisco: (ruta) => unlink(path.resolve(process.cwd(), ruta)),
      });

      try {
        await logEvent({
          id_usuario:     req.user.id,
          nombre_usuario: req.user.nombre_usuario,
          accion:         AuditActions.SUBIR_DOCUMENTO_LICITACION,
          entidad:        'licitaciones',
          id_entidad:     id,
          detalle:        { archivos: created.map((c) => c.nombre_original) },
          ip_origen:      clientIp,
          resultado:      'exito',
        });
      } catch (auditErr) {
        console.warn('[LicitacionDocumentController.uploadDocumentos] Audit logging failed (non-fatal):', auditErr.message);
      }

      return res.status(201).json({
        success: true,
        message: `${created.length} documento(s) subido(s) correctamente.`,
        data:    created,
      });
    } catch (error) {
      await cleanupAll();
      console.error('[LicitacionDocumentController.uploadDocumentos] Error:', error.message);
      return res.status(500).json({ success: false, message: 'No se pudieron subir los documentos.' });
    }
  },

  // ---------------------------------------------------------------------------
  // getDocumentos — GET /api/licitaciones/:id/documentos  (todos los autenticados)
  // ---------------------------------------------------------------------------
  async getDocumentos(req, res) {
    const { id, error: idError } = parseId(req.params.id, 'licitación');
    if (idError) return res.status(idError.status).json(idError.body);

    try {
      const licitacion = await LicitacionModel.findById(id);
      if (!licitacion) {
        return res.status(404).json({ success: false, message: `No se encontró la licitación con ID ${id}.` });
      }

      const documentos = await LicitacionDocumentModel.findByLicitacion(id);
      return res.status(200).json({ success: true, total: documentos.length, data: documentos });
    } catch (error) {
      console.error('[LicitacionDocumentController.getDocumentos] Error:', error.message);
      return res.status(500).json({ success: false, message: 'No se pudieron obtener los documentos.' });
    }
  },

  // ---------------------------------------------------------------------------
  // downloadDocumento — GET /api/licitaciones/:id/documentos/:docId  (todos)
  // ---------------------------------------------------------------------------
  async downloadDocumento(req, res) {
    const { id,    error: idError }  = parseId(req.params.id,    'licitación');
    const { id: docId, error: docError } = parseId(req.params.docId, 'documento');

    // Dos identificadores, dos mensajes distintos: antes los dos caian en un
    // 'ID inválido.' a secas y no habia forma de saber cual de los dos estaba
    // mal mirando la respuesta.
    if (idError)  return res.status(idError.status).json(idError.body);
    if (docError) return res.status(docError.status).json(docError.body);

    try {
      const doc = await LicitacionDocumentModel.findById(docId);
      if (!doc || doc.id_licitacion !== id) {
        return res.status(404).json({ success: false, message: 'Documento no encontrado.' });
      }

      const absolutePath = path.resolve(process.cwd(), doc.ruta_archivo);
      const exists = await fs.promises.access(absolutePath).then(() => true).catch(() => false);
      if (!exists) {
        console.warn(`[LicitacionDocumentController.downloadDocumento] Archivo ausente en disco: ${absolutePath}`);
        return res.status(404).json({ success: false, message: 'El archivo ya no está disponible en el servidor.' });
      }

      // El nombre viaja en la cabecera con acentos y todo. Antes se saneaba con
      // `replace(/[^\w.\- ]/g, '_')`, y `\w` es el alfabeto INGLÉS: cada
      // «Especificación técnica.pdf» se descargaba como «Especificaci_n
      // t_cnica.pdf». Ver src/utils/nombreDeDescarga.js — la cabecera lleva las
      // dos formas, la ASCII y la UTF-8, que es lo que previó la RFC 6266.
      res.setHeader('Content-Type', doc.mime_type);
      res.setHeader('Content-Disposition', cabeceraDeDescarga(doc.nombre_original));
      res.setHeader('X-Content-Type-Options', 'nosniff');

      const readStream = fs.createReadStream(absolutePath);
      readStream.on('error', (err) => {
        console.error('[LicitacionDocumentController.downloadDocumento] Stream error:', err.message);
        if (!res.headersSent) {
          res.status(500).json({ success: false, message: 'No se pudo transmitir el archivo.' });
        }
      });
      return readStream.pipe(res);
    } catch (error) {
      console.error('[LicitacionDocumentController.downloadDocumento] Error:', error.message);
      return res.status(500).json({ success: false, message: 'No se pudo descargar el documento.' });
    }
  },

  // ---------------------------------------------------------------------------
  // deleteDocumento — DELETE /api/licitaciones/:id/documentos/:docId
  // (responsable, Jefe, SysAdmin)
  // ---------------------------------------------------------------------------
  async deleteDocumento(req, res) {
    const { id,    error: idError }  = parseId(req.params.id,    'licitación');
    const { id: docId, error: docError } = parseId(req.params.docId, 'documento');
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    if (idError)  return res.status(idError.status).json(idError.body);
    if (docError) return res.status(docError.status).json(docError.body);

    try {
      const licitacion = await LicitacionModel.findById(id);
      if (!licitacion) {
        return res.status(404).json({ success: false, message: `No se encontró la licitación con ID ${id}.` });
      }

      if (!canManageDocuments(req.user, licitacion)) {
        return res.status(403).json({
          success: false,
          message: 'Solo el responsable de la licitación (o Jefe/SysAdmin) puede eliminar documentos.',
        });
      }

      const doc = await LicitacionDocumentModel.findById(docId);
      if (!doc || doc.id_licitacion !== id) {
        return res.status(404).json({ success: false, message: 'Documento no encontrado.' });
      }

      await LicitacionDocumentModel.deleteById(docId);
      // Best-effort: remove the physical file. A missing/already-gone file
      // must never surface as an error — the DB row is the source of truth.
      await unlink(path.resolve(process.cwd(), doc.ruta_archivo));

      try {
        await logEvent({
          id_usuario:     req.user.id,
          nombre_usuario: req.user.nombre_usuario,
          accion:         AuditActions.ELIMINAR_DOCUMENTO_LICITACION,
          entidad:        'licitaciones',
          id_entidad:     id,
          detalle:        { documento: doc.nombre_original },
          ip_origen:      clientIp,
          resultado:      'exito',
        });
      } catch (auditErr) {
        console.warn('[LicitacionDocumentController.deleteDocumento] Audit logging failed (non-fatal):', auditErr.message);
      }

      return res.status(200).json({ success: true, message: 'Documento eliminado.' });
    } catch (error) {
      console.error('[LicitacionDocumentController.deleteDocumento] Error:', error.message);
      return res.status(500).json({ success: false, message: 'No se pudo eliminar el documento.' });
    }
  },
};

module.exports = LicitacionDocumentController;
