// =============================================================================
// src/controllers/quotation/quotationFilters.js
// Parseo y validación de los query params de GET /api/cotizaciones.
//
// Función PURA: recibe req.query y devuelve o bien un error listo para
// responder, o bien los tres objetos que consume el modelo. No toca req/res ni
// la base, así que es testeable sin levantar nada.
//
// Extraído de QuotationController.getQuotations sin cambios de comportamiento.
// Cubierto por tests/unit/quotationFilters.test.js.
// =============================================================================

'use strict';

const QuotationModel = require('../../models/QuotationModel');

const DATE_REGEX       = /^\d{4}-\d{2}-\d{2}$/;
const VALID_CURRENCIES = ['USD', 'BOB'];
const DEFAULT_LIMIT    = 20;
const MAX_LIMIT        = 100;

// Claves de orden expuestas a los llamadores de GET /api/cotizaciones
const VALID_SORT_KEYS = Object.keys(QuotationModel.SORTABLE_COLUMNS);

/** Error de validación uniforme (todos responden 422). */
const invalid = (message) => ({ error: { status: 422, message } });

/**
 * Interpreta un query param entero positivo.
 * @returns {{ value: number }|{ error: Object }}
 */
function positiveInt(raw, field) {
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed < 1) return invalid(`${field} must be a positive integer.`);
  return { value: parsed };
}

/**
 * parseQuotationFilters
 *
 * @param   {Object} query — req.query
 * @returns {{ error: { status, message } } |
 *           { filters: Object, pagination: { page, limit }, sort: { by, order } }}
 */
function parseQuotationFilters(query = {}) {
  const filters = {};

  // ── Búsqueda libre y por datos del cliente ────────────────────────────────
  if (query.q)            filters.q            = String(query.q);
  if (query.razon_social) filters.razon_social = String(query.razon_social);
  if (query.nit)          filters.nit          = String(query.nit);

  // ── Estado (lista blanca del modelo) ──────────────────────────────────────
  if (query.estado) {
    if (!QuotationModel.VALID_STATES.includes(query.estado)) {
      return invalid(
        `Invalid estado '${query.estado}'. Valid values: [${QuotationModel.VALID_STATES.join(', ')}]`
      );
    }
    filters.estado = query.estado;
  }

  // ── Claves foráneas ───────────────────────────────────────────────────────
  for (const field of ['id_cliente', 'id_ejecutivo', 'id_licitacion']) {
    if (!query[field]) continue;
    const parsed = positiveInt(query[field], field);
    if (parsed.error) return parsed;
    filters[field] = parsed.value;
  }

  // ── Rango de fechas ───────────────────────────────────────────────────────
  for (const field of ['fecha_desde', 'fecha_hasta']) {
    if (!query[field]) continue;
    if (!DATE_REGEX.test(query[field])) {
      return invalid(`${field} must be in YYYY-MM-DD format.`);
    }
    filters[field] = query[field];
  }

  if (filters.fecha_desde && filters.fecha_hasta && filters.fecha_desde > filters.fecha_hasta) {
    return invalid('fecha_desde cannot be later than fecha_hasta.');
  }

  // ── Moneda ────────────────────────────────────────────────────────────────
  if (query.moneda) {
    const moneda = String(query.moneda).toUpperCase();
    if (!VALID_CURRENCIES.includes(moneda)) {
      return invalid("moneda must be 'USD' or 'BOB'.");
    }
    filters.moneda = moneda;
  }

  // ── Presencia de PDF ──────────────────────────────────────────────────────
  if (query.tiene_pdf !== undefined) {
    if      (query.tiene_pdf === 'true')  filters.tiene_pdf = true;
    else if (query.tiene_pdf === 'false') filters.tiene_pdf = false;
    else return invalid("tiene_pdf must be 'true' or 'false'.");
  }

  // ── Atajo hoy=true ────────────────────────────────────────────────────────
  // Restringe fecha_emision a hoy y PISA cualquier fecha_desde/fecha_hasta
  // explícita — lo usa el widget "Proformas del Día" del ejecutivo.
  if (query.hoy === 'true') {
    // 'en-CA' formatea como YYYY-MM-DD. Se calcula en la zona horaria de
    // Bolivia: toISOString() (UTC) saltaría a *mañana* a las 20:00 locales
    // (UTC-4) en un servidor UTC, vaciando el widget todas las noches aunque
    // haya cotizaciones de hoy.
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' });
    filters.fecha_desde = today;
    filters.fecha_hasta = today;
  }

  // ── Paginación y orden ────────────────────────────────────────────────────
  // El parseInt(..., 10) explícito garantiza tipo entero antes de inyectarlo en
  // el array de parámetros del prepared statement (si no, MySQL responde
  // "Incorrect arguments to mysqld_stmt_execute" por la coerción del string).
  const page      = Math.max(1, parseInt(query.page, 10) || 1);
  const limit     = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || DEFAULT_LIMIT));
  const by        = query.sort_by || 'creado_en';
  const order     = (query.sort_order || '').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  if (!VALID_SORT_KEYS.includes(by)) {
    return invalid(`Invalid sort_by '${by}'. Valid keys: [${VALID_SORT_KEYS.join(', ')}]`);
  }

  return { filters, pagination: { page, limit }, sort: { by, order } };
}

module.exports = {
  parseQuotationFilters,
  VALID_SORT_KEYS,
  VALID_CURRENCIES,
  DEFAULT_LIMIT,
  MAX_LIMIT,
};
