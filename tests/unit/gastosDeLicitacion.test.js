// =============================================================================
// tests/unit/gastosDeLicitacion.test.js
// La plata de los gastos se trata como plata en todo el recorrido.
//
// QUÉ SON ESTOS GASTOS
// Lo que costó presentarse a un concurso y cumplirlo: garantías, notarías,
// fletes, viáticos. Se cargan cuando la licitación se adjudica, y su suma
// contra lo cotizado es lo que dice si el negocio dejó margen o se perdió plata.
// O sea: no son un dato accesorio, son la mitad de la respuesta.
//
// LOS DOS PROBLEMAS
//
// 1. EL MONTO ACEPTABA DECIMALES QUE LA COLUMNA NO GUARDA
//    `monto` se validaba con z.number().positive() sin límite de decimales, y
//    la columna es DECIMAL(15,2). Quien cargaba 1234.567 veía guardado 1234.57,
//    y la bitácora registraba 1234.567 — el registro de auditoría y el dato real
//    decían cosas distintas sobre el mismo gasto.
//
//    Es la tercera vez que aparece esta forma en el proyecto: ya pasó con
//    precio_unitario y con descuento_manual. La regla del proyecto es «el número
//    que se valida es el número que se guarda».
//
// 2. LA SUMA NO SE REDONDEABA AL FINAL
//    sumGastosEnMoneda hacía `total += Number(g.monto)` y devolvía eso. Sumar
//    valores de dos decimales en punto flotante deja residuo: catorce gastos
//    pueden dar 4821.9500000000007. Ese número es el que se compara contra lo
//    cotizado para decir si hubo ganancia.
// =============================================================================

'use strict';

const { createGastoSchema } = require('../../src/validators/licitacionValidator');
const { sumGastosEnMoneda } = require('../../src/utils/licitacionTotals');

/** Lo que hace la columna DECIMAL(15,2) al guardar. */
const comoLoGuardaLaBase = (n) => Math.round(n * 100) / 100;

const gastoCon = (monto) => ({ concepto: 'Garantía de seriedad', monto });

// ---------------------------------------------------------------------------
describe('el monto que se valida es el que se guarda', () => {
  test('un monto de tres decimales se redondea al entrar', () => {
    const res = createGastoSchema.safeParse(gastoCon(1234.567));
    expect(res.success).toBe(true);
    expect(res.data.monto).toBe(1234.57);
  });

  // Los valores esperados se escriben a mano y NO se calculan con
  // Math.round(n * 100) / 100.
  //
  // Ese atajo NO es un modelo fiel de la columna: para 1.005 devuelve 1.00,
  // porque 1.005 * 100 en punto flotante da 100.49999999999999. MySQL hace
  // aritmética decimal EXACTA y redondea el medio hacia arriba, así que guarda
  // 1.01. Usar el atajo como referencia haría que el test exigiera el
  // comportamiento equivocado.
  test.each([
    [1234.567, 1234.57],
    [0.005,    0.01],
    [99.994,   99.99],
    [1.005,    1.01],
    [45.999,   46.00],
  ])('%s se guarda como %s, igual que MySQL', (crudo, esperado) => {
    expect(createGastoSchema.safeParse(gastoCon(crudo)).data.monto).toBe(esperado);
  });

  test('un monto que ya tenía dos decimales no se toca', () => {
    expect(createGastoSchema.safeParse(gastoCon(1500.50)).data.monto).toBe(1500.50);
  });

  test('el medio centavo va para arriba, como en toda factura', () => {
    // El mismo criterio que el redondeo de los subtotales de la proforma.
    expect(createGastoSchema.safeParse(gastoCon(49.995)).data.monto).toBe(50.00);
  });
});

// ---------------------------------------------------------------------------
describe('lo que ya se rechazaba se sigue rechazando', () => {
  test('un gasto de cero no es un gasto', () => {
    expect(createGastoSchema.safeParse(gastoCon(0)).success).toBe(false);
  });

  test('un monto negativo tampoco', () => {
    expect(createGastoSchema.safeParse(gastoCon(-100)).success).toBe(false);
  });

  test('el redondeo no puede colar un cero por la ventana', () => {
    // 0.001 redondeado a dos decimales da 0, y un gasto de cero está prohibido.
    // Tiene que rechazarse, no entrar como cero.
    expect(createGastoSchema.safeParse(gastoCon(0.001)).success).toBe(false);
  });

  test('sin concepto no se registra', () => {
    expect(createGastoSchema.safeParse({ monto: 100 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('la suma de los gastos', () => {
  test('no arrastra el residuo del punto flotante', () => {
    // Los tres clásicos: 0.1 + 0.2 no da 0.3 en binario.
    const gastos = [
      { monto: 0.1, moneda: 'BOB' },
      { monto: 0.2, moneda: 'BOB' },
    ];
    expect(sumGastosEnMoneda(gastos, 'BOB').total).toBe(0.3);
  });

  test('el medio centavo de la suma va para arriba', () => {
    // Este es el que distingue las dos funciones de redondeo: toFixed devolvia
    // 49.99 para este caso, redondearCentavos devuelve 50.00. Es la misma
    // cuenta que decide los subtotales de la proforma.
    expect(sumGastosEnMoneda([{ monto: 49.995, moneda: 'BOB' }], 'BOB').total).toBe(50.00);
  });

  test('catorce gastos dan un número limpio', () => {
    const gastos = Array.from({ length: 14 }, () => ({ monto: 344.425, moneda: 'BOB' }));
    const { total } = sumGastosEnMoneda(gastos, 'BOB');

    // Sin redondeo final esto daba algo como 4821.9500000000007, y ese número
    // es el que se compara contra lo cotizado para decir si hubo ganancia.
    expect(total).toBe(comoLoGuardaLaBase(total));
    expect(String(total).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2);
  });

  test('sigue avisando cuando hay gastos en otra moneda', () => {
    // No se convierten monedas: mezclarlas daría un total falso. Se suman los
    // de la moneda pedida y se avisa que hay otros.
    const gastos = [
      { monto: 100, moneda: 'BOB' },
      { monto: 50,  moneda: 'USD' },
    ];
    const { total, tieneOtraMoneda } = sumGastosEnMoneda(gastos, 'BOB');
    expect(total).toBe(100);
    expect(tieneOtraMoneda).toBe(true);
  });

  test('un gasto sin moneda se asume en la de la licitación', () => {
    // Así se cargaron siempre desde la pantalla, que nunca ofreció elegirla.
    const { total } = sumGastosEnMoneda([{ monto: 250 }], 'USD');
    expect(total).toBe(250);
  });

  test('sin gastos el total es cero, no NaN', () => {
    expect(sumGastosEnMoneda([], 'BOB').total).toBe(0);
    expect(sumGastosEnMoneda(undefined, 'BOB').total).toBe(0);
  });
});
