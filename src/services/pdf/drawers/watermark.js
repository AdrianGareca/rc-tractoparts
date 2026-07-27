// =============================================================================
// src/services/pdf/drawers/watermark.js
// Marca de agua del logo (una por pagina, antes de todo el contenido).
//
// Extraido de pdfService.js sin cambios de comportamiento.
// =============================================================================

'use strict';

const fs   = require('fs');
const { LOGO_PATH, C, PW, PH, MARGIN, CW } = require('../constants');

// ---------------------------------------------------------------------------
// drawLogoWatermark
// Paints the RC Tractoparts logo image (or text fallback) as a full-page
// centred watermark at near-invisible opacity.  Call once per page, BEFORE
// any other content so every element renders on top (painter's order).
// @param {PDFDocument} doc
// ---------------------------------------------------------------------------
function drawLogoWatermark(doc) {
  if (!fs.existsSync(LOGO_PATH)) {
    // Text fallback — large, centred, ultra-faint
    doc.save();
    doc.opacity(0.05);
    doc
      .font('Helvetica-Bold')
      .fontSize(72)
      .fillColor(C.NAVY)
      .text('RC TRACTOPARTS', MARGIN, PH / 2 - 36,
        { width: CW, align: 'center', lineBreak: false });
    doc.restore();
    return;
  }
  const WM_SIZE = 260;   // pt — large but subtly transparent
  const wx      = (PW - WM_SIZE) / 2;
  const wy      = (PH - WM_SIZE) / 2;
  doc.save();
  doc.opacity(0.06);     // 6% — visible branding, zero legibility impact
  doc.image(LOGO_PATH, wx, wy, {
    fit:    [WM_SIZE, WM_SIZE],
    align:  'center',
    valign: 'center',
  });
  doc.restore();
}

// ---------------------------------------------------------------------------
// renderWatermark
// Paints a tilted "APROBADO" ink-stamp behind the items table on the current page.
// Must be called AFTER drawing the header/grid sections (so those remain clean)
// but BEFORE drawing the table rows (so text renders on top — painter's order).
//
// @param {PDFDocument} doc
// @param {Object}      quotation
// @param {number}      tableBodyY  — Top Y of the items table body; watermark is
//                                    centred in the table area vertically.
// ---------------------------------------------------------------------------
function renderWatermark(doc, quotation, tableBodyY) {
  const estado = (quotation.estado_nombre || quotation.estado || '').toUpperCase();
  // Only stamp when the quotation has been formally approved or accepted.
  // The legacy 'CONFIRMADO' guard is removed — the DB uses canonical Spanish state names.
  const shouldStamp = estado === 'APROBADA INTERNAMENTE'
    || estado === 'CONFIRMADA'
    || estado === 'ACEPTADA'
    || estado.includes('APROBAD');

  if (!shouldStamp) return;

  // Centre the stamp horizontally on the page and vertically in the table area
  const centerX = PW / 2;
  // Use table area mid-point when supplied; fall back to page centre for safety
  const tableAreaH = PH - (tableBodyY ?? PH / 2) - MARGIN - 110;
  const centerY    = tableBodyY != null
    ? tableBodyY + Math.min(tableAreaH / 2, 140)
    : PH / 2;

  const STAMP_W = 230;
  const STAMP_H = 76;
  const STAMP_COLOR = '#C71585';   // Pinkish-magenta ink — matches physical stamp

  doc.save();
  doc.opacity(0.14);
  doc.rotate(-30, { origin: [centerX, centerY] });

  // Rounded-rectangle frame (distressed border look)
  doc
    .roundedRect(centerX - STAMP_W / 2, centerY - STAMP_H / 2, STAMP_W, STAMP_H, 6)
    .lineWidth(6)
    .strokeColor(STAMP_COLOR)
    .stroke();

  // Bold "APROBADO" text centred inside the frame
  doc
    .font('Helvetica-Bold')
    .fontSize(54)
    .fillColor(STAMP_COLOR)
    .text('APROBADO',
      centerX - STAMP_W / 2,
      centerY - 27,
      { width: STAMP_W, align: 'center', lineBreak: false });

  doc.restore();
}

module.exports = { drawLogoWatermark, renderWatermark };
