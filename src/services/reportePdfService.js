// =============================================================================
// src/services/reportePdfService.js
// PDF Generation Service — Reportes / Analytics export
//
// Unlike pdfService.js (cotización proformas), a report PDF is generated
// on-demand for an arbitrary date range and is never persisted or reopened —
// so this builds the document straight into an in-memory Buffer instead of
// writing to disk (no uploads/ clutter, nothing to purge later).
//
// Visual language is intentionally borrowed from pdfService.js (same navy
// palette, same logo, same footer-bar pattern) so a report reads as the same
// corporate document family as a cotización proforma. Two rules carried over
// verbatim from that file:
//   • NO emoji in any doc.text() call — PDFKit's standard 14 fonts (Helvetica)
//     are WinAnsi-encoded, not Unicode, so an emoji codepoint renders as
//     garbled glyphs ("Ø=Ü…") instead of the intended character. Spanish
//     accents (á, é, í, ó, ú, ñ) ARE covered by WinAnsi and render fine —
//     only the emoji were ever the problem. Section separation uses a navy
//     bar instead, matching the "DATOS DE COTIZACIÓN" band style.
//   • The footer is drawn with doc.page.margins.bottom temporarily zeroed
//     (see drawFooter in pdfService.js). Its absolute Y sits inside the
//     normal bottom-margin exclusion zone, and PDFKit auto-inserts a blank
//     trailing page if a text() call there is judged to overflow the content
//     area — zeroing the margin for that one call is what prevents it.
//
// Two modes, chosen by the controller from the caller's role/RLS scope:
//   'company'    — Jefe/Administracion/SysAdmin: full stats grid, per-executive
//                  breakdown, top clients, clientes-por-origen distribution.
//   'individual' — Ejecutivo: only their own summary + their own top clients.
//                  No company-wide data ever appears in this mode.
// =============================================================================

'use strict';

const fs          = require('fs');
const path        = require('path');
const PDFDocument = require('pdfkit');

const ASSETS_DIR = path.join(__dirname, '..', 'assets', 'images');
const LOGO_PATH  = path.join(ASSETS_DIR, 'rc_logo.png');

const PW     = 595.28; // A4 width (pt)
const PH     = 841.89; // A4 height (pt)
const MARGIN = 40;
const CW     = PW - MARGIN * 2;

// Same palette as pdfService.js — keeps reports visually part of the same
// document family as the cotización proformas.
const C = {
  NAVY:        '#1B2B4B',
  ORANGE:      '#C85A0F',
  WHITE:       '#FFFFFF',
  LIGHT_GRAY:  '#F7F8FA',
  DARK_GRAY:   '#2D3748',
  MID_GRAY:    '#6B7280',
  BORDER_GRAY: '#CBD5E0',
};

function fmtMoney(v) {
  const n = parseFloat(v || 0);
  return n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------------
// drawHeader — logo (or text fallback) on the left, a compact metadata box
// on the right (mirrors the "DATOS DE COTIZACIÓN" box from pdfService.js),
// a navy divider beneath. Returns the Y position where content may start.
// ---------------------------------------------------------------------------
function drawHeader(doc, { title, periodo, rol, nombreUsuario }) {
  const y0     = MARGIN;
  const LOGO_W = 140;
  const LOGO_H = 64;
  const BOX_W  = 230;
  const BOX_H  = 64;
  const BOX_X  = PW - MARGIN - BOX_W;

  if (fs.existsSync(LOGO_PATH)) {
    doc.image(LOGO_PATH, MARGIN, y0, { fit: [LOGO_W, LOGO_H], align: 'left', valign: 'center' });
  } else {
    doc.rect(MARGIN, y0, LOGO_W, LOGO_H).lineWidth(0.8).fillAndStroke('#ECF5FB', C.BORDER_GRAY);
    doc.font('Helvetica-Bold').fontSize(13).fillColor(C.NAVY)
       .text('RC TRACTOPARTS', MARGIN + 6, y0 + 26, { width: LOGO_W - 12, align: 'center', lineBreak: false });
  }

  doc.rect(BOX_X, y0, BOX_W, BOX_H).lineWidth(0.8).fillAndStroke(C.WHITE, C.DARK_GRAY);
  doc.rect(BOX_X, y0, BOX_W, 18).fill(C.NAVY);
  doc.font('Helvetica-Bold').fontSize(7).fillColor(C.WHITE)
     .text(title, BOX_X + 4, y0 + 5, { width: BOX_W - 8, align: 'center', lineBreak: false });

  const rows = [
    ['PERÍODO',       periodo],
    ['GENERADO POR',  `${nombreUsuario || '—'} (${rol})`],
    ['FECHA',         new Date().toLocaleString('es-BO')],
  ];
  let ry = y0 + 24;
  rows.forEach(([lbl, val]) => {
    doc.font('Helvetica-Bold').fontSize(6).fillColor(C.MID_GRAY)
       .text(lbl, BOX_X + 6, ry, { width: 66, lineBreak: false });
    doc.font('Helvetica').fontSize(6.5).fillColor(C.DARK_GRAY)
       .text(String(val), BOX_X + 74, ry, { width: BOX_W - 80, lineBreak: false });
    ry += 13;
  });

  const dividerY = y0 + LOGO_H + 12;
  doc.strokeColor(C.NAVY).lineWidth(1.2)
     .moveTo(MARGIN, dividerY).lineTo(PW - MARGIN, dividerY).stroke();

  return dividerY + 16;
}

// ---------------------------------------------------------------------------
// drawFooter — navy bar with an orange top accent, matching pdfService.js's
// drawFooter exactly (including the margins.bottom=0 guard that prevents the
// blank trailing page — see the file-level comment above for why).
// ---------------------------------------------------------------------------
function drawFooter(doc, subtitle) {
  const FOOTER_H = 34;
  const footerY  = PH - FOOTER_H;

  const savedBottomMargin = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;

  doc.rect(0, footerY - 3, PW, 3).fill(C.ORANGE);
  doc.rect(0, footerY, PW, FOOTER_H).fill(C.NAVY);

  doc.font('Helvetica').fontSize(6.5).fillColor('#A0AEC0')
     .text(subtitle, MARGIN, footerY + 8, { lineBreak: false });

  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.WHITE)
     .text('RC TRACTOPARTS', 0, footerY + 8, { width: PW, align: 'center', lineBreak: false });

  doc.font('Helvetica').fontSize(6.5).fillColor('#CBD5E0')
     .text('79855624 - 72182960  |  rctractoparts@gmail.com',
       MARGIN, footerY + 8, { width: CW, align: 'right', lineBreak: false });

  doc.page.margins.bottom = savedBottomMargin;
}

// ---------------------------------------------------------------------------
// sectionTitle — navy band header (replaces the old emoji-prefixed text
// title). Adds a page break first if the section wouldn't fit.
// ---------------------------------------------------------------------------
function sectionTitle(doc, text, y) {
  if (y > PH - MARGIN - 90) {
    doc.addPage();
    y = MARGIN;
  }
  doc.rect(MARGIN, y, CW, 16).fill(C.NAVY);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.WHITE)
     .text(text.toUpperCase(), MARGIN + 6, y + 4, { width: CW - 12, lineBreak: false });
  return y + 24;
}

// ---------------------------------------------------------------------------
// simpleTable — draws a header row + data rows using fixed column widths.
// Returns the Y position after the table. Breaks to a new page when a row
// would overflow the bottom margin.
// ---------------------------------------------------------------------------
function simpleTable(doc, { columns, rows, y, emptyLabel }) {
  const rowH = 16;

  const drawHeaderRow = (yy) => {
    doc.rect(MARGIN, yy, CW, rowH).fill(C.NAVY);
    let x = MARGIN;
    columns.forEach((col) => {
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.WHITE)
         .text(col.label, x + 4, yy + 4, { width: col.width - 8, align: col.align || 'left', lineBreak: false });
      x += col.width;
    });
    return yy + rowH;
  };

  let cy = drawHeaderRow(y);

  if (!rows || rows.length === 0) {
    doc.font('Helvetica').fontSize(8).fillColor(C.MID_GRAY)
       .text(emptyLabel || 'Sin datos para este período.', MARGIN, cy + 6, { width: CW, align: 'center' });
    return cy + 24;
  }

  rows.forEach((row, idx) => {
    if (cy + rowH > PH - MARGIN - 40) {
      doc.addPage();
      cy = MARGIN;
      cy = drawHeaderRow(cy);
    }
    if (idx % 2 === 1) {
      doc.rect(MARGIN, cy, CW, rowH).fill(C.LIGHT_GRAY);
    }
    let x = MARGIN;
    columns.forEach((col) => {
      const val = col.render ? col.render(row) : String(row[col.key] ?? '—');
      doc.font('Helvetica').fontSize(7.5).fillColor(col.color ? col.color(row) : C.DARK_GRAY)
         .text(val, x + 4, cy + 4, { width: col.width - 8, align: col.align || 'left', lineBreak: false });
      x += col.width;
    });
    doc.strokeColor(C.BORDER_GRAY).lineWidth(0.5)
       .moveTo(MARGIN, cy + rowH).lineTo(MARGIN + CW, cy + rowH).stroke();
    cy += rowH;
  });

  return cy + 12;
}

function statBox(doc, x, y, w, label, value, color) {
  doc.roundedRect(x, y, w, 42, 4).lineWidth(0.8).fillAndStroke(C.LIGHT_GRAY, C.BORDER_GRAY);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(color || C.NAVY)
     .text(value, x + 8, y + 8, { width: w - 16, lineBreak: false });
  doc.font('Helvetica').fontSize(7).fillColor(C.MID_GRAY)
     .text(label, x + 8, y + 26, { width: w - 16, lineBreak: false });
}

// ---------------------------------------------------------------------------
// generateReportePdf — returns a Promise<Buffer>.
//
// @param {Object} data
//   mode            {'company'|'individual'}
//   periodo         {string} human-readable period label
//   rol             {string} caller's role
//   nombreUsuario   {string} caller's display name
//   progreso        {Object|null} getProgreso() result — company mode only
//   topClientes     {Array}
//   leaderboard     {Array}
//   clientesPorOrigen {Array} — company mode only
// ---------------------------------------------------------------------------
async function generateReportePdf(data) {
  const {
    mode, periodo, rol, nombreUsuario,
    progreso, topClientes = [], leaderboard = [], clientesPorOrigen = [],
  } = data;

  const docTitle = mode === 'company' ? 'REPORTE GENERAL' : 'REPORTE INDIVIDUAL';

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        autoFirstPage: true,
        margins: { top: MARGIN, bottom: MARGIN + 34, left: MARGIN, right: MARGIN },
        info: {
          Title:   mode === 'company' ? 'Reporte General — RC Tractoparts' : 'Reporte Individual — RC Tractoparts',
          Author:  'RC Tractoparts — Sistema de Gestión de Cotizaciones',
          Creator: 'RC Tractoparts SGC',
        },
        compress: true,
      });

      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const footerSubtitle = `Generado: ${new Date().toLocaleString('es-BO', { timeZone: 'America/La_Paz', dateStyle: 'long', timeStyle: 'short' })}`;

      let y = drawHeader(doc, {
        title: docTitle,
        periodo,
        rol,
        nombreUsuario,
      });

      if (mode === 'company' && progreso) {
        y = sectionTitle(doc, 'Resumen General', y);

        const boxW = (CW - 3 * 8) / 4;
        statBox(doc, MARGIN,               y, boxW, 'Volumen USD', `$ ${fmtMoney(progreso.volumen.total_mes_usd)}`, '#2563EB');
        statBox(doc, MARGIN + (boxW + 8),  y, boxW, 'Volumen BOB', `Bs. ${fmtMoney(progreso.volumen.total_mes_bob)}`, '#6D28D9');
        statBox(doc, MARGIN + 2*(boxW+8),  y, boxW, 'Cotizaciones', String(progreso.volumen.total_cotizaciones), C.ORANGE);
        statBox(doc, MARGIN + 3*(boxW+8),  y, boxW, 'Tasa de Éxito', `${progreso.conversion.ratio_pct}%`,
          parseFloat(progreso.conversion.ratio_pct) >= 50 ? '#059669' : '#DC2626');
        y += 58;

        y = sectionTitle(doc, 'Rendimiento por Ejecutivo', y);
        y = simpleTable(doc, {
          y,
          columns: [
            { key: 'ejecutivo',  label: 'EJECUTIVO',   width: CW * 0.28 },
            { key: 'total',      label: 'TOTAL',        width: CW * 0.12, align: 'right' },
            { key: 'aceptadas',  label: 'CONFIRMADAS',  width: CW * 0.15, align: 'right' },
            { key: 'rechazadas', label: 'RECHAZADAS',   width: CW * 0.15, align: 'right' },
            { key: 'volumen_usd', label: 'VOLUMEN USD', width: CW * 0.30, align: 'right',
              render: (r) => `$ ${fmtMoney(r.volumen_usd)}` },
          ],
          rows: progreso.por_ejecutivo,
        });
      }

      y = sectionTitle(doc, mode === 'company' ? 'Top 10 Clientes' : 'Mis Clientes Principales', y);
      y = simpleTable(doc, {
        y,
        columns: [
          { key: 'cliente',            label: 'CLIENTE',    width: CW * 0.35 },
          { key: 'nit',                label: 'NIT',        width: CW * 0.15 },
          { key: 'proformas_emitidas', label: 'PROFORMAS',  width: CW * 0.15, align: 'right' },
          { key: 'total_usd',          label: 'TOTAL USD',  width: CW * 0.175, align: 'right', render: (r) => `$ ${fmtMoney(r.total_usd)}` },
          { key: 'total_bob',          label: 'TOTAL BOB',  width: CW * 0.175, align: 'right', render: (r) => `Bs. ${fmtMoney(r.total_bob)}` },
        ],
        rows: topClientes,
        emptyLabel: 'Sin cotizaciones confirmadas/enviadas en este período.',
      });

      if (mode === 'individual') {
        y = sectionTitle(doc, 'Mi Rendimiento', y);
        y = simpleTable(doc, {
          y,
          columns: [
            { key: 'total_creadas',   label: 'CREADAS',    width: CW * 0.2, align: 'right' },
            { key: 'total_aprobadas', label: 'APROBADAS',  width: CW * 0.2, align: 'right' },
            { key: 'tasa_aprobacion', label: 'TASA APROB.', width: CW * 0.2, align: 'right', render: (r) => `${r.tasa_aprobacion}%` },
            { key: 'total_usd',       label: 'TOTAL USD',  width: CW * 0.2, align: 'right', render: (r) => `$ ${fmtMoney(r.total_usd)}` },
            { key: 'total_bob',       label: 'TOTAL BOB',  width: CW * 0.2, align: 'right', render: (r) => `Bs. ${fmtMoney(r.total_bob)}` },
          ],
          rows: leaderboard,
          emptyLabel: 'Sin actividad registrada en este período.',
        });
      }

      if (mode === 'company') {
        y = sectionTitle(doc, 'Clientes por Origen', y);
        y = simpleTable(doc, {
          y,
          columns: [
            { key: 'origen',         label: 'ORIGEN',         width: CW * 0.4 },
            { key: 'total_clientes', label: 'CLIENTES',       width: CW * 0.2, align: 'right' },
            { key: 'total_usd',      label: 'VOLUMEN USD',    width: CW * 0.2, align: 'right', render: (r) => `$ ${fmtMoney(r.total_usd)}` },
            { key: 'total_bob',      label: 'VOLUMEN BOB',    width: CW * 0.2, align: 'right', render: (r) => `Bs. ${fmtMoney(r.total_bob)}` },
          ],
          rows: clientesPorOrigen,
          emptyLabel: 'Sin clientes clasificados todavía.',
        });
      }

      // Footer on every page generated above.
      const pageRange = doc.bufferedPageRange();
      for (let i = 0; i < pageRange.count; i++) {
        doc.switchToPage(pageRange.start + i);
        drawFooter(doc, footerSubtitle);
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateReportePdf };
