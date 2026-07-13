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
    'Confirmada':            '#059669',
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

// buildItemLayout — computes per-quotation column widths and left-edge X
// positions for the items table. When `showCodigo` is false the CÓDIGO column
// collapses to zero width and its 48 pt are absorbed by DESCRIPCIÓN so the
// layout shifts gracefully instead of leaving a gap. Widths always sum to CW.
function buildItemLayout(showCodigo) {
  const w = {
    item:   20,
    codigo: showCodigo ? 48 : 0,
    codAlt: 52,
    desc:   showCodigo ? 130 : 178,   // DESCRIPCIÓN absorbs CÓDIGO's width when hidden
    cant:   26,
    uni:    26,
    pUnit:  62,
    pTotal: 62,
  };
  // Last column (T. ENTREGA) absorbs the remainder to prevent rounding gaps.
  w.entrega = parseFloat(
    (CW - (w.item + w.codigo + w.codAlt + w.desc + w.cant + w.uni + w.pUnit + w.pTotal)).toFixed(2)
  );

  const x = {};
  let cur = MARGIN;
  for (const [k, width] of Object.entries(w)) {
    x[k] = cur;
    cur += width;
  }

  return { w, x, showCodigo };
}

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
//
// src/config/db.js sets `timezone: '+00:00'`, so mysql2 returns DATE/DATETIME
// columns as JS Date objects representing a UTC instant. Reading those with
// LOCAL getters (getDate/getMonth/getFullYear) shifts the printed date by a
// day whenever the Node process runs in a timezone behind UTC (a midnight-UTC
// value rolls back to the previous local day). Date objects must therefore
// always be read with the UTC getters. Plain 'YYYY-MM-DD' strings are parsed
// directly from their components instead of round-tripping through Date, so
// the result never depends on the process's local timezone at all.
// ---------------------------------------------------------------------------
function formatDate(v) {
  if (!v) return '—';

  if (typeof v === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (match) {
      const [, yyyy, mm, dd] = match;
      return `${dd}/${mm}/${yyyy}`;
    }
    v = new Date(v);
  }

  const d = v;
  if (isNaN(d.getTime())) return String(v);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
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
// drawLogoWatermark
// Paints the RC Tractoparts logo image (or text fallback) as a full-page
// centred watermark at near-invisible opacity.  Call once per page, BEFORE
// any other content so every element renders on top (painter's order).
// @param {PDFDocument} doc
// ---------------------------------------------------------------------------
function drawLogoWatermark(doc) {
  if (!fs.existsSync(LOGO_PATH)) {
    // Text fallback — large, centred, ultra-faint
    doc.save();
    doc.opacity(0.05);
    doc
      .font('Helvetica-Bold')
      .fontSize(72)
      .fillColor(C.NAVY)
      .text('RC TRACTOPARTS', MARGIN, PH / 2 - 36,
        { width: CW, align: 'center', lineBreak: false });
    doc.restore();
    return;
  }
  const WM_SIZE = 260;   // pt — large but subtly transparent
  const wx      = (PW - WM_SIZE) / 2;
  const wy      = (PH - WM_SIZE) / 2;
  doc.save();
  doc.opacity(0.06);     // 6% — visible branding, zero legibility impact
  doc.image(LOGO_PATH, wx, wy, {
    fit:    [WM_SIZE, WM_SIZE],
    align:  'center',
    valign: 'center',
  });
  doc.restore();
}

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
  // Only stamp when the quotation has been formally approved or accepted.
  // The legacy 'CONFIRMADO' guard is removed — the DB uses canonical Spanish state names.
  const shouldStamp = estado === 'APROBADA INTERNAMENTE'
    || estado === 'CONFIRMADA'
    || estado === 'ACEPTADA'
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
// normalizeEntidad
// Resolves the issuing-entity string for display. Empty/blank values fall back
// to the primary legal name, and the LEGACY value "RC Tractoparts" (stored on
// pre-rename records) is mapped gracefully to the current legal name so old
// quotations print the correct header without any data migration.
//
// @param   {string|null|undefined} raw  quotation.entidad_emisora
// @returns {string}
// ---------------------------------------------------------------------------
const PRIMARY_ENTIDAD = 'Empresa unipersonal de Ronald Roca Cartagena';
function normalizeEntidad(raw) {
  const value = (raw && String(raw).trim()) || PRIMARY_ENTIDAD;
  return value === 'RC Tractoparts' ? PRIMARY_ENTIDAD : value;
}

// ---------------------------------------------------------------------------
// Bank-account resolution (dynamic per issuing entity)
//
// BANK_ACCOUNTS holds the canonical DATOS BANCARIOS for each issuing entity.
// It is the resilient FALLBACK used when the DB-provided bank fields are absent
// (e.g. before the cuentas_bancarias migration is applied on a given
// environment) — mirroring the graceful-degradation approach used elsewhere in
// the codebase. Keys are the canonical entidad_emisora values produced by
// normalizeEntidad().
// ---------------------------------------------------------------------------
const BANK_ACCOUNTS = {
  'Empresa unipersonal de Ronald Roca Cartagena': {
    beneficiario: 'Ronald Roca Cartagena',
    banco:        'BANCO UNIÓN S.A.',
    cuenta:       '10000060054760',
  },
  'Roca Importaciones S.R.L.': {
    beneficiario: 'ROCA IMPORTACIONES S.R.L.',
    banco:        'BANCO UNION S.A.',
    cuenta:       '1-000-00-66027513',
  },
};

// ---------------------------------------------------------------------------
// resolveBankData
// Returns the { beneficiario, banco, cuenta } to print in the DATOS BANCARIOS
// block. DB-provided fields (attached by QuotationModel.findById from the
// cuentas_bancarias table) take precedence; otherwise the built-in
// BANK_ACCOUNTS map keyed by the normalized issuing entity is used.
// ---------------------------------------------------------------------------
function resolveBankData(quotation) {
  if (quotation.banco_beneficiario || quotation.banco_nombre || quotation.banco_cuenta) {
    return {
      beneficiario: quotation.banco_beneficiario || '—',
      banco:        quotation.banco_nombre       || '—',
      cuenta:       quotation.banco_cuenta        || '—',
    };
  }
  const entidad = normalizeEntidad(quotation.entidad_emisora);
  return BANK_ACCOUNTS[entidad] || BANK_ACCOUNTS[PRIMARY_ENTIDAD];
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

// ---------------------------------------------------------------------------
// drawBrandStrip
// Full-width partner-brand row. Each brand occupies an equal-width slot
// (flexbox "space-between" equivalent).
//
// DUPLICATED-LOGO FIX:
//   The previous implementation used `doc.image(path, x, y, { fit, align,
//   valign })`. The combination of `fit` with `align/valign` made certain
//   wide PNGs (notably John Deere and CAT) render duplicated / tiled inside
//   their slot. The robust fix is to NOT rely on `fit`+alignment at all:
//   we open each image once, compute the EXACT contained width/height that
//   preserves the original aspect ratio (object-fit: contain, by hand), then
//   issue a SINGLE doc.image() call with explicit { width, height }. Exact
//   dimensions + one draw call = no scaling ambiguity and no tiling artifacts.
// Returns Y immediately below the strip.
// ---------------------------------------------------------------------------
function drawBrandStrip(doc, startY) {
  const STRIP_H  = 30;                       // uniform max height for every logo
  const SLOT_PAD = 8;                        // horizontal breathing room per slot
  const slotW    = CW / BRAND_DEFS.length;   // ≈ 87.2 pt — equal slots
  const maxImgW  = slotW - SLOT_PAD * 2;     // max width available inside a slot

  // Hairline rule above the strip to separate it from the header block
  doc
    .moveTo(MARGIN, startY)
    .lineTo(PW - MARGIN, startY)
    .lineWidth(0.4)
    .strokeColor(C.BORDER_GRAY)
    .stroke();

  const rowY = startY + 6;

  BRAND_DEFS.forEach(({ file, label }, i) => {
    const slotX   = MARGIN + i * slotW;
    const imgPath = path.join(BRANDS_DIR, file);

    if (fs.existsSync(imgPath)) {
      // Open the image once to read its intrinsic pixel dimensions.
      const img   = doc.openImage(imgPath);
      const ratio = img.width / img.height;

      // object-fit: contain — scale to the uniform max height, then clamp the
      // width so ultra-wide logos (e.g. Komatsu 5:1) never spill past the slot.
      let drawH = STRIP_H;
      let drawW = drawH * ratio;
      if (drawW > maxImgW) {
        drawW = maxImgW;
        drawH = drawW / ratio;
      }

      // Centre the (correctly proportioned) image inside its slot.
      const drawX = slotX + (slotW - drawW) / 2;
      const drawY = rowY  + (STRIP_H - drawH) / 2;

      // Exactly one draw call, with explicit aspect-correct width AND height.
      doc.image(img, drawX, drawY, { width: drawW, height: drawH });
    } else {
      // Text fallback when an image asset is not yet deployed
      doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor(C.NAVY)
        .text(label, slotX, rowY + (STRIP_H - 8) / 2,
          { width: slotW, align: 'center', lineBreak: false });
    }
  });

  return rowY + STRIP_H + 6;
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

// ---------------------------------------------------------------------------
// drawTableHeaderRow
// Renders the light-pink column-header row for the items table.
// Re-called on each new page after a page break.
// Returns Y immediately below the header row.
// ---------------------------------------------------------------------------
function drawTableHeaderRow(doc, y, layout) {
  // Pink/pastel background fill
  doc.rect(MARGIN, y, CW, TABLE_HEADER_H).fill(C.PINK_HEADER);
  // Outer border stroke
  doc
    .rect(MARGIN, y, CW, TABLE_HEADER_H)
    .lineWidth(0.6)
    .strokeColor(C.BORDER_GRAY)
    .stroke();

  // Column set — the CÓDIGO header is included only when the layout shows it.
  const headers = [
    { key: 'item',    label: 'ITEM',        align: 'center' },
    ...(layout.showCodigo ? [{ key: 'codigo', label: 'CÓDIGO', align: 'center' }] : []),
    { key: 'codAlt',  label: 'CÓD. ALT.',   align: 'center' },
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
      .fillColor(C.PINK_TEXT)
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

    // CÓDIGO ALTERNATIVO — not yet stored in DB; renders placeholder
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(C.MID_GRAY)
      .text(item.codigo_alternativo || '—', layout.x.codAlt + 2, ty,
        { width: layout.w.codAlt - 4, align: 'center', lineBreak: false });

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
    ['codAlt', 'desc', 'cant', 'uni', 'pUnit', 'pTotal', 'entrega']
      .concat(layout.showCodigo ? ['codigo'] : [])
      .forEach((key) => {
        const dx = layout.x[key];
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
  // Page-break guard: the SON line + conditions/bank/total block needs
  // ~150 pt. If the items table ended too low, PDFKit's auto page-break
  // would fire mid-block on a doc.text() call — scattering labels onto a
  // phantom page while the rects/lines stay behind. Start the whole block
  // on a fresh page instead.
  if (startY > PH - 240) {
    doc.addPage();
    drawLogoWatermark(doc);
    drawFooter(doc, quotation);
    startY = MARGIN;
  }

  const detalles = Array.isArray(quotation.detalles) ? quotation.detalles : [];

  // Subtotal = sum of line-item subtotals. Prices are already tax-inclusive,
  // so there is NO added IVA row: the subtotal equals the total unless a manual
  // cash discount applies.
  const computedTotal = detalles.reduce(
    (s, item) => s + parseFloat(item.subtotal || 0),
    0
  );

  // Manual cash discount (descuento_manual) — an absolute amount subtracted
  // directly from the subtotal, mirroring the server-side monto_total math.
  const discount    = quotation.descuento_manual != null ? parseFloat(quotation.descuento_manual) : 0;
  const hasDiscount = detalles.length > 0 && discount > 0;

  const displayTotal = detalles.length > 0
    ? Math.max(0, computedTotal - discount)
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

  // Forma de pago: use the per-quotation value (forma_pago) when supplied,
  // otherwise fall back to the historical default advance-payment condition.
  const formaPagoStr = (quotation.forma_pago && String(quotation.forma_pago).trim())
    || '60% ANTICIPO Y SALDO CONTRA ENTREGA';

  const condiciones = [
    ['Tiempo de entrega:', entregaStr],
    ['Forma de pago:',     formaPagoStr],
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

  // Dynamic per issuing entity (ENTIDAD EMISORA): the unipersonal entity prints
  // its personal account; the S.R.L. entity prints the corporate account.
  const banco = resolveBankData(quotation);
  const bancoData = [
    ['Beneficiario:', banco.beneficiario],
    ['Entidad:',      banco.banco],
    ['Cuenta Cte:',   banco.cuenta],
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

  // Manual discount row (only when a positive descuento_manual is set). Shown
  // as a negative amount in orange so it reads clearly as a deduction that
  // subtracts from the subtotal to yield the TOTAL below.
  if (hasDiscount) {
    doc.rect(RIGHT_X, ry, RIGHT_W, 18).fill(C.WHITE);
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(C.MID_GRAY)
      .text('Descuento:', RIGHT_X + 6, ry + 5,
        { width: RIGHT_W / 2 - 6, lineBreak: false });
    doc
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .fillColor(C.ORANGE)
      .text(`- ${fmtPrice(discount, quotation.moneda)}`,
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

  // Measure the box BEFORE drawing so the page-break guard can decide
  // whether the title + box still fit above the fixed footer.
  doc.font('Helvetica').fontSize(7.5);
  const textH = doc.heightOfString(notes, { width: CW - 16 });
  const boxH  = Math.min(textH + 16, 80);

  // Page-break guard — same rationale as drawTotalsAndConditions: a
  // doc.text() past the bottom margin triggers PDFKit's auto page-break
  // mid-section, splitting the notes from their box.
  if (startY + 8 + 18 + boxH > PH - MARGIN - 50) {
    doc.addPage();
    drawLogoWatermark(doc);
    drawFooter(doc, quotation);
    startY = MARGIN - 8; // so y = startY + 8 lands exactly on MARGIN
  }

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
//
// IMPORTANT: text is drawn below the normal content area (footerY ≈ 804 pt on
// A4).  PDFKit triggers an auto-page-break when doc.text() is called at a Y
// position past (page height − bottom margin).  We zero the bottom margin
// before drawing and restore it afterward so no phantom extra pages appear.
// ---------------------------------------------------------------------------
function drawFooter(doc, quotation) {
  const FOOTER_H = 38;
  const footerY  = PH - FOOTER_H;

  // Save and zero the bottom margin so text at absolute footer coordinates
  // (804–832 pt) cannot trigger PDFKit's auto-page-break logic.
  const savedBottomMargin = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;

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
      'Av. El Trompillo 2do Anillo, Edif. Torre Empresarial Los Laureles, Piso 9. Santa Cruz - Bolivia.',
      MARGIN, footerY + 19,
      { width: CW, align: 'right', lineBreak: false });

  doc
    .font('Helvetica')
    .fontSize(6)
    .fillColor('#718096')
    .text('Documento confidencial — RC Tractoparts',
      MARGIN, footerY + 28,
      { width: CW, align: 'right', lineBreak: false });

  // Restore the bottom margin so subsequent content flow is unaffected.
  doc.page.margins.bottom = savedBottomMargin;
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
// ⚠️  DEPLOYMENT / STORAGE RISK — EPHEMERAL FILESYSTEM
// ---------------------------------------------------------------------------
// This function PERSISTS the generated PDF to the server's LOCAL DISK
// (uploads/cotizaciones) via fs.createWriteStream and stores only the relative
// path in the DB (cotizaciones.pdf_ruta). On ephemeral-filesystem platforms
// (Render, Heroku, most container PaaS), the local disk is WIPED on every
// deploy, restart, or dyno recycle — so previously generated PDFs (and the
// uploaded Excel files handled by quotationPdfController.uploadFiles) will
// silently 404 after a restart even though pdf_ruta/excel_ruta still point at
// them. PLANNED ARCHITECTURE CHANGE: stream the PDF straight to the HTTP
// response as a Buffer for downloads and/or offload persistence to durable
// object storage (S3, Cloudflare R2, GCS) instead of the local FS.
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

      // numero_correlativo formats like "SC-2026/000692" contain a '/', which
      // path.join() (and the OS) would interpret as a subdirectory separator,
      // making fs.createWriteStream fail with ENOENT (target dir doesn't exist).
      // Sanitize to a filesystem-safe stem before building the filename.
      const safeCorrelativo = String(quotation.numero_correlativo || `COT-${quotation.id}`)
        .replace(/[^\w\-]/g, '_');
      const filename     = `${safeCorrelativo}-${Date.now()}.pdf`;
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
      // Logo watermark is painted FIRST so every subsequent element sits on
      // top of it (PDFKit uses painter's order: last draw = topmost layer).
      drawLogoWatermark(doc);

      // Header, subtitle, and 3-col grid are drawn first so the APROBADO
      // watermark stamp (painted next) stays visually inside the items table.
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

// ---------------------------------------------------------------------------
// purgeQuotationPdf
// Physically deletes a previously generated/stored PDF from disk so that a
// quotation never accumulates more than ONE physical file across its lifecycle.
//
// Call this with the EXISTING pdf_ruta (as stored in the DB) BEFORE generating
// the replacement PDF for a new state. The path is resolved relative to the
// process CWD — exactly how generateQuotationPdf() and downloadPdf() resolve it.
//
// Idempotent and non-throwing by contract: a null/blank path, or a file that is
// already gone (ENOENT), resolves quietly to `false`. Any other unexpected
// error is swallowed and logged, never propagated — purging is a best-effort
// housekeeping step that must never roll back a committed state transition.
//
// @param   {string|null} relativePath  pdf_ruta value from the DB
// @returns {Promise<boolean>}           true if a file was actually deleted
// ---------------------------------------------------------------------------
async function purgeQuotationPdf(relativePath) {
  if (!relativePath || typeof relativePath !== 'string' || !relativePath.trim()) {
    return false;
  }

  const absolutePath = path.resolve(process.cwd(), relativePath);

  try {
    await fs.promises.unlink(absolutePath);
    return true;
  } catch (err) {
    // ENOENT — the file is already absent, which satisfies the invariant.
    if (err.code !== 'ENOENT') {
      console.warn(
        `[pdfService.purgeQuotationPdf] Could not delete old PDF '${absolutePath}' (non-fatal):`,
        err.message
      );
    }
    return false;
  }
}

module.exports = { generateQuotationPdf, purgeQuotationPdf };

