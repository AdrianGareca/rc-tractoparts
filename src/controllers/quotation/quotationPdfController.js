// =============================================================================
// src/controllers/quotation/quotationPdfController.js
// PDF/Excel operations — upload and download handlers for quotation documents.
//
// Extracted from quotationController.js to enforce single-responsibility:
//   uploadFiles  — POST /:id/upload  (Role: Ejecutivo) — Excel only, see below
//   downloadPdf  — GET  /:id/pdf     (All roles)
//   downloadExcel — GET /:id/excel   (All roles)
//
// El PDF nunca se sube a mano: siempre lo genera/regenera PDFKit
// (pdfService.js). Hasta 2026-08-28 existía además una ruta POST /:id/pdf y
// un campo 'pdf' en /:id/upload para subirlo manualmente, con toda una
// máquina de reemplazo atómico y una columna pdf_origen para que una
// edición no lo purgara — pero ningún botón de la aplicación real llegó a
// usarla nunca (sólo el Excel se sube desde el formulario de cotizaciones),
// así que se sacó por completo. Ver el historial de git si hace falta
// reconstruirla.
//
// Security model:
//   • Magic-number check (%PDF- para descarga, PK\x03\x04 para el Excel
//     subido) — OWASP A08.
//   • File path never reaches the DB without integer ID validation.
//   • Priority 1: serve uploaded corporate PDF if present on disk.
//   • Priority 2: on-the-fly PDFKit generation as an emergency fallback.
// =============================================================================

'use strict';

const fs                         = require('fs');
const path                       = require('path');
const QuotationModel             = require('../../models/QuotationModel');
const { logEvent, AuditActions } = require('../../utils/auditLog');
const pdfService                 = require('../../services/pdfService');
// Lectura del id de la URL, compartida: estaba escrita a mano 28 veces
// con el mensaje en dos idiomas distintos.
const { parseId } = require('../../utils/parseId');
// Lock de fila + reintento ante deadlock, para que dos subidas casi
// simultáneas al mismo archivo no se pisen entre sí (ver swapFilePath).
const { withDeadlockRetry } = require('./transactionHelpers');

// ---------------------------------------------------------------------------
// buildPdfDownloadName
// Produces a professional, header/filesystem-safe download stem of the form
//   [N° COTIZACIÓN]_[ESTADO]   e.g. "COT-2026-0007_APROBADA_INTERNAMENTE"
// (the ".pdf" extension is appended by the caller).
//   • correlativo: word chars and hyphens preserved (COT-2026-0007 stays intact),
//     anything else collapsed to '_' to defeat Content-Disposition header injection.
//   • estado: accents stripped, uppercased, non-alphanumerics → '_', edges trimmed,
//     so "Enviada al cliente" → "ENVIADA_AL_CLIENTE".
// ---------------------------------------------------------------------------
function buildPdfDownloadName(quotation, id) {
  const correlativo = String(quotation.numero_correlativo || `COT-${id}`)
    .replace(/[^\w\-]/g, '_');

  const estado = String(quotation.estado || 'SIN_ESTADO')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // strip accents
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')                        // non-alnum → underscore
    .replace(/^_+|_+$/g, '');                           // trim leading/trailing _

  return `${correlativo}_${estado}`;
}

// ---------------------------------------------------------------------------
// _rejectIfNotOwner — shared ownership guard for uploadPdf/uploadFiles.
//
// Both routes are Ejecutivo-only (see quotationRoutes.js), but role alone
// isn't enough: without comparing quotation.id_ejecutivo to the caller, ANY
// Ejecutivo could overwrite the PDF/Excel on ANY other Ejecutivo's quotation
// just by knowing its numeric id — same ownership rule already enforced on
// PUT /:id (updateQuotation). Found via stress-testing on 2026-08-25.
//
// Cleans up whichever files multer already wrote to disk before rejecting,
// so a blocked cross-user upload never leaves an orphan behind.
//
// @param {Array<{path:string}|null>} filesToCleanup - req.file / req.files.*[0], nulls allowed
// @returns {Promise<boolean>} true if access was denied (res already sent — caller must return)
// ---------------------------------------------------------------------------
async function _rejectIfNotOwner(res, quotation, req, filesToCleanup) {
  if (quotation.id_ejecutivo === req.user.id) return false;

  for (const f of filesToCleanup) {
    if (f?.path) await fs.promises.unlink(path.resolve(process.cwd(), f.path)).catch(() => {});
  }
  res.status(403).json({
    success: false,
    message: 'Access denied. You can only upload files to quotations that you own.',
  });
  return true;
}

// ---------------------------------------------------------------------------
// _unlinkOldFile — borra el archivo previamente vinculado tras reemplazarlo.
//
// El "invariante de un solo PDF/Excel por cotización" sólo se aplicaba en la
// base (updatePdfPath/updateExcelPath son UPDATE puros) — el archivo viejo se
// quedaba en disco para siempre. Encontrado en la ronda de estrés del
// 2026-08-25.
//
// @param {string|null} oldRelativePath - quotation.pdf_ruta / excel_ruta ANTES del reemplazo
// @param {string}      newRelativePath - la ruta recién guardada (no se borra si coinciden)
// ---------------------------------------------------------------------------
async function _unlinkOldFile(oldRelativePath, newRelativePath) {
  if (!oldRelativePath || oldRelativePath === newRelativePath) return;
  await fs.promises.unlink(path.resolve(process.cwd(), oldRelativePath)).catch(() => {});
}

const QuotationPdfController = {

  // ---------------------------------------------------------------------------
  // downloadPdf — GET /api/cotizaciones/:id/pdf  (All roles)
  //
  // Priority 1: If pdf_ruta is set and the file physically exists on disk,
  //             stream that uploaded corporate PDF directly to the client.
  // Priority 2: If pdf_ruta is absent or the file is missing, fall back to
  //             on-the-fly PDFKit generation as an emergency safety net.
  // ---------------------------------------------------------------------------
  async downloadPdf(req, res) {
    const { id, error: idError } = parseId(req.params.id, 'cotización');
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    if (idError) return res.status(idError.status).json(idError.body);

    try {
      const quotation = await QuotationModel.findById(id);

      if (!quotation) {
        return res.status(404).json({ success: false, message: `Quotation with ID ${id} was not found.` });
      }

      // Professional, header-safe download name: [N° COTIZACIÓN]_[ESTADO]
      // e.g. COT-2026-0007_APROBADA_INTERNAMENTE.pdf — always reflects the
      // quotation's current live state.
      const safePdfName = buildPdfDownloadName(quotation, id);

      // ── Priority 1: serve the uploaded corporate PDF if it exists on disk ──
      if (quotation.pdf_ruta) {
        const absolutePath = path.resolve(process.cwd(), quotation.pdf_ruta);

        // B5: use non-blocking async access check instead of synchronous existsSync
        const uploadedExists = await fs.promises.access(absolutePath).then(() => true).catch(() => false);
        if (uploadedExists) {
          await logEvent({
            id_usuario:     req.user.id,
            nombre_usuario: req.user.nombre_usuario,
            accion:         AuditActions.DESCARGAR_PDF,
            entidad:        'cotizaciones',
            id_entidad:     id,
            detalle:        { pdf_ruta: quotation.pdf_ruta, source: 'uploaded' },
            ip_origen:      clientIp,
            resultado:      'exito',
          });

          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `inline; filename="${safePdfName}.pdf"`);
          return res.sendFile(absolutePath, (err) => {
            if (err) {
              console.error('[QuotationPdfController.downloadPdf] Uploaded file send error:', err.message);
              if (!res.headersSent) {
                res.status(500).json({ success: false, message: 'Failed to send the PDF file.' });
              }
            }
          });
        }

        // File path recorded in DB but binary is gone from disk — log and fall through
        console.warn(
          `[QuotationPdfController.downloadPdf] pdf_ruta set but file not found on disk: ${absolutePath}. Falling back to PDFKit generation.`,
        );
      }

      // ── Priority 2: dynamic PDFKit generation (emergency fallback) ─────────
      const relativePath     = await pdfService.generateQuotationPdf(quotation);
      const generatedAbsPath = path.resolve(process.cwd(), relativePath);

      // CRÍTICO — encontrado en la ronda de estrés del 2026-08-26: sin este
      // guardado, CADA descarga con el archivo faltante generaba un PDF
      // nuevo y lo dejaba huérfano en disco para siempre — sin límite ni
      // rate-limit en esta ruta (a diferencia de las subidas). Guardar la
      // ruta acá hace que la PRÓXIMA descarga entre por la Prioridad 1 de
      // arriba y sirva este mismo archivo en vez de generar otro.
      await QuotationModel.updatePdfPath(id, relativePath);

      await logEvent({
        id_usuario:     req.user.id,
        nombre_usuario: req.user.nombre_usuario,
        accion:         AuditActions.DESCARGAR_PDF,
        entidad:        'cotizaciones',
        id_entidad:     id,
        detalle:        { pdf_ruta: relativePath, source: 'generated' },
        ip_origen:      clientIp,
        resultado:      'exito',
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${safePdfName}.pdf"`);
      return res.sendFile(generatedAbsPath, (err) => {
        if (err) {
          console.error('[QuotationPdfController.downloadPdf] Generated file send error:', err.message);
          if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'Failed to send the generated PDF.' });
          }
        }
      });

    } catch (error) {
      console.error('[QuotationPdfController.downloadPdf] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to retrieve the PDF document.' });
    }
  },

  // ---------------------------------------------------------------------------
  // uploadFiles — POST /api/cotizaciones/:id/upload
  // Excel-only handler (the 'pdf' field this used to also accept was removed
  // 2026-08-28 — see the long comment in quotationRoutes.js: no UI ever sent
  // it, so a manually-uploaded PDF was only reachable by calling the API
  // directly, never through the app).
  //
  // Security model:
  //   • The file undergoes a magic-number check AFTER Multer writes it to disk.
  //   • Excel files (.xlsx / OpenXML) are ZIP archives that must begin with
  //     the standard PK signature: 0x50 0x4B 0x03 0x04 (4 bytes).
  //   • A file failing verification is deleted immediately; the request is
  //     rejected before the path touches the database (OWASP A08).
  // ---------------------------------------------------------------------------
  async uploadFiles(req, res) {
    const { id, error: idError } = parseId(req.params.id, 'cotización');
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    const files   = req.files || {};
    const xlsFile = files.excel?.[0] ?? null;

    // Helper — safely delete a file from disk (errors are suppressed)
    const unlink = (absPath) => fs.promises.unlink(absPath).catch(() => {});

    if (idError) {
      // Multer ya escribió el archivo en disco antes de llegar acá — sin
      // esto queda huérfano. Mismo criterio que licitacionDocumentController.js.
      if (xlsFile) await unlink(path.resolve(process.cwd(), xlsFile.path));
      return res.status(idError.status).json(idError.body);
    }

    if (!xlsFile) {
      return res.status(422).json({
        success: false,
        message: 'No file received. Include the "excel" field.',
      });
    }

    // Verify Excel magic number: PK ZIP signature 0x50 0x4B 0x03 0x04 (4 bytes)
    // Modern .xlsx files are OpenXML ZIP archives and always start with this header.
    const xlsAbsPath = path.resolve(process.cwd(), xlsFile.path);
    try {
      const fd  = await fs.promises.open(xlsAbsPath, 'r');
      const buf = Buffer.alloc(4);
      await fd.read(buf, 0, 4, 0);
      await fd.close();
      // Expected: 50 4B 03 04 (PK\x03\x04)
      const isValidZip =
        buf[0] === 0x50 &&
        buf[1] === 0x4B &&
        buf[2] === 0x03 &&
        buf[3] === 0x04;
      if (!isValidZip) {
        await unlink(xlsAbsPath);
        return res.status(422).json({
          success: false,
          message: 'Excel content failed magic-number check (expected PK ZIP header for .xlsx). Upload rejected.',
        });
      }
    } catch {
      await unlink(xlsAbsPath);
      return res.status(422).json({
        success: false,
        message: 'Could not verify Excel file integrity. Upload rejected.',
      });
    }

    // ── Persist path ─────────────────────────────────────────────────────────
    try {
      const quotation = await QuotationModel.findById(id);
      if (!quotation) {
        await unlink(path.resolve(process.cwd(), xlsFile.path));
        return res.status(404).json({ success: false, message: `Quotation with ID ${id} was not found.` });
      }

      if (await _rejectIfNotOwner(res, quotation, req, [xlsFile])) return;

      // Excel files are stored in storage/excels/ — separate from generated PDFs.
      const xlsRelative = `storage/excels/${xlsFile.filename}`;

      // Lock de fila + swap atómico: NO se usa quotation.excel_ruta (leído
      // arriba, antes del lock) para decidir qué borrar — esa lectura puede
      // haber quedado vieja si otra subida a esta misma cotización terminó
      // en el medio. swapFilePath relee bajo lock y devuelve lo que había
      // JUSTO ANTES de este UPDATE, que es siempre lo correcto a borrar.
      const oldXlsPath = await withDeadlockRetry(
        (connection) => QuotationModel.swapFilePath(connection, id, 'excel_ruta', xlsRelative),
        { label: 'QuotationPdfController.uploadFiles' }
      );

      // Borrar el Excel anterior del disco recién DESPUÉS de que el nuevo
      // quedó registrado — si el UPDATE fallara, el archivo viejo sigue
      // siendo el vigente y no hay que perderlo.
      await _unlinkOldFile(oldXlsPath, xlsRelative);

      await logEvent({
        id_usuario:     req.user.id,
        nombre_usuario: req.user.nombre_usuario,
        accion:         AuditActions.SUBIR_PDF,
        entidad:        'cotizaciones',
        id_entidad:     id,
        detalle:        { excel_filename: xlsFile.filename, excel_size: xlsFile.size },
        ip_origen:      clientIp,
        resultado:      'exito',
      });

      return res.status(200).json({
        success: true,
        message: 'File uploaded and linked to quotation successfully.',
        data:    { id, excel_ruta: xlsRelative },
      });
    } catch (error) {
      // Clean up the disk-written file if it wasn't successfully registered
      // in the database, to avoid a silent orphan.
      if (xlsFile?.path) await unlink(path.resolve(process.cwd(), xlsFile.path));
      console.error('[QuotationPdfController.uploadFiles] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to link uploaded file.' });
    }
  },

  // ---------------------------------------------------------------------------
  // downloadExcel — GET /api/cotizaciones/:id/excel  (All authenticated roles)
  //
  // Streams the stored Excel spreadsheet (.xlsx) directly from disk to the
  // client.  The Bearer token carried by apiClient ensures the route is
  // accessible only to authenticated sessions — financial blueprints are never
  // served to unauthenticated callers.
  //
  // Returns 404 when no Excel spreadsheet has been attached yet.
  // ---------------------------------------------------------------------------
  async downloadExcel(req, res) {
    const { id, error: idError } = parseId(req.params.id, 'cotización');
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    if (idError) return res.status(idError.status).json(idError.body);

    try {
      const quotation = await QuotationModel.findById(id);

      if (!quotation) {
        return res.status(404).json({ success: false, message: `Quotation with ID ${id} was not found.` });
      }

      if (!quotation.excel_ruta) {
        return res.status(404).json({
          success: false,
          message: 'No Excel spreadsheet has been attached to this quotation yet.',
        });
      }

      const absolutePath = path.resolve(process.cwd(), quotation.excel_ruta);

      // B5: use non-blocking async access check instead of synchronous existsSync
      const excelExists = await fs.promises.access(absolutePath).then(() => true).catch(() => false);
      if (!excelExists) {
        console.warn(
          `[QuotationPdfController.downloadExcel] excel_ruta set but file missing on disk: ${absolutePath}`,
        );
        return res.status(404).json({
          success: false,
          message: 'Excel file not found on disk. It may have been removed.',
        });
      }

      await logEvent({
        id_usuario:     req.user.id,
        nombre_usuario: req.user.nombre_usuario,
        accion:         AuditActions.DESCARGAR_PDF,   // reuse existing audit action
        entidad:        'cotizaciones',
        id_entidad:     id,
        detalle:        { excel_ruta: quotation.excel_ruta, source: 'uploaded' },
        ip_origen:      clientIp,
        resultado:      'exito',
      });

      // B2: sanitize correlativo for use in HTTP header — strip any chars outside
      // the safe token/quoted-string set to prevent header injection.
      const safeXlsName = (quotation.numero_correlativo || String(id)).replace(/[^\w\-\.]/g, '_');

      // Use the official IANA MIME type for OpenXML spreadsheets (OWASP content sniffing prevention)
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${safeXlsName}.xlsx"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');

      // Stream the file using native fs.createReadStream — no in-memory buffering
      const readStream = fs.createReadStream(absolutePath);
      readStream.on('error', (err) => {
        console.error('[QuotationPdfController.downloadExcel] Stream error:', err.message);
        if (!res.headersSent) {
          res.status(500).json({ success: false, message: 'Failed to stream the Excel file.' });
        }
      });
      return readStream.pipe(res);

    } catch (error) {
      console.error('[QuotationPdfController.downloadExcel] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to retrieve the Excel document.' });
    }
  },
};

module.exports = QuotationPdfController;
