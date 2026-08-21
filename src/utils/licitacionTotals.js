// =============================================================================
// src/utils/licitacionTotals.js
// Totales de gastos de una licitación, respetando la moneda.
//
// Única fuente de verdad para el cálculo de gastos: lo consumen
// LicitacionModel.findById y licitacionGastoController.getGastos, que antes
// tenían cada uno su propia suma (y el mismo bug).
//
// REGLA: sólo se suman los gastos en la MISMA moneda que la licitación —
// idéntico criterio al que ya se aplica a las cotizaciones vinculadas. El
// resultado (ganancia/pérdida) se calcula restando ese total al ingreso, que
// está en la moneda de la licitación: mezclar monedas ahí produce una cifra
// financiera sin sentido presentada como si fuera correcta.
//
// Cubierto por tests/unit/licitacionTotals.test.js.
// =============================================================================

'use strict';

// El redondeo monetario compartido, uno solo para todo el sistema.
const { redondearCentavos } = require('./quotationTotals');

/**
 * Suma los gastos que están en `moneda` e informa si quedó alguno afuera.
 *
 * @param   {Array}  gastos — filas de licitacion_gastos ({ monto, moneda })
 * @param   {string} moneda — moneda de la licitación
 * @returns {{ total: number, tieneOtraMoneda: boolean }}
 */
function sumGastosEnMoneda(gastos = [], moneda = 'BOB') {
  let total = 0;
  let tieneOtraMoneda = false;

  for (const g of gastos) {
    // Un gasto sin moneda se asume en la de la licitación: así se cargaron
    // siempre desde la UI, que nunca ofreció elegirla.
    const monedaGasto = g?.moneda ?? moneda;
    if (monedaGasto === moneda) {
      total += Number(g?.monto) || 0;
    } else {
      tieneOtraMoneda = true;
    }
  }

  // Se redondea con la funcion compartida y NO con toFixed.
  //
  // toFixed no es una funcion de redondeo monetario: trabaja sobre el binario y
  // no sobre el decimal que uno escribio, asi que (49.995).toFixed(2) da 49.99.
  // Acá casi nunca se nota —los montos vienen de la base ya con dos decimales y
  // el residuo de la suma es de un orden mucho menor que medio centavo— pero
  // tener DOS redondeos de dinero distintos en el mismo sistema es exactamente
  // como volvio este bug las otras veces.
  //
  // Una sola cuenta: la de src/utils/quotationTotals.js, que es la que decide
  // los subtotales de la proforma y la vista previa del vendedor.
  return { total: redondearCentavos(total), tieneOtraMoneda };
}

module.exports = { sumGastosEnMoneda };
