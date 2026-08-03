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

  // ESCRITO A MANO, SIN Intl — y esto importa más de lo que parece.
  //
  // toLocaleString('es-BO') depende de los datos ICU que traiga el binario de
  // Node. La imagen del servidor es node:20-alpine; si ese build no lleva el
  // ICU completo, el locale cae a en-US EN SILENCIO y los separadores se dan
  // vuelta: 1.234,50 pasa a imprimirse como 1,234.50.
  //
  // No es un detalle cosmético. Esta función formatea los montos de las
  // PROFORMAS que se le mandan al cliente: un total que dice "1,234.50" en un
  // documento boliviano se lee como mil doscientos con cincuenta o como uno
  // con veintitrés según quién lo mire. Localmente nunca se ve, porque el Node
  // de escritorio sí trae el ICU completo.
  //
  // Formato boliviano: punto para los miles, coma para los decimales.
  const n = parseFloat(amount);
  const negativo = n < 0;
  const [entero, decimales] = Math.abs(n).toFixed(2).split('.');
  const conMiles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  return `${negativo ? '-' : ''}${conMiles},${decimales}`;
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

// ---------------------------------------------------------------------------
// MESES / formatDateTime — fecha y hora escritas a mano, sin Intl.
//
// POR QUE NO toLocaleString('es-BO')
// Intl depende de los datos ICU que traiga el binario de Node. La imagen del
// servidor es node:20-alpine, y si ese build no lleva el ICU completo, CUALQUIER
// locale cae de vuelta a ingles sin avisar: el PDF sale con "July 12, 2026" en
// un documento que por lo demas esta todo en castellano. Localmente no se ve
// porque el Node de escritorio si trae el ICU completo — el clasico "en mi
// maquina anda".
//
// Escribiendo los meses a mano el resultado es el MISMO en cualquier maquina y
// en cualquier contenedor. Son doce palabras; la alternativa era atarse a como
// se compilo el runtime.
// ---------------------------------------------------------------------------
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/**
 * "12 de julio de 2026, 15:45". Siempre en castellano, sin depender de ICU.
 *
 * @param {Date|string|number} [v] — por defecto, ahora
 * @returns {string}
 */
function formatDateTime(v = new Date()) {
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return String(v);

  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}, ${hh}:${mi}`;
}

/**
 * "2026-07" → "julio 2026". Para la tabla de evolucion mes a mes, donde
 * "2026-07" obliga a traducir mentalmente en cada fila.
 *
 * @param {string} ym — 'YYYY-MM'
 * @returns {string}
 */
function formatMes(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
  if (!m) return String(ym ?? '—');
  return `${MESES[Number(m[2]) - 1]} ${m[1]}`;
}

module.exports = { fmtNum, fmtPrice, formatDate, hLine,
  formatDateTime,
  formatMes,
};
