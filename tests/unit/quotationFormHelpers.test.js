// =============================================================================
// tests/unit/quotationFormHelpers.test.js
// Red de seguridad de public/js/views/quotationForm/helpers.js.
//
// Fija el comportamiento EXACTO que estas funciones tenían embebidas dentro de
// quotationForm.js, para que la modularización del formulario no lo altere.
// =============================================================================

'use strict';

import { fmt, escText, nextCorrelativoOf } from '../../public/js/views/quotationForm/helpers.js';

describe('fmt', () => {
  test('formatea a 2 decimales', () => {
    expect(fmt(0)).toBe('0.00');
    expect(fmt(5)).toBe('5.00');
    expect(fmt(1234.5)).toBe('1234.50');
    expect(fmt(0.005)).toBe('0.01');
  });

  test('acepta strings numéricos (los inputs del form devuelven texto)', () => {
    expect(fmt('7')).toBe('7.00');
    expect(fmt('12.345')).toBe('12.35');
  });

  test('cae a 0.00 con valores no numéricos', () => {
    expect(fmt(undefined)).toBe('0.00');
    expect(fmt(NaN)).toBe('0.00');
    expect(fmt('abc')).toBe('0.00');
  });

  test('null y string vacío se coercionan a 0 (comportamiento heredado)', () => {
    // Number(null) === 0 y Number('') === 0, así que isNaN() los deja pasar.
    expect(fmt(null)).toBe('0.00');
    expect(fmt('')).toBe('0.00');
  });
});

describe('escText', () => {
  test('escapa los cinco caracteres peligrosos', () => {
    expect(escText('&')).toBe('&amp;');
    expect(escText('<')).toBe('&lt;');
    expect(escText('>')).toBe('&gt;');
    expect(escText('"')).toBe('&quot;');
    expect(escText("'")).toBe('&#39;');
  });

  test('neutraliza una inyección de script', () => {
    expect(escText('<script>alert(1)</script>'))
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  test('escapa el ampersand primero (sin doble escape)', () => {
    expect(escText('&lt;')).toBe('&amp;lt;');
  });

  test('null y undefined dan string vacío', () => {
    expect(escText(null)).toBe('');
    expect(escText(undefined)).toBe('');
  });

  test('deja intacto el texto inofensivo y convierte no-strings', () => {
    expect(escText('Repuesto CAT 336')).toBe('Repuesto CAT 336');
    expect(escText(42)).toBe('42');
    expect(escText(0)).toBe('0');
  });
});

describe('nextCorrelativoOf', () => {
  test('incrementa conservando el prefijo y el padding', () => {
    expect(nextCorrelativoOf('SC-2026/000123')).toBe('SC-2026/000124');
    expect(nextCorrelativoOf('COT-2026-0007')).toBe('COT-2026-0008');
  });

  test('propaga el acarreo sin perder ancho', () => {
    expect(nextCorrelativoOf('SC-2026/000999')).toBe('SC-2026/001000');
    expect(nextCorrelativoOf('SC-2026/009999')).toBe('SC-2026/010000');
  });

  test('crece cuando el acarreo desborda el padding', () => {
    expect(nextCorrelativoOf('SC-2026/999999')).toBe('SC-2026/1000000');
  });

  test('funciona sin prefijo', () => {
    expect(nextCorrelativoOf('7')).toBe('8');
    expect(nextCorrelativoOf('099')).toBe('100');
  });

  test('ignora espacios alrededor', () => {
    expect(nextCorrelativoOf('  SC-2026/000001  ')).toBe('SC-2026/000002');
  });

  test('devuelve null cuando no termina en dígitos', () => {
    expect(nextCorrelativoOf('SC-2026/000123-A')).toBeNull();
    expect(nextCorrelativoOf('sin-numero')).toBeNull();
    expect(nextCorrelativoOf('')).toBeNull();
    expect(nextCorrelativoOf(null)).toBeNull();
    expect(nextCorrelativoOf(undefined)).toBeNull();
  });
});
