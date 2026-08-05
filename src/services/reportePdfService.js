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
// Fechas escritas a mano, sin Intl: la imagen del servidor es node:20-alpine y
// si ese build no trae el ICU completo, toLocaleString('es-BO') cae a ingles en
// silencio — el PDF salia con "July 12, 2026" en un documento en castellano.
const { fmtNum, formatDate, formatDateTime, formatMes } = require('./pdf/format');
// La franja de logos de marcas y el subtitulo enmarcado son lo que hace
// RECONOCIBLE a una proforma de RC Tractoparts. Reusar el mismo dibujante —y no
// una copia— garantiza que si manana cambia una marca, cambie en los dos
// documentos a la vez.
const { drawBrandStrip } = require('./pdf/drawers/brandStrip');

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

// Delega en el formateador compartido, que NO usa Intl: sin ICU completo los
// separadores se dan vuelta y 1.234,50 sale como 1,234.50 (ver pdf/format.js).
function fmtMoney(v) {
  const s = fmtNum(v);
  return s === '—' ? '0,00' : s;
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
    ['FECHA',         formatDateTime()],
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

  // ESTETICA DE LA PROFORMA, no de tablero.
  // Antes esto era una banda marina rellena con texto blanco: se veia como un
  // dashboard, no como el documento que la empresa imprime. La proforma resuelve
  // sus titulos al reves — texto marino directamente sobre blanco, chico y en
  // mayusculas, separado por un filete NARANJA (ver drawThreeColumnGrid en
  // pdf/drawers/infoGrid.js, que lo describe como "physical proforma aesthetic").
  //
  // Copiar ese tratamiento es lo que hace que un reporte y una cotizacion se
  // lean como papeles de la misma empresa.
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.NAVY)
     .text(text.toUpperCase(), MARGIN, y, { width: CW, characterSpacing: 0.6, lineBreak: false });

  doc.moveTo(MARGIN, y + 12).lineTo(PW - MARGIN, y + 12)
     .lineWidth(0.9).strokeColor(C.ORANGE).stroke();

  return y + 20;
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
  // Misma logica que sectionTitle: la proforma usa cajas BLANCAS con borde fino
  // y un filete naranja bajo el rotulo, no rectangulos redondeados con relleno
  // gris. El redondeo y el fondo tenue son lenguaje de tablero web; en un papel
  // impreso se leen como un elemento ajeno al resto del documento.
  //
  // El rotulo va ARRIBA y el numero abajo, al reves que antes: es el orden en
  // que la proforma presenta cada dato (etiqueta chica, valor grande), y ademas
  // permite leer la columna de rotulos de un vistazo cuando hay cuatro cajas.
  doc.rect(x, y, w, 42).lineWidth(0.5).fillAndStroke(C.WHITE, C.BORDER_GRAY);

  doc.font('Helvetica-Bold').fontSize(6.5).fillColor(C.NAVY)
     .text(label.toUpperCase(), x + 7, y + 6, { width: w - 14, lineBreak: false });

  doc.moveTo(x, y + 16).lineTo(x + w, y + 16)
     .lineWidth(0.8).strokeColor(C.ORANGE).stroke();

  doc.font('Helvetica-Bold').fontSize(13).fillColor(color || C.NAVY)
     .text(value, x + 7, y + 22, { width: w - 14, lineBreak: false });
}

// ---------------------------------------------------------------------------
// drawMisMetricas — el reporte propio del ejecutivo (modo individual).
//
// LA JERARQUIA NO ES CASUAL: primero la CONVERSION, que es lo que distingue al
// que cotiza mucho del que vende. En esta empresa se cotiza todo lo que llega,
// asi que el volumen por si solo no dice nada.
//
// El denominador de la conversion son las cotizaciones que YA SALIERON al
// cliente, no el total: lo que sigue en preparacion no cuenta ni a favor ni en
// contra (ver src/models/quotation/misMetricas.js).
//
// Los montos van SIEMPRE separados por moneda. Sumar USD con Bs. daria un
// numero sin significado.
// ---------------------------------------------------------------------------
function drawMisMetricas(doc, m, leaderboard, y) {
  // Sin datos no se dibuja una grilla de guiones: se dice que no hay nada.
  if (!m) {
    y = sectionTitle(doc, 'Mi Rendimiento', y);
    doc.font('Helvetica').fontSize(9).fillColor(C.MID_GRAY)
       .text('Sin actividad registrada en este período.', MARGIN, y);
    return y + 20;
  }

  y = sectionTitle(doc, 'Mi Rendimiento', y);

  // ── Fila 1: la conversion y los tiempos ──────────────────────────────────
  const boxW = (CW - 3 * 8) / 4;
  const x = (i) => MARGIN + i * (boxW + 8);

  // El color sale del dato, no esta fijo: un verde alegre sobre un 3% seria
  // peor que no pintar nada.
  const colorConv = m.conversion == null ? C.MID_GRAY
    : m.conversion >= 40 ? '#059669'
    : m.conversion >= 20 ? '#D97706'
    : '#DC2626';

  statBox(doc, x(0), y, boxW, 'TASA DE CONVERSION',
    m.conversion == null ? 'S/D' : `${m.conversion}%`, colorConv);
  statBox(doc, x(1), y, boxW, 'DIAS PROMEDIO AL CIERRE',
    m.dias_cierre == null ? 'S/D' : String(m.dias_cierre), '#6D28D9');
  statBox(doc, x(2), y, boxW, 'EN PROCESO', String(m.en_proceso ?? 0), C.ORANGE);
  statBox(doc, x(3), y, boxW, 'RECHAZADAS', String(m.rechazadas ?? 0), '#DC2626');
  y += 50;

  // La aclaracion del denominador va impresa: sin ella, quien lea el PDF
  // meses despues no sabe sobre que base esta calculado ese porcentaje.
  doc.font('Helvetica').fontSize(7.5).fillColor(C.MID_GRAY)
     .text(
       m.conversion == null
         ? 'Todavía no hay cotizaciones enviadas al cliente en este período.'
         : `${m.cerradas} cerradas sobre ${m.en_la_cancha} que llegaron al cliente. ` +
           `Las ${m.en_proceso} en preparación no entran en el cálculo.`,
       MARGIN, y, { width: CW });
  y += 18;

  // ── Fila 2: los tickets, separados por moneda ────────────────────────────
  const medioW = (CW - 8) / 2;
  statBox(doc, MARGIN, y, medioW, 'TICKET PROMEDIO USD',
    m.ticket_usd == null ? 'S/D' : `$ ${fmtMoney(m.ticket_usd)}`, '#0F766E');
  statBox(doc, MARGIN + medioW + 8, y, medioW, 'TICKET PROMEDIO BOB',
    m.ticket_bob == null ? 'S/D' : `Bs. ${fmtMoney(m.ticket_bob)}`, '#0F766E');
  y += 54;

  // ── Desglose por estado ──────────────────────────────────────────────────
  const total = (m.por_estado || []).reduce((a, f) => a + f.cantidad, 0);
  y = sectionTitle(doc, 'En qué anda cada cotización', y);
  y = simpleTable(doc, {
    y,
    columns: [
      { key: 'estado',    label: 'ESTADO',     width: CW * 0.30 },
      { key: 'cantidad',  label: 'CANTIDAD',   width: CW * 0.14, align: 'right' },
      { key: 'pct',       label: '% DEL TOTAL', width: CW * 0.16, align: 'right',
        render: (r) => (total > 0 ? `${((r.cantidad / total) * 100).toFixed(1)}%` : '-') },
      { key: 'monto_usd', label: 'MONTO USD',  width: CW * 0.20, align: 'right',
        render: (r) => (r.monto_usd > 0 ? `$ ${fmtMoney(r.monto_usd)}` : '-') },
      { key: 'monto_bob', label: 'MONTO BOB',  width: CW * 0.20, align: 'right',
        render: (r) => (r.monto_bob > 0 ? `Bs. ${fmtMoney(r.monto_bob)}` : '-') },
    ],
    rows: m.por_estado || [],
    emptyLabel: 'Sin cotizaciones en este período.',
  });

  // ── Comparado con el periodo anterior ────────────────────────────────────
  // Un 57 % suelto no dice si vas mejor o peor. La flecha lo dice de un vistazo,
  // y el numero exacto queda al lado para quien quiera verificarlo.
  if (m.comparacion && m.comparacion.conversion != null && m.conversion != null) {
    const delta = Number((m.conversion - m.comparacion.conversion).toFixed(1));
    // Sin emoji ni flechas Unicode: PDFKit con las fuentes estandar (Helvetica)
    // usa WinAnsi, no Unicode, asi que una flecha ↑ sale como un glifo roto.
    // Una palabra dice lo mismo y no depende de la codificacion.
    const sentido = delta > 0 ? 'SUBIO' : delta < 0 ? 'BAJO' : 'IGUAL';
    const color   = delta > 0 ? '#059669' : delta < 0 ? '#DC2626' : C.MID_GRAY;

    y = sectionTitle(doc, 'Comparado con el período anterior', y);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(color)
       .text(
         `${sentido}  ${delta > 0 ? '+' : ''}${delta} puntos de conversión`,
         MARGIN, y, { width: CW, lineBreak: false });
    y += 14;
    doc.font('Helvetica').fontSize(7.5).fillColor(C.MID_GRAY)
       .text(
         `Período anterior (${formatDate(m.comparacion.periodo.desde)} al ${formatDate(m.comparacion.periodo.hasta)}): ` +
         `${m.comparacion.conversion}% de conversión, ${m.comparacion.cerradas} cerradas sobre ` +
         `${m.comparacion.emitidas} emitidas.`,
         MARGIN, y, { width: CW });
    y += 22;
  }

  // ── Esperando respuesta del cliente ──────────────────────────────────────
  // La UNICA seccion accionable del reporte: no dice como te fue, dice a quien
  // llamar manana. Ordenada por dias esperando, lo mas viejo primero.
  if ((m.pendientes || []).length > 0) {
    y = sectionTitle(doc, 'Esperando respuesta del cliente', y);
    y = simpleTable(doc, {
      y,
      columns: [
        { key: 'correlativo',    label: 'COTIZACION', width: CW * 0.20 },
        { key: 'cliente',        label: 'CLIENTE',    width: CW * 0.42 },
        { key: 'monto',          label: 'MONTO',      width: CW * 0.20, align: 'right',
          render: (r) => (r.moneda === 'USD' ? `$ ${fmtMoney(r.monto)}` : `Bs. ${fmtMoney(r.monto)}`) },
        { key: 'dias_esperando', label: 'DIAS',       width: CW * 0.18, align: 'right',
          render: (r) => `${r.dias_esperando} d` },
      ],
      rows: m.pendientes,
    });
  }

  // ── Las que cerro ────────────────────────────────────────────────────────
  // La evidencia concreta detras del porcentaje: que vendio, a quien y cuando.
  if ((m.confirmadas || []).length > 0) {
    y = sectionTitle(doc, 'Ventas cerradas en el período', y);
    y = simpleTable(doc, {
      y,
      columns: [
        { key: 'correlativo', label: 'COTIZACION', width: CW * 0.20 },
        { key: 'cliente',     label: 'CLIENTE',    width: CW * 0.44 },
        { key: 'fecha',       label: 'CERRADA EL', width: CW * 0.18,
          render: (r) => (r.fecha ? formatDate(r.fecha) : '-') },
        { key: 'monto',       label: 'MONTO',      width: CW * 0.18, align: 'right',
          render: (r) => (r.moneda === 'USD' ? `$ ${fmtMoney(r.monto)}` : `Bs. ${fmtMoney(r.monto)}`) },
      ],
      rows: m.confirmadas,
    });
  }

  // ── Lo que mas cotiza ────────────────────────────────────────────────────
  // Que repuestos mueve ESTE ejecutivo. La columna de clientes distintos dice
  // si es un articulo que pide mucha gente o el capricho de un cliente solo.
  if ((m.top_items || []).length > 0) {
    y = sectionTitle(doc, 'Los repuestos que más cotizo', y);
    y = simpleTable(doc, {
      y,
      columns: [
        { key: 'codigo',      label: 'CODIGO',      width: CW * 0.20 },
        { key: 'marca',       label: 'MARCA',       width: CW * 0.16,
          render: (r) => r.marca || '-' },
        { key: 'descripcion', label: 'DESCRIPCION', width: CW * 0.34 },
        { key: 'cantidad',    label: 'CANTIDAD',    width: CW * 0.16, align: 'right',
          render: (r) => `${r.cantidad} ${r.unidad || ''}`.trim() },
        { key: 'clientes',    label: 'CLIENTES',    width: CW * 0.14, align: 'right' },
      ],
      rows: m.top_items,
    });
  }

  // ── Evolucion mes a mes ──────────────────────────────────────────────────
  // Como tabla y no como grafico: PDFKit no dibuja graficos y una barra hecha a
  // mano con rectangulos se desalinea al cambiar el ancho de pagina. Tres
  // columnas de numeros se leen igual de bien y no se rompen nunca.
  if ((m.por_mes || []).length > 0) {
    y = sectionTitle(doc, 'Mi evolución', y);
    y = simpleTable(doc, {
      y,
      columns: [
        { key: 'mes',      label: 'MES',       width: CW * 0.34,
          render: (r) => formatMes(r.mes) },
        { key: 'emitidas', label: 'EMITIDAS',  width: CW * 0.22, align: 'right' },
        { key: 'cerradas', label: 'CERRADAS',  width: CW * 0.22, align: 'right' },
        { key: 'pct',      label: 'CONVERSION', width: CW * 0.22, align: 'right',
          render: (r) => (r.emitidas > 0 ? `${Math.round((r.cerradas / r.emitidas) * 100)}%` : '-') },
      ],
      rows: m.por_mes,
    });
  }

  return y;
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
//   metricas        {Object|null} misMetricas.obtener() — individual mode only
//   clientesPorOrigen {Array} — company mode only
// ---------------------------------------------------------------------------
async function generateReportePdf(data) {
  const {
    mode, periodo, rol, nombreUsuario,
    progreso, topClientes = [], leaderboard = [], clientesPorOrigen = [],
    metricas = null,
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

      const footerSubtitle = `Generado: ${formatDateTime()}`;

      let y = drawHeader(doc, {
        title: docTitle,
        periodo,
        rol,
        nombreUsuario,
      });

      // La franja de marcas, igual que en la proforma. Pesa 136 KB en total
      // desde que se optimizaron los logos, asi que sumarla no engorda el PDF
      // de forma apreciable — y es lo primero que identifica al documento como
      // de esta empresa.
      y = drawBrandStrip(doc, y);

      // Titulo enmarcado entre dos reglas marinas: el mismo tratamiento que
      // drawSubtitle le da a "PROFORMA REPUESTOS".
      doc.moveTo(MARGIN, y).lineTo(PW - MARGIN, y).lineWidth(0.8).strokeColor(C.NAVY).stroke();
      doc.font('Helvetica-Bold').fontSize(12).fillColor(C.NAVY)
         .text(mode === 'company' ? 'REPORTE GENERAL' : 'REPORTE INDIVIDUAL',
           MARGIN, y + 5, { width: CW, align: 'center', lineBreak: false });
      doc.moveTo(MARGIN, y + 21).lineTo(PW - MARGIN, y + 21).lineWidth(0.8).strokeColor(C.NAVY).stroke();
      y += 32;

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
        // ANTES: una sola tabla de UNA fila con cinco numeros. El ejecutivo
        // imprimia este PDF para mostrar como venia y no habia casi nada que
        // mostrar. Ahora lleva lo mismo que la pantalla.
        y = drawMisMetricas(doc, metricas, leaderboard, y);
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
