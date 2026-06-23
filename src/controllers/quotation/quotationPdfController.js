// =============================================================================
// src/controllers/quotation/quotationPdfController.js
// PDF Operations — upload and download handlers for quotation documents.
//
// Extracted from quotationController.js to enforce single-responsibility:
//   uploadPdf   — POST /:id/pdf  (Role: Ejecutivo)
//   downloadPdf — GET  /:id/pdf  (All roles)
//
// Security model carried over:
//   • Magic-number check (%PDF-) after multer writes the file (OWASP A08).
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

const QuotationPdfController = {

  // ---------------------------------------------------------------------------
  // uploadPdf — POST /api/cotizaciones/:id/pdf  (Role: Ejecutivo)
  // ---------------------------------------------------------------------------
  async uploadPdf(req, res) {
    const id       = parseInt(req.params.id, 10);
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    if (isNaN(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'Invalid quotation ID.' });
    }

    if (!req.file) {
      return res.status(422).json({
        success: false,
        message: 'No PDF file received. Ensure the field name is "archivo" and the file is a valid PDF.',
      });
    }

    try {
      // ── Magic-number check (OWASP A08 — Software & Data Integrity) ──────────
      // MIME type declared in the multipart request is CLIENT-CONTROLLED and can
      // be trivially spoofed.  After multer writes the file, we open the first
      // 5 bytes and verify they match the canonical PDF signature: "%PDF-".
      // Any file that fails this check is deleted immediately and the request is
      // rejected before the path ever reaches the database.
      const uploadedAbsPath = path.resolve(process.cwd(), req.file.path);
      try {
        const fd     = await fs.promises.open(uploadedAbsPath, 'r');
        const header = Buffer.alloc(5);
        await fd.read(header, 0, 5, 0);
        await fd.close();
        if (header.toString('ascii') !== '%PDF-') {
          await fs.promises.unlink(uploadedAbsPath).catch(() => {});
          return res.status(422).json({
            success: false,
            message: 'File content is not a valid PDF (magic-number mismatch). Upload rejected.',
          });
        }
      } catch (magicErr) {
        // If we cannot read the file for any reason, reject to be safe
        await fs.promises.unlink(uploadedAbsPath).catch(() => {});
        return res.status(422).json({
          success: false,
          message: 'Could not verify uploaded file integrity. Upload rejected.',
        });
      }

      const quotation = await QuotationModel.findById(id);
      if (!quotation) {
        // Clean up the already-saved file if the quotation doesn't exist
        await fs.promises.unlink(uploadedAbsPath).catch(() => {});
        return res.status(404).json({ success: false, message: `Quotation with ID ${id} was not found.` });
      }

      // Use forward slashes regardless of OS so the stored DB path is
      // portable and consistent when displayed or queried cross-platform.
      const relativePath = [
        (process.env.UPLOAD_DIR || 'uploads/cotizaciones').replace(/\\/g, '/'),
        req.file.filename,
      ].join('/');

      await QuotationModel.updatePdfPath(id, relativePath);

      await logEvent({
        id_usuario:     req.user.id,
        nombre_usuario: req.user.nombre_usuario,
        accion:         AuditActions.SUBIR_PDF,
        entidad:        'cotizaciones',
        id_entidad:     id,
        detalle:        { archivo: req.file.filename, size_bytes: req.file.size },
        ip_origen:      clientIp,
        resultado:      'exito',
      });

      return res.status(200).json({
        success:  true,
        message:  'PDF uploaded and linked to quotation successfully.',
        data:     { id, pdf_ruta: relativePath, filename: req.file.filename },
      });
    } catch (error) {
      // B3: clean up the file written by multer if the DB operation failed after
      // the magic-number check succeeded (otherwise the file becomes an orphan).
      if (req.file?.path) {
        await fs.promises.unlink(path.resolve(process.cwd(), req.file.path)).catch(() => {});
      }
      console.error('[QuotationPdfController.uploadPdf] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to link the uploaded PDF.' });
    }
  },

  // ---------------------------------------------------------------------------
  // downloadPdf — GET /api/cotizaciones/:id/pdf  (All roles)
  //
  // Priority 1: If pdf_ruta is set and the file physically exists on disk,
  //             stream that uploaded corporate PDF directly to the client.
  // Priority 2: If pdf_ruta is absent or the file is missing, fall back to
  //             on-the-fly PDFKit generation as an emergency safety net.
  // ---------------------------------------------------------------------------
  async downloadPdf(req, res) {
    const id       = parseInt(req.params.id, 10);
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    if (isNaN(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'Invalid quotation ID.' });
    }

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
  // Dual-field handler: accepts an optional 'pdf' field and/or an optional
  // 'excel' field in a single multipart request.
  //
  // Security model:
  //   • Each file undergoes a magic-number check AFTER Multer writes it to disk.
  //   • PDF  files must begin with "%PDF-" (5 bytes).
  //   • Excel files (.xlsx / OpenXML) are ZIP archives that must begin with
  //     the standard PK signature: 0x50 0x4B 0x03 0x04 (4 bytes).
  //   • Any file failing verification is deleted immediately; the request is
  //     rejected before the path touches the database (OWASP A08).
  // ---------------------------------------------------------------------------
  async uploadFiles(req, res) {
    const id       = parseInt(req.params.id, 10);
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    if (isNaN(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'Invalid quotation ID.' });
    }

    const files   = req.files || {};
    const pdfFile = files.pdf?.[0]   ?? null;
    const xlsFile = files.excel?.[0] ?? null;

    if (!pdfFile && !xlsFile) {
      return res.status(422).json({
        success: false,
        message: 'No files received. Include at least one field: "pdf" or "excel".',
      });
    }

    // Helper — safely delete a file from disk (errors are suppressed)
    const unlink = (absPath) => fs.promises.unlink(absPath).catch(() => {});

    // ── Magic-number verification ────────────────────────────────────────────

    // Verify PDF magic number: "%PDF-" (5 bytes, 0x25 0x50 0x44 0x46 0x2D)
    if (pdfFile) {
      const pdfAbsPath = path.resolve(process.cwd(), pdfFile.path);
      try {
        const fd  = await fs.promises.open(pdfAbsPath, 'r');
        const buf = Buffer.alloc(5);
        await fd.read(buf, 0, 5, 0);
        await fd.close();
        if (buf.toString('ascii') !== '%PDF-') {
          await unlink(pdfAbsPath);
          if (xlsFile) await unlink(path.resolve(process.cwd(), xlsFile.path));
          return res.status(422).json({
            success: false,
            message: 'PDF content failed magic-number check (expected %PDF- header). Upload rejected.',
          });
        }
      } catch {
        await unlink(pdfAbsPath);
        if (xlsFile) await unlink(path.resolve(process.cwd(), xlsFile.path));
        return res.status(422).json({
          success: false,
          message: 'Could not verify PDF file integrity. Upload rejected.',
        });
      }
    }

    // Verify Excel magic number: PK ZIP signature 0x50 0x4B 0x03 0x04 (4 bytes)
    // Modern .xlsx files are OpenXML ZIP archives and always start with this header.
    if (xlsFile) {
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
          if (pdfFile) await unlink(path.resolve(process.cwd(), pdfFile.path));
          return res.status(422).json({
            success: false,
            message: 'Excel content failed magic-number check (expected PK ZIP header for .xlsx). Upload rejected.',
          });
        }
      } catch {
        await unlink(xlsAbsPath);
        if (pdfFile) await unlink(path.resolve(process.cwd(), pdfFile.path));
        return res.status(422).json({
          success: false,
          message: 'Could not verify Excel file integrity. Upload rejected.',
        });
      }
    }

    // ── Persist paths ────────────────────────────────────────────────────────
    try {
      const quotation = await QuotationModel.findById(id);
      if (!quotation) {
        if (pdfFile)  await unlink(path.resolve(process.cwd(), pdfFile.path));
        if (xlsFile)  await unlink(path.resolve(process.cwd(), xlsFile.path));
        return res.status(404).json({ success: false, message: `Quotation with ID ${id} was not found.` });
      }

      const uploadBase = (process.env.UPLOAD_DIR || 'uploads/cotizaciones').replace(/\\/g, '/');
      const excelBase  = 'storage/excels';

      let pdfRelative = null;
      let xlsRelative = null;

      if (pdfFile) {
        pdfRelative = `${uploadBase}/${pdfFile.filename}`;
        await QuotationModel.updatePdfPath(id, pdfRelative);
      }

      if (xlsFile) {
        // Excel files are stored in storage/excels/ — separate from PDF uploads
        xlsRelative = `${excelBase}/${xlsFile.filename}`;
        await QuotationModel.updateExcelPath(id, xlsRelative);
      }

      await logEvent({
        id_usuario:     req.user.id,
        nombre_usuario: req.user.nombre_usuario,
        accion:         AuditActions.SUBIR_PDF,
        entidad:        'cotizaciones',
        id_entidad:     id,
        detalle: {
          pdf_filename:   pdfFile?.filename  ?? null,
          excel_filename: xlsFile?.filename  ?? null,
          pdf_size:       pdfFile?.size      ?? null,
          excel_size:     xlsFile?.size      ?? null,
        },
        ip_origen: clientIp,
        resultado: 'exito',
      });

      return res.status(200).json({
        success: true,
        message: 'Files uploaded and linked to quotation successfully.',
        data: {
          id,
          pdf_ruta:   pdfRelative,
          excel_ruta: xlsRelative,
        },
      });
    } catch (error) {
      // B4: clean up any disk-written files that were not successfully registered
      // in the database to avoid silent orphans.
      if (pdfFile?.path) await unlink(path.resolve(process.cwd(), pdfFile.path));
      if (xlsFile?.path) await unlink(path.resolve(process.cwd(), xlsFile.path));
      console.error('[QuotationPdfController.uploadFiles] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to link uploaded files.' });
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
    const id       = parseInt(req.params.id, 10);
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    if (isNaN(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'Invalid quotation ID.' });
    }

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
