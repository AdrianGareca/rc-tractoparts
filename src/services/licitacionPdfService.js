// =============================================================================
// src/services/licitacionPdfService.js
// PDF generator for the licitación "expediente" (case file).
//
// Comparte el lenguaje visual de la proforma (pdfService.js), porque los tres
// documentos que salen de este sistema —proforma, expediente y reporte— tienen
// que leerse como papeles de la misma empresa:
//   • logo a la izquierda, caja de datos a la derecha, divisor marino
//   • franja de marcas (mismo dibujante, no una copia)
//   • titulo enmarcado entre dos reglas marinas
//   • titulos de seccion en marino sobre blanco, con filete NARANJA debajo
//   • tablas con encabezado marino y filas alternadas
//
// Antes tenia una banda marina a todo lo ancho con el logo sobre un chip
// blanco: se veia como la portada de un informe, no como papel membretado.
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
// Mismo motivo que en reportePdfService: Intl depende del ICU del binario y
// node:20-alpine puede no traerlo completo, haciendo caer todo a ingles.
const { fmtNum, formatDate, formatDateTime } = require('./pdf/format');
// Mismo dibujante de la franja de marcas que usa la proforma: si manana cambia
// una marca, cambia en los tres documentos a la vez.
const { drawBrandStrip } = require('./pdf/drawers/brandStrip');

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
  const s = fmtNum(amount);   // sin Intl: ver el porque en pdf/format.js
  return moneda === 'USD' ? `$ ${s}` : `Bs. ${s}`;
}
// Delega en el formateador compartido, que arma DD/MM/YYYY a mano. La rama
// que quedaba usaba toLocaleDateString('es-BO'), y eso depende del ICU del
// binario: en node:20-alpine sin ICU completo salía en formato inglés.
const fmtDate = formatDate;

// ── layout primitives ────────────────────────────────────────────────────────
function ensureSpace(doc, y, needed) {
  if (y + needed > PH - MARGIN - 24) { doc.addPage(); return MARGIN + 6; }
  return y;
}

// Titulo de seccion, con el mismo tratamiento que la proforma: texto marino
// sobre blanco y un filete NARANJA debajo. Antes la linea era gris de borde, y
// esa diferencia bastaba para que el expediente se leyera como otro documento.
// El detalle esta en drawThreeColumnGrid (pdf/drawers/infoGrid.js), que lo
// describe como "physical proforma aesthetic".
function sectionTitle(doc, y, text) {
  y = ensureSpace(doc, y, 26);
  doc.fillColor(C.NAVY).font('Helvetica-Bold').fontSize(9)
    .text(text.toUpperCase(), MARGIN, y, { characterSpacing: 0.6 });
  const yy = y + 14;
  doc.moveTo(MARGIN, yy).lineTo(PW - MARGIN, yy).lineWidth(0.9).strokeColor(C.ORANGE).stroke();
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

  // ── Cabecera, con la estructura de la proforma ───────────────────────────
  // ANTES: una banda marina que ocupaba todo el ancho, con el logo sobre un
  // chip blanco encima. Se veia como la portada de un informe, no como el papel
  // membretado que usa la empresa.
  //
  // AHORA: logo a la izquierda sobre blanco, caja de datos a la derecha y un
  // divisor marino debajo — exactamente lo que hace drawHeader en la proforma.
  const LOGO_W = 130, LOGO_H = 58;
  const BOX_W  = 215, BOX_H = 58;
  const BOX_X  = PW - MARGIN - BOX_W;
  const y0     = MARGIN;

  if (fs.existsSync(LOGO_PATH)) {
    try { doc.image(LOGO_PATH, MARGIN, y0, { fit: [LOGO_W, LOGO_H], align: 'left', valign: 'center' }); }
    catch { /* el fallback de texto de abajo cubre el caso */ }
  }

  doc.rect(BOX_X, y0, BOX_W, BOX_H).lineWidth(0.8).fillAndStroke(C.WHITE, C.DARK);
  doc.rect(BOX_X, y0, BOX_W, 17).fill(C.NAVY);
  doc.font('Helvetica-Bold').fontSize(7).fillColor(C.WHITE)
    .text('EXPEDIENTE DE LICITACIÓN', BOX_X + 4, y0 + 5,
      { width: BOX_W - 8, align: 'center', lineBreak: false });

  const cab = [
    ['CÓDIGO',   lic.codigo || '—'],
    ['ESTADO',   String(lic.estado || '—')],
    ['GENERADO', formatDateTime()],
  ];
  let cy = y0 + 23;
  cab.forEach(([lbl, val]) => {
    doc.font('Helvetica-Bold').fontSize(6).fillColor(C.MID)
      .text(lbl, BOX_X + 6, cy, { width: 52, lineBreak: false });
    doc.font('Helvetica').fontSize(6.5).fillColor(C.DARK)
      .text(String(val), BOX_X + 60, cy, { width: BOX_W - 66, lineBreak: false });
    cy += 12;
  });

  const divisorY = y0 + LOGO_H + 10;
  doc.strokeColor(C.NAVY).lineWidth(1.2)
    .moveTo(MARGIN, divisorY).lineTo(PW - MARGIN, divisorY).stroke();

  let y = divisorY + 14;

  // La franja de marcas y el titulo enmarcado: lo que vuelve reconocible al
  // documento como de RC Tractoparts. Mismo dibujante que la proforma.
  y = drawBrandStrip(doc, y);

  doc.moveTo(MARGIN, y).lineTo(PW - MARGIN, y).lineWidth(0.8).strokeColor(C.NAVY).stroke();
  doc.font('Helvetica-Bold').fontSize(12).fillColor(C.NAVY)
    .text('EXPEDIENTE DE LICITACIÓN', MARGIN, y + 5,
      { width: CW, align: 'center', lineBreak: false });
  doc.moveTo(MARGIN, y + 21).lineTo(PW - MARGIN, y + 21).lineWidth(0.8).strokeColor(C.NAVY).stroke();
  y += 32;

  // El estado va como pildora dentro del cuerpo, no en la cabecera: ahi compite
  // con el codigo y con la fecha, y es un dato que se lee UNA vez.
  const pillColor = ESTADO_COLOR[lic.estado] || C.MID;
  const estadoTxt = String(lic.estado || '—').toUpperCase();
  const pillW = doc.font('Helvetica-Bold').fontSize(8).widthOfString(estadoTxt) + 18;
  doc.roundedRect(MARGIN, y, pillW, 17, 8.5).fill(pillColor);
  doc.fillColor(C.WHITE).font('Helvetica-Bold').fontSize(8)
    .text(estadoTxt, MARGIN + 9, y + 5, { lineBreak: false });
  y += 26;

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
