// =============================================================================
// src/services/pdf/drawers/infoGrid.js
// Bloque tecnico de 3 columnas: Cliente / Solicitante / Equipo.
//
// Extraido de pdfService.js sin cambios de comportamiento.
// =============================================================================

'use strict';

const { C, MARGIN, CW } = require('../constants');

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
  const ROW_H   = 14;
  const ROWS    = 5;
  const BOX_H   = TITLE_H + ROWS * ROW_H + 4;  // 90 pt

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

  colDefs.forEach(({ title, x, fields }) => {
    // Clean white box with thin border — no colored section headers (physical proforma aesthetic)
    doc
      .rect(x, y0, COLW, BOX_H)
      .lineWidth(0.5)
      .fillAndStroke(C.WHITE, C.BORDER_GRAY);

    // Section title: navy bold text directly on white, separated by a fine rule
    doc
      .font('Helvetica-Bold')
      .fontSize(6.5)
      .fillColor(C.NAVY)
      .text(title, x + 6, y0 + (TITLE_H - 6.5) / 2,
        { width: COLW - 10, lineBreak: false });

    // Thin separator below title (orange accent matches the physical proforma)
    doc
      .moveTo(x, y0 + TITLE_H)
      .lineTo(x + COLW, y0 + TITLE_H)
      .lineWidth(0.8)
      .strokeColor(C.ORANGE)
      .stroke();

    // Field rows
    const LWID = 52;
    let fy = y0 + TITLE_H + 2;
    fields.forEach(([lbl, val]) => {
      doc
        .font('Helvetica-Bold')
        .fontSize(6.5)
        .fillColor(C.MID_GRAY)
        .text(`${lbl}:`, x + 6, fy + 2,
          { width: LWID, lineBreak: false });
      doc
        .font('Helvetica')
        .fontSize(6.5)
        .fillColor(C.DARK_GRAY)
        .text(String(val), x + LWID + 8, fy + 2,
          { width: COLW - LWID - 14, lineBreak: false });
      fy += ROW_H;
    });
  });

  return y0 + BOX_H + 8;
}

module.exports = { drawThreeColumnGrid };
