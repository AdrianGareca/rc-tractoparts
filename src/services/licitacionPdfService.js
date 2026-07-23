// =============================================================================
// src/services/licitacionPdfService.js
// PDF generator for the licitación "expediente" (case file).
//
// Self-contained (separate from the ornate quotation proforma in pdfService.js)
// but mirrors its corporate look: navy header band, white-on-navy section
// titles, tinted boxes, colored status pill, and navy-headed tables.
//
// Generated ON DEMAND and streamed directly to the response (never persisted),
// so it always reflects the licitación's current cotizaciones/gastos/estado.
//
// Exported:
//   createDoc(licitacion)             — a configured A4 PDFDocument.
//   renderExpediente(doc, licitacion) — draws the whole document into it. The
//   controller owns piping to res and calling doc.end().
// =============================================================================

'use strict';

const path = require('path');
const fs   = require('fs');
const PDFDocument = require('pdfkit');

const ASSETS_DIR = path.join(__dirname, '..', 'assets', 'images');
const LOGO_PATH  = path.join(ASSETS_DIR, 'rc_logo.png');

// A4 geometry
const PW = 595.28, PH = 841.89, MARGIN = 40;
const CW = PW - MARGIN * 2;

// Corporate palette (mirrors pdfService.js)
const C = {
  NAVY:   '#1B2B4B',
  ORANGE: '#C85A0F',
  WHITE:  '#FFFFFF',
  LIGHT:  '#F7F8FA',
  DARK:   '#2D3748',
  MID:    '#6B7280',
  BORDER: '#CBD5E0',
  GREEN:  '#059669',
  RED:    '#DC2626',
  TINT:   '#EFF6FF',
};

// Licitación state → pill color
const ESTADO_COLOR = {
  'En preparacion': '#6B7280',
  'Cotizando':      '#D97706',
  'En evaluacion':  '#6366F1',
  'Presentada':     '#2563EB',
  'Adjudicada':     '#059669',
  'No adjudicada':  '#DC2626',
  'Archivada':      '#6B7280',
};

// ── formatting helpers ───────────────────────────────────────────────────────
function fmtMoney(amount, moneda = 'BOB') {
  if (amount == null || isNaN(parseFloat(amount))) return '—';
  const s = parseFloat(amount).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'USD' ? `$ ${s}` : `Bs. ${s}`;
}
function fmtDate(v) {
  if (!v) return '—';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) { const [y, m, d] = s.slice(0, 10).split('-'); return `${d}/${m}/${y}`; }
  const dt = new Date(v);
  return isNaN(dt.getTime()) ? s : dt.toLocaleDateString('es-BO');
}

// ── layout primitives ────────────────────────────────────────────────────────
function ensureSpace(doc, y, needed) {
  if (y + needed > PH - MARGIN - 24) { doc.addPage(); return MARGIN + 6; }
  return y;
}

// Section title: navy left stripe + bold navy text + hairline underline.
function sectionTitle(doc, y, text) {
  y = ensureSpace(doc, y, 26);
  doc.rect(MARGIN, y, 3.5, 12).fill(C.ORANGE);
  doc.fillColor(C.NAVY).font('Helvetica-Bold').fontSize(10.5).text(text.toUpperCase(), MARGIN + 9, y);
  const yy = y + 16;
  doc.moveTo(MARGIN, yy).lineTo(PW - MARGIN, yy).lineWidth(0.6).strokeColor(C.BORDER).stroke();
  return yy + 8;
}

// Key/value row inside a boxed area.
function kvRow(doc, y, label, value) {
  const labelW = 135;
  const valW   = CW - labelW - 24;
  const vh = doc.font('Helvetica').fontSize(9).heightOfString(value == null || value === '' ? '—' : String(value), { width: valW });
  const rowH = Math.max(15, vh + 4);
  y = ensureSpace(doc, y, rowH);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(C.MID).text(label, MARGIN + 12, y + 1, { width: labelW });
  doc.font('Helvetica').fontSize(9).fillColor(C.DARK)
    .text(value == null || value === '' ? '—' : String(value), MARGIN + 12 + labelW, y + 1, { width: valW });
  return y + rowH;
}

// Generic table with navy header + zebra rows.
function table(doc, y, columns, rows, emptyText) {
  const totalW = columns.reduce((a, c) => a + c.w, 0);
  const scale  = CW / totalW;
  const xs = []; let cx = MARGIN;
  columns.forEach((c) => { xs.push(cx); cx += c.w * scale; });

  // header
  y = ensureSpace(doc, y, 20);
  doc.rect(MARGIN, y, CW, 17).fill(C.NAVY);
  doc.fillColor(C.WHITE).font('Helvetica-Bold').fontSize(8);
  columns.forEach((c, i) => doc.text(c.t, xs[i] + 5, y + 5, { width: c.w * scale - 10, align: c.align || 'left' }));
  y += 17;

  if (!rows || rows.length === 0) {
    doc.rect(MARGIN, y, CW, 18).fill(C.LIGHT);
    doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(C.MID).text(emptyText || 'Sin registros.', MARGIN + 6, y + 5);
    return y + 22;
  }

  doc.font('Helvetica').fontSize(8.5);
  rows.forEach((r, idx) => {
    const cells = columns.map((c) => (c.r ? c.r(r) : String(r[c.k] ?? '—')));
    const rowH = Math.max(15, Math.max(...cells.map((t, i) => doc.heightOfString(t, { width: columns[i].w * scale - 10 }))) + 6);
    y = ensureSpace(doc, y, rowH);
    if (idx % 2 === 1) doc.rect(MARGIN, y, CW, rowH).fill(C.LIGHT);
    columns.forEach((c, i) => {
      doc.fillColor(c.color ? c.color(r) : C.DARK).font(c.bold ? 'Helvetica-Bold' : 'Helvetica')
        .text(cells[i], xs[i] + 5, y + 3.5, { width: c.w * scale - 10, align: c.align || 'left' });
    });
    y += rowH;
  });
  // bottom border
  doc.moveTo(MARGIN, y).lineTo(PW - MARGIN, y).lineWidth(0.6).strokeColor(C.BORDER).stroke();
  return y + 4;
}

// ── main render ──────────────────────────────────────────────────────────────
function renderExpediente(doc, lic) {
  const moneda = lic.moneda || 'BOB';

  // ── Header band ──────────────────────────────────────────────────────────
  const bandH = 62;
  doc.rect(0, 0, PW, bandH).fill(C.NAVY);
  // logo on a white rounded chip so it reads on navy
  if (fs.existsSync(LOGO_PATH)) {
    try {
      doc.roundedRect(MARGIN, 12, 58, 38, 5).fill(C.WHITE);
      doc.image(LOGO_PATH, MARGIN + 5, 15, { fit: [48, 32] });
    } catch { /* ignore */ }
  }
  doc.fillColor(C.WHITE).font('Helvetica-Bold').fontSize(15)
    .text('EXPEDIENTE DE LICITACIÓN', MARGIN + 72, 14, { width: CW - 72 });
  doc.font('Helvetica').fontSize(10).fillColor('#C7D2FE')
    .text(`${lic.codigo}`, MARGIN + 72, 33);
  // estado pill (top-right)
  const pillColor = ESTADO_COLOR[lic.estado] || C.MID;
  const estadoTxt = String(lic.estado || '—').toUpperCase();
  const pillW = doc.font('Helvetica-Bold').fontSize(8).widthOfString(estadoTxt) + 16;
  doc.roundedRect(PW - MARGIN - pillW, 20, pillW, 16, 8).fill(pillColor);
  doc.fillColor(C.WHITE).font('Helvetica-Bold').fontSize(8).text(estadoTxt, PW - MARGIN - pillW + 8, 24.5);
  doc.fillColor('#C7D2FE').font('Helvetica').fontSize(7)
    .text(`Generado: ${new Date().toLocaleString('es-BO')}`, PW - MARGIN - 200, 42, { width: 200, align: 'right' });

  let y = bandH + 14;

  // ── 1. Datos de la licitación ────────────────────────────────────────────
  y = sectionTitle(doc, y, 'Datos de la licitación');
  const boxTop = y;
  doc.rect(MARGIN, boxTop, CW, 2).fill(C.WHITE); // spacer anchor
  y += 2;
  y = kvRow(doc, y, 'Nombre', lic.nombre);
  y = kvRow(doc, y, 'Convocante', `${lic.cliente_nombre ?? '—'}${lic.cliente_nit ? '   ·   NIT ' + lic.cliente_nit : ''}`);
  y = kvRow(doc, y, 'Responsable (Proyectos)', lic.responsable_nombre);
  y = kvRow(doc, y, 'Fecha límite', fmtDate(lic.fecha_limite));
  if (lic.descripcion)             y = kvRow(doc, y, 'Descripción', lic.descripcion);
  if (lic.observaciones_resultado) y = kvRow(doc, y, 'Observaciones', lic.observaciones_resultado);
  // frame around the data box
  doc.roundedRect(MARGIN, boxTop, CW, y - boxTop + 2, 3).lineWidth(0.6).strokeColor(C.BORDER).stroke();
  y += 12;

  // ── 2. Resumen económico ─────────────────────────────────────────────────
  y = sectionTitle(doc, y, 'Resumen económico');
  const ingreso   = Number(lic.total_comprometido ?? 0);
  const gastosT   = Number(lic.total_gastos ?? 0);
  const resultado = Number(lic.resultado ?? (ingreso - gastosT));
  const ganancia  = resultado >= 0;

  // small figures grid
  y = ensureSpace(doc, y, 46);
  const cardW = (CW - 16) / 3;
  const cards = [
    { label: 'Presupuesto ref.', value: lic.presupuesto_referencial != null ? fmtMoney(lic.presupuesto_referencial, moneda) : '—', color: C.NAVY },
    { label: 'Ingreso (cotizado)', value: fmtMoney(ingreso, moneda), color: C.NAVY },
    { label: 'Total gastos', value: fmtMoney(gastosT, moneda), color: C.ORANGE },
  ];
  cards.forEach((cd, i) => {
    const cx = MARGIN + i * (cardW + 8);
    doc.roundedRect(cx, y, cardW, 40, 3).fill(C.LIGHT);
    doc.fillColor(C.MID).font('Helvetica-Bold').fontSize(7.5).text(cd.label.toUpperCase(), cx + 8, y + 7, { width: cardW - 16 });
    doc.fillColor(cd.color).font('Helvetica-Bold').fontSize(12).text(cd.value, cx + 8, y + 20, { width: cardW - 16 });
  });
  y += 50;

  // Resultado banner
  y = ensureSpace(doc, y, 40);
  doc.roundedRect(MARGIN, y, CW, 34, 4).fill(ganancia ? '#ECFDF5' : '#FEF2F2');
  doc.roundedRect(MARGIN, y, 5, 34, 2).fill(ganancia ? C.GREEN : C.RED);
  doc.fillColor(ganancia ? C.GREEN : C.RED).font('Helvetica-Bold').fontSize(13)
    .text(`${ganancia ? 'GANANCIA' : 'PÉRDIDA'}: ${fmtMoney(Math.abs(resultado), moneda)}`, MARGIN + 16, y + 6);
  doc.fillColor(C.MID).font('Helvetica').fontSize(8)
    .text(`Ingreso ${fmtMoney(ingreso, moneda)}  −  Gastos ${fmtMoney(gastosT, moneda)}`, MARGIN + 16, y + 22);
  y += 44;

  // ── 3. Cotizaciones vinculadas ───────────────────────────────────────────
  y = sectionTitle(doc, y, `Cotizaciones vinculadas (${(lic.cotizaciones || []).length})`);
  y = table(doc, y, [
    { t: 'Correlativo', k: 'numero_correlativo', w: 34, bold: true },
    { t: 'Estado',      k: 'estado',             w: 30 },
    { t: 'Monto',       w: 22, align: 'right', r: (r) => fmtMoney(r.monto_total, r.moneda) },
    { t: 'Ejecutivo',   k: 'ejecutivo_nombre',   w: 34 },
  ], lic.cotizaciones, 'Sin cotizaciones vinculadas.');
  y += 8;

  // ── 4. Gastos ────────────────────────────────────────────────────────────
  y = sectionTitle(doc, y, `Gastos (${(lic.gastos || []).length})`);
  y = table(doc, y, [
    { t: 'Concepto', k: 'concepto',       w: 48 },
    { t: 'Monto',    w: 20, align: 'right', r: (r) => fmtMoney(r.monto, r.moneda), color: () => C.ORANGE, bold: true },
    { t: 'Registró', k: 'nombre_usuario', w: 22 },
    { t: 'Fecha',    w: 18, r: (r) => fmtDate(r.creado_en) },
  ], lic.gastos, 'Sin gastos registrados.');

  // ── Footer on every page ─────────────────────────────────────────────────
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.moveTo(MARGIN, PH - MARGIN - 12).lineTo(PW - MARGIN, PH - MARGIN - 12).lineWidth(0.5).strokeColor(C.BORDER).stroke();
    doc.font('Helvetica').fontSize(7).fillColor(C.MID)
      .text('RC Tractoparts — Empresa unipersonal de Ronald Roca Cartagena  ·  Documento interno de seguimiento de licitación',
        MARGIN, PH - MARGIN - 9, { width: CW - 40, align: 'left' });
    doc.text(`Pág. ${i - range.start + 1} de ${range.count}`, PW - MARGIN - 60, PH - MARGIN - 9, { width: 60, align: 'right' });
  }
}

// Standard A4 document. bufferPages:true so the footer can paginate all pages.
function createDoc(lic) {
  return new PDFDocument({
    size: 'A4',
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    bufferPages: true,
    info: {
      Title:   `Expediente Licitación ${lic.codigo}`,
      Author:  'RC Tractoparts — Sistema de Gestión',
      Subject: 'Expediente de Licitación',
    },
    compress: true,
  });
}

module.exports = { renderExpediente, createDoc };
