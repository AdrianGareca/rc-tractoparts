// =============================================================================
// tests/unit/redondeoDeCentavos.test.js
// El medio centavo se redondea para arriba, como en toda factura.
//
// EL BUG
// calcularSubtotal redondeaba con `parseFloat(x.toFixed(2))`, y toFixed NO es
// una función de redondeo monetario. Trabaja sobre el número binario que
// realmente guarda la máquina, no sobre el decimal que uno escribió:
//
//     (49.995).toFixed(2)  ===  "49.99"     y debería ser 50.00
//     (1.005).toFixed(2)   ===  "1.00"      y debería ser 1.01
//
// El binario más cercano a 49.995 es 49.994999999999998863…, o sea un pelo POR
// DEBAJO. toFixed lo ve así y redondea para abajo. Cambiar a
// Math.round(x * 100) / 100 no arregla nada: mueve el error de lugar, porque
// 1.005 * 100 da 100.49999999999999 y vuelve a caer para abajo.
//
// DÓNDE SE VE
// En la línea de la proforma. Una manguera: 1,5 metros a Bs. 33,33.
//
//     CANT   P. UNIT   SUBTOTAL
//      1.5     33.33     49.99      <- la calculadora del cliente dice 50,00
//
// Y no queda ahí: MySQL calcula sobre DECIMAL, que es aritmética decimal exacta,
// y redondea el medio para arriba. Así que el subtotal que guarda JavaScript y
// el que daría la base al hacer la misma cuenta NO COINCIDEN. Cualquier reporte
// que rehaga la multiplicación en SQL contradice al PDF.
//
// LA SOLUCIÓN
// Antes de redondear se borra el ruido binario con toPrecision(15). Un `double`
// guarda entre 15 y 17 dígitos significativos confiables; recortar a 15
// devuelve el decimal que la persona escribió, y recién ahí se redondea.
//
// Es la técnica estándar para esto. La alternativa de verdad —aritmética
// decimal con enteros escalados— se descartó porque cantidad admite 4 decimales
// y precio hasta once dígitos: el producto escalado se pasa del entero seguro
// de JavaScript y el arreglo traería un desborde silencioso, que es peor que el
// centavo que vino a arreglar.
// =============================================================================

'use strict';

const { calcularSubtotal, calcularMontoTotal, redondearCentavos } = require('../../src/utils/quotationTotals');

// El modulo de dinero del navegador. Es una copia deliberada —el servidor es
// CommonJS y el navegador modulos nativos, y no hay paso de compilacion que
// pueda compartir un archivo entre los dos— y el ultimo bloque de este archivo
// exige que las dos digan lo mismo.
import { round2 } from '../../public/js/shared/quotationTotals.js';

// ---------------------------------------------------------------------------
describe('el medio centavo va para arriba', () => {
  // Los valores clásicos donde toFixed y Math.round fallan. Cada uno es un
  // decimal exacto cuyo binario más cercano cae del lado equivocado.
  test.each([
    [49.995,  50.00],
    [1.005,   1.01],
    [12.345,  12.35],
    [0.005,   0.01],
    [123.455, 123.46],
    [2.675,   2.68],
    [8.615,   8.62],
  ])('%s se redondea a %s', (crudo, esperado) => {
    expect(redondearCentavos(crudo)).toBe(esperado);
  });

  test('lo que ya tenía dos decimales no se mueve', () => {
    for (const n of [0, 0.01, 45.90, 123.45, 99999.99]) {
      expect(redondearCentavos(n)).toBe(n);
    }
  });

  test('para abajo cuando corresponde', () => {
    expect(redondearCentavos(49.994)).toBe(49.99);
    expect(redondearCentavos(1.0049)).toBe(1.00);
  });
});

// ---------------------------------------------------------------------------
describe('la línea de la proforma', () => {
  test('1,5 metros a 33,33 dan 50,00 y no 49,99', () => {
    // El caso exacto que encontró el bug.
    expect(calcularSubtotal(1.5, 33.33)).toBe(50.00);
  });

  test('las multiplicaciones de todos los días no cambiaron', () => {
    expect(calcularSubtotal(10, 12.35)).toBe(123.50);
    expect(calcularSubtotal(3, 45.90)).toBe(137.70);
    expect(calcularSubtotal(1, 0)).toBe(0);
    expect(calcularSubtotal(2, 1250)).toBe(2500);
  });

  test('sigue rechazando lo que no es una cantidad', () => {
    expect(() => calcularSubtotal(0, 10)).toThrow(/cantidad/);
    expect(() => calcularSubtotal(-1, 10)).toThrow(/cantidad/);
    expect(() => calcularSubtotal(1, -10)).toThrow(/precio/);
  });
});

// ---------------------------------------------------------------------------
describe('el total de la cotización', () => {
  test('suma los subtotales ya redondeados, no los crudos', () => {
    // Redondear por línea y DESPUÉS sumar no da lo mismo que sumar y redondear
    // al final. Se elige lo primero porque es lo que ve el cliente: la proforma
    // imprime cada línea redondeada, y el total tiene que ser la suma de esas
    // líneas impresas — si no, el cliente suma la columna y le da otra cosa.
    const detalles = [
      { cantidad: 1.5, precio_unitario: 33.33 },   // 50.00
      { cantidad: 1,   precio_unitario: 1.005 },   //  1.01  (el validador ya lo dejó en 1.01)
      { cantidad: 3,   precio_unitario: 45.90 },   // 137.70
    ];
    expect(calcularMontoTotal(detalles)).toBe(188.71);
  });

  test('una cotización sin ítems vale cero', () => {
    expect(calcularMontoTotal([])).toBe(0);
    expect(calcularMontoTotal(null)).toBe(0);
  });

  test('el total es exactamente la suma de la columna impresa', () => {
    // La propiedad, no un caso: sumar lo que el cliente ve tiene que dar lo que
    // el cliente ve abajo de todo.
    const detalles = [
      { cantidad: 1.5,  precio_unitario: 33.33 },
      { cantidad: 2.25, precio_unitario: 10.01 },
      { cantidad: 7,    precio_unitario: 99.99 },
      { cantidad: 0.5,  precio_unitario: 0.01 },
    ];

    const columnaImpresa = detalles.map((d) => calcularSubtotal(d.cantidad, d.precio_unitario));
    const sumaDeLaColumna = redondearCentavos(columnaImpresa.reduce((a, b) => a + b, 0));

    expect(calcularMontoTotal(detalles)).toBe(sumaDeLaColumna);
  });
});

// ---------------------------------------------------------------------------
describe('el redondeo es uno solo, en la pantalla y en el PDF', () => {
  // POR QUE ESTE BLOQUE
  // El navegador redondea para la vista previa en vivo —lo que el vendedor ve
  // mientras carga la cotizacion— y el servidor redondea para lo que se guarda
  // y se imprime. Si difieren, el vendedor arma la cotizacion mirando un total
  // y el cliente recibe un PDF con otro. Nadie se entera hasta que el cliente
  // llama a reclamar por un centavo.
  //
  // Los dos tenian el mismo bug de toFixed. Arreglar uno solo habria sido peor
  // que dejar los dos rotos: al menos coincidian.

  const CASOS = [
    49.995, 1.005, 12.345, 0.005, 123.455, 2.675, 8.615,
    0, 0.01, 45.90, 123.45, 99999.99, 49.994, 1.0049,
  ];

  test.each(CASOS)('%s se redondea igual de los dos lados', (n) => {
    expect(round2(n)).toBe(redondearCentavos(n));
  });

  test('el del navegador no propaga NaN y el del servidor no lo recibe', () => {
    // No son la misma funcion en los bordes, a proposito. El del navegador
    // recibe lo que hay tecleado en un campo de texto, asi que tiene que
    // sobrevivir a la basura: un NaN en una fila contaminaria el total entero y
    // la pantalla mostraria "NaN" donde va la plata.
    //
    // El del servidor recibe numeros que Zod ya valido, asi que no necesita esa
    // red — y ponersela escondería un error de programacion en vez de mostrarlo.
    expect(round2('abc')).toBe(0);
    expect(round2(undefined)).toBe(0);
    expect(round2(Infinity)).toBe(0);
  });
});
