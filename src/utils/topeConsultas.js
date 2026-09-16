// =============================================================================
// src/utils/topeConsultas.js
// Tope de tiempo para las consultas de reportes.
//
// POR QUÉ EXISTE
// En la ronda de estrés del 2026-09-15, con 40.000 cotizaciones, el reporte de
// consumo sin rango de fechas tardaba más de un minuto. Lo grave no era esperar:
// mientras corría ocupaba conexiones del pool (son diez), y con tres reportes a
// la vez el RESTO de la empresa pasaba de 71 a 15 peticiones por segundo. Un
// solo reporte pesado frenaba el login, los listados y el formulario de todos.
//
// La decisión (Adrian, 2026-09-15): un reporte que pase de 30 segundos se corta,
// y la pantalla le pide a la persona que acote las fechas. Nginx corta a los 60
// de todas formas, así que pasado ese punto nadie iba a ver el resultado.
//
// CÓMO
// MySQL 8 acepta la pista /*+ MAX_EXECUTION_TIME(ms) */ en un SELECT: al
// vencerse, aborta la consulta y libera la conexión. Sólo aplica a SELECT de
// nivel superior, que es exactamente lo que son todas las consultas de reporte.
//
// Cubierto por tests/unit/topeConsultas.test.js, que además exige que los
// modelos de reportes no ejecuten ninguna consulta sin el tope.
// =============================================================================

'use strict';

const { pool } = require('../config/db');

const TOPE_REPORTES_MS = 30_000;

// ER_QUERY_TIMEOUT: «Query execution was interrupted, maximum statement
// execution time exceeded».
const ERRNO_TOPE = 3024;

const MENSAJE_TOPE =
  'El reporte tardó demasiado en calcularse. Acotá el rango de fechas o agregá un filtro y volvé a intentar.';

/**
 * Agrega la pista de tope al primer SELECT de la consulta.
 *
 * @param   {string} sql
 * @param   {number} [ms]
 * @returns {string}
 */
function conTope(sql, ms = TOPE_REPORTES_MS) {
  const conPista = sql.replace(/^(\s*)SELECT\b/i, `$1SELECT /*+ MAX_EXECUTION_TIME(${ms}) */`);
  if (conPista === sql) {
    // Una consulta de reporte que no empieza con SELECT no puede llevar la
    // pista, y ejecutarla sin tope reabriría justo el problema que esto cierra.
    throw new Error('conTope: la consulta tiene que empezar con SELECT.');
  }
  return conPista;
}

/**
 * pool.execute con el tope puesto. Los modelos de reportes usan esta función
 * en lugar de pool.execute.
 */
function consultarReporte(sql, params) {
  return pool.execute(conTope(sql), params);
}

/** ¿El error es el tope vencido? */
function esTopeExcedido(err) {
  return err?.errno === ERRNO_TOPE || err?.code === 'ER_QUERY_TIMEOUT';
}

module.exports = { conTope, consultarReporte, esTopeExcedido, TOPE_REPORTES_MS, MENSAJE_TOPE };
