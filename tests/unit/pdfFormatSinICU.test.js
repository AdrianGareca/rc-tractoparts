// =============================================================================
// tests/unit/pdfFormatSinICU.test.js
// El formateo de fechas y montos de los PDF, sin depender de Intl.
//
// EL BUG QUE ORIGINÓ ESTE ARCHIVO
// Los reportes salían con las fechas en inglés — "July 12, 2026" dentro de un
// documento escrito todo en castellano. La causa no estaba en el código sino
// en el runtime: `toLocaleString('es-BO')` depende de los datos ICU que traiga
// el binario de Node, y la imagen del servidor es node:20-alpine. Si ese build
// no lleva el ICU completo, CUALQUIER locale cae de vuelta a en-US en silencio.
//
// Localmente nunca se veía: el Node de escritorio sí trae el ICU completo. El
// clásico "en mi máquina anda".
//
// LO MÁS GRAVE NO ERAN LAS FECHAS
// La misma llamada formateaba los MONTOS de las proformas que se le mandan al
// cliente. Sin ICU, 1.234,50 se imprime como 1,234.50 — y un total así, en un
// documento boliviano, se lee como mil doscientos o como uno con veintitrés
// según quién lo mire.
//
// Estos tests no pueden apagar el ICU del Node que los corre, así que verifican
// lo que sí es verificable y es lo que importa: que el resultado sea el formato
// boliviano exacto, calculado por código propio y no delegado a Intl.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');
const { fmtNum, fmtPrice, formatDate, formatDateTime, formatMes } =
  require('../../src/services/pdf/format');

// ---------------------------------------------------------------------------
describe('montos en formato boliviano', () => {
  test.each([
    [1234.5,       '1.234,50'],
    [1234567.891,  '1.234.567,89'],
    [999,          '999,00'],
    [1000,         '1.000,00'],
    [0,            '0,00'],
    [0.5,          '0,50'],
    [-1234.5,      '-1.234,50'],
  ])('%p → %s', (entrada, esperado) => {
    expect(fmtNum(entrada)).toBe(esperado);
  });

  // Justo el caso que se rompía: punto para miles, coma para decimales. Al
  // revés es el formato en inglés.
  test('el punto separa miles y la coma decimales, nunca al revés', () => {
    const s = fmtNum(1234.56);
    expect(s.indexOf('.')).toBeLessThan(s.indexOf(','));
    expect(s).toBe('1.234,56');
    expect(s).not.toBe('1,234.56');
  });

  test('siempre dos decimales, aunque el número sea entero', () => {
    expect(fmtNum(45)).toBe('45,00');
  });

  test('lo que no es un número devuelve raya, no NaN', () => {
    expect(fmtNum(null)).toBe('—');
    expect(fmtNum('abc')).toBe('—');
    expect(fmtNum('')).toBe('—');
  });

  test('el símbolo de moneda va adelante', () => {
    expect(fmtPrice(1234.5, 'BOB')).toBe('Bs. 1.234,50');
    expect(fmtPrice(1234.5, 'USD')).toBe('$ 1.234,50');
  });
});

// ---------------------------------------------------------------------------
describe('fechas en castellano', () => {
  test('formatDate devuelve DD/MM/YYYY', () => {
    expect(formatDate('2026-07-12')).toBe('12/07/2026');
  });

  test('formatDateTime escribe el mes en castellano', () => {
    const s = formatDateTime(new Date(2026, 6, 12, 15, 45));
    expect(s).toBe('12 de julio de 2026, 15:45');
  });

  test.each([
    ['2026-01', 'enero 2026'],
    ['2026-07', 'julio 2026'],
    ['2026-12', 'diciembre 2026'],
  ])('formatMes traduce %s → %s', (ym, esperado) => {
    expect(formatMes(ym)).toBe(esperado);
  });

  test('la hora va en 24 horas, sin AM/PM', () => {
    const s = formatDateTime(new Date(2026, 6, 12, 20, 5));
    expect(s).toContain('20:05');
    expect(s).not.toMatch(/AM|PM|a\. m\.|p\. m\./i);
  });

  test('una fecha inválida no imprime "Invalid Date"', () => {
    expect(formatMes('cualquier cosa')).toBe('cualquier cosa');
  });
});

// ---------------------------------------------------------------------------
// El guardián: si alguien vuelve a meter toLocaleString en un servicio de PDF,
// el bug regresa — y regresa en silencio, porque en la máquina de quien lo
// escriba va a verse perfecto.
// ---------------------------------------------------------------------------
describe('ningún servicio de PDF depende de Intl', () => {
  const SERVICIOS = path.resolve(__dirname, '../../src/services');

  const archivos = fs.readdirSync(SERVICIOS)
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join(SERVICIOS, f))
    .concat(
      fs.readdirSync(path.join(SERVICIOS, 'pdf'))
        .filter((f) => f.endsWith('.js'))
        .map((f) => path.join(SERVICIOS, 'pdf', f))
    );

  test('hay servicios que revisar', () => {
    expect(archivos.length).toBeGreaterThan(3);
  });

  test.each(archivos.map((f) => [path.basename(f), f]))('%s', (_n, file) => {
    const src = fs.readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')     // los comentarios explican el bug
      .replace(/^\s*\/\/.*$/gm, ' ');        // y lo nombran: no cuentan

    const usos = [
      ...src.matchAll(/\btoLocale(?:String|DateString|TimeString)\s*\(/g),
      ...src.matchAll(/\bnew\s+Intl\.\w+/g),
    ];

    if (usos.length > 0) {
      throw new Error(
        `${path.basename(file)} usa Intl/toLocaleString. Eso depende del ICU que ` +
        'traiga el binario de Node, y node:20-alpine puede no traerlo completo: ' +
        'el locale cae a inglés en silencio y las fechas y los separadores de ' +
        'miles salen mal en el servidor. Usá los helpers de pdf/format.js.'
      );
    }
  });
});
