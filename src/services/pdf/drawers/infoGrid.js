// =============================================================================
// src/services/pdf/drawers/infoGrid.js
// Bloque tecnico de 3 columnas: Cliente / Solicitante / Equipo.
//
// Extraido de pdfService.js sin cambios de comportamiento.
// =============================================================================

'use strict';

const { C, MARGIN, CW } = require('../constants');

// ---------------------------------------------------------------------------
// _calcRowHeights — alto de cada una de las 5 filas, medido ANTES de dibujar.
//
// Un valor largo (p.ej. una razón social de 150 caracteres, el máximo que
// permite el validador) no entra en una sola línea — y como las tres columnas
// comparten el mismo alto de caja, el peor caso de CUALQUIERA de las tres
// decide el alto de esa fila para las tres. Sin esto, el valor se dibujaba
// con `lineBreak:false` y se salía de su columna sin que nada lo detuviera.
// Mismo patrón que _calcRowHeight en itemsTable.js.
//
// Encontrado en la ronda de estrés del 2026-08-25.
// ---------------------------------------------------------------------------
function _calcRowHeights(doc, colDefs, valueWidth, minHeight, padding) {
  doc.font('Helvetica').fontSize(6.5);
  const numFilas = colDefs[0].fields.length;

  return Array.from({ length: numFilas }, (_, i) =>
    Math.max(
      minHeight,
      ...colDefs.map(({ fields }) => doc.heightOfString(String(fields[i][1]), { width: valueWidth }) + padding)
    )
  );
}

// ---------------------------------------------------------------------------
// _drawColumn — una de las tres columnas: caja, título, filete, y sus filas.
// ---------------------------------------------------------------------------
function _drawColumn(doc, { title, x, fields }, { y0, colW, boxH, titleH, lwid, valueW, rowHeights }) {
  // Clean white box with thin border — no colored section headers (physical proforma aesthetic)
  doc
    .rect(x, y0, colW, boxH)
    .lineWidth(0.5)
    .fillAndStroke(C.WHITE, C.BORDER_GRAY);

  // Section title: navy bold text directly on white, separated by a fine rule
  doc
    .font('Helvetica-Bold')
    .fontSize(6.5)
    .fillColor(C.NAVY)
    .text(title, x + 6, y0 + (titleH - 6.5) / 2,
      { width: colW - 10, lineBreak: false });

  // Thin separator below title (orange accent matches the physical proforma)
  doc
    .moveTo(x, y0 + titleH)
    .lineTo(x + colW, y0 + titleH)
    .lineWidth(0.8)
    .strokeColor(C.ORANGE)
    .stroke();

  // Field rows
  let fy = y0 + titleH + 2;
  fields.forEach(([lbl, val], i) => {
    doc
      .font('Helvetica-Bold')
      .fontSize(6.5)
      .fillColor(C.MID_GRAY)
      .text(`${lbl}:`, x + 6, fy + 2,
        { width: lwid, lineBreak: false });
    doc
      .font('Helvetica')
      .fontSize(6.5)
      .fillColor(C.DARK_GRAY)
      // Sin lineBreak:false: un valor que no entra en el ancho ahora envuelve
      // a una segunda línea en vez de salirse de la columna — el alto de la
      // fila (rowHeights[i]) ya se calculó para que esa segunda línea entre.
      .text(String(val), x + lwid + 8, fy + 2, { width: valueW });
    fy += rowHeights[i];
  });
}

// ---------------------------------------------------------------------------
// drawThreeColumnGrid
// Three equal-width columns with light-blue accent section headers:
//   1. DATOS GENERALES DEL CLIENTE  (Cliente, NIT, Dirección, Ciudad, Teléfono)
//   2. DATOS DEL SOLICITANTE        (Nombre, Nº Solicitud/OC, Área, Celular, Correo)
//   3. DATOS DEL EQUIPO             (MARCA, TIPO, MODELO, SERIE, MOTOR)
//
// Every field renders '—' when the underlying value is null/empty, so a
// quotation whose client predates the Dirección/Ciudad fields still prints.
// ---------------------------------------------------------------------------
function drawThreeColumnGrid(doc, quotation, startY) {
  const y0      = startY + 6;
  const GAP     = 6;
  const COLW    = (CW - GAP * 2) / 3;   // ≈ 170.43 pt
  const TITLE_H = 16;
  const ROW_H   = 14;      // alto mínimo de una fila — el caso normal, una línea
  const ROW_PAD = 4;       // margen extra cuando el valor envuelve a más de una línea
  const LWID    = 52;
  const VALUE_W = COLW - LWID - 14;

  const colDefs = [
    {
      title:  'DATOS GENERALES DEL CLIENTE',
      x:      MARGIN,
      fields: [
        ['Cliente',   quotation.cliente_nombre  || '—'],
        ['NIT',       quotation.cliente_nit     || '—'],
        ['Dirección', quotation.cliente_dir     || '—'],
        ['Ciudad',    quotation.cliente_ciudad  || '—'],
        ['Teléfono',  quotation.cliente_tel     || '—'],
      ],
    },
    {
      title:  'DATOS DEL SOLICITANTE',
      x:      MARGIN + COLW + GAP,
      fields: [
        // External solicitor (the person/client who requested the proforma),
        // NOT the Sales Executive — the executive is shown only in the top-right
        // metadata box (drawHeader). Falls back to '—' when not provided.
        ['Nombre',       quotation.nombre_sol    || '—'],
        ['Nº Solic./OC', quotation.nro_solicitud || '—'],
        ['Área',         quotation.area_sol        || '—'],
        ['Celular',      quotation.celular_sol     || '—'],
        ['Correo',       quotation.correo_sol      || '—'],
      ],
    },
    {
      title:  'DATOS DEL EQUIPO',
      x:      MARGIN + (COLW + GAP) * 2,
      fields: [
        ['MARCA',  quotation.equipo_marca  || '—'],
        ['TIPO',   quotation.equipo_tipo   || '—'],
        ['MODELO', quotation.equipo_modelo || '—'],
        ['SERIE',  quotation.equipo_serie  || '—'],
        ['MOTOR',  quotation.equipo_motor  || '—'],
      ],
    },
  ];

  const rowHeights = _calcRowHeights(doc, colDefs, VALUE_W, ROW_H, ROW_PAD);
  const BOX_H      = TITLE_H + rowHeights.reduce((a, b) => a + b, 0) + 4;
  const drawOpts   = { y0, colW: COLW, boxH: BOX_H, titleH: TITLE_H, lwid: LWID, valueW: VALUE_W, rowHeights };

  colDefs.forEach((col) => _drawColumn(doc, col, drawOpts));

  return y0 + BOX_H + 8;
}

module.exports = { drawThreeColumnGrid };
