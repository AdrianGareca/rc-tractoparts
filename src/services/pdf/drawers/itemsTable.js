// =============================================================================
// src/services/pdf/drawers/itemsTable.js
// Tabla de items de 9 columnas, con corte de pagina y encabezado repetido.
//
// Extraido de pdfService.js sin cambios de comportamiento.
// =============================================================================

'use strict';

const { C, PW, MARGIN, CW, buildItemLayout, TABLE_HEADER_H, ROW_MIN_H, ROW_PADDING, PAGE_BREAK_Y } = require('../constants');
const { fmtNum, fmtPrice } = require('../format');
const { drawLogoWatermark } = require('./watermark');
const { drawFooter } = require('./footer');

// ---------------------------------------------------------------------------
// drawTableHeaderRow
// Renders the light-pink column-header row for the items table.
// Re-called on each new page after a page break.
// Returns Y immediately below the header row.
// ---------------------------------------------------------------------------
function drawTableHeaderRow(doc, y, layout) {
  // Navy background fill
  doc.rect(MARGIN, y, CW, TABLE_HEADER_H).fill(C.TABLE_HEADER);
  // Outer border stroke
  doc
    .rect(MARGIN, y, CW, TABLE_HEADER_H)
    .lineWidth(0.6)
    .strokeColor(C.BORDER_GRAY)
    .stroke();

  // Column set — the CÓDIGO / CÓD. ALT. headers are included only when the
  // layout shows codes (both toggle together off the same mostrar_codigos flag).
  const headers = [
    { key: 'item',    label: 'ITEM',        align: 'center' },
    ...(layout.showCodigo ? [{ key: 'codigo', label: 'CÓDIGO', align: 'center' }] : []),
    ...(layout.showCodigo ? [{ key: 'codAlt', label: 'CÓD. ALT.', align: 'center' }] : []),
    { key: 'desc',    label: 'DESCRIPCIÓN', align: 'left'   },
    { key: 'cant',    label: 'CANT.',       align: 'right'  },
    { key: 'uni',     label: 'UNI',         align: 'center' },
    { key: 'pUnit',   label: 'P. UNIT.',    align: 'right'  },
    { key: 'pTotal',  label: 'P. TOTAL',    align: 'right'  },
    { key: 'entrega', label: 'T. ENTREGA',  align: 'center' },
  ];

  headers.forEach(({ key, label, align }) => {
    const x = layout.x[key];
    const w = layout.w[key];
    doc
      .font('Helvetica-Bold')
      .fontSize(6.5)
      .fillColor(C.TABLE_HEADER_TEXT)
      .text(label, x + 2, y + (TABLE_HEADER_H - 6.5) / 2,
        { width: w - 4, align, lineBreak: false });
  });

  // Vertical column dividers — one at the left edge of every column except the
  // first (ITEM), following the visible column set so no stray line is drawn
  // where the CÓDIGO column used to be when it is hidden.
  headers.slice(1).forEach(({ key }) => {
    const dx = layout.x[key];
    doc
      .moveTo(dx, y)
      .lineTo(dx, y + TABLE_HEADER_H)
      .lineWidth(0.3)
      .strokeColor(C.BORDER_GRAY)
      .stroke();
  });

  return y + TABLE_HEADER_H;
}

// ---------------------------------------------------------------------------
// _calcRowHeight — dynamic row height from description text wrapping
// ---------------------------------------------------------------------------
function _calcRowHeight(doc, text, descW, fs = 7.5) {
  doc.fontSize(fs);
  const h = doc.heightOfString(String(text || ''), { width: descW - 8 });
  return Math.max(ROW_MIN_H, h + ROW_PADDING);
}

// ---------------------------------------------------------------------------
// _drawRowCells — pinta el CONTENIDO de una fila ya ubicada (ITEM#, CÓDIGO,
// CÓD.ALT., DESCRIPCIÓN + marca, CANT., UNI, P.UNIT., P.TOTAL, T.ENTREGA) más
// los separadores verticales. Extraida de drawItemsTable: el fondo alternado,
// el separador inferior y el salto de página son del LOOP que recorre todos
// los ítems, esto es solo el contenido de UNA fila — no toca `y` del llamador,
// solo lee la posición que ya se decidió.
// ---------------------------------------------------------------------------
function _drawRowCells(doc, item, idx, y, rowH, layout, quotation) {
  const ty = y + (rowH - 7.5) / 2;  // Vertical centre for single-line cells

  // ITEM #
  doc
    .font('Helvetica')
    .fontSize(7)
    .fillColor(C.MID_GRAY)
    .text(String(idx + 1), layout.x.item + 2, ty,
      { width: layout.w.item - 4, align: 'center', lineBreak: false });

  // CÓDIGO (codigo_parte preferred; fallback to producto_codigo) — rendered
  // only when the CÓDIGO column is visible for this quotation.
  if (layout.showCodigo) {
    const codigo = item.codigo_parte || item.producto_codigo || '—';
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(C.DARK_GRAY)
      .text(codigo, layout.x.codigo + 2, ty,
        { width: layout.w.codigo - 4, align: 'center', lineBreak: false });
  }

  // CÓDIGO ALTERNATIVO — rendered only when the CÓDIGO column is visible for
  // this quotation (same mostrar_codigos toggle as CÓDIGO).
  if (layout.showCodigo) {
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(C.MID_GRAY)
      .text(item.codigo_alternativo || '—', layout.x.codAlt + 2, ty,
        { width: layout.w.codAlt - 4, align: 'center', lineBreak: false });
  }

  // DESCRIPCIÓN — top-aligned, wraps; brand name as a muted italic subtitle
  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(C.DARK_GRAY)
    .text(String(item.descripcion_item || '—'), layout.x.desc + 4, y + 5,
      { width: layout.w.desc - 8, lineBreak: true });

  // Inline brand label — rendered as clean italic text, no box/rect
  if (item.marca_nombre) {
    const descH = doc.heightOfString(String(item.descripcion_item || ''), { width: layout.w.desc - 8 });
    const brandLabelY = y + 5 + descH + 1;
    doc
      .font('Helvetica-Oblique')
      .fontSize(6)
      .fillColor(C.MID_GRAY)
      .text(item.marca_nombre.toUpperCase(), layout.x.desc + 4, brandLabelY,
        { width: layout.w.desc - 8, lineBreak: false });
  }

  // CANT. — right-aligned, es-BO format
  const qtyVal = parseFloat(item.cantidad);
  const qtyStr = Number.isInteger(qtyVal)
    ? String(qtyVal)
    : fmtNum(qtyVal);
  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(C.DARK_GRAY)
    .text(qtyStr, layout.x.cant + 2, ty,
      { width: layout.w.cant - 4, align: 'right', lineBreak: false });

  // UNI
  doc
    .font('Helvetica')
    .fontSize(7)
    .fillColor(C.MID_GRAY)
    .text(item.unidad || 'UND', layout.x.uni + 1, ty,
      { width: layout.w.uni - 2, align: 'center', lineBreak: false });

  // PRECIO UNITARIO — right-aligned, es-BO
  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(C.DARK_GRAY)
    .text(fmtPrice(item.precio_unitario, quotation.moneda), layout.x.pUnit + 2, ty,
      { width: layout.w.pUnit - 4, align: 'right', lineBreak: false });

  // PRECIO TOTAL — bold, right-aligned, es-BO
  doc
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .fillColor(C.DARK_GRAY)
    .text(fmtPrice(item.subtotal, quotation.moneda), layout.x.pTotal + 2, ty,
      { width: layout.w.pTotal - 4, align: 'right', lineBreak: false });

  // TIEMPO DE ENTREGA — not yet stored per line; renders placeholder
  doc
    .font('Helvetica')
    .fontSize(7)
    .fillColor(C.MID_GRAY)
    .text(item.tiempo_entrega || '—', layout.x.entrega + 2, ty,
      { width: layout.w.entrega - 4, align: 'center', lineBreak: false });

  // Vertical column dividers for this row — one at the left edge of every
  // column except ITEM, following the visible column set.
  ['desc', 'cant', 'uni', 'pUnit', 'pTotal', 'entrega']
    .concat(layout.showCodigo ? ['codigo', 'codAlt'] : [])
    .forEach((key) => {
      const dx = layout.x[key];
      doc
        .moveTo(dx, y)
        .lineTo(dx, y + rowH)
        .lineWidth(0.25)
        .strokeColor(C.BORDER_GRAY)
        .stroke();
    });
}

// ---------------------------------------------------------------------------
// drawItemsTable
// 9-column line-items grid.  Row height adapts to description wrapping.
// Inserts a page break (repeating header) when remaining space is tight.
// Columns: ITEM · CÓDIGO · CÓD.ALT. · DESCRIPCIÓN · CANT. · UNI
//          · PRECIO UNITARIO · PRECIO TOTAL · TIEMPO DE ENTREGA
// Numeric columns are right-aligned with es-BO locale format (e.g. 2.100,00).
// ---------------------------------------------------------------------------
function drawItemsTable(doc, quotation, startY) {
  const detalles = Array.isArray(quotation.detalles) ? quotation.detalles : [];

  // Resolve the CÓDIGO-column visibility toggle (mostrar_codigos: TINYINT 1/0,
  // boolean, or null on legacy rows → default to showing the column) and build
  // the column layout once for this quotation.
  const showCodigo = quotation.mostrar_codigos == null
    ? true
    : Boolean(Number(quotation.mostrar_codigos));
  const layout = buildItemLayout(showCodigo);

  // Section title with orange underline
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(C.NAVY)
    .text('DETALLE DE ÍTEMS COTIZADOS', MARGIN, startY, { lineBreak: false });
  doc
    .moveTo(MARGIN, startY + 12)
    .lineTo(PW - MARGIN, startY + 12)
    .lineWidth(1.2)
    .strokeColor(C.ORANGE)
    .stroke();

  let y          = startY + 18;
  let headerY    = y;            // Y of the CURRENT page's table header row
  y              = drawTableHeaderRow(doc, y, layout);

  // Empty state
  if (detalles.length === 0) {
    doc.rect(MARGIN, y, CW, 26).fill(C.LIGHT_GRAY);
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(C.MID_GRAY)
      .text('Sin ítems registrados en esta cotización.',
        MARGIN, y + 8, { width: CW, align: 'center', lineBreak: false });
    return y + 38;
  }

  detalles.forEach((item, idx) => {
    // Row height = wrapped description PLUS the italic brand subtitle drawn
    // beneath it (6 pt line + gap); without the extra 8 pt the brand label
    // bleeds past the row's bottom border into the next row.
    let rowH = _calcRowHeight(doc, item.descripcion_item, layout.w.desc);
    if (item.marca_nombre) rowH += 8;

    // Page break guard
    if (y + rowH > PAGE_BREAK_Y) {
      // Draw the outer border for rows rendered so far on this page
      doc
        .rect(MARGIN, headerY, CW, y - headerY)
        .lineWidth(0.6)
        .strokeColor(C.BORDER_GRAY)
        .stroke();
      doc.addPage();
      // Paint the logo watermark behind content on the new page (painter's order)
      drawLogoWatermark(doc);
      drawFooter(doc, quotation);
      y = MARGIN + 8;
      // Reset headerY to THIS page's header top — the closing outer border
      // below the loop must frame the current page's rows, not coordinates
      // captured on a previous page.
      headerY = y;
      y = drawTableHeaderRow(doc, y, layout);
    }

    // Alternating row background
    const fill = idx % 2 === 0 ? C.WHITE : C.ALT_ROW;
    doc.rect(MARGIN, y, CW, rowH).fill(fill);

    // Bottom row separator
    doc
      .moveTo(MARGIN, y + rowH)
      .lineTo(MARGIN + CW, y + rowH)
      .lineWidth(0.25)
      .strokeColor(C.BORDER_GRAY)
      .stroke();

    _drawRowCells(doc, item, idx, y, rowH, layout, quotation);

    y += rowH;
  });

  // Outer border enclosing the entire table (header + all data rows)
  doc
    .rect(MARGIN, headerY, CW, y - headerY)
    .lineWidth(0.6)
    .strokeColor(C.BORDER_GRAY)
    .stroke();

  return y + 10;
}

module.exports = { drawItemsTable, drawTableHeaderRow };
