// =============================================================================
// tests/unit/calcularTotales.test.js
// Unit Tests UT-01 through UT-08 — Quotation Line-Item Total Calculation
// (Section 3.11.2 — Pruebas unitarias: cálculo de subtotales y monto total)
//
// These tests are pure unit tests — they import calculation functions directly
// from the service, with no database connections involved. Run with:
//   npm run test:unit
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// Calculation functions — extracted from business logic so they can be tested
// in isolation. In the full codebase these live in a cotizacionService.js;
// for Sprint 1 they are defined inline in this file so tests are self-contained.
// ---------------------------------------------------------------------------

/**
 * calcularSubtotal
 * Compute the subtotal for one line item: cantidad × precio_unitario, rounded to 2 decimals.
 * Throws a descriptive error if inputs are invalid (UT-07, UT-08).
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
 * Sum the subtotals of all line items. Returns 0.00 for an empty array.
 * Each item must have cantidad and precio_unitario properties.
 *
 * @param   {Array<{cantidad: number, precio_unitario: number}>} detalles
 * @returns {number} - Total amount rounded to 2 decimals
 */
function calcularMontoTotal(detalles) {
  if (!Array.isArray(detalles) || detalles.length === 0) {
    return 0.00; // UT-04: empty quotation returns zero
  }

  const total = detalles.reduce((acc, item) => {
    return acc + calcularSubtotal(item.cantidad, item.precio_unitario);
  }, 0);

  return parseFloat(total.toFixed(2));
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('calcularSubtotal', () => {

  // UT-01 — Exact integer multiplication
  test('UT-01: exact subtotal for a single line item', () => {
    expect(calcularSubtotal(2, 150.00)).toBeCloseTo(300.00, 2);
  });

  // UT-02 — Rounding to 2 decimal places
  test('UT-02: subtotal with repeating decimals rounds to 2 places', () => {
    // 3 × 33.333 = 99.999 → rounds to 100.00
    expect(calcularSubtotal(3, 33.333)).toBeCloseTo(100.00, 2);
  });

  // UT-05 — Fractional quantity
  test('UT-05: fractional quantity produces correct subtotal', () => {
    expect(calcularSubtotal(0.5, 1000.00)).toBeCloseTo(500.00, 2);
  });

  // UT-06 — Maximum realistic price without throwing
  test('UT-06: maximum supported unit price does not throw', () => {
    expect(() => calcularSubtotal(1, 999_999_999.99)).not.toThrow();
    expect(calcularSubtotal(1, 999_999_999.99)).toBeCloseTo(999_999_999.99, 2);
  });

  // UT-07 — Negative quantity must throw
  test('UT-07: negative quantity throws a validation error', () => {
    expect(() => calcularSubtotal(-1, 100.00))
      .toThrow('cantidad debe ser mayor a 0');
  });

  // UT-08 — Negative price must throw
  test('UT-08: negative unit price throws a validation error', () => {
    expect(() => calcularSubtotal(2, -50.00))
      .toThrow('precio_unitario debe ser mayor o igual a 0');
  });

  // Edge case — zero quantity (boundary of UT-07)
  test('EDGE: zero quantity throws a validation error', () => {
    expect(() => calcularSubtotal(0, 100.00))
      .toThrow('cantidad debe ser mayor a 0');
  });

  // Edge case — zero price should be valid (free items)
  test('EDGE: zero unit price is valid and returns 0.00', () => {
    expect(calcularSubtotal(5, 0)).toBeCloseTo(0.00, 2);
  });
});

describe('calcularMontoTotal', () => {

  // UT-03 — Multi-line sum
  test('UT-03: correct sum across multiple line items', () => {
    const detalles = [
      { cantidad: 2, precio_unitario: 150.00 }, // subtotal = 300.00
      { cantidad: 5, precio_unitario:  80.00 }, // subtotal = 400.00
      { cantidad: 1, precio_unitario: 120.00 }, // subtotal = 120.00
    ];
    expect(calcularMontoTotal(detalles)).toEqual(820.00);
  });

  // UT-04 — Empty array returns 0.00
  test('UT-04: empty detalles array returns 0.00', () => {
    expect(calcularMontoTotal([])).toEqual(0.00);
  });

  // Edge case — single item total equals its subtotal
  test('EDGE: single line item total matches its subtotal', () => {
    const detalles = [{ cantidad: 3, precio_unitario: 99.99 }];
    expect(calcularMontoTotal(detalles)).toBeCloseTo(299.97, 2);
  });

  // Edge case — total with repeating-decimal items rounds correctly
  test('EDGE: sum of repeating-decimal subtotals is correctly rounded', () => {
    const detalles = [
      { cantidad: 1, precio_unitario: 0.10 },
      { cantidad: 1, precio_unitario: 0.20 },
    ];
    // 0.10 + 0.20 = 0.30 (not 0.30000000000000004 from floating point)
    expect(calcularMontoTotal(detalles)).toBeCloseTo(0.30, 2);
  });
});
