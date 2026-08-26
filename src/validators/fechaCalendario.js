// =============================================================================
// src/validators/fechaCalendario.js
// ¿La fecha existe de verdad en el calendario?
//
// EL BUG QUE ESTO ARREGLA
// Cada campo de fecha (fecha_emision, fecha_validez, fecha_proximo_seguimiento,
// fecha_limite de licitación...) sólo se validaba con
// /^\d{4}-\d{2}-\d{2}$/ — un chequeo de FORMATO, no de calendario. Una fecha
// con el formato correcto pero imposible ("2026-02-30", "2026-13-01",
// "2026-00-00") pasaba esa regex sin problema, llegaba intacta hasta MySQL, y
// la columna DATE la rechazaba con una excepción que ningún controller
// atrapaba — HTTP 500 genérico en vez de un 422 claro. Encontrado en la ronda
// de estrés del 2026-08-26 en al menos dos endpoints distintos
// (POST /api/cotizaciones y PATCH /api/cotizaciones/:id/seguimiento), pero el
// mismo regex está repetido en 5 lugares (cotizaciones y licitaciones), así
// que el arreglo va en un solo sitio para que no puedan volver a divergir.
//
// CÓMO SE VERIFICA
// New Date(Date.UTC(...)) "desborda" en vez de fallar: el mes 13 se convierte
// en enero del año siguiente, el día 30 de febrero se convierte en el 1 o 2 de
// marzo. Por eso no alcanza con construir la fecha — hay que reconstruir la
// cadena a partir de los componentes que YA devolvió el objeto Date y
// compararla con la original. Si desbordó, no van a coincidir.
// =============================================================================

'use strict';

const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param   {string} valor — ya se asume que pasó FORMATO_FECHA
 * @returns {boolean} true si year-month-day es una fecha real del calendario
 */
function esFechaCalendarioValida(valor) {
  if (typeof valor !== 'string' || !FORMATO_FECHA.test(valor)) return false;

  const [anio, mes, dia] = valor.split('-').map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));

  return (
    fecha.getUTCFullYear() === anio &&
    fecha.getUTCMonth() === mes - 1 &&
    fecha.getUTCDate() === dia
  );
}

module.exports = { FORMATO_FECHA, esFechaCalendarioValida };
