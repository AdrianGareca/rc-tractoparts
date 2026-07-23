// =============================================================================
// src/services/licitacionPdfService.js
// PDF generator for the licitación "expediente" (case file) — self-contained,
// separate from the ornate quotation proforma in pdfService.js.
//
// Generated ON DEMAND and streamed directly to the response (never persisted),
// so it always reflects the licitación's current cotizaciones/gastos/estado.
//
// Exported:
//   renderExpediente(doc, licitacion) — draws the whole document into a
//   caller-provided PDFDocument. The controller owns creating the doc, setting
//   the HTTP headers, piping to res, and calling doc.end().
// =============================================================================

'use strict';

const path = require('path');
const fs   = require('fs');
const PDFDocument = require('pdfkit');

const ASSETS_DIR = path.join(__dirname, '..', 'assets', 'images');
const LOGO_PATH  = path.join(ASSETS_DIR, 'rc_logo.png');

const MARGIN = 45;
const C = {
  INK:     '#1f2937',
  MUTED:   '#6b7280',
  BORDER:  '#d1d5db',
  HEAD_BG: '#f3f4f6',
  GREEN:   '#059669',
  RED:     '#dc2626',
  BLUE:    '#2563eb',
};

// ── helpers ──────────────────────────────────────────────────────────────────
function fmtMoney(amount, moneda = 'BOB') {
  if (amount == null || isNaN(parseFloat(amount))) return '—';
  const s = parseFloat(amount).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'USD' ? `$ ${s}` : `Bs. ${s}`;
}

function fmtDate(v) {
  if (!v) return '—';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }
  const dt = new Date(v);
  return isNaN(dt.getTime()) ? s : dt.toLocaleDateString('es-BO');
}

const ESTADO_LABEL = (e) => String(e || '—');

// A newPage-aware Y cursor helper: if we're about to overflow, add a page.
function ensureSpace(doc, y, needed) {
  const bottom = doc.page.height - MARGIN - 30;
  if (y + needed > bottom) {
    doc.addPage();
    return MARGIN;
  }
  return y;
}

function sectionTitle(doc, y, text) {
  y = ensureSpace(doc, y, 30);
  doc.fillColor(C.INK).font('Helvetica-Bold').fontSize(11).text(text, MARGIN, y);
  const yy = doc.y + 3;
  doc.moveTo(MARGIN, yy).lineTo(doc.page.width - MARGIN, yy).lineWidth(0.5).strokeColor(C.BORDER).stroke();
  return yy + 8;
}

// Simple two-column definition list.
function defRow(doc, y, label, value) {
  y = ensureSpace(doc, y, 18);
  const labelW = 130;
  doc.font('Helvetica').fontSize(9).fillColor(C.MUTED).text(label, MARGIN, y, { width: labelW });
  doc.font('Helvetica').fontSize(9).fillColor(C.INK)
    .text(value == null || value === '' ? '—' : String(value), MARGIN + labelW, y, { width: doc.page.width - MARGIN * 2 - labelW });
  return Math.max(doc.y, y + 14) + 2;
}

// Generic table: columns = [{ title, key, width, align, render? }]
function drawTable(doc, y, columns, rows, emptyText) {
  const tableW = doc.page.width - MARGIN * 2;
  const totalW = columns.reduce((a, c) => a + c.width, 0);
  const scale  = tableW / totalW;
  const colX = [];
  let cx = MARGIN;
  columns.forEach((c) => { colX.push(cx); cx += c.width * scale; });

  // header row
  y = ensureSpace(doc, y, 22);
  doc.rect(MARGIN, y, tableW, 18).fill(C.HEAD_BG);
  doc.fillColor(C.INK).font('Helvetica-Bold').fontSize(8.5);
  columns.forEach((c, i) => {
    doc.text(c.title, colX[i] + 4, y + 5, { width: c.width * scale - 8, align: c.align || 'left' });
  });
  y += 18;

  if (!rows || rows.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(C.MUTED).text(emptyText || 'Sin registros.', MARGIN + 4, y + 4);
    return y + 20;
  }

  doc.font('Helvetica').fontSize(8.5).fillColor(C.INK);
  rows.forEach((r) => {
    // measure row height by the tallest cell
    const cells = columns.map((c) => (c.render ? c.render(r) : String(r[c.key] ?? '—')));
    const heights = cells.map((txt, i) =>
      doc.heightOfString(txt, { width: columns[i].width * scale - 8 }));
    const rowH = Math.max(16, Math.max(...heights) + 6);
    y = ensureSpace(doc, y, rowH);
    columns.forEach((c, i) => {
      doc.fillColor(C.INK).text(cells[i], colX[i] + 4, y + 3, { width: c.width * scale - 8, align: c.align || 'left' });
    });
    doc.moveTo(MARGIN, y + rowH).lineTo(MARGIN + tableW, y + rowH).lineWidth(0.4).strokeColor(C.BORDER).stroke();
    y += rowH;
  });
  return y + 4;
}

// ── main render ──────────────────────────────────────────────────────────────
function renderExpediente(doc, lic) {
  // Header band
  if (fs.existsSync(LOGO_PATH)) {
    try { doc.image(LOGO_PATH, MARGIN, MARGIN - 8, { width: 70 }); } catch { /* ignore */ }
  }
  doc.fillColor(C.INK).font('Helvetica-Bold').fontSize(16)
    .text('EXPEDIENTE DE LICITACIÓN', MARGIN + 85, MARGIN, { width: doc.page.width - MARGIN * 2 - 85 });
  doc.font('Helvetica').fontSize(10).fillColor(C.MUTED)
    .text(`${lic.codigo}  ·  ${ESTADO_LABEL(lic.estado)}`, MARGIN + 85, MARGIN + 22);
  doc.fontSize(8).fillColor(C.MUTED)
    .text(`Generado: ${new Date().toLocaleString('es-BO')}`, MARGIN + 85, MARGIN + 37);

  let y = MARGIN + 60;
  doc.moveTo(MARGIN, y).lineTo(doc.page.width - MARGIN, y).lineWidth(1).strokeColor(C.BLUE).stroke();
  y += 12;

  // 1. Datos de la licitación
  y = sectionTitle(doc, y, 'Datos de la licitación');
  y = defRow(doc, y, 'Nombre', lic.nombre);
  y = defRow(doc, y, 'Convocante', `${lic.cliente_nombre ?? '—'}${lic.cliente_nit ? '  (NIT ' + lic.cliente_nit + ')' : ''}`);
  y = defRow(doc, y, 'Responsable', lic.responsable_nombre);
  y = defRow(doc, y, 'Fecha límite', fmtDate(lic.fecha_limite));
  y = defRow(doc, y, 'Estado', ESTADO_LABEL(lic.estado));
  if (lic.descripcion)             y = defRow(doc, y, 'Descripción', lic.descripcion);
  if (lic.observaciones_resultado) y = defRow(doc, y, 'Resultado', lic.observaciones_resultado);
  y += 6;

  // 2. Resumen económico
  y = sectionTitle(doc, y, 'Resumen económico');
  const moneda = lic.moneda || 'BOB';
  if (lic.presupuesto_referencial != null) {
    y = defRow(doc, y, 'Presupuesto referencial', fmtMoney(lic.presupuesto_referencial, moneda));
  }
  y = defRow(doc, y, 'Total cotizado (ingreso)', fmtMoney(lic.total_comprometido, moneda));
  y = defRow(doc, y, 'Total gastos', fmtMoney(lic.total_gastos, moneda));

  // Resultado destacado
  const resultado = Number(lic.resultado ?? (Number(lic.total_comprometido || 0) - Number(lic.total_gastos || 0)));
  const esGanancia = resultado >= 0;
  y = ensureSpace(doc, y, 26);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(esGanancia ? C.GREEN : C.RED)
    .text(`${esGanancia ? 'Ganancia' : 'Pérdida'}: ${fmtMoney(Math.abs(resultado), moneda)}`, MARGIN, y + 2);
  y = doc.y + 10;

  // 3. Cotizaciones vinculadas
  y = sectionTitle(doc, y, `Cotizaciones vinculadas (${(lic.cotizaciones || []).length})`);
  y = drawTable(doc, y, [
    { title: 'Correlativo', key: 'numero_correlativo', width: 30 },
    { title: 'Estado',      key: 'estado',             width: 26 },
    { title: 'Monto',       width: 22, align: 'right', render: (r) => fmtMoney(r.monto_total, r.moneda) },
    { title: 'Ejecutivo',   key: 'ejecutivo_nombre',   width: 30 },
  ], lic.cotizaciones, 'Sin cotizaciones vinculadas.');
  y += 6;

  // 4. Gastos
  y = sectionTitle(doc, y, `Gastos (${(lic.gastos || []).length})`);
  y = drawTable(doc, y, [
    { title: 'Concepto', key: 'concepto', width: 46 },
    { title: 'Monto',    width: 22, align: 'right', render: (r) => fmtMoney(r.monto, r.moneda) },
    { title: 'Registró', key: 'nombre_usuario', width: 22 },
    { title: 'Fecha',    width: 20, render: (r) => fmtDate(r.creado_en) },
  ], lic.gastos, 'Sin gastos registrados.');

  // Footer
  const fy = doc.page.height - MARGIN - 14;
  doc.font('Helvetica').fontSize(7.5).fillColor(C.MUTED)
    .text('RC Tractoparts — Empresa unipersonal de Ronald Roca Cartagena · Documento interno de seguimiento de licitación',
      MARGIN, fy, { width: doc.page.width - MARGIN * 2, align: 'center' });
}

// Convenience: create a standard A4 document for the expediente.
function createDoc(lic) {
  return new PDFDocument({
    size: 'A4',
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    info: {
      Title:   `Expediente Licitación ${lic.codigo}`,
      Author:  'RC Tractoparts — Sistema de Gestión',
      Subject: 'Expediente de Licitación',
    },
    compress: true,
  });
}

module.exports = { renderExpediente, createDoc };
