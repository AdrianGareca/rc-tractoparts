// =============================================================================
// tests/unit/licitacionTotals.test.js
// Red de seguridad del total de gastos de una licitación.
//
// BUG QUE ESTO ARREGLA: LicitacionModel.findById filtraba las cotizaciones
// vinculadas por moneda ("sumar montos de monedas distintas daría una
// comparación sin sentido", dice su propio comentario) y tres líneas más abajo
// sumaba TODOS los gastos sin filtrar. El resultado —presentado en la UI como
// "📈 Ganancia" / "📉 Pérdida"— restaba dólares a bolivianos.
// =============================================================================

'use strict';

const { sumGastosEnMoneda } = require('../../src/utils/licitacionTotals');

const g = (monto, moneda) => ({ monto, moneda });

describe('sumGastosEnMoneda — moneda única', () => {
  test('suma los gastos de la misma moneda', () => {
    expect(sumGastosEnMoneda([g(100, 'BOB'), g(250.5, 'BOB')], 'BOB'))
      .toEqual({ total: 350.5, tieneOtraMoneda: false });
  });

  test('una lista vacía da cero', () => {
    expect(sumGastosEnMoneda([], 'BOB')).toEqual({ total: 0, tieneOtraMoneda: false });
  });

  test('sin argumentos no rompe', () => {
    expect(sumGastosEnMoneda()).toEqual({ total: 0, tieneOtraMoneda: false });
  });

  test('funciona igual en USD', () => {
    expect(sumGastosEnMoneda([g(40, 'USD'), g(60, 'USD')], 'USD'))
      .toEqual({ total: 100, tieneOtraMoneda: false });
  });
});

describe('sumGastosEnMoneda — el bug: monedas mezcladas', () => {
  test('NO suma los gastos en otra moneda', () => {
    // Antes: 100 + 500 = 600 restado a un ingreso en bolivianos.
    expect(sumGastosEnMoneda([g(100, 'BOB'), g(500, 'USD')], 'BOB'))
      .toEqual({ total: 100, tieneOtraMoneda: true });
  });

  test('avisa que hay gastos excluidos para que la UI lo muestre', () => {
    expect(sumGastosEnMoneda([g(500, 'USD')], 'BOB'))
      .toEqual({ total: 0, tieneOtraMoneda: true });
  });

  test('el escenario completo: licitación en BOB con un gasto en USD', () => {
    // Licitación en BOB, ingreso Bs. 10.000, un gasto de USD 500.
    // Antes daba "Ganancia Bs. 9.500" (restaba 500 como si fueran bolivianos);
    // el gasto real son ~Bs. 3.450, así que la cifra se iba por ~Bs. 2.950.
    const { total, tieneOtraMoneda } = sumGastosEnMoneda(
      [g(500, 'USD')], 'BOB'
    );

    expect(total).toBe(0);              // no se mezcla
    expect(tieneOtraMoneda).toBe(true); // pero se avisa
    expect(10000 - total).toBe(10000);  // el ingreso queda intacto
  });

  test('mezcla en ambos sentidos', () => {
    const gastos = [g(100, 'BOB'), g(200, 'USD'), g(50, 'BOB'), g(300, 'USD')];

    expect(sumGastosEnMoneda(gastos, 'BOB')).toEqual({ total: 150, tieneOtraMoneda: true });
    expect(sumGastosEnMoneda(gastos, 'USD')).toEqual({ total: 500, tieneOtraMoneda: true });
  });
});

describe('sumGastosEnMoneda — datos imperfectos', () => {
  test('un gasto sin moneda se asume en la de la licitación', () => {
    // Las filas viejas se cargaron desde una UI que nunca ofreció elegir moneda.
    expect(sumGastosEnMoneda([{ monto: 100 }], 'BOB'))
      .toEqual({ total: 100, tieneOtraMoneda: false });
  });

  test('un monto no numérico cuenta como 0 y no rompe el total', () => {
    expect(sumGastosEnMoneda([g('abc', 'BOB'), g(100, 'BOB')], 'BOB'))
      .toEqual({ total: 100, tieneOtraMoneda: false });
  });

  test('acepta montos como string (DECIMAL de MySQL)', () => {
    expect(sumGastosEnMoneda([g('100.50', 'BOB')], 'BOB').total).toBe(100.5);
  });

  test('una fila nula no rompe el recorrido', () => {
    expect(() => sumGastosEnMoneda([null, g(10, 'BOB')], 'BOB')).not.toThrow();
    expect(sumGastosEnMoneda([null, g(10, 'BOB')], 'BOB').total).toBe(10);
  });

  test('redondea a 2 decimales (evita el arrastre de coma flotante)', () => {
    expect(sumGastosEnMoneda([g(0.1, 'BOB'), g(0.2, 'BOB')], 'BOB').total).toBe(0.3);
  });
});
