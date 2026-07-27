// =============================================================================
// src/services/pdf/drawers/header.js
// Encabezado: logo + franja de marcas (izq) y caja de datos de la cotizacion (der).
//
// Extraido de pdfService.js sin cambios de comportamiento.
// =============================================================================

'use strict';

const fs   = require('fs');
const { LOGO_PATH, C, PW, MARGIN } = require('../constants');
const { formatDate } = require('../format');
const { normalizeEntidad } = require('../bankData');
const { drawBrandStrip } = require('./brandStrip');

// ---------------------------------------------------------------------------
// drawHeader
// Left side  : RC TRACTOPARTS logo (real image with text fallback) + brand strip.
// Right side : Quotation info box with thin borders (Nº, PEDIDO, ESTADO, FECHA).
// Returns Y immediately below the full header block.
// ---------------------------------------------------------------------------
function drawHeader(doc, quotation) {
  const y0      = MARGIN;
  const LOGO_W  = 155;
  const LOGO_H  = 72;
  const BOX_W   = 185;
  const BOX_H   = 116;         // info-box height (top-right metadata block; 5 data rows)
  const BOX_X   = PW - MARGIN - BOX_W;

  // ── Left: corporate logo (real image with text fallback) ──────────────────
  if (fs.existsSync(LOGO_PATH)) {
    // Align LEFT (not center): the logo is a wide landscape image that, when
    // fitted by height into the [LOGO_W, LOGO_H] box, is narrower than LOGO_W.
    // With align:'center' PDFKit padded the extra horizontal space on both
    // sides, pushing the visible logo ~12 pt to the right and breaking the
    // left-edge alignment with the entity text block below (anchored at MARGIN).
    // align:'left' pins the logo's left edge exactly on MARGIN (x = 36).
    doc.image(LOGO_PATH, MARGIN, y0, {
      fit:    [LOGO_W, LOGO_H],
      align:  'left',
      valign: 'center',
    });
  } else {
    // Text fallback when image asset is not yet deployed
    doc
      .rect(MARGIN, y0, LOGO_W, LOGO_H)
      .lineWidth(0.8)
      .fillAndStroke('#ECF5FB', C.BORDER_GRAY);
    doc
      .font('Helvetica-Bold')
      .fontSize(15)
      .fillColor(C.NAVY)
      .text('RC TRACTOPARTS', MARGIN + 6, y0 + 14,
        { width: LOGO_W - 12, align: 'center', lineBreak: false });
    doc
      .font('Helvetica')
      .fontSize(6.5)
      .fillColor(C.MID_GRAY)
      .text('Importaciones · Repuestos · Maquinaria Pesada',
        MARGIN + 4, y0 + 34, { width: LOGO_W - 8, align: 'center', lineBreak: false });
    doc
      .font('Helvetica')
      .fontSize(6)
      .fillColor(C.MID_GRAY)
      .text('Santa Cruz de la Sierra — Bolivia',
        MARGIN + 4, y0 + 46, { width: LOGO_W - 8, align: 'center', lineBreak: false });
  }

  // ── Issuing-entity block — printed in the blank band directly under the logo ─
  // Bounding box (collision-safe): x ∈ [MARGIN, BOX_X − gap], y ∈ [logo bottom,
  // brand-strip line]. The logo bottom sits at y0 + LOGO_H = 108 pt and the
  // brand-strip divider begins at y0 + BOX_H + 8 = 142 pt, so all text below is
  // rendered between y ≈ 110 and y ≈ 136 — never overlapping the logo (above),
  // the info box (right of BOX_X) or the brand strip (below).
  const entidad   = normalizeEntidad(quotation.entidad_emisora);
  const emisorX   = MARGIN;
  const emisorW   = BOX_X - MARGIN - 10;      // ≈ 328 pt — stops short of the info box
  let   emisorY   = y0 + LOGO_H + 2;          // ≈ 110 pt — just below the logo

  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(C.NAVY)
    .text(entidad, emisorX, emisorY, { width: emisorW, lineBreak: false });
  emisorY += 11;

  doc
    .font('Helvetica')
    .fontSize(5.5)
    .fillColor(C.MID_GRAY)
    .text(
      'Av. El Trompillo 2do Anillo, Edif. Torre Empresarial Los Laureles, Piso 9. Santa Cruz - Bolivia.',
      emisorX, emisorY, { width: emisorW, lineBreak: false });
  emisorY += 8;

  doc
    .font('Helvetica')
    .fontSize(6)
    .fillColor(C.DARK_GRAY)
    .text('Tel: 79855624 - 72182960   |   rctractoparts@gmail.com',
      emisorX, emisorY, { width: emisorW, lineBreak: false });

  // ── Right: quotation info box ─────────────────────────────────────────────
  doc
    .rect(BOX_X, y0, BOX_W, BOX_H)
    .lineWidth(0.8)
    .fillAndStroke(C.WHITE, C.DARK_GRAY);

  // Box title bar (navy)
  doc.rect(BOX_X, y0, BOX_W, 18).fill(C.NAVY);
  doc
    .font('Helvetica-Bold')
    .fontSize(7)
    .fillColor(C.WHITE)
    .text('DATOS DE COTIZACIÓN', BOX_X + 4, y0 + 5,
      { width: BOX_W - 8, align: 'center', lineBreak: false });

  const infoRows = [
    ['Nº COTIZACIÓN', quotation.numero_correlativo || '—'],
    ['PEDIDO',        (quotation.tipo_pedido || 'EMAIL').toUpperCase()],
    // Store raw DB estado so the STATUS color palette can be resolved in the
    // render loop; the display string is uppercased there before painting.
    ['ESTADO',        quotation.estado || '—'],
    ['FECHA',         formatDate(quotation.fecha_emision)],
  ];

  // FECHA CONFIRM. = sale-closure date. Rendered ONLY when the sale is actually
  // closed (estado 'Confirmada', or its legacy alias 'Aceptada') AND the closure
  // timestamp exists. Any other state omits the row entirely — the box height
  // auto-adjusts via rowH below. 'Aceptada' tolerated for pre-migration records.
  if ((quotation.estado === 'Confirmada' || quotation.estado === 'Aceptada') && quotation.fecha_confirmacion) {
    infoRows.push(['FECHA CONFIRM.', formatDate(quotation.fecha_confirmacion)]);
  }

  // Ejecutivo de ventas that created the quotation (usuarios.nombre_completo,
  // aliased as ejecutivo_nombre by QuotationModel.findById).
  infoRows.push(['EJECUTIVO', quotation.ejecutivo_nombre || '—']);

  const LABELW = 78;
  const rowH   = Math.floor((BOX_H - 18) / infoRows.length);  // ≈ 18 pt
  let   ry     = y0 + 20;

  infoRows.forEach(([lbl, val], i) => {
    if (i % 2 === 1) {
      doc.rect(BOX_X + 1, ry, BOX_W - 2, rowH).fill(C.LIGHT_GRAY);
    }
    doc
      .font('Helvetica-Bold')
      .fontSize(6.5)
      .fillColor(C.MID_GRAY)
      .text(lbl, BOX_X + 6, ry + (rowH - 7) / 2,
        { width: LABELW, lineBreak: false });
    // For the ESTADO row, resolve the dynamic color from the STATUS palette
    // and uppercase the value for display; all other rows use DARK_GRAY as-is.
    const valText  = lbl === 'ESTADO' ? String(val).toUpperCase() : String(val);
    const valColor = lbl === 'ESTADO' ? (C.STATUS[String(val)] || C.DARK_GRAY) : C.DARK_GRAY;
    doc
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .fillColor(valColor)
      .text(valText, BOX_X + LABELW + 4, ry + (rowH - 7.5) / 2,
        { width: BOX_W - LABELW - 10, lineBreak: false });
    // Row bottom divider
    doc
      .moveTo(BOX_X, ry + rowH)
      .lineTo(BOX_X + BOX_W, ry + rowH)
      .lineWidth(0.3)
      .strokeColor(C.BORDER_GRAY)
      .stroke();
    ry += rowH;
  });

  // ── Partner brand strip — full-width row beneath the header block ──────────
  // Rendered across the whole content width so each logo gets a generous,
  // equal-width slot (≈ 87 pt) instead of being crammed under the 155 pt logo.
  const stripY = y0 + BOX_H + 8;
  return drawBrandStrip(doc, stripY);
}

module.exports = { drawHeader };
