// =============================================================================
// src/services/pdf/drawers/subtitle.js
// Titulo centrado "PROFORMA REPUESTOS" con sus divisores.
//
// Extraido de pdfService.js sin cambios de comportamiento.
// =============================================================================

'use strict';

const { C, MARGIN, CW } = require('../constants');
const { hLine } = require('../format');

// ---------------------------------------------------------------------------
// drawSubtitle
// Centred "PROFORMA REPUESTOS" title framed by two navy horizontal rules.
// No diagonal stamps or watermarks are rendered.
// ---------------------------------------------------------------------------
function drawSubtitle(doc, startY) {
  const y = startY + 4;
  hLine(doc, y, C.NAVY, 0.8);

  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(C.NAVY)
    .text('PROFORMA REPUESTOS', MARGIN, y + 5,
      { width: CW, align: 'center', lineBreak: false });

  hLine(doc, y + 21, C.NAVY, 0.8);

  return y + 28;
}

module.exports = { drawSubtitle };
