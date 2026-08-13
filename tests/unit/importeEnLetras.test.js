// =============================================================================
// tests/unit/importeEnLetras.test.js
// La línea SON: tiene que decir el mismo número que el TOTAL de arriba.
//
// EL BUG
// numberToWordsES sacaba los centavos así:
//
//     const n     = Math.floor(abs);
//     const cents = Math.round((abs - n) * 100);
//
// Cuando esa cuenta da 100 —porque el resto es 0.999…— el entero NO arrastra y
// los centavos se imprimen tal cual. El PDF terminaba diciendo:
//
//     TOTAL:  Bs. 189.00
//     SON:    CIENTO OCHENTA Y OCHO CON 100/100 BOLIVIANOS
//
// El número dice ciento ochenta y nueve, las letras dicen ciento ochenta y ocho
// con cien centavos — que ni siquiera es un importe que exista. En una proforma
// boliviana el importe en letras es el que manda, así que las dos cifras del
// mismo documento se contradicen en el renglón que tiene peso legal.
//
// CÓMO SE LLEGABA AHÍ
// El total del PDF se arma con un reduce que suma los subtotales SIN redondear.
// Sumar catorce valores de dos decimales en punto flotante deja residuo, y a
// veces cae para abajo: 188.99999999999997. fmtNum lo imprime como 189.00
// —toFixed redondea— pero numberToWordsES lo parte en 188 + 100 centavos.
//
// LOS DOS ARREGLOS
//   1. numberToWordsES arrastra: 100 centavos son un entero más y cero centavos.
//   2. el total del PDF se redondea con redondearCentavos antes de usarse, así
//      el residuo no llega nunca — que es atacar la causa y no el síntoma.
//
// Se hacen los dos a propósito. El segundo cierra el camino conocido; el primero
// deja la función correcta para cualquier camino que aparezca después.
// =============================================================================

'use strict';

const { numberToWordsES } = require('../../src/services/pdf/numberToWords');
const { redondearCentavos } = require('../../src/utils/quotationTotals');

// ---------------------------------------------------------------------------
describe('los centavos nunca llegan a cien', () => {
  test.each([
    [188.99999999999997, 'CIENTO OCHENTA Y NUEVE CON 00/100'],
    [1234.999,           'MIL DOSCIENTOS TREINTA Y CINCO CON 00/100'],
    [0.999,              'UNO CON 00/100'],
    [99.999,             'CIEN CON 00/100'],
  ])('%s se dice %s', (monto, esperado) => {
    expect(numberToWordsES(monto)).toBe(esperado);
  });

  test('el arrastre cruza la decena, la centena y el millar', () => {
    // Cada uno obliga a rehacer el nombre del número entero, no sólo a sumarle
    // uno: "NUEVE" no se convierte en "DIEZ" pegándole un dígito.
    expect(numberToWordsES(9.999)).toBe('DIEZ CON 00/100');
    expect(numberToWordsES(999.999)).toBe('MIL CON 00/100');
    expect(numberToWordsES(999999.999)).toBe('UN MILLÓN CON 00/100');
  });

  test('nunca aparece la cadena 100/100', () => {
    // La propiedad, no un caso. Se barre el borde con paso fino.
    for (let i = 0; i < 400; i++) {
      const monto = i * 1.7 + 0.9994 + i * 0.0001;
      expect(numberToWordsES(monto)).not.toContain('100/100');
    }
  });
});

// ---------------------------------------------------------------------------
describe('lo que ya decía bien sigue igual', () => {
  test.each([
    [12345.67, 'DOCE MIL TRESCIENTOS CUARENTA Y CINCO CON 67/100'],
    [0,        'CERO CON 00/100'],
    [1,        'UNO CON 00/100'],
    [0.5,      'CERO CON 50/100'],
  ])('%s se dice %s', (monto, esperado) => {
    expect(numberToWordsES(monto)).toBe(esperado);
  });

  test('un monto ilegible no rompe el PDF', () => {
    // El PDF se genera igual: es preferible una proforma con CERO en letras y
    // el número correcto arriba, que una descarga que falla sin explicación.
    expect(numberToWordsES(null)).toBe('CERO CON 00/100');
    expect(numberToWordsES('abc')).toBe('CERO CON 00/100');
    expect(numberToWordsES(undefined)).toBe('CERO CON 00/100');
  });
});

// ---------------------------------------------------------------------------
describe('el número y las letras no se contradicen', () => {
  // La prueba que de verdad importa: lo que se imprime arriba y lo que se
  // imprime abajo tienen que ser el mismo importe.
  const MONTOS = [
    188.99999999999997, 1234.999, 0.999, 99.999, 12345.67, 0.5, 1000.005, 49.995,
  ];

  test.each(MONTOS)('%s — el entero de las letras coincide con el número impreso', (monto) => {
    // Lo que imprime la caja del TOTAL, que redondea a dos decimales.
    const numeroImpreso = redondearCentavos(monto);

    // Lo que dice el renglón SON:, leído al revés.
    const letras = numberToWordsES(monto);
    const centavos = parseInt(letras.match(/CON (\d+)\/100/)[1], 10);

    expect(centavos).toBeLessThan(100);
    // Los centavos de las letras tienen que ser los del número impreso.
    expect(centavos).toBe(Math.round((numeroImpreso - Math.floor(numeroImpreso)) * 100));
  });
});
