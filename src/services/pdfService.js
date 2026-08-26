// =============================================================================
// src/services/pdfService.js
// PDF Generation Service — RC Tractoparts Proforma Invoices  (layout v3)
//
// Este archivo es ahora solo el ORQUESTADOR: arma el documento llamando a los
// drawers en orden y lo escribe a disco. Cada seccion del layout vive en su
// propio modulo dentro de src/services/pdf/:
//
//   constants.js       — paleta, geometria A4, buildItemLayout, rutas de assets
//   format.js          — fmtNum, fmtPrice, formatDate, hLine
//   numberToWords.js   — numberToWordsES (linea "SON:" del bloque de totales)
//   bankData.js        — normalizeEntidad, BANK_ACCOUNTS, resolveBankData
//   drawers/watermark  — marca de agua del logo (una por pagina)
//   drawers/header     — logo + franja de marcas | caja de datos de la cotizacion
//   drawers/brandStrip — franja de logos de marcas
//   drawers/subtitle   — titulo centrado "PROFORMA REPUESTOS"
//   drawers/infoGrid   — bloque de 3 columnas Cliente / Solicitante / Equipo
//   drawers/itemsTable — tabla de items de 9 columnas con corte de pagina
//   drawers/totals     — SON en letras, condiciones, datos bancarios y total
//   drawers/observations — bloque de observaciones
//   drawers/footer     — pie con los datos de contacto corporativos
//
// Cada draw* recibe (doc, ..., startY) y devuelve la Y justo debajo de lo que
// dibujo. Los campos que aun no existen en la BD se renderizan como "—".
// =============================================================================

'use strict';

const fs          = require('fs');
const path        = require('path');
const PDFDocument = require('pdfkit');

const { MARGIN } = require('./pdf/constants');
const { numberToWordsES } = require('./pdf/numberToWords');

const { drawLogoWatermark, renderWatermark } = require('./pdf/drawers/watermark');
const { drawHeader } = require('./pdf/drawers/header');
const { drawSubtitle } = require('./pdf/drawers/subtitle');
const { drawThreeColumnGrid } = require('./pdf/drawers/infoGrid');
const { drawItemsTable } = require('./pdf/drawers/itemsTable');
const { drawTotalsAndConditions } = require('./pdf/drawers/totals');
const { drawObservations } = require('./pdf/drawers/observations');
const { drawFooter } = require('./pdf/drawers/footer');

// =============================================================================
// Public API
// =============================================================================

// ---------------------------------------------------------------------------
// generateQuotationPdf
// Receives the full quotation object (QuotationModel.findById — with .detalles[]),
// orchestrates the layout sections, writes the file to disk and resolves with
// the relative file path once the WriteStream 'finish' event fires.
//
// ⚠️  DEPLOYMENT / STORAGE RISK — EPHEMERAL FILESYSTEM
// ---------------------------------------------------------------------------
// This function PERSISTS the generated PDF to the server's LOCAL DISK
// (uploads/cotizaciones) via fs.createWriteStream and stores only the relative
// path in the DB (cotizaciones.pdf_ruta). On ephemeral-filesystem platforms
// (Render, Heroku, most container PaaS), the local disk is WIPED on every
// deploy, restart, or dyno recycle — so previously generated PDFs (and the
// uploaded Excel files handled by quotationPdfController.uploadFiles) will
// silently 404 after a restart even though pdf_ruta/excel_ruta still point at
// them. PLANNED ARCHITECTURE CHANGE: stream the PDF straight to the HTTP
// response as a Buffer for downloads and/or offload persistence to durable
// object storage (S3, Cloudflare R2, GCS) instead of the local FS.
//
// @param   {Object} quotation  Full quotation including .detalles[]
// @returns {Promise<string>}   Relative path to the written PDF file
// ---------------------------------------------------------------------------
async function generateQuotationPdf(quotation) {
  return new Promise((resolve, reject) => {
    try {
      // 1. Resolve output directory
      const uploadDir = path.resolve(
        process.cwd(),
        process.env.UPLOAD_DIR || 'uploads/cotizaciones'
      );
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      // numero_correlativo formats like "SC-2026/000692" contain a '/', which
      // path.join() (and the OS) would interpret as a subdirectory separator,
      // making fs.createWriteStream fail with ENOENT (target dir doesn't exist).
      // Sanitize to a filesystem-safe stem before building the filename.
      const safeCorrelativo = String(quotation.numero_correlativo || `COT-${quotation.id}`)
        .replace(/[^\w\-]/g, '_');
      const filename     = `${safeCorrelativo}-${Date.now()}.pdf`;
      const absolutePath = path.join(uploadDir, filename);
      // join('/') y NO path.join(): esta ruta se guarda en la base y se sirve
      // por HTTP, así que tiene que ser igual en Windows y en Linux.
      // path.join ponía barras invertidas en Windows (confirmado en la base
      // real: 'uploads\\cotizaciones\\SC-...') — en un deploy Linux esa ruta
      // se interpreta como un nombre de archivo literal con backslashes, y
      // la descarga fallaría con 404. Mismo criterio que ya usan
      // quotationRoutes.js (nombre en disco) y persistirDocumentos.js
      // (documentos de licitación). Encontrado en la ronda de estrés del
      // 2026-08-26.
      const relativePath = [
        (process.env.UPLOAD_DIR || 'uploads/cotizaciones').replace(/\\/g, '/'),
        filename,
      ].join('/');

      // 2. Initialise PDFKit document
      const doc = new PDFDocument({
        size:          'A4',
        autoFirstPage: true,
        margins:       { top: MARGIN, bottom: MARGIN + 45, left: MARGIN, right: MARGIN },
        info: {
          Title:    `Cotización ${quotation.numero_correlativo}`,
          Author:   'RC Tractoparts — Sistema de Gestión de Cotizaciones',
          Subject:  'Proforma Repuestos',
          Keywords: `cotización, proforma, rc tractoparts, ${quotation.numero_correlativo}`,
          Creator:  'RC Tractoparts SGC v3.0',
        },
        compress: true,
      });

      // 3. Pipe to write stream — resolve/reject driven by stream events
      const writeStream = fs.createWriteStream(absolutePath);
      doc.pipe(writeStream);
      writeStream.on('finish', () => resolve(relativePath));
      writeStream.on('error',  (err) => reject(err));

      // 4. Render layout sections top-to-bottom
      // Logo watermark is painted FIRST so every subsequent element sits on
      // top of it (PDFKit uses painter's order: last draw = topmost layer).
      drawLogoWatermark(doc);

      // Header, subtitle, and 3-col grid are drawn first so the APROBADO
      // watermark stamp (painted next) stays visually inside the items table.
      let y = drawHeader(doc, quotation);
      y     = drawSubtitle(doc, y);
      y     = drawThreeColumnGrid(doc, quotation, y);

      // Watermark is painted HERE — after the top sections (which stay clean)
      // but before the items table rows so all line-item text renders on top
      // (PDFKit draws in painter's order).  tableBodyY is passed so the stamp
      // is centred dynamically within the items block, not at the page centre.
      renderWatermark(doc, quotation, y + 42);  // +42 accounts for table title + header row

      y     = drawItemsTable(doc, quotation, y);
      y     = drawTotalsAndConditions(doc, quotation, y);
      /* y = */ drawObservations(doc, quotation, y);

      // Footer is painted at a fixed absolute Y — not part of the flow
      drawFooter(doc, quotation);

      // 5. Finalise — triggers 'finish' on the write stream
      doc.end();

    } catch (layoutError) {
      reject(layoutError);
    }
  });
}

// ---------------------------------------------------------------------------
// purgeQuotationPdf
// Physically deletes a previously generated/stored PDF from disk so that a
// quotation never accumulates more than ONE physical file across its lifecycle.
//
// Call this with the EXISTING pdf_ruta (as stored in the DB) BEFORE generating
// the replacement PDF for a new state. The path is resolved relative to the
// process CWD — exactly how generateQuotationPdf() and downloadPdf() resolve it.
//
// Idempotent and non-throwing by contract: a null/blank path, or a file that is
// already gone (ENOENT), resolves quietly to `false`. Any other unexpected
// error is swallowed and logged, never propagated — purging is a best-effort
// housekeeping step that must never roll back a committed state transition.
//
// @param   {string|null} relativePath  pdf_ruta value from the DB
// @returns {Promise<boolean>}           true if a file was actually deleted
// ---------------------------------------------------------------------------
async function purgeQuotationPdf(relativePath) {
  if (!relativePath || typeof relativePath !== 'string' || !relativePath.trim()) {
    return false;
  }

  const absolutePath = path.resolve(process.cwd(), relativePath);

  try {
    await fs.promises.unlink(absolutePath);
    return true;
  } catch (err) {
    // ENOENT — the file is already absent, which satisfies the invariant.
    if (err.code !== 'ENOENT') {
      console.warn(
        `[pdfService.purgeQuotationPdf] Could not delete old PDF '${absolutePath}' (non-fatal):`,
        err.message
      );
    }
    return false;
  }
}

// numberToWordsES se re-exporta para no romper a quien ya lo importaba
// desde este modulo (tests/unit/numberToWords.test.js).
module.exports = { generateQuotationPdf, purgeQuotationPdf, numberToWordsES };
