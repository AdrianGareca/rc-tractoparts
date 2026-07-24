// =============================================================================
// public/js/shared/quotationTotals.js
// SINGLE source of truth for the quotation form's money math (browser side).
//
// Mirrors the backend's src/utils/quotationTotals.js EXACTLY: round each line to
// 2 decimals BEFORE summing (round-per-line-then-sum). Keeping the browser
// preview identical to the server's stored monto_total prevents the on-screen
// total from silently disagreeing with what gets saved by a rounding cent — a
// real bug that shipped when the form summed raw products and rounded only once.
//
// A cross-check unit test (tests/unit/quotationTotalsFront.test.js) asserts this
// module and the backend produce the same total for every valid input, so the
// two can never drift apart again.
// =============================================================================

/** Round a number to 2 decimals (monetary precision). Non-finite → 0. */
export function round2(n) {
  const x = Number(n);
  return Number.isFinite(x) ? parseFloat(x.toFixed(2)) : 0;
}

/**
 * Live-preview subtotal: round each line to 2 decimals, THEN sum, THEN round the
 * total — the exact order the backend uses. Non-throwing so a half-typed row
 * (empty/NaN quantity or price) contributes 0 instead of breaking the preview.
 * @param {Array<{cantidad:*, precio_unitario:*}>} items
 * @returns {number}
 */
export function sumSubtotals(items) {
  if (!Array.isArray(items)) return 0;
  const total = items.reduce((acc, it) => {
    const q = parseFloat(it?.cantidad);
    const p = parseFloat(it?.precio_unitario);
    if (!Number.isFinite(q) || !Number.isFinite(p) || q <= 0 || p < 0) return acc;
    return acc + round2(q * p);
  }, 0);
  return round2(total);
}

/**
 * A manual cash discount is only ever a positive reduction. Negative or NaN → 0,
 * matching the submit rule (`discountRaw > 0 ? discountRaw : null`) so the live
 * preview can never show a total LARGER than the subtotal.
 * @param {*} raw
 * @returns {number}
 */
export function clampDiscount(raw) {
  const d = parseFloat(raw);
  return Number.isFinite(d) && d > 0 ? d : 0;
}

/**
 * Final total shown/saved: subtotal minus the clamped discount, never below 0.
 * @param {number} subtotal
 * @param {*} discountRaw
 * @returns {number}
 */
export function computeTotal(subtotal, discountRaw) {
  return round2(Math.max(0, round2(subtotal) - clampDiscount(discountRaw)));
}

/**
 * Validate a submittable line item (one that carries a description). cantidad
 * must be > 0 and precio_unitario >= 0 — the same rule the backend Zod schema
 * enforces, surfaced client-side so the user gets immediate per-field feedback.
 * @param {{cantidad:*, precio_unitario:*}} item
 * @returns {Array<{field:string, message:string}>} empty when valid
 */
export function validateDetalle(item) {
  const errors = [];
  const q = parseFloat(item?.cantidad);
  const p = parseFloat(item?.precio_unitario);
  if (!Number.isFinite(q) || q <= 0) {
    errors.push({ field: 'cantidad', message: 'La cantidad debe ser mayor a 0.' });
  }
  if (!Number.isFinite(p) || p < 0) {
    errors.push({ field: 'precio_unitario', message: 'El precio no puede ser negativo.' });
  }
  return errors;
}
