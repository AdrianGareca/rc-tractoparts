// =============================================================================
// src/services/pdf/drawers/observations.js
// Bloque de observaciones al pie del cuerpo.
//
// Extraido de pdfService.js sin cambios de comportamiento.
// =============================================================================

'use strict';

const { C, PW, PH, MARGIN, CW } = require('../constants');
const { drawLogoWatermark } = require('./watermark');
const { drawFooter } = require('./footer');

// ---------------------------------------------------------------------------
// drawObservations
// Optional notes box.  Skipped entirely when observaciones is blank.
// ---------------------------------------------------------------------------
function drawObservations(doc, quotation, startY) {
  const notes = (quotation.observaciones || '').trim();
  if (!notes) return startY;

  // Measure the box BEFORE drawing so the page-break guard can decide
  // whether the title + box still fit above the fixed footer.
  doc.font('Helvetica').fontSize(7.5);
  const textH = doc.heightOfString(notes, { width: CW - 16 });
  const boxH  = Math.min(textH + 16, 80);

  // Page-break guard — same rationale as drawTotalsAndConditions: a
  // doc.text() past the bottom margin triggers PDFKit's auto page-break
  // mid-section, splitting the notes from their box.
  if (startY + 8 + 18 + boxH > PH - MARGIN - 50) {
    doc.addPage();
    drawLogoWatermark(doc);
    drawFooter(doc, quotation);
    startY = MARGIN - 8; // so y = startY + 8 lands exactly on MARGIN
  }

  let y = startY + 8;

  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(C.NAVY)
    .text('OBSERVACIONES', MARGIN, y, { lineBreak: false });
  doc
    .moveTo(MARGIN, y + 12)
    .lineTo(PW - MARGIN, y + 12)
    .lineWidth(1)
    .strokeColor(C.ORANGE)
    .stroke();
  y += 18;

  doc
    .rect(MARGIN, y, CW, boxH)
    .fillAndStroke(C.LIGHT_GRAY, C.BORDER_GRAY);
  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(C.DARK_GRAY)
    .text(notes, MARGIN + 8, y + 8, {
      width:     CW - 16,
      height:    boxH - 16,
      ellipsis:  true,
      lineBreak: true,
    });

  return y + boxH + 10;
}

module.exports = { drawObservations };
