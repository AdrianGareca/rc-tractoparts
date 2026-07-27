// =============================================================================
// src/services/pdf/constants.js
// Paleta, geometría de página y layout de la tabla de ítems de la proforma.
//
// Extraído de pdfService.js sin cambios de valores.
// Cubierto por tests/unit/pdfLayout.test.js.
// =============================================================================

'use strict';

const path = require('path');

// =============================================================================
// Asset paths — resolved relative to this file's directory
// =============================================================================

const ASSETS_DIR  = path.join(__dirname, '..', '..', 'assets', 'images');
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
  TABLE_HEADER: '#1B2B4B',  // Items table header background (navy, matches NAVY)
  TABLE_HEADER_TEXT: '#FFFFFF', // Items table header text (white on navy)
  ALT_ROW:     '#F7F8FA',   // Alternating row tint inside the items table
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
    codAlt: showCodigo ? 52 : 0,
    desc:   showCodigo ? 130 : 230,   // DESCRIPCIÓN absorbs CÓDIGO + CÓD. ALT. widths when hidden
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

module.exports = {
  ASSETS_DIR, LOGO_PATH, BRANDS_DIR, BRAND_DEFS,
  C,
  PW, PH, MARGIN, CW,
  buildItemLayout,
  TABLE_HEADER_H, ROW_MIN_H, ROW_PADDING, PAGE_BREAK_Y,
};
