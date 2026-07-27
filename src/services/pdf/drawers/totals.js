// =============================================================================
// src/services/pdf/drawers/totals.js
// Linea SON en letras, condiciones de la oferta, datos bancarios y total.
//
// Extraido de pdfService.js sin cambios de comportamiento.
// =============================================================================

'use strict';

const { C, PW, PH, MARGIN, CW } = require('../constants');
const { fmtPrice, formatDate } = require('../format');
const { numberToWordsES } = require('../numberToWords');
const { resolveBankData } = require('../bankData');
const { drawLogoWatermark } = require('./watermark');
const { drawFooter } = require('./footer');

// ---------------------------------------------------------------------------
// drawTotalsAndConditions
// Full-width "SON:" line (amount-in-words) followed by a two-column block:
//   Left  (~55 % of CW): CONDICIONES DE LA OFERTA + DATOS BANCARIOS
//   Right (~45 % of CW): Subtotal row (if items exist) + navy TOTAL box
// ---------------------------------------------------------------------------
function drawTotalsAndConditions(doc, quotation, startY) {
  // Page-break guard: the SON line + conditions/bank/total block needs
  // ~150 pt. If the items table ended too low, PDFKit's auto page-break
  // would fire mid-block on a doc.text() call — scattering labels onto a
  // phantom page while the rects/lines stay behind. Start the whole block
  // on a fresh page instead.
  if (startY > PH - 240) {
    doc.addPage();
    drawLogoWatermark(doc);
    drawFooter(doc, quotation);
    startY = MARGIN;
  }

  const detalles = Array.isArray(quotation.detalles) ? quotation.detalles : [];

  // Subtotal = sum of line-item subtotals. Prices are already tax-inclusive,
  // so there is NO added IVA row: the subtotal equals the total unless a manual
  // cash discount applies.
  const computedTotal = detalles.reduce(
    (s, item) => s + parseFloat(item.subtotal || 0),
    0
  );

  // Manual cash discount (descuento_manual) — an absolute amount subtracted
  // directly from the subtotal, mirroring the server-side monto_total math.
  const discount    = quotation.descuento_manual != null ? parseFloat(quotation.descuento_manual) : 0;
  const hasDiscount = detalles.length > 0 && discount > 0;

  const displayTotal = detalles.length > 0
    ? Math.max(0, computedTotal - discount)
    : parseFloat(quotation.monto_total || 0);

  const currencyLabel = quotation.moneda === 'BOB' ? 'BOLIVIANOS' : 'DÓLARES AMERICANOS';
  const totalWords    = numberToWordsES(displayTotal);

  let y = startY + 6;

  // ── SON: line ─────────────────────────────────────────────────────────────
  const SON_H = 20;
  doc.rect(MARGIN, y, CW, SON_H).fill('#FFF3E0');
  doc
    .moveTo(MARGIN, y)
    .lineTo(PW - MARGIN, y)
    .lineWidth(0.6)
    .strokeColor(C.ORANGE)
    .stroke();
  doc
    .moveTo(MARGIN, y + SON_H)
    .lineTo(PW - MARGIN, y + SON_H)
    .lineWidth(0.6)
    .strokeColor(C.ORANGE)
    .stroke();

  doc
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .fillColor(C.NAVY)
    .text('SON:', MARGIN + 6, y + (SON_H - 7.5) / 2, { lineBreak: false });
  doc
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .fillColor(C.DARK_GRAY)
    .text(`${totalWords} ${currencyLabel}`,
      MARGIN + 30, y + (SON_H - 7.5) / 2,
      { width: CW - 36, lineBreak: false });

  y += SON_H + 8;

  // ── Two-column block ──────────────────────────────────────────────────────
  const LEFT_W  = CW * 0.55;       // ≈ 287.8 pt
  const RIGHT_W = CW - LEFT_W - 6; // ≈ 229.5 pt
  const RIGHT_X = MARGIN + LEFT_W + 6;

  // LEFT COLUMN ── CONDICIONES DE LA OFERTA ──────────────────────────────────
  let ly = y;

  doc
    .font('Helvetica-Bold')
    .fontSize(7)
    .fillColor(C.NAVY)
    .text('CONDICIONES DE LA OFERTA', MARGIN + 4, ly + 5,
      { width: LEFT_W - 10, lineBreak: false });
  doc
    .moveTo(MARGIN, ly + 15)
    .lineTo(MARGIN + LEFT_W, ly + 15)
    .lineWidth(0.6)
    .strokeColor(C.BORDER_GRAY)
    .stroke();
  ly += 18;

  const validezStr = quotation.fecha_validez
    ? `HASTA EL ${formatDate(quotation.fecha_validez)}`
    : '15 DÍAS CALENDARIO';
  // Use per-quotation tiempo_entrega if provided, else fall back to default
  const entregaStr = quotation.tiempo_entrega || '25 DÍAS CALENDARIO';

  // Forma de pago: use the per-quotation value (forma_pago) when supplied,
  // otherwise fall back to the historical default advance-payment condition.
  const formaPagoStr = (quotation.forma_pago && String(quotation.forma_pago).trim())
    || '60% ANTICIPO Y SALDO CONTRA ENTREGA';

  const condiciones = [
    ['Tiempo de entrega:', entregaStr],
    ['Forma de pago:',     formaPagoStr],
    ['Validez de oferta:', validezStr],
  ];

  condiciones.forEach(([lbl, val]) => {
    doc
      .font('Helvetica-Bold')
      .fontSize(7)
      .fillColor(C.MID_GRAY)
      .text(lbl, MARGIN + 4, ly + 2, { width: 78, lineBreak: false });
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(C.DARK_GRAY)
      .text(val, MARGIN + 84, ly + 2,
        { width: LEFT_W - 88, lineBreak: false });
    ly += 12;
  });

  ly += 4;

  // LEFT COLUMN ── DATOS BANCARIOS ───────────────────────────────────────────
  doc
    .font('Helvetica-Bold')
    .fontSize(7)
    .fillColor(C.NAVY)
    .text('DATOS BANCARIOS', MARGIN + 4, ly + 5,
      { width: LEFT_W - 10, lineBreak: false });
  doc
    .moveTo(MARGIN, ly + 15)
    .lineTo(MARGIN + LEFT_W, ly + 15)
    .lineWidth(0.6)
    .strokeColor(C.BORDER_GRAY)
    .stroke();
  ly += 18;

  // Dynamic per issuing entity (ENTIDAD EMISORA): the unipersonal entity prints
  // its personal account; the S.R.L. entity prints the corporate account.
  const banco = resolveBankData(quotation);
  const bancoData = [
    ['Beneficiario:', banco.beneficiario],
    ['Entidad:',      banco.banco],
    ['Cuenta Cte:',   banco.cuenta],
  ];

  bancoData.forEach(([lbl, val]) => {
    doc
      .font('Helvetica-Bold')
      .fontSize(7)
      .fillColor(C.MID_GRAY)
      .text(lbl, MARGIN + 4, ly + 2, { width: 60, lineBreak: false });
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(C.DARK_GRAY)
      .text(val, MARGIN + 66, ly + 2,
        { width: LEFT_W - 70, lineBreak: false });
    ly += 12;
  });

  // RIGHT COLUMN ── Totals ───────────────────────────────────────────────────
  let ry = y;

  // Subtotal row (only if there are line items)
  if (detalles.length > 0) {
    doc.rect(RIGHT_X, ry, RIGHT_W, 18).fill(C.LIGHT_GRAY);
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(C.MID_GRAY)
      .text('Subtotal:', RIGHT_X + 6, ry + 5,
        { width: RIGHT_W / 2 - 6, lineBreak: false });
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(C.DARK_GRAY)
      .text(fmtPrice(computedTotal, quotation.moneda),
        RIGHT_X + RIGHT_W / 2, ry + 5,
        { width: RIGHT_W / 2 - 4, align: 'right', lineBreak: false });
    ry += 18;
  }

  // Manual discount row (only when a positive descuento_manual is set). Shown
  // as a negative amount in orange so it reads clearly as a deduction that
  // subtracts from the subtotal to yield the TOTAL below.
  if (hasDiscount) {
    doc.rect(RIGHT_X, ry, RIGHT_W, 18).fill(C.WHITE);
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(C.MID_GRAY)
      .text('Descuento:', RIGHT_X + 6, ry + 5,
        { width: RIGHT_W / 2 - 6, lineBreak: false });
    doc
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .fillColor(C.ORANGE)
      .text(`- ${fmtPrice(discount, quotation.moneda)}`,
        RIGHT_X + RIGHT_W / 2, ry + 5,
        { width: RIGHT_W / 2 - 4, align: 'right', lineBreak: false });
    ry += 18;
  }

  // Grand total — navy box with orange value text
  const TBOX_H = 28;
  doc.rect(RIGHT_X, ry, RIGHT_W, TBOX_H).fill(C.NAVY);
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(C.WHITE)
    .text('TOTAL:', RIGHT_X + 8, ry + (TBOX_H - 9) / 2, { lineBreak: false });
  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(C.ORANGE)
    .text(fmtPrice(displayTotal, quotation.moneda),
      RIGHT_X + 8, ry + (TBOX_H - 12) / 2,
      { width: RIGHT_W - 16, align: 'right', lineBreak: false });
  ry += TBOX_H + 4;

  // Currency denomination note
  doc
    .font('Helvetica')
    .fontSize(6.5)
    .fillColor(C.MID_GRAY)
    .text(
      quotation.moneda === 'BOB'
        ? 'Valores en Bolivianos (BOB).'
        : 'Valores en Dólares Americanos (USD).',
      RIGHT_X, ry,
      { width: RIGHT_W, align: 'right', lineBreak: false });

  return Math.max(ly, ry + 12) + 8;
}

module.exports = { drawTotalsAndConditions };
