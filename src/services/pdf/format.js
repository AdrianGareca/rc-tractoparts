// =============================================================================
// src/services/pdf/format.js
// Formateo de números, precios y fechas para la proforma + primitivas de dibujo.
//
// Extraído de pdfService.js sin cambios de comportamiento.
// Cubierto por tests/unit/pdfFormat.test.js.
// =============================================================================

'use strict';

const { C, MARGIN, PW } = require('./constants');

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

  // El valor tal como llegó: si no se puede formatear, se imprime esto en vez
  // de la representación del Date. Sin esta copia, `String(v)` mas abajo opera
  // sobre la reasignación `v = new Date(v)` y saca "Invalid Date" impreso en la
  // proforma, perdiendo un dato que muchas veces era legible ('26/07/2026').
  const original = v;

  if (typeof v === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (match) {
      const [, yyyy, mm, dd] = match;
      return `${dd}/${mm}/${yyyy}`;
    }
    v = new Date(v);
  }

  // Cualquier cosa que no sea Date (un objeto suelto, un número raro) tampoco
  // tiene getTime: se trata como dato ausente en lugar de reventar el render.
  if (!(v instanceof Date) || isNaN(v.getTime())) {
    // Un Date inválido no tiene ningún valor original que rescatar, así que usa
    // el mismo placeholder que el resto de los datos ausentes.
    return typeof original === 'string' ? original : '—';
  }

  const dd = String(v.getUTCDate()).padStart(2, '0');
  const mm = String(v.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${v.getUTCFullYear()}`;
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

module.exports = { fmtNum, fmtPrice, formatDate, hLine };
