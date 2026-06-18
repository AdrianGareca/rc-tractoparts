// =============================================================================
// src/services/pdfService.js
// PDF Generation Service — RC Tractoparts Proforma Invoices  (layout v3)
//
// Generates a corporate-branded A4 PDF for a quotation record using PDFKit.
// Layout faithfully mirrors the physical proforma scans:
//   • Header  : Logo + brand strip (left) | Quotation info box (right)
//   • Subtitle: Centred "PROFORMA REPUESTOS" title with navy dividers
//   • Grid    : 3-column technical block (Cliente / Solicitante / Equipo)
//   • Table   : 9-column items grid with light-pink header, es-BO number fmt
//   • Totals  : SON-in-words line · Conditions · Bank data · Grand-total box
//   • Footer  : Verified corporate contact info, right-aligned
//
// Fields added in future DB migrations (equipo_*, celular_sol, etc.) will
// auto-populate; until then the PDF renders '—' as a graceful placeholder.
// =============================================================================

'use strict';

const fs          = require('fs');
const path        = require('path');
const PDFDocument = require('pdfkit');

// =============================================================================
// Asset paths — resolved relative to this file's directory
// =============================================================================

const ASSETS_DIR  = path.join(__dirname, '..', 'assets', 'images');
const LOGO_PATH   = path.join(ASSETS_DIR, 'rc_logo.png');
const BRANDS_DIR  = path.join(ASSETS_DIR, 'brands');

// Ordered list: filename → fallback display label
const BRAND_DEFS = [
  { file: 'volvo.png',      label: 'VOLVO'     },
  { file: 'john_deere.png', label: 'JOHN DEERE' },
  { file: 'komatsu.png',    label: 'KOMATSU'   },
  { file: 'jcb.png',        label: 'JCB'       },
  { file: 'cat.png',        label: 'CAT'       },
  { file: 'case.png',       label: 'CASE'      },
];

// =============================================================================
// Color palette
// =============================================================================

const C = {
  NAVY:        '#1B2B4B',   // Primary navy — headers, totals box
  ORANGE:      '#C85A0F',   // Accent — dividers, total value, SON line border
  WHITE:       '#FFFFFF',
  LIGHT_GRAY:  '#F7F8FA',   // Alternating row fill, tinted backgrounds
  DARK_GRAY:   '#2D3748',   // Primary body text
  MID_GRAY:    '#6B7280',   // Labels, row numbers, secondary text
  BORDER_GRAY: '#CBD5E0',   // Table borders, section dividers
  BLUE_ACCENT: '#3B82F6',   // Left stripe on 3-column section headers
  BLUE_BG:     '#EFF6FF',   // 3-column section header background
  BLUE_TITLE:  '#1D4ED8',   // 3-column section header text
  PINK_HEADER: '#FADADD',   // Items table header background (light pink/pastel)
  PINK_TEXT:   '#4A1622',   // Items table header text (dark on pink)
  ALT_ROW:     '#FFF8F8',   // Alternating row tint inside the items table
  STATUS: {
    'Pendiente':             '#6B7280',
    'En revision':           '#D97706',
    'En espera':             '#D97706',
    'Aprobada internamente': '#059669',
    'Enviada al cliente':    '#2563EB',
    'Aceptada':              '#059669',
    'Rechazada':             '#DC2626',
    'Archivada':             '#6B7280',
  },
};

// =============================================================================
// Page geometry — A4 (595.28 × 841.89 pt)
// =============================================================================

const PW     = 595.28;
const PH     = 841.89;
const MARGIN = 36;
const CW     = PW - MARGIN * 2;  // 523.28 pt usable content width

// =============================================================================
// 9-column items table
// Widths must sum exactly to CW (523.28 pt).
// Last column absorbs the remainder to prevent rounding gaps.
// =============================================================================

const COL = {
  item:    20,
  codigo:  48,
  codAlt:  52,
  desc:    130,
  cant:    26,
  uni:     26,
  pUnit:   62,
  pTotal:  62,
  entrega: parseFloat((CW - 20 - 48 - 52 - 130 - 26 - 26 - 62 - 62).toFixed(2)), // 97.28
};

// Precomputed left-edge X of each column
const COL_X = (() => {
  let x = MARGIN;
  const out = {};
  for (const [k, w] of Object.entries(COL)) {
    out[k] = x;
    x += w;
  }
  return out;
})();

const TABLE_HEADER_H = 24;   // Height of the pink column-header row
const ROW_MIN_H      = 20;   // Minimum data-row height
const ROW_PADDING    = 8;    // Vertical padding inside each data row
const PAGE_BREAK_Y   = PH - MARGIN - 100; // Y threshold that triggers a new page

// =============================================================================
// Utility helpers
// =============================================================================

// ---------------------------------------------------------------------------
// fmtNum — es-BO locale number format: thousands separator = '.' decimal = ','
//          Example: 2100.5 → "2.100,50"
// ---------------------------------------------------------------------------
function fmtNum(amount) {
  if (amount == null || amount === '' || isNaN(parseFloat(amount))) return '—';
  return parseFloat(amount).toLocaleString('es-BO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ---------------------------------------------------------------------------
// fmtPrice — prepend currency symbol to the formatted number
// ---------------------------------------------------------------------------
function fmtPrice(amount, moneda) {
  const s = fmtNum(amount);
  if (s === '—') return '—';
  return moneda === 'BOB' ? `Bs. ${s}` : `$ ${s}`;
}

// ---------------------------------------------------------------------------
// formatDate — YYYY-MM-DD / Date → DD/MM/YYYY, UTC-safe
// ---------------------------------------------------------------------------
function formatDate(v) {
  if (!v) return '—';
  const d = typeof v === 'string' ? new Date(`${v}T00:00:00`) : new Date(v);
  if (isNaN(d.getTime())) return String(v);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

// ---------------------------------------------------------------------------
// hLine — full-width horizontal rule between MARGIN edges
// ---------------------------------------------------------------------------
function hLine(doc, y, color = C.BORDER_GRAY, lw = 0.5) {
  doc.save()
    .moveTo(MARGIN, y)
    .lineTo(PW - MARGIN, y)
    .lineWidth(lw)
    .strokeColor(color)
    .stroke()
    .restore();
}

// =============================================================================
// Number → Spanish words  (used in the "SON:" totals line)
// Example: numberToWordsES(3080.00) → "TRES MIL OCHENTA CON 00/100"
// =============================================================================

const _ONES = [
  '', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO',
  'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE',
  'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE',
];
const _TENS = [
  '', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA',
  'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA',
];
const _HUNS = [
  '', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS',
  'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS',
];

function _lt1000(n) {
  if (n === 0) return '';
  if (n === 100) return 'CIEN';
  let s = '';
  const h   = Math.floor(n / 100);
  const rem = n % 100;
  if (h) s += _HUNS[h];
  if (h && rem) s += ' ';
  if (rem > 0) {
    if (rem < 20) {
      s += _ONES[rem];
    } else {
      s += _TENS[Math.floor(rem / 10)];
      if (rem % 10) s += ' Y ' + _ONES[rem % 10];
    }
  }
  return s;
}

function _buildWords(n) {
  if (n >= 1000) {
    const t = Math.floor(n / 1000);
    const r = n % 1000;
    return (t === 1 ? 'MIL' : `${_lt1000(t)} MIL`) + (r > 0 ? ' ' + _lt1000(r) : '');
  }
  return _lt1000(n);
}

function numberToWordsES(amount) {
  if (amount == null || isNaN(parseFloat(amount))) return 'CERO CON 00/100';
  const abs   = Math.abs(parseFloat(amount));
  const n     = Math.floor(abs);
  const cents = Math.round((abs - n) * 100);
  const cc    = String(cents).padStart(2, '0');
  if (n === 0) return `CERO CON ${cc}/100`;

  let w = '';
  if (n >= 1000000) {
    const m = Math.floor(n / 1000000);
    w += m === 1 ? 'UN MILLÓN' : `${_lt1000(m)} MILLONES`;
    const r = n % 1000000;
    if (r > 0) w += ' ' + _buildWords(r);
  } else {
    w = _buildWords(n);
  }
  return `${w.trim()} CON ${cc}/100`;
}

// =============================================================================
// Section drawers
// Each draw* function receives (doc, ..., startY) and returns the Y position
// immediately below its rendered content.
// =============================================================================

// ---------------------------------------------------------------------------
// renderWatermark
// Paints a tilted "APROBADO" ink-stamp behind the items table on the current page.
// Must be called AFTER drawing the header/grid sections (so those remain clean)
// but BEFORE drawing the table rows (so text renders on top — painter's order).
//
// @param {PDFDocument} doc
// @param {Object}      quotation
// @param {number}      tableBodyY  — Top Y of the items table body; watermark is
//                                    centred in the table area vertically.
// ---------------------------------------------------------------------------
function renderWatermark(doc, quotation, tableBodyY) {
  const estado = (quotation.estado_nombre || quotation.estado || '').toUpperCase();
  const shouldStamp = estado === 'CONFIRMADO'
    || estado === 'APROBADA INTERNAMENTE'
    || estado.includes('CONFIRM')
    || estado.includes('APROBAD');

  if (!shouldStamp) return;

  // Centre the stamp horizontally on the page and vertically in the table area
  const centerX = PW / 2;
  // Use table area mid-point when supplied; fall back to page centre for safety
  const tableAreaH = PH - (tableBodyY ?? PH / 2) - MARGIN - 110;
  const centerY    = tableBodyY != null
    ? tableBodyY + Math.min(tableAreaH / 2, 140)
    : PH / 2;

  const STAMP_W = 230;
  const STAMP_H = 76;
  const STAMP_COLOR = '#C71585';   // Pinkish-magenta ink — matches physical stamp

  doc.save();
  doc.opacity(0.14);
  doc.rotate(-30, { origin: [centerX, centerY] });

  // Rounded-rectangle frame (distressed border look)
  doc
    .roundedRect(centerX - STAMP_W / 2, centerY - STAMP_H / 2, STAMP_W, STAMP_H, 6)
    .lineWidth(6)
    .strokeColor(STAMP_COLOR)
    .stroke();

  // Bold "APROBADO" text centred inside the frame
  doc
    .font('Helvetica-Bold')
    .fontSize(54)
    .fillColor(STAMP_COLOR)
    .text('APROBADO',
      centerX - STAMP_W / 2,
      centerY - 27,
      { width: STAMP_W, align: 'center', lineBreak: false });

  doc.restore();
}

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
  const BRAND_H = 15;
  const GAP     = 4;
  const BOX_W   = 185;
  const BOX_H   = LOGO_H + GAP + BRAND_H;  // 91 pt — matches left block height
  const BOX_X   = PW - MARGIN - BOX_W;

  // ── Left: corporate logo (real image with text fallback) ──────────────────
  if (fs.existsSync(LOGO_PATH)) {
    doc.image(LOGO_PATH, MARGIN, y0, {
      width:  LOGO_W,
      height: LOGO_H,
      fit:    [LOGO_W, LOGO_H],
      align:  'center',
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

  // ── Left: partner brand strip (real images with text fallback) ─────────────
  const brandY  = y0 + LOGO_H + GAP;
  const brandCW = LOGO_W / BRAND_DEFS.length;  // ≈ 25.83 pt per cell
  const IMG_PAD = 3;

  // Draw a single thin border around the entire strip (no colored cell fills —
  // clean proforma aesthetic matching the physical printed sheet).
  doc
    .rect(MARGIN, brandY, LOGO_W, BRAND_H)
    .lineWidth(0.5)
    .fillAndStroke(C.WHITE, C.BORDER_GRAY);

  BRAND_DEFS.forEach(({ file, label }, i) => {
    const bx      = MARGIN + i * brandCW;
    const imgPath = path.join(BRANDS_DIR, file);

    // Thin vertical divider between logos (except before first)
    if (i > 0) {
      doc
        .moveTo(bx, brandY)
        .lineTo(bx, brandY + BRAND_H)
        .lineWidth(0.3)
        .strokeColor(C.BORDER_GRAY)
        .stroke();
    }

    if (fs.existsSync(imgPath)) {
      doc.image(imgPath, bx + IMG_PAD, brandY + IMG_PAD, {
        width:  brandCW - IMG_PAD * 2,
        height: BRAND_H - IMG_PAD * 2,
        fit:    [brandCW - IMG_PAD * 2, BRAND_H - IMG_PAD * 2],
        align:  'center',
        valign: 'center',
      });
    } else {
      // Text fallback when brand image asset is not yet deployed
      doc
        .font('Helvetica-Bold')
        .fontSize(4.5)
        .fillColor(C.NAVY)
        .text(label, bx, brandY + (BRAND_H - 4.5) / 2,
          { width: brandCW, align: 'center', lineBreak: false });
    }
  });

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
    ['ESTADO',        (quotation.estado      || 'CONFIRMADO').toUpperCase()],
    ['FECHA CONFIRM.', formatDate(quotation.fecha_aprobacion || quotation.fecha_emision)],
  ];

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
    doc
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .fillColor(C.DARK_GRAY)
      .text(String(val), BOX_X + LABELW + 4, ry + (rowH - 7.5) / 2,
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

  return y0 + BOX_H + 8;  // Y immediately below the header block
}

// ---------------------------------------------------------------------------
// drawSubtitle
// Centred "PROFORMA REPUESTOS" title framed by two navy horizontal rules.
// No diagonal stamps or watermarks are rendered.
// ---------------------------------------------------------------------------
function drawSubtitle(doc, startY) {
  const y = startY + 4;
  hLine(doc, y, C.NAVY, 0.8);

  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(C.NAVY)
    .text('PROFORMA REPUESTOS', MARGIN, y + 5,
      { width: CW, align: 'center', lineBreak: false });

  hLine(doc, y + 21, C.NAVY, 0.8);

  return y + 28;
}

// ---------------------------------------------------------------------------
// drawThreeColumnGrid
// Three equal-width columns with light-blue accent section headers:
//   1. DATOS GENERALES DEL CLIENTE  (Cliente, NIT, Dirección, Ciudad, Teléfono)
//   2. DATOS DEL SOLICITANTE        (Nombre, Nº Solicitud/OC, Área, Celular, Correo)
//   3. DATOS DEL EQUIPO             (MARCA, TIPO, MODELO, SERIE, MOTOR)
//
// Fields absent from the current DB schema render as '—' until the
// corresponding columns are added via migration.
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
        ['Nombre',       quotation.ejecutivo_nombre || '—'],
        ['Nº Solic./OC', quotation.nro_solicitud   || '—'],
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

// ---------------------------------------------------------------------------
// drawTableHeaderRow
// Renders the light-pink column-header row for the items table.
// Re-called on each new page after a page break.
// Returns Y immediately below the header row.
// ---------------------------------------------------------------------------
function drawTableHeaderRow(doc, y) {
  // Pink/pastel background fill
  doc.rect(MARGIN, y, CW, TABLE_HEADER_H).fill(C.PINK_HEADER);
  // Outer border stroke
  doc
    .rect(MARGIN, y, CW, TABLE_HEADER_H)
    .lineWidth(0.6)
    .strokeColor(C.BORDER_GRAY)
    .stroke();

  const headers = [
    { label: 'ITEM',        x: COL_X.item,    w: COL.item,    align: 'center' },
    { label: 'CÓDIGO',      x: COL_X.codigo,  w: COL.codigo,  align: 'center' },
    { label: 'CÓD. ALT.',   x: COL_X.codAlt,  w: COL.codAlt,  align: 'center' },
    { label: 'DESCRIPCIÓN', x: COL_X.desc,    w: COL.desc,    align: 'left'   },
    { label: 'CANT.',       x: COL_X.cant,    w: COL.cant,    align: 'right'  },
    { label: 'UNI',         x: COL_X.uni,     w: COL.uni,     align: 'center' },
    { label: 'P. UNIT.',    x: COL_X.pUnit,   w: COL.pUnit,   align: 'right'  },
    { label: 'P. TOTAL',    x: COL_X.pTotal,  w: COL.pTotal,  align: 'right'  },
    { label: 'T. ENTREGA',  x: COL_X.entrega, w: COL.entrega, align: 'center' },
  ];

  headers.forEach(({ label, x, w, align }) => {
    doc
      .font('Helvetica-Bold')
      .fontSize(6.5)
      .fillColor(C.PINK_TEXT)
      .text(label, x + 2, y + (TABLE_HEADER_H - 6.5) / 2,
        { width: w - 4, align, lineBreak: false });
  });

  // Vertical column dividers
  [
    COL_X.codigo, COL_X.codAlt, COL_X.desc, COL_X.cant,
    COL_X.uni, COL_X.pUnit, COL_X.pTotal, COL_X.entrega,
  ].forEach((dx) => {
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
function _calcRowHeight(doc, text, fs = 7.5) {
  doc.fontSize(fs);
  const h = doc.heightOfString(String(text || ''), { width: COL.desc - 8 });
  return Math.max(ROW_MIN_H, h + ROW_PADDING);
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
  const headerY  = y;            // Y of the first table header row
  y              = drawTableHeaderRow(doc, y);

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

  const dataStartY = y;  // Top of first data row (used for outer border)

  detalles.forEach((item, idx) => {
    const rowH = _calcRowHeight(doc, item.descripcion_item);

    // Page break guard
    if (y + rowH > PAGE_BREAK_Y) {
      // Draw the outer border for rows rendered so far on this page
      doc
        .rect(MARGIN, headerY, CW, y - headerY)
        .lineWidth(0.6)
        .strokeColor(C.BORDER_GRAY)
        .stroke();
      doc.addPage();
      drawFooter(doc, quotation);
      y = MARGIN + 8;
      y = drawTableHeaderRow(doc, y);
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

    const ty = y + (rowH - 7.5) / 2;  // Vertical centre for single-line cells

    // ITEM #
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(C.MID_GRAY)
      .text(String(idx + 1), COL_X.item + 2, ty,
        { width: COL.item - 4, align: 'center', lineBreak: false });

    // CÓDIGO (codigo_parte preferred; fallback to producto_codigo)
    const codigo = item.codigo_parte || item.producto_codigo || '—';
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(C.DARK_GRAY)
      .text(codigo, COL_X.codigo + 2, ty,
        { width: COL.codigo - 4, align: 'center', lineBreak: false });

    // CÓDIGO ALTERNATIVO — not yet stored in DB; renders placeholder
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(C.MID_GRAY)
      .text(item.codigo_alternativo || '—', COL_X.codAlt + 2, ty,
        { width: COL.codAlt - 4, align: 'center', lineBreak: false });

    // DESCRIPCIÓN — top-aligned, wraps
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(C.DARK_GRAY)
      .text(String(item.descripcion_item || '—'), COL_X.desc + 4, y + 5,
        { width: COL.desc - 8, lineBreak: true });

    // CANT. — right-aligned, es-BO format
    const qtyVal = parseFloat(item.cantidad);
    const qtyStr = Number.isInteger(qtyVal)
      ? String(qtyVal)
      : fmtNum(qtyVal);
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(C.DARK_GRAY)
      .text(qtyStr, COL_X.cant + 2, ty,
        { width: COL.cant - 4, align: 'right', lineBreak: false });

    // UNI
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(C.MID_GRAY)
      .text(item.unidad || 'UND', COL_X.uni + 1, ty,
        { width: COL.uni - 2, align: 'center', lineBreak: false });

    // PRECIO UNITARIO — right-aligned, es-BO
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(C.DARK_GRAY)
      .text(fmtPrice(item.precio_unitario, quotation.moneda), COL_X.pUnit + 2, ty,
        { width: COL.pUnit - 4, align: 'right', lineBreak: false });

    // PRECIO TOTAL — bold, right-aligned, es-BO
    doc
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .fillColor(C.DARK_GRAY)
      .text(fmtPrice(item.subtotal, quotation.moneda), COL_X.pTotal + 2, ty,
        { width: COL.pTotal - 4, align: 'right', lineBreak: false });

    // TIEMPO DE ENTREGA — not yet stored per line; renders placeholder
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(C.MID_GRAY)
      .text(item.tiempo_entrega || '—', COL_X.entrega + 2, ty,
        { width: COL.entrega - 4, align: 'center', lineBreak: false });

    // Vertical column dividers for this row
    [
      COL_X.codigo, COL_X.codAlt, COL_X.desc, COL_X.cant,
      COL_X.uni, COL_X.pUnit, COL_X.pTotal, COL_X.entrega,
    ].forEach((dx) => {
      doc
        .moveTo(dx, y)
        .lineTo(dx, y + rowH)
        .lineWidth(0.25)
        .strokeColor(C.BORDER_GRAY)
        .stroke();
    });

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

// ---------------------------------------------------------------------------
// drawTotalsAndConditions
// Full-width "SON:" line (amount-in-words) followed by a two-column block:
//   Left  (~55 % of CW): CONDICIONES DE LA OFERTA + DATOS BANCARIOS
//   Right (~45 % of CW): Subtotal row (if items exist) + navy TOTAL box
// ---------------------------------------------------------------------------
function drawTotalsAndConditions(doc, quotation, startY) {
  const detalles = Array.isArray(quotation.detalles) ? quotation.detalles : [];

  const computedTotal = detalles.reduce(
    (s, item) => s + parseFloat(item.subtotal || 0),
    0
  );
  const displayTotal = detalles.length > 0
    ? computedTotal
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

  const condiciones = [
    ['Tiempo de entrega:', entregaStr],
    ['Forma de pago:',     '60% ANTICIPO Y SALDO CONTRA ENTREGA'],
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

  const bancoData = [
    ['Beneficiario:', 'ROCA IMPORTACIONES S.R.L.'],
    ['Entidad:',      'BANCO UNION S.A.'],
    ['Cuenta Cte:',   '1-000-00-66027513'],
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

// ---------------------------------------------------------------------------
// drawObservations
// Optional notes box.  Skipped entirely when observaciones is blank.
// ---------------------------------------------------------------------------
function drawObservations(doc, quotation, startY) {
  const notes = (quotation.observaciones || '').trim();
  if (!notes) return startY;

  let y = startY + 8;

  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(C.NAVY)
    .text('OBSERVACIONES', MARGIN, y, { lineBreak: false });
  doc
    .moveTo(MARGIN, y + 12)
    .lineTo(PW - MARGIN, y + 12)
    .lineWidth(1)
    .strokeColor(C.ORANGE)
    .stroke();
  y += 18;

  doc.fontSize(7.5);
  const textH = doc.heightOfString(notes, { width: CW - 16 });
  const boxH  = Math.min(textH + 16, 80);

  doc
    .rect(MARGIN, y, CW, boxH)
    .fillAndStroke(C.LIGHT_GRAY, C.BORDER_GRAY);
  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(C.DARK_GRAY)
    .text(notes, MARGIN + 8, y + 8, {
      width:     CW - 16,
      height:    boxH - 16,
      ellipsis:  true,
      lineBreak: true,
    });

  return y + boxH + 10;
}

// ---------------------------------------------------------------------------
// drawFooter
// Fixed to the absolute bottom of each page.
// Corporate contact info block strictly right-aligned, as per verified specs.
// ---------------------------------------------------------------------------
function drawFooter(doc, quotation) {
  const FOOTER_H = 38;
  const footerY  = PH - FOOTER_H;

  // Orange top accent stripe (3 pt)
  doc.rect(0, footerY - 3, PW, 3).fill(C.ORANGE);

  // Navy footer background
  doc.rect(0, footerY, PW, FOOTER_H).fill(C.NAVY);

  // Left: generation timestamp
  const generatedAt = new Date().toLocaleString('es-BO', {
    timeZone:  'America/La_Paz',
    dateStyle: 'long',
    timeStyle: 'short',
  });
  doc
    .font('Helvetica')
    .fontSize(6.5)
    .fillColor('#A0AEC0')
    .text(`Generado: ${generatedAt}`, MARGIN, footerY + 8, { lineBreak: false });

  // Centre: correlativo reference
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(C.WHITE)
    .text(quotation.numero_correlativo || '',
      0, footerY + 8, { width: PW, align: 'center', lineBreak: false });

  // Right: corporate contact block (verified specs)
  doc
    .font('Helvetica')
    .fontSize(6.5)
    .fillColor('#CBD5E0')
    .text('79855624 - 72182960  |  rctractoparts@gmail.com',
      MARGIN, footerY + 8,
      { width: CW, align: 'right', lineBreak: false });

  doc
    .font('Helvetica')
    .fontSize(5.5)
    .fillColor('#718096')
    .text(
      'Av. Cristóbal de Mendoza 2do Anillo, Edif. Adventura Local #23 — Santa Cruz - Bolivia',
      MARGIN, footerY + 19,
      { width: CW, align: 'right', lineBreak: false });

  doc
    .font('Helvetica')
    .fontSize(6)
    .fillColor('#718096')
    .text('Documento confidencial — RC Tractoparts',
      MARGIN, footerY + 28,
      { width: CW, align: 'right', lineBreak: false });
}

// =============================================================================
// Public API
// =============================================================================

// ---------------------------------------------------------------------------
// generateQuotationPdf
// Receives the full quotation object (QuotationModel.findById — with .detalles[]),
// orchestrates the layout sections, writes the file to disk and resolves with
// the relative file path once the WriteStream 'finish' event fires.
//
// @param   {Object} quotation  Full quotation including .detalles[]
// @returns {Promise<string>}   Relative path to the written PDF file
// ---------------------------------------------------------------------------
async function generateQuotationPdf(quotation) {
  return new Promise((resolve, reject) => {
    try {
      // 1. Resolve output directory
      const uploadDir = path.resolve(
        process.cwd(),
        process.env.UPLOAD_DIR || 'uploads/cotizaciones'
      );
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const filename     = `${quotation.numero_correlativo}-${Date.now()}.pdf`;
      const absolutePath = path.join(uploadDir, filename);
      const relativePath = path.join(
        process.env.UPLOAD_DIR || 'uploads/cotizaciones',
        filename
      );

      // 2. Initialise PDFKit document
      const doc = new PDFDocument({
        size:          'A4',
        autoFirstPage: true,
        margins:       { top: MARGIN, bottom: MARGIN + 45, left: MARGIN, right: MARGIN },
        info: {
          Title:    `Cotización ${quotation.numero_correlativo}`,
          Author:   'RC Tractoparts — Sistema de Gestión de Cotizaciones',
          Subject:  'Proforma Repuestos',
          Keywords: `cotización, proforma, rc tractoparts, ${quotation.numero_correlativo}`,
          Creator:  'RC Tractoparts SGC v3.0',
        },
        compress: true,
      });

      // 3. Pipe to write stream — resolve/reject driven by stream events
      const writeStream = fs.createWriteStream(absolutePath);
      doc.pipe(writeStream);
      writeStream.on('finish', () => resolve(relativePath));
      writeStream.on('error',  (err) => reject(err));

      // 4. Render layout sections top-to-bottom
      // Header, subtitle, and 3-col grid are drawn first so the watermark
      // (painted next) stays visually inside the items table area.
      let y = drawHeader(doc, quotation);
      y     = drawSubtitle(doc, y);
      y     = drawThreeColumnGrid(doc, quotation, y);

      // Watermark is painted HERE — after the top sections (which stay clean)
      // but before the items table rows so all line-item text renders on top
      // (PDFKit draws in painter's order).  tableBodyY is passed so the stamp
      // is centred dynamically within the items block, not at the page centre.
      renderWatermark(doc, quotation, y + 42);  // +42 accounts for table title + header row

      y     = drawItemsTable(doc, quotation, y);
      y     = drawTotalsAndConditions(doc, quotation, y);
      /* y = */ drawObservations(doc, quotation, y);

      // Footer is painted at a fixed absolute Y — not part of the flow
      drawFooter(doc, quotation);

      // 5. Finalise — triggers 'finish' on the write stream
      doc.end();

    } catch (layoutError) {
      reject(layoutError);
    }
  });
}

module.exports = { generateQuotationPdf };

