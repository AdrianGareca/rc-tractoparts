// =============================================================================
// tests/unit/csvExport.test.js
// La exportación a CSV (public/js/shared/csvExport.js).
//
// Los tres detalles que se prueban son los tres que NO se notan en la máquina
// de quien programa: el archivo abre bien en su Excel, con sus datos de prueba
// sin acentos ni comas. Se rompen recién en la máquina del usuario.
// =============================================================================

'use strict';

import { csvCell, buildCsv } from '../../public/js/shared/csvExport.js';

describe('csvCell — cada celda', () => {
  test('siempre va entre comillas, así una coma no parte la fila', () => {
    expect(csvCell('Agropecuaria del Este, S.R.L.')).toBe('"Agropecuaria del Este, S.R.L."');
  });

  test('una comilla adentro se duplica (así la escapa CSV)', () => {
    expect(csvCell('Filtro "original"')).toBe('"Filtro ""original"""');
  });

  test('un salto de línea adentro no rompe la fila', () => {
    expect(csvCell('linea1\nlinea2')).toBe('"linea1\nlinea2"');
  });

  test('null y undefined quedan vacíos, no como la palabra "null"', () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });

  test('los números pasan tal cual', () => {
    expect(csvCell(42)).toBe('"42"');
    expect(csvCell(0)).toBe('"0"');
  });
});

// ---------------------------------------------------------------------------
// Inyección de fórmulas. Los datos son razones sociales y descripciones que
// cargan los usuarios: un cliente llamado «=SUMA(...)» ejecutaría algo en la
// máquina de quien abra el archivo.
// ---------------------------------------------------------------------------
describe('csvCell — no deja que Excel ejecute nada', () => {
  test.each(['=SUMA(A1:A9)', '+1+1', '-2+3', '@SUM(A1)'])(
    '«%s» se neutraliza con una comilla simple',
    (peligroso) => {
      expect(csvCell(peligroso)).toBe(`"'${peligroso}"`);
    }
  );

  test('un texto normal NO se toca', () => {
    expect(csvCell('FA-220')).toBe('"FA-220"');
    expect(csvCell('Rodillo inferior')).toBe('"Rodillo inferior"');
  });

  // Un código de parte legítimo puede empezar con guion.
  test('un guion al principio se neutraliza igual (mejor eso que ejecutar)', () => {
    expect(csvCell('-100-X')).toBe(`"'-100-X"`);
  });
});

// ---------------------------------------------------------------------------
describe('buildCsv — el archivo entero', () => {
  const csv = buildCsv(['Codigo', 'Cantidad'], [['FA-220', 48], ['RI-100', 12]]);

  // Sin el BOM, Excel abre con la codificación del sistema y toda la ñ y todo
  // acento salen rotos. Es EL motivo por el que dicen «el Excel salió mal».
  test('empieza con el BOM de UTF-8', () => {
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
  });

  test('las filas se cortan con CRLF (Excel en Windows lo necesita)', () => {
    expect(csv).toContain('\r\n');
    expect(csv.split('\r\n')).toHaveLength(4);   // sep + cabecera + 2 filas
  });

  // EL BUG REPORTADO: «se ve todo mezclado». Excel no usa siempre la coma —
  // usa el separador de listas del sistema, y en Windows en español es el punto
  // y coma. Con comas metía la fila entera en una sola celda.
  test('separa con punto y coma, que es lo que espera Excel en español', () => {
    expect(csv).toContain('"Codigo";"Cantidad"');
    expect(csv).not.toContain('"Codigo","Cantidad"');
  });

  test('la primera línea le declara el separador a Excel', () => {
    // `sep=;` es una directiva propia de Excel: hace que el archivo abra bien
    // incluso en una instalación configurada en otro idioma.
    expect(csv.split('\r\n')[0]).toBe('﻿sep=;');
  });

  test('la cabecera va después de la directiva, entrecomillada', () => {
    expect(csv.split('\r\n')[1]).toBe('"Codigo";"Cantidad"');
  });

  test('los acentos sobreviven', () => {
    const c = buildCsv(['Descripción'], [['Cotización con ñ y á']]);
    expect(c).toContain('Descripción');
    expect(c).toContain('Cotización con ñ y á');
  });

  test('sin filas devuelve la directiva y la cabecera', () => {
    expect(buildCsv(['A'], []).split('\r\n')).toHaveLength(2);
  });
});
