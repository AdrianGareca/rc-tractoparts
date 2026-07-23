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
    const id       = parseInt(req.params.id, 10);
    const clientIp = req.ip || req.socket?.remoteAddress || null;
    const files    = req.files || [];

    const cleanupAll = () => Promise.all(files.map((f) => unlink(path.resolve(process.cwd(), f.path))));

    if (isNaN(id) || id < 1) {
      await cleanupAll();
      return res.status(400).json({ success: false, message: 'ID de licitación inválido.' });
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

      // ── Persist one row per file ────────────────────────────────────────────
      const created = [];
      for (const file of files) {
        const ext          = extOf(file.originalname);
        const relativePath = ['storage/licitaciones', file.filename].join('/');
        const docId = await LicitacionDocumentModel.create({
          id_licitacion:   id,
          nombre_original: file.originalname,
          ruta_archivo:    relativePath,
          mime_type:       MIME_BY_EXT[ext] || 'application/octet-stream',
          tamano_bytes:    file.size,
          id_usuario:      req.user.id,
          nombre_usuario:  req.user.nombre_usuario,
        });
        created.push({ id: docId, nombre_original: file.originalname, tamano_bytes: file.size });
      }

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
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'ID de licitación inválido.' });
    }

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
    const id    = parseInt(req.params.id, 10);
    const docId = parseInt(req.params.docId, 10);

    if (isNaN(id) || id < 1 || isNaN(docId) || docId < 1) {
      return res.status(400).json({ success: false, message: 'ID inválido.' });
    }

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

      // Sanitize the original filename for the Content-Disposition header
      // (prevents header injection via a crafted upload filename).
      const safeName = doc.nombre_original.replace(/[^\w.\- ]/g, '_');

      res.setHeader('Content-Type', doc.mime_type);
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
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
    const id       = parseInt(req.params.id, 10);
    const docId    = parseInt(req.params.docId, 10);
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    if (isNaN(id) || id < 1 || isNaN(docId) || docId < 1) {
      return res.status(400).json({ success: false, message: 'ID inválido.' });
    }

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
