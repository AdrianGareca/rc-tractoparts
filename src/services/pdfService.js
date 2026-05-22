// =============================================================================
// src/services/pdfService.js
// Automated PDF Generation Service — RC Tractoparts Proforma Invoices
//
// Generates a corporate-branded PDF for a quotation record using PDFKit.
// The service receives the full quotation object (already fetched from the DB,
// including the .detalles[] array) and writes a formatted A4 document to disk.
//
// The public API is a single async function that wraps PDFKit's event-driven
// stream in a Promise, resolving only when the 'finish' event fires on the
// underlying WriteStream — guaranteeing the file is completely flushed to disk
// before the caller persists the path in the database.
//
// Dependency: pdfkit — install with: npm install pdfkit
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

// =============================================================================
// Design constants
// =============================================================================

// ---------------------------------------------------------------------------
// Corporate color palette — RC Tractoparts (Heavy Machinery Import)
// Dark Slate Navy + Burnt Orange convey industrial authority and precision.
// ---------------------------------------------------------------------------
const C = {
  NAVY:        '#1B2B4B',  // Primary: header banner, table header row, footer
  NAVY_LIGHT:  '#253A5E',  // Logo placeholder box fill
  NAVY_MID:    '#2D4A72',  // Table column dividers on dark backgrounds
  ORANGE:      '#C85A0F',  // Accent: accent bar, total label, highlight
  WHITE:       '#FFFFFF',  // Text on dark backgrounds
  LIGHT_GRAY:  '#F7F8FA',  // Alternating table row fill, info box backgrounds
  DARK_GRAY:   '#2D3748',  // Primary body text
  MID_GRAY:    '#718096',  // Labels, row numbers, secondary text
  BORDER_GRAY: '#E2E8F0',  // Table borders, section dividers
  BLUE_GRAY:   '#A0AEC0',  // Muted text in the footer
  STEEL:       '#CBD5E0',  // Contact details in the header
  // Status badge background colors — one per state in the state machine
  STATUS: {
    'Pendiente':             '#6B7280',  // neutral gray
    'En revision':           '#D97706',  // amber
    'Aprobada internamente': '#059669',  // emerald green
    'Enviada al cliente':    '#2563EB',  // blue
    'Aceptada':              '#059669',  // emerald green
    'Rechazada':             '#DC2626',  // red
    'Archivada':             '#6B7280',  // neutral gray
  },
};

// ---------------------------------------------------------------------------
// Page geometry — A4 size in PostScript points (1 pt = 1/72 inch)
// ---------------------------------------------------------------------------
const PW     = 595.28;            // A4 page width in points
const PH     = 841.89;            // A4 page height in points
const MARGIN = 45;                // Uniform margin applied to all four sides
const CW     = PW - MARGIN * 2;  // Usable content width: 505.28 pt

// ---------------------------------------------------------------------------
// Table column widths — must sum exactly to CW (505.28 pt)
// The subtotal column absorbs the remainder to avoid rounding gaps.
// ---------------------------------------------------------------------------
const COL = {
  num:       28,                          // Row counter (#)
  qty:       48,                          // Quantity
  desc:      225,                         // Item description (wrappable)
  unitPrice: 97,                          // Unit price (right-aligned)
  subtotal:  CW - 28 - 48 - 225 - 97,    // 107.28 pt — Subtotal (right-aligned)
};

// X position of each column's left edge (pre-computed for reuse)
const COL_X = {
  num:       MARGIN,
  qty:       MARGIN + COL.num,
  desc:      MARGIN + COL.num + COL.qty,
  unitPrice: MARGIN + COL.num + COL.qty + COL.desc,
  subtotal:  MARGIN + COL.num + COL.qty + COL.desc + COL.unitPrice,
};

// Row height constants
const TABLE_HEADER_H = 22;  // Fixed height of the column-header row
const ROW_MIN_H      = 22;  // Minimum height for any data row (short descriptions)
const ROW_PADDING    = 10;  // Top + bottom padding applied to each cell's text

// Y threshold below which a new page is inserted to protect the footer
const PAGE_BREAK_THRESHOLD = PH - MARGIN - 75;

// =============================================================================
// Utility helpers
// =============================================================================

// ---------------------------------------------------------------------------
// formatCurrency
// Formats a numeric amount with the appropriate currency symbol and two
// decimal places using US-locale number formatting for the digit groups.
// ---------------------------------------------------------------------------
function formatCurrency(amount, moneda) {
  if (amount == null || isNaN(parseFloat(amount))) return '—';

  const formatted = parseFloat(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return moneda === 'BOB' ? `Bs. ${formatted}` : `$ ${formatted}`;
}

// ---------------------------------------------------------------------------
// formatDate
// Converts a MySQL DATE string (YYYY-MM-DD) or Date object to DD/MM/YYYY.
// Appends 'T00:00:00' before parsing to prevent timezone shifting on
// midnight-boundary dates when running in UTC environments.
// ---------------------------------------------------------------------------
function formatDate(dateVal) {
  if (!dateVal) return '—';

  const d = typeof dateVal === 'string'
    ? new Date(`${dateVal}T00:00:00`)   // Prevent UTC-midnight drift
    : new Date(dateVal);

  if (isNaN(d.getTime())) return String(dateVal); // Fallback: return raw value

  const dd   = String(d.getDate()).padStart(2, '0');
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();

  return `${dd}/${mm}/${yyyy}`;
}

// ---------------------------------------------------------------------------
// hLine — Draw a horizontal rule across the full content width
// ---------------------------------------------------------------------------
function hLine(doc, y, color = C.BORDER_GRAY, lineWidth = 0.5) {
  doc
    .save()
    .moveTo(MARGIN, y)
    .lineTo(PW - MARGIN, y)
    .lineWidth(lineWidth)
    .strokeColor(color)
    .stroke()
    .restore();
}

// ---------------------------------------------------------------------------
// calcRowHeight
// Measures the pixel height a description string will occupy inside its
// column at the given font size, then adds padding to produce the full row
// height. Returns at least ROW_MIN_H to keep short rows readable.
// ---------------------------------------------------------------------------
function calcRowHeight(doc, descriptionText, fontSize = 8.5) {
  const innerWidth = COL.desc - ROW_PADDING; // Subtract cell padding from column width
  doc.fontSize(fontSize);
  const textH = doc.heightOfString(String(descriptionText || ''), { width: innerWidth });
  return Math.max(ROW_MIN_H, textH + ROW_PADDING);
}

// ---------------------------------------------------------------------------
// drawVerticalDividers
// Renders thin vertical separator lines between table columns for the height
// of a single row. Called by both the header row and each data row.
// ---------------------------------------------------------------------------
function drawVerticalDividers(doc, rowY, rowH, color = C.BORDER_GRAY) {
  // The four X positions that separate the five columns
  const divX = [COL_X.qty, COL_X.desc, COL_X.unitPrice, COL_X.subtotal];

  divX.forEach((x) => {
    doc
      .save()
      .moveTo(x, rowY)
      .lineTo(x, rowY + rowH)
      .lineWidth(0.4)
      .strokeColor(color)
      .stroke()
      .restore();
  });
}

// =============================================================================
// Section drawers
// Each function receives the PDFDocument and the current Y position,
// renders its content, and returns the new Y position after its bottom edge.
// =============================================================================

// ---------------------------------------------------------------------------
// drawHeader
// Navy banner across the full page width (bleeds to page edges, ignoring
// margins). Left side carries company identity text; right side contains
// a logo placeholder box ready to swap for an actual image asset.
// ---------------------------------------------------------------------------
function drawHeader(doc) {
  const BANNER_H = 92;  // Height of the navy background rectangle

  // Full-bleed navy background (x=0, not MARGIN)
  doc
    .rect(0, 0, PW, BANNER_H)
    .fill(C.NAVY);

  // ── Company name ───────────────────────────────────────────────────────────
  doc
    .font('Helvetica-Bold')
    .fontSize(21)
    .fillColor(C.WHITE)
    .text('RC TRACTOPARTS', MARGIN, 16, { lineBreak: false });

  // ── Tagline / industry descriptor ─────────────────────────────────────────
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(C.BLUE_GRAY)
    .text(
      'Importaciones de Maquinaria Pesada y Repuestos',
      MARGIN, 41,
      { lineBreak: false }
    );

  // ── Contact line 1 ────────────────────────────────────────────────────────
  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(C.STEEL)
    .text(
      'Santa Cruz de la Sierra, Bolivia  |  Tel: +591 3 000-0000  |  info@rctractoparts.com',
      MARGIN, 54,
      { lineBreak: false }
    );

  // ── Contact line 2 ────────────────────────────────────────────────────────
  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(C.STEEL)
    .text('www.rctractoparts.com', MARGIN, 67, { lineBreak: false });

  // ── Logo placeholder ──────────────────────────────────────────────────────
  const LOGO_X = PW - MARGIN - 98;
  const LOGO_Y = 10;
  const LOGO_W = 98;
  const LOGO_H = 72;

  // Placeholder box with a slightly lighter navy fill + border
  doc
    .rect(LOGO_X, LOGO_Y, LOGO_W, LOGO_H)
    .fillAndStroke(C.NAVY_LIGHT, C.NAVY_MID);

  // Horizontal rule inside the placeholder to suggest an image frame
  doc
    .moveTo(LOGO_X + 12, LOGO_Y + LOGO_H / 2)
    .lineTo(LOGO_X + LOGO_W - 12, LOGO_Y + LOGO_H / 2)
    .lineWidth(0.5)
    .strokeColor('#3B5278')
    .stroke();

  // "LOGOTIPO" label centered inside the box
  doc
    .font('Helvetica')
    .fontSize(7)
    .fillColor(C.MID_GRAY)
    .text('LOGOTIPO', LOGO_X, LOGO_Y + LOGO_H / 2 + 5, {
      width:     LOGO_W,
      align:     'center',
      lineBreak: false,
    });

  // ── Accent bar — orange stripe below the navy banner ──────────────────────
  doc
    .rect(0, BANNER_H, PW, 4)
    .fill(C.ORANGE);

  return BANNER_H + 4; // Y position immediately below the accent bar
}

// ---------------------------------------------------------------------------
// drawMetadataAndClient
// Two-column block. Left column: client details. Right column: quotation
// metadata (serial, dates, currency, estado badge).
// Both columns share the same background box height for visual alignment.
// ---------------------------------------------------------------------------
function drawMetadataAndClient(doc, quotation, startY) {
  const TOP    = startY + 14;
  const COL_W  = (CW - 14) / 2;  // Each column is half the content width, 14pt gap
  const LEFT_X = MARGIN;
  const RIGHT_X = MARGIN + COL_W + 14;

  // ── Document type heading ─────────────────────────────────────────────────
  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .fillColor(C.NAVY)
    .text('PROFORMA / COTIZACIÓN COMERCIAL', MARGIN, TOP, { lineBreak: false });

  const BOX_TOP = TOP + 22;   // Top of the info boxes, below the heading
  const BOX_H   = 118;        // Height of both info boxes

  // ── RIGHT COLUMN: quotation metadata ─────────────────────────────────────

  // Box background
  doc
    .rect(RIGHT_X, BOX_TOP, COL_W, BOX_H)
    .fillAndStroke(C.LIGHT_GRAY, C.BORDER_GRAY);

  // Box header bar (navy)
  doc
    .rect(RIGHT_X, BOX_TOP, COL_W, 22)
    .fill(C.NAVY);

  doc
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .fillColor(C.WHITE)
    .text('DATOS DE LA COTIZACIÓN', RIGHT_X + 8, BOX_TOP + 7, { lineBreak: false });

  // Metadata rows: label (bold, muted) + value (regular, dark)
  const LABEL_W = 88;
  const metaRows = [
    ['N° Correlativo:', quotation.numero_correlativo || '—'],
    ['Fecha de emisión:', formatDate(quotation.fecha_emision)],
    [
      'Fecha de validez:',
      quotation.fecha_validez ? formatDate(quotation.fecha_validez) : 'Sin vencimiento',
    ],
    ['Moneda:', quotation.moneda === 'BOB' ? 'BOB — Bolivianos' : 'USD — Dólares'],
  ];

  let metaY = BOX_TOP + 29;

  metaRows.forEach(([label, value]) => {
    // Label
    doc
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .fillColor(C.MID_GRAY)
      .text(label, RIGHT_X + 8, metaY, { width: LABEL_W, lineBreak: false });

    // Value
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(C.DARK_GRAY)
      .text(value, RIGHT_X + 8 + LABEL_W, metaY, {
        width:     COL_W - LABEL_W - 16,
        lineBreak: false,
      });

    metaY += 14; // Advance to the next metadata row
  });

  // Status badge — colored pill at the bottom of the metadata box
  const statusColor = C.STATUS[quotation.estado] || C.MID_GRAY;

  doc
    .rect(RIGHT_X + 8, metaY + 2, COL_W - 16, 17)
    .fill(statusColor);

  doc
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .fillColor(C.WHITE)
    .text(
      `ESTADO: ${(quotation.estado || '').toUpperCase()}`,
      RIGHT_X + 8, metaY + 6,
      { width: COL_W - 16, align: 'center', lineBreak: false }
    );

  // ── LEFT COLUMN: client details ───────────────────────────────────────────

  doc
    .rect(LEFT_X, BOX_TOP, COL_W, BOX_H)
    .fillAndStroke(C.LIGHT_GRAY, C.BORDER_GRAY);

  doc
    .rect(LEFT_X, BOX_TOP, COL_W, 22)
    .fill(C.NAVY);

  doc
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .fillColor(C.WHITE)
    .text('CLIENTE / DESTINATARIO', LEFT_X + 8, BOX_TOP + 7, { lineBreak: false });

  // Static client fields
  const CLIENT_LABEL_W = 62;
  const clientFields = [
    ['Razón Social:', quotation.cliente_nombre   || '—'],
    ['NIT / CI:',    quotation.cliente_nit       || '—'],
    ['Ejecutivo:',   quotation.ejecutivo_nombre  || '—'],
  ];

  let clientY = BOX_TOP + 29;

  clientFields.forEach(([label, value]) => {
    doc
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .fillColor(C.MID_GRAY)
      .text(label, LEFT_X + 8, clientY, { width: CLIENT_LABEL_W, lineBreak: false });

    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(C.DARK_GRAY)
      .text(value, LEFT_X + 8 + CLIENT_LABEL_W, clientY, {
        width:     COL_W - CLIENT_LABEL_W - 16,
        lineBreak: false,
      });

    clientY += 16;
  });

  // Description field — may overflow into two lines
  doc
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .fillColor(C.MID_GRAY)
    .text('Descripción:', LEFT_X + 8, clientY, { lineBreak: false });

  clientY += 12;

  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(C.DARK_GRAY)
    .text(quotation.descripcion || '—', LEFT_X + 8, clientY, {
      width:     COL_W - 16,
      height:    26,        // Clamp to approximately 2 lines
      ellipsis:  true,
      lineBreak: true,
    });

  return BOX_TOP + BOX_H + 18; // Y below both columns + inter-section gap
}

// ---------------------------------------------------------------------------
// drawTableHeaderRow
// Renders the navy column header row and returns the Y position after it.
// Extracted as a standalone function so it can be re-called on new pages.
// ---------------------------------------------------------------------------
function drawTableHeaderRow(doc, y) {
  // Navy background for the header row
  doc
    .rect(MARGIN, y, CW, TABLE_HEADER_H)
    .fill(C.NAVY);

  // Column header labels — positioned and aligned per column
  const headers = [
    { label: '#',           x: COL_X.num,       w: COL.num,       align: 'center' },
    { label: 'CANT.',       x: COL_X.qty,       w: COL.qty,       align: 'center' },
    { label: 'DESCRIPCIÓN', x: COL_X.desc,      w: COL.desc,      align: 'left'   },
    { label: 'P. UNITARIO', x: COL_X.unitPrice, w: COL.unitPrice, align: 'right'  },
    { label: 'SUBTOTAL',    x: COL_X.subtotal,  w: COL.subtotal,  align: 'right'  },
  ];

  headers.forEach(({ label, x, w, align }) => {
    doc
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .fillColor(C.WHITE)
      .text(label, x + 4, y + 7, { width: w - 8, align, lineBreak: false });
  });

  // Vertical dividers between header cells (slightly lighter than the background)
  drawVerticalDividers(doc, y, TABLE_HEADER_H, C.NAVY_MID);

  return y + TABLE_HEADER_H; // Return Y immediately below the header row
}

// ---------------------------------------------------------------------------
// drawItemsTable
// Renders the full line-items grid. Each row's height is calculated
// dynamically from the description text to avoid overlap on long entries.
// Inserts a page break (with a repeated table header) when remaining page
// space is insufficient for the next row.
// ---------------------------------------------------------------------------
function drawItemsTable(doc, quotation, startY) {
  const detalles = Array.isArray(quotation.detalles) ? quotation.detalles : [];

  // ── Section title ──────────────────────────────────────────────────────────
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(C.NAVY)
    .text('DETALLE DE ÍTEMS COTIZADOS', MARGIN, startY, { lineBreak: false });

  // Orange underline beneath the section title
  doc
    .moveTo(MARGIN, startY + 13)
    .lineTo(PW - MARGIN, startY + 13)
    .lineWidth(1.2)
    .strokeColor(C.ORANGE)
    .stroke();

  let y = startY + 20;

  // Draw the initial column header row
  y = drawTableHeaderRow(doc, y);

  // ── Empty state ────────────────────────────────────────────────────────────
  if (detalles.length === 0) {
    doc
      .rect(MARGIN, y, CW, 28)
      .fill(C.LIGHT_GRAY);

    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(C.MID_GRAY)
      .text('Sin ítems registrados en esta cotización.', MARGIN, y + 9, {
        width: CW,
        align: 'center',
        lineBreak: false,
      });

    return y + 40; // Return Y with extra gap after the empty row
  }

  // ── Data rows ──────────────────────────────────────────────────────────────
  detalles.forEach((item, index) => {
    // Calculate row height from description text wrapping at the desc column width
    const rowH = calcRowHeight(doc, item.descripcion_item, 8.5);

    // Page break check: if the row won't fit, open a new page and re-draw header
    if (y + rowH > PAGE_BREAK_THRESHOLD) {
      doc.addPage();
      drawFooter(doc, quotation);          // Paint footer on the completed page
      y = MARGIN + 8;                      // Reset Y to the top of the new page
      y = drawTableHeaderRow(doc, y);      // Re-draw column headers
    }

    // Alternating row fill: even rows = white, odd rows = light gray
    const rowFill = index % 2 === 0 ? C.WHITE : C.LIGHT_GRAY;

    doc
      .rect(MARGIN, y, CW, rowH)
      .fill(rowFill);

    // Bottom border (thin) to visually separate rows
    doc
      .save()
      .moveTo(MARGIN, y + rowH)
      .lineTo(MARGIN + CW, y + rowH)
      .lineWidth(0.3)
      .strokeColor(C.BORDER_GRAY)
      .stroke()
      .restore();

    // Vertical center offset for single-line cells
    // (multi-line desc cells use their own top-aligned y + 6 offset)
    const cellTextY = y + (rowH - 8.5) / 2;

    // Cell: row number
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(C.MID_GRAY)
      .text(
        String(index + 1),
        COL_X.num + 4, cellTextY,
        { width: COL.num - 8, align: 'center', lineBreak: false }
      );

    // Cell: quantity (formatted to avoid unnecessary trailing zeros)
    const qtyValue = parseFloat(item.cantidad);
    const qtyDisplay = Number.isInteger(qtyValue)
      ? String(qtyValue)
      : qtyValue.toLocaleString('en-US', { maximumFractionDigits: 4 });

    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(C.DARK_GRAY)
      .text(
        qtyDisplay,
        COL_X.qty + 4, cellTextY,
        { width: COL.qty - 8, align: 'center', lineBreak: false }
      );

    // Cell: description — top-aligned, wraps naturally across multiple lines
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(C.DARK_GRAY)
      .text(
        String(item.descripcion_item || '—'),
        COL_X.desc + 5, y + 6,           // 5pt left padding, 6pt top padding
        { width: COL.desc - 10, lineBreak: true }
      );

    // Cell: unit price (right-aligned within column)
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(C.DARK_GRAY)
      .text(
        formatCurrency(item.precio_unitario, quotation.moneda),
        COL_X.unitPrice + 4, cellTextY,
        { width: COL.unitPrice - 8, align: 'right', lineBreak: false }
      );

    // Cell: subtotal (right-aligned, bold — draws the eye to line totals)
    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor(C.DARK_GRAY)
      .text(
        formatCurrency(item.subtotal, quotation.moneda),
        COL_X.subtotal + 4, cellTextY,
        { width: COL.subtotal - 8, align: 'right', lineBreak: false }
      );

    // Vertical column dividers for this row
    drawVerticalDividers(doc, y, rowH);

    y += rowH; // Advance to next row
  });

  // Outer border rectangle enclosing all data rows
  doc
    .rect(MARGIN, startY + 20 + TABLE_HEADER_H, CW, y - (startY + 20 + TABLE_HEADER_H))
    .lineWidth(0.8)
    .strokeColor(C.BORDER_GRAY)
    .stroke();

  return y + 14; // Return Y below the table with a small gap
}

// ---------------------------------------------------------------------------
// drawTotals
// Right-aligned totals block. Computes the grand total from line item
// subtotals when detalles are present; falls back to the stored monto_total
// for header-only quotations. The grand total row uses the navy + orange
// treatment to make it visually dominant.
// ---------------------------------------------------------------------------
function drawTotals(doc, quotation, startY) {
  const detalles   = Array.isArray(quotation.detalles) ? quotation.detalles : [];
  const TOTALS_W   = 230;
  const TOTALS_X   = PW - MARGIN - TOTALS_W;

  // Compute sum from line items; fall back to stored monto_total if no items
  const computedTotal = detalles.reduce(
    (sum, item) => sum + parseFloat(item.subtotal || 0),
    0
  );

  const displayTotal = detalles.length > 0
    ? computedTotal
    : parseFloat(quotation.monto_total || 0);

  let y = startY;

  // ── Subtotal row (only shown when line items are present) ─────────────────
  if (detalles.length > 0) {
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(C.MID_GRAY)
      .text('Subtotal:', TOTALS_X, y, { width: 105, align: 'right', lineBreak: false });

    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(C.DARK_GRAY)
      .text(
        formatCurrency(computedTotal, quotation.moneda),
        TOTALS_X + 115, y,
        { width: TOTALS_W - 115, align: 'right', lineBreak: false }
      );

    y += 16;

    hLine(doc, y, C.BORDER_GRAY, 0.5);
    y += 6;
  }

  // ── Grand total highlighted box ────────────────────────────────────────────
  const TOTAL_BOX_H = 30;

  doc
    .rect(TOTALS_X, y, TOTALS_W, TOTAL_BOX_H)
    .fill(C.NAVY);

  // "TOTAL:" label (left side of the box, white text)
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(C.WHITE)
    .text('TOTAL:', TOTALS_X + 10, y + 10, { lineBreak: false });

  // Amount value (right side of the box, orange accent)
  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(C.ORANGE)
    .text(
      formatCurrency(displayTotal, quotation.moneda),
      TOTALS_X + 10, y + 8,
      { width: TOTALS_W - 20, align: 'right', lineBreak: false }
    );

  y += TOTAL_BOX_H;

  // ── Currency note ──────────────────────────────────────────────────────────
  const currencyNote = quotation.moneda === 'BOB'
    ? 'Valores expresados en Bolivianos (BOB).'
    : 'Valores expresados en Dólares Americanos (USD).';

  doc
    .font('Helvetica')
    .fontSize(7)
    .fillColor(C.MID_GRAY)
    .text(currencyNote, TOTALS_X, y + 5, {
      width:     TOTALS_W,
      align:     'right',
      lineBreak: false,
    });

  return y + 22; // Return Y below the totals block
}

// ---------------------------------------------------------------------------
// drawObservations
// Renders the quotation's initial observations text in a light-background
// box. If the field is empty or null, this section is skipped entirely.
// ---------------------------------------------------------------------------
function drawObservations(doc, quotation, startY) {
  const notes = (quotation.observaciones || '').trim();
  if (!notes) return startY; // Nothing to render — skip the section

  let y = startY + 10;

  // Section title + orange rule
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(C.NAVY)
    .text('OBSERVACIONES Y CONDICIONES', MARGIN, y, { lineBreak: false });

  doc
    .moveTo(MARGIN, y + 13)
    .lineTo(PW - MARGIN, y + 13)
    .lineWidth(1)
    .strokeColor(C.ORANGE)
    .stroke();

  y += 20;

  // Calculate the notes box height from the actual text content
  doc.fontSize(8.5);
  const textH  = doc.heightOfString(notes, { width: CW - 16 });
  const boxH   = Math.min(textH + 16, 90); // Cap at 90pt to protect the footer

  // Notes box with light background and border
  doc
    .rect(MARGIN, y, CW, boxH)
    .fillAndStroke(C.LIGHT_GRAY, C.BORDER_GRAY);

  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(C.DARK_GRAY)
    .text(notes, MARGIN + 8, y + 8, {
      width:     CW - 16,
      height:    boxH - 16,
      ellipsis:  true,    // Truncate with "…" if the cap clips the text
      lineBreak: true,
    });

  return y + boxH + 12; // Return Y below the notes box
}

// ---------------------------------------------------------------------------
// drawFooter
// Fixed navy bar anchored to the absolute bottom of the page, regardless of
// content height. Contains the generation timestamp, the serial number
// centered as a reference, and a confidentiality notice.
// ---------------------------------------------------------------------------
function drawFooter(doc, quotation) {
  const FOOTER_H = 34;
  const footerY  = PH - FOOTER_H;  // Absolute bottom position

  // Full-bleed navy background
  doc
    .rect(0, footerY, PW, FOOTER_H)
    .fill(C.NAVY);

  // Generation timestamp — left side
  const generatedAt = new Date().toLocaleString('es-BO', {
    timeZone:  'America/La_Paz',
    dateStyle: 'long',
    timeStyle: 'short',
  });

  doc
    .font('Helvetica')
    .fontSize(7)
    .fillColor(C.BLUE_GRAY)
    .text(
      `Generado el ${generatedAt}`,
      MARGIN, footerY + 8,
      { lineBreak: false }
    );

  // Correlativo reference — horizontally centered
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(C.WHITE)
    .text(
      quotation.numero_correlativo || '',
      0, footerY + 8,
      { width: PW, align: 'center', lineBreak: false }
    );

  // Confidentiality notice — right side
  doc
    .font('Helvetica')
    .fontSize(6.5)
    .fillColor(C.MID_GRAY)
    .text(
      'Documento confidencial — RC Tractoparts',
      MARGIN, footerY + 20,
      { width: CW, align: 'right', lineBreak: false }
    );
}

// =============================================================================
// Public API
// =============================================================================

// ---------------------------------------------------------------------------
// generateQuotationPdf
// The single public function of this module. Receives the full quotation
// object (as returned by QuotationModel.findById — including detalles[]),
// orchestrates the layout, writes the file to disk, and resolves with the
// relative file path once the WriteStream's 'finish' event confirms the
// bytes have been completely flushed.
//
// @param   {Object} quotation - Full quotation object with .detalles[]
// @returns {Promise<string>}  - Relative path to the written PDF file
// ---------------------------------------------------------------------------
async function generateQuotationPdf(quotation) {
  return new Promise((resolve, reject) => {
    try {
      // -----------------------------------------------------------------------
      // 1. Resolve the output directory and create it if it does not exist
      // -----------------------------------------------------------------------
      const uploadDir = path.resolve(
        process.cwd(),
        process.env.UPLOAD_DIR || 'uploads/cotizaciones'
      );

      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true }); // Create all missing parent dirs
      }

      // Build a unique filename: <correlativo>-<unix_ms>.pdf
      // The timestamp suffix prevents overwriting a previous version on regeneration.
      const filename     = `${quotation.numero_correlativo}-${Date.now()}.pdf`;
      const absolutePath = path.join(uploadDir, filename);

      // Relative path stored in the database (portable across deploy environments)
      const relativePath = path.join(
        process.env.UPLOAD_DIR || 'uploads/cotizaciones',
        filename
      );

      // -----------------------------------------------------------------------
      // 2. Initialize the PDFKit document
      // -----------------------------------------------------------------------
      const doc = new PDFDocument({
        size:        'A4',
        autoFirstPage: true,
        margins: {
          top:    MARGIN,
          bottom: MARGIN,
          left:   MARGIN,
          right:  MARGIN,
        },
        info: {
          Title:    `Cotización ${quotation.numero_correlativo}`,
          Author:   'RC Tractoparts — Sistema de Gestión de Cotizaciones',
          Subject:  'Proforma / Cotización Comercial',
          Keywords: `cotización, proforma, rc tractoparts, ${quotation.numero_correlativo}`,
          Creator:  'RC Tractoparts SGC v2.0',
        },
        // Compress the PDF content stream for a smaller output file
        compress: true,
      });

      // -----------------------------------------------------------------------
      // 3. Pipe the document to the write stream
      //    Promise lifecycle is tied exclusively to stream events, not doc events,
      //    because the 'finish' event on the WriteStream is the reliable signal
      //    that all bytes have been flushed to the OS file system.
      // -----------------------------------------------------------------------
      const writeStream = fs.createWriteStream(absolutePath);

      doc.pipe(writeStream);

      writeStream.on('finish', () => resolve(relativePath)); // File fully written
      writeStream.on('error',  (err) => reject(err));        // Disk write failure

      // -----------------------------------------------------------------------
      // 4. Render document sections in top-to-bottom order
      //    Each draw* call returns the new Y position for the next section.
      // -----------------------------------------------------------------------
      let y = drawHeader(doc);
      y = drawMetadataAndClient(doc, quotation, y);
      y = drawItemsTable(doc, quotation, y);
      y = drawTotals(doc, quotation, y);
      y = drawObservations(doc, quotation, y);

      // Footer is painted at a fixed absolute Y (bottom of page), not at 'y'
      drawFooter(doc, quotation);

      // -----------------------------------------------------------------------
      // 5. Finalize — flushes all buffered content to the pipe and closes it.
      //    This triggers the WriteStream's 'finish' event, resolving the Promise.
      // -----------------------------------------------------------------------
      doc.end();

    } catch (layoutError) {
      // Catch synchronous errors that occur during drawing (e.g. missing fields,
      // invalid data types passed to PDFKit methods).
      reject(layoutError);
    }
  });
}

module.exports = { generateQuotationPdf };
