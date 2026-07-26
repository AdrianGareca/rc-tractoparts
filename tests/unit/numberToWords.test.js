// =============================================================================
// tests/unit/numberToWords.test.js
// Bug 5.1 — numberToWordsES printed the literal string "undefined" in the PDF's
// legal "SON:" amount-in-words line for totals >= 1,000,000,000.
//
// Cause: the millions COUNT (Math.floor(n / 1e6)) was rendered with _lt1000,
// which only handles 0–999. Once the count reached 1000+ (n >= 1e9) it indexed
// past the hundreds table and concatenated "undefined". The fix renders the
// millions count with the full sub-million renderer (recursively), covering the
// whole DECIMAL(15,2) range the schema allows.
// =============================================================================

'use strict';

const { numberToWordsES } = require('../../src/services/pdfService');

describe('numberToWordsES', () => {
  test('regression: small and mid values keep their exact wording', () => {
    expect(numberToWordsES(0)).toBe('CERO CON 00/100');
    expect(numberToWordsES(3080)).toBe('TRES MIL OCHENTA CON 00/100');
    expect(numberToWordsES(1234.56)).toBe('MIL DOSCIENTOS TREINTA Y CUATRO CON 56/100');
    expect(numberToWordsES(1000000)).toBe('UN MILLÓN CON 00/100');
    expect(numberToWordsES(2000000)).toBe('DOS MILLONES CON 00/100');
  });

  test('the ≥ 1,000,000,000 case no longer produces "undefined"', () => {
    expect(numberToWordsES(1500000000)).toBe('MIL QUINIENTOS MILLONES CON 00/100');
  });

  test('no value across the DECIMAL(15,2) range ever contains "undefined"', () => {
    const samples = [
      999999999,          // just under a billion
      1000000000,         // one billion
      1500000000,
      9999999999,
      99999999999,
      999999999999,       // ~10^12
      9999999999999.99,   // near the DECIMAL(15,2) ceiling
    ];
    for (const v of samples) {
      const words = numberToWordsES(v);
      expect(words).not.toMatch(/undefined/i);
      expect(words).toMatch(/ CON \d{2}\/100$/); // always well-formed
    }
  });

  test('cents are rendered from the fractional part', () => {
    expect(numberToWordsES(1000000.50)).toBe('UN MILLÓN CON 50/100');
  });
});
