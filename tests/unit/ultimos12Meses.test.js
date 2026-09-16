// =============================================================================
// tests/unit/ultimos12Meses.test.js
// El rango con el que abren los reportes pesados.
//
// Desde el 2026-09-15 el reporte de consumo y los reportes del ejecutivo abren
// con los últimos 12 meses en vez de todo el historial (decisión de Adrian,
// tras medir que el historial completo pasaba del minuto con años de datos).
// El rango se arma en el navegador, con la fecha local: es exactamente la zona
// donde este proyecto ya tropezó tres veces con UTC−4 (ver fechaLocal.js).
// =============================================================================

'use strict';

import { ultimos12Meses } from '../../public/js/shared/fechaLocal.js';

const dias = (desde, hasta) =>
  Math.round((new Date(`${hasta}T12:00:00`) - new Date(`${desde}T12:00:00`)) / 86400000) + 1;

describe('ultimos12Meses', () => {
  test('va del día siguiente a hoy hace un año, hasta hoy', () => {
    expect(ultimos12Meses(new Date(2026, 8, 15))).toEqual(['2025-09-16', '2026-09-15']);
  });

  test('cubre exactamente un año: 365 días, o 366 si en el medio hay un 29 de febrero', () => {
    expect(dias(...ultimos12Meses(new Date(2026, 8, 15)))).toBe(365);
    expect(dias(...ultimos12Meses(new Date(2028, 5, 1)))).toBe(366);
  });

  test('cruza el cambio de año sin romperse', () => {
    expect(ultimos12Meses(new Date(2026, 0, 1))).toEqual(['2025-01-02', '2026-01-01']);
    expect(ultimos12Meses(new Date(2026, 11, 31))).toEqual(['2026-01-01', '2026-12-31']);
  });

  test('el 29 de febrero no produce una fecha inexistente', () => {
    expect(ultimos12Meses(new Date(2028, 1, 29))).toEqual(['2027-03-02', '2028-02-29']);
  });

  test('usa la fecha LOCAL: a las 23:00 sigue siendo hoy, no mañana en UTC', () => {
    const [, hasta] = ultimos12Meses(new Date(2026, 8, 15, 23, 0, 0));
    expect(hasta).toBe('2026-09-15');
  });

  test('sin argumento, termina hoy', () => {
    const hoy = new Date();
    const esperado = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
    expect(ultimos12Meses()[1]).toBe(esperado);
  });
});
