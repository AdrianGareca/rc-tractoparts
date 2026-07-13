// =============================================================================
// tests/unit/calcularTotales.test.js
// Unit Tests UT-01 through UT-08 — Quotation Line-Item Total Calculation
// (Section 3.11.2 — Pruebas unitarias: cálculo de subtotales y monto total)
//
// These tests import the REAL calculation functions from
// src/utils/quotationTotals.js — the exact module used by
// QuotationController.createQuotation/updateQuotation and by
// QuotationModel.createDetalles. Testing a local reimplementation here would
// give false confidence: it could pass while the production code path
// actually rounds differently (that divergence was a real, previously-shipped
// bug — see the 'REGRESSION' test below).
// ---------------------------------------------------------------------------

'use strict';

const { calcularSubtotal, calcularMontoTotal } = require('../../src/utils/quotationTotals');

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

  // REGRESSION — monto_total must equal the sum of the PER-LINE rounded
  // subtotals (what QuotationModel.createDetalles stores in
  // cotizacion_detalles.subtotal), NOT the rounding of the raw unrounded sum.
  // Two lines of 0.125 each round individually to 0.13 + 0.13 = 0.26, but
  // summing the raw products first (0.125 + 0.125 = 0.25) then rounding once
  // gives 0.25 — a real, previously-shipped 1-cent divergence between
  // cotizaciones.monto_total (reports) and SUM(detalle.subtotal) (the PDF).
  test('REGRESSION: sums per-line rounded subtotals, not the rounded raw sum', () => {
    const detalles = [
      { cantidad: 1, precio_unitario: 0.125 }, // rounds to 0.13
      { cantidad: 1, precio_unitario: 0.125 }, // rounds to 0.13
    ];
    expect(calcularSubtotal(1, 0.125)).toBeCloseTo(0.13, 2);
    expect(calcularMontoTotal(detalles)).toBeCloseTo(0.26, 2); // NOT 0.25
  });
});
