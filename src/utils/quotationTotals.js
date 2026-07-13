// =============================================================================
// src/utils/quotationTotals.js
// Shared line-item total calculation — the SINGLE source of truth for how a
// quotation's monto_total is derived from its detalles.
//
// Both QuotationController.createQuotation and QuotationController.updateQuotation
// must compute the header total the exact same way QuotationModel.createDetalles
// rounds and stores each line's subtotal (round-per-line, THEN sum) — otherwise
// cotizaciones.monto_total (used by reports) can diverge from
// SUM(cotizacion_detalles.subtotal) (used by the PDF) by a rounding cent.
// Extracted here so there is only one implementation to keep in sync, and so
// it can be unit-tested directly instead of via a reimplementation.
// =============================================================================

'use strict';

/**
 * calcularSubtotal
 * Compute the subtotal for one line item: cantidad × precio_unitario, rounded to 2 decimals.
 * Throws a descriptive error if inputs are invalid (callers must validate beforehand;
 * this is a defensive guard, not the primary validation layer).
 *
 * @param   {number} cantidad        - Quantity (must be > 0)
 * @param   {number} precioUnitario  - Unit price (must be >= 0)
 * @returns {number}                 - Rounded subtotal
 */
function calcularSubtotal(cantidad, precioUnitario) {
  if (typeof cantidad !== 'number' || cantidad <= 0) {
    throw new Error('cantidad debe ser mayor a 0');
  }

  if (typeof precioUnitario !== 'number' || precioUnitario < 0) {
    throw new Error('precio_unitario debe ser mayor o igual a 0');
  }

  // Multiply and round to exactly 2 decimal places (monetary precision)
  return parseFloat((cantidad * precioUnitario).toFixed(2));
}

/**
 * calcularMontoTotal
 * Sum the ALREADY-ROUNDED subtotals of all line items. Returns 0.00 for an
 * empty array. Each item must have cantidad and precio_unitario properties.
 * Does not apply any discount — callers subtract descuento_manual themselves.
 *
 * @param   {Array<{cantidad: number, precio_unitario: number}>} detalles
 * @returns {number} - Total amount rounded to 2 decimals
 */
function calcularMontoTotal(detalles) {
  if (!Array.isArray(detalles) || detalles.length === 0) {
    return 0.00;
  }

  const total = detalles.reduce((acc, item) => {
    return acc + calcularSubtotal(item.cantidad, item.precio_unitario);
  }, 0);

  return parseFloat(total.toFixed(2));
}

module.exports = { calcularSubtotal, calcularMontoTotal };
