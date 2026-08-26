// =============================================================================
// tests/unit/fechaCalendario.test.js
// ¿La fecha existe de verdad, o sólo tiene el FORMATO de una fecha?
//
// BUG REAL: /^\d{4}-\d{2}-\d{2}$/ deja pasar "2026-02-30" o "2026-13-01" —
// llegan intactos hasta MySQL, que los rechaza en la columna DATE con una
// excepción sin capturar (HTTP 500). Encontrado en la ronda de estrés del
// 2026-08-25 en POST /api/cotizaciones y PATCH /:id/seguimiento.
// =============================================================================

'use strict';

const { esFechaCalendarioValida } = require('../../src/validators/fechaCalendario');

describe('esFechaCalendarioValida — fechas reales', () => {
  test.each([
    '2026-01-01', '2026-12-31', '2026-02-28', '2024-02-29', // 2024 es bisiesto
    '2026-08-26', '2000-02-29',                              // 2000 es bisiesto (regla de los 400)
  ])('%s es válida', (fecha) => {
    expect(esFechaCalendarioValida(fecha)).toBe(true);
  });
});

describe('esFechaCalendarioValida — el bug real: formato correcto, calendario imposible', () => {
  test.each([
    '2026-02-30',  // febrero no tiene día 30
    '2026-02-29',  // 2026 no es bisiesto
    '2026-13-01',  // no existe el mes 13
    '2026-00-01',  // no existe el mes 0
    '2026-01-00',  // no existe el día 0
    '2026-04-31',  // abril tiene 30 días
    '1900-02-29',  // 1900 NO es bisiesto (regla de los 100, sin la de los 400)
  ])('%s tiene el formato bien pero no existe en el calendario', (fecha) => {
    expect(esFechaCalendarioValida(fecha)).toBe(false);
  });
});

describe('esFechaCalendarioValida — casos borde', () => {
  test('formato inválido da false, no rompe', () => {
    expect(esFechaCalendarioValida('26-08-2026')).toBe(false);
    expect(esFechaCalendarioValida('2026/08/26')).toBe(false);
    expect(esFechaCalendarioValida('no es una fecha')).toBe(false);
    expect(esFechaCalendarioValida('')).toBe(false);
  });

  test('valores no-string no rompen', () => {
    expect(esFechaCalendarioValida(null)).toBe(false);
    expect(esFechaCalendarioValida(undefined)).toBe(false);
    expect(esFechaCalendarioValida(20260826)).toBe(false);
  });
});
