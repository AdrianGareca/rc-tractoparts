// =============================================================================
// tests/unit/quotationTotalsFront.test.js
// Unit tests for the SHARED front-end money module (public/js/shared/quotationTotals.js).
//
// These pin the three Tanda-2 preview bugs:
//   2.1 — the live total must round EACH line to 2 decimals before summing,
//         exactly like the backend, so the on-screen total equals what is saved.
//   2.2 — a manual discount can only ever REDUCE the total; a negative/NaN value
//         must be treated as 0 (never inflate the preview above the subtotal).
//   2.3 — a submittable line item (one with a description) must have cantidad > 0
//         and precio_unitario >= 0 — the same rule the backend enforces.
//
// The final block is the anti-divergence guarantee: for a battery of VALID
// inputs, the front-end sum must equal the backend's authoritative
// calcularMontoTotal. babel-jest lets us `import` the browser ESM module and
// `require` the backend CommonJS module in the same file.
// =============================================================================

import {
  round2,
  sumSubtotals,
  clampDiscount,
  computeTotal,
  validateDetalle,
} from '../../public/js/shared/quotationTotals.js';

const backend = require('../../src/utils/quotationTotals');

describe('2.1 — round-per-line-then-sum (matches backend)', () => {
  test('two lines of 0.125 sum to 0.26 (per-line rounding), NOT 0.25', () => {
    const items = [
      { cantidad: 1, precio_unitario: 0.125 },
      { cantidad: 1, precio_unitario: 0.125 },
    ];
    expect(sumSubtotals(items)).toBe(0.26);
  });

  test('empty / non-array input is 0', () => {
    expect(sumSubtotals([])).toBe(0);
    expect(sumSubtotals(undefined)).toBe(0);
  });

  test('half-typed rows (NaN / empty) contribute 0 instead of breaking the preview', () => {
    const items = [
      { cantidad: '', precio_unitario: '' },
      { cantidad: 2, precio_unitario: 150 },
    ];
    expect(sumSubtotals(items)).toBe(300);
  });
});

describe('2.2 — discount can only reduce the total', () => {
  test('clampDiscount floors negatives and NaN to 0', () => {
    expect(clampDiscount(-50)).toBe(0);
    expect(clampDiscount('abc')).toBe(0);
    expect(clampDiscount('')).toBe(0);
    expect(clampDiscount(25.5)).toBe(25.5);
  });

  test('a negative discount never inflates the total above the subtotal', () => {
    // subtotal 300, discount -100 → must stay 300, never 400
    expect(computeTotal(300, -100)).toBe(300);
  });

  test('a valid discount reduces the total', () => {
    expect(computeTotal(300, 50)).toBe(250);
  });

  test('the total never goes below 0', () => {
    expect(computeTotal(100, 250)).toBe(0);
  });
});

describe('2.3 — line-item validation mirrors the backend rule', () => {
  test('rejects a zero / empty / negative quantity', () => {
    expect(validateDetalle({ cantidad: 0, precio_unitario: 10 }).some(e => e.field === 'cantidad')).toBe(true);
    expect(validateDetalle({ cantidad: '', precio_unitario: 10 }).some(e => e.field === 'cantidad')).toBe(true);
    expect(validateDetalle({ cantidad: -2, precio_unitario: 10 }).some(e => e.field === 'cantidad')).toBe(true);
  });

  test('rejects a negative unit price', () => {
    expect(validateDetalle({ cantidad: 1, precio_unitario: -5 }).some(e => e.field === 'precio_unitario')).toBe(true);
  });

  test('accepts a valid item (price 0 is allowed)', () => {
    expect(validateDetalle({ cantidad: 2, precio_unitario: 0 })).toEqual([]);
    expect(validateDetalle({ cantidad: 1.5, precio_unitario: 999.99 })).toEqual([]);
  });
});

describe('round2 helper', () => {
  test('rounds to 2 decimals; non-finite → 0', () => {
    expect(round2(0.125)).toBe(0.13);
    expect(round2(99.999)).toBe(100);
    expect(round2(NaN)).toBe(0);
    expect(round2('x')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Anti-divergence guarantee: the front-end preview sum must equal the backend's
// authoritative total for every valid input. If either implementation's rounding
// drifts, this fails — which is exactly the bug class that shipped before.
// ---------------------------------------------------------------------------
describe('front-end sum agrees with backend calcularMontoTotal (valid inputs)', () => {
  const cases = [
    [{ cantidad: 1, precio_unitario: 0.125 }, { cantidad: 1, precio_unitario: 0.125 }],
    [{ cantidad: 3, precio_unitario: 33.333 }],
    [{ cantidad: 2, precio_unitario: 150 }, { cantidad: 0.5, precio_unitario: 1000 }],
    [{ cantidad: 1, precio_unitario: 0.125 }, { cantidad: 1, precio_unitario: 0.125 }, { cantidad: 1, precio_unitario: 0.125 }],
    [{ cantidad: 7, precio_unitario: 12.345 }, { cantidad: 4, precio_unitario: 9.99 }],
  ];

  test.each(cases)('case %#: front-end === backend', (...items) => {
    const front = sumSubtotals(items);
    const back  = backend.calcularMontoTotal(items);
    expect(front).toBe(back);
  });
});
