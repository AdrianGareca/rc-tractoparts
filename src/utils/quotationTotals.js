// =============================================================================
// src/utils/quotationTotals.js
// Shared line-item total calculation — the SINGLE source of truth for how a
// quotation's monto_total is derived from its detalles.
//
// Both QuotationController.createQuotation and QuotationController.updateQuotation
// must compute the header total the exact same way QuotationModel.createDetalles
// rounds and stores each line's subtotal (round-per-line, THEN sum) — otherwise
// cotizaciones.monto_total (used by reports) can diverge from
// SUM(cotizacion_detalles.subtotal) (used by the PDF) by a rounding cent.
// Extracted here so there is only one implementation to keep in sync, and so
// it can be unit-tested directly instead of via a reimplementation.
// =============================================================================

'use strict';

/**
 * redondearCentavos
 * Redondea a dos decimales con el medio HACIA ARRIBA, como cualquier factura.
 *
 * POR QUE NO ALCANZA toFixed(2)
 * toFixed no es una funcion de redondeo monetario: trabaja sobre el numero
 * binario que realmente guarda la maquina, no sobre el decimal que uno escribio.
 *
 *     (49.995).toFixed(2)  ===  "49.99"   y deberia ser 50.00
 *     (1.005).toFixed(2)   ===  "1.00"    y deberia ser 1.01
 *
 * El binario mas cercano a 49.995 es 49.994999999999998863..., o sea un pelo por
 * DEBAJO, y toFixed lo redondea para abajo. Cambiar a Math.round(x * 100) / 100
 * no arregla nada: mueve el error de lugar, porque 1.005 * 100 da
 * 100.49999999999999 y vuelve a caer para abajo.
 *
 * Se veia en la linea de la proforma: 1,5 metros de manguera a Bs. 33,33
 * imprimian un subtotal de 49,99 mientras la calculadora del cliente daba
 * 50,00. Y MySQL, que calcula sobre DECIMAL —aritmetica decimal exacta— redondea
 * el medio para arriba, asi que el subtotal guardado por JavaScript y el que
 * daria la base al rehacer la cuenta NO coincidian.
 *
 * COMO SE ARREGLA
 * Antes de redondear se borra el ruido binario con toPrecision(15). Un `double`
 * guarda entre 15 y 17 digitos significativos confiables; recortar a 15 devuelve
 * el decimal que la persona escribio, y recien ahi se redondea.
 *
 * POR QUE NO ARITMETICA CON ENTEROS ESCALADOS, QUE SERIA LO EXACTO
 * Porque cantidad admite 4 decimales y precio hasta once digitos: el producto
 * escalado se pasa del entero seguro de JavaScript (9.007e15) y traeria un
 * desborde silencioso, que es bastante peor que el centavo que vino a arreglar.
 *
 * Cubierto por tests/unit/redondeoDeCentavos.test.js.
 *
 * @param   {number} n
 * @returns {number} el mismo numero con a lo sumo dos decimales
 */
function redondearCentavos(n) {
  // toPrecision devuelve texto —a veces en notacion exponencial para numeros
  // muy grandes o muy chicos—, y Number() lo entiende en las dos formas.
  return Math.round(Number((n * 100).toPrecision(15))) / 100;
}

/**
 * calcularSubtotal
 * Compute the subtotal for one line item: cantidad × precio_unitario, rounded to 2 decimals.
 * Throws a descriptive error if inputs are invalid (callers must validate beforehand;
 * this is a defensive guard, not the primary validation layer).
 *
 * @param   {number} cantidad        - Quantity (must be > 0)
 * @param   {number} precioUnitario  - Unit price (must be >= 0)
 * @returns {number}                 - Rounded subtotal
 */
function calcularSubtotal(cantidad, precioUnitario) {
  if (typeof cantidad !== 'number' || cantidad <= 0) {
    throw new Error('cantidad debe ser mayor a 0');
  }

  if (typeof precioUnitario !== 'number' || precioUnitario < 0) {
    throw new Error('precio_unitario debe ser mayor o igual a 0');
  }

  return redondearCentavos(cantidad * precioUnitario);
}

/**
 * calcularMontoTotal
 * Sum the ALREADY-ROUNDED subtotals of all line items. Returns 0.00 for an
 * empty array. Each item must have cantidad and precio_unitario properties.
 * Does not apply any discount — callers subtract descuento_manual themselves.
 *
 * @param   {Array<{cantidad: number, precio_unitario: number}>} detalles
 * @returns {number} - Total amount rounded to 2 decimals
 */
function calcularMontoTotal(detalles) {
  if (!Array.isArray(detalles) || detalles.length === 0) {
    return 0.00;
  }

  const total = detalles.reduce((acc, item) => {
    return acc + calcularSubtotal(item.cantidad, item.precio_unitario);
  }, 0);

  // Se redondea igual al final aunque los sumandos ya vengan redondeados: sumar
  // floats de dos decimales deja basura en el decimoquinto digito (0.1 + 0.2 da
  // 0.30000000000000004), y ese residuo llega tal cual a MySQL.
  return redondearCentavos(total);
}

module.exports = { calcularSubtotal, calcularMontoTotal, redondearCentavos };
