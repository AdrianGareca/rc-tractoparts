// =============================================================================
// src/models/quotation/misMetricas.js
// Las metricas propias de un ejecutivo: como viene su trabajo y como lo cierra.
//
// QUE RESPONDE, Y POR QUE ESA ES LA PREGUNTA
// El tablero del ejecutivo mostraba dos tablas: sus clientes principales y UNA
// fila con sus totales. Para alguien que quiere ver como viene, eso es un
// resumen de un renglon.
//
// La metrica que manda es la CONVERSION: de lo que envie al cliente, cuanto
// cerre. Es la que distingue al que cotiza mucho del que vende — y en esta
// empresa, donde se cotiza todo lo que llega, cotizar mucho no dice nada por si
// solo. La acompanan los dias promedio hasta el cierre: cerrar el 40% en cinco
// dias no es lo mismo que cerrar el 40% en dos meses.
//
// DOS REGLAS QUE HACEN QUE LOS NUMEROS SIGNIFIQUEN ALGO
//
//   1. EL DINERO NUNCA SE SUMA ENTRE MONEDAS. Un ejecutivo tiene cotizaciones
//      en USD y en Bs.; sumarlas da un numero sin sentido. Todo monto viene
//      desglosado por moneda, como ya se hace en el resto de los reportes.
//
//   2. LA CONVERSION SE MIDE SOBRE LO QUE SALIO AL CLIENTE. Dividir las
//      confirmadas por el TOTAL de cotizaciones castiga a quien todavia tiene
//      trabajo en curso: una cotizacion creada hoy no es una venta perdida.
//      El denominador son las que llegaron a manos del cliente — enviadas,
//      confirmadas y rechazadas — que son las unicas que ya tuvieron respuesta
//      o la estan esperando.
// =============================================================================

'use strict';

const { pool } = require('../../config/db');
// Qué cuenta como venta se decide en un solo lugar para todo el sistema.
const { ESTADOS_VENTA } = require('./constants');

// Estados en los que la cotizacion YA salio al cliente. Es el denominador de la
// conversion: lo que todavia esta en preparacion no cuenta ni a favor ni en
// contra. 'Aceptada' es el alias legado de 'Confirmada'.
const ESTADOS_EN_LA_CANCHA = ['Enviada al cliente', 'Confirmada', 'Aceptada', 'Rechazada'];
// Lo cerrado es LO MISMO que una venta, y esa definicion vive en
// constants.ESTADOS_VENTA. Tenerla escrita aca abria la puerta a que un
// dia divergiera de los reportes sin que nadie lo notara.
const ESTADOS_CERRADOS     = ESTADOS_VENTA;

/** Fragmento WHERE comun: un ejecutivo y, opcionalmente, un rango de fechas. */
function _where({ idEjecutivo, desde, hasta }) {
  const cond   = ['c.id_ejecutivo = ?'];
  const params = [idEjecutivo];

  if (desde) { cond.push('c.fecha_emision >= ?'); params.push(desde); }
  if (hasta) { cond.push('c.fecha_emision <= ?'); params.push(hasta); }

  return { clause: `WHERE ${cond.join(' AND ')}`, params };
}

// ---------------------------------------------------------------------------
// _periodoAnterior — la ventana inmediatamente previa, del mismo largo.
//
// «Mostrar sus avances» sin un punto de comparacion es un numero suelto: 57 %
// de conversion no se sabe si es bueno hasta verlo contra el mes pasado. Se
// calcula una ventana de IGUAL duracion pegada antes de la actual, para que la
// comparacion sea justa (un mes contra un mes, no un mes contra un trimestre).
//
// Sin rango de fechas no hay periodo anterior posible: se devuelve null y el
// PDF simplemente no dibuja la seccion.
// ---------------------------------------------------------------------------
function _periodoAnterior(desde, hasta) {
  if (!desde || !hasta) return null;

  const d = new Date(`${desde}T00:00:00Z`);
  const h = new Date(`${hasta}T00:00:00Z`);
  if (isNaN(d) || isNaN(h)) return null;

  const dias = Math.round((h - d) / 86400000) + 1;   // inclusivo en los dos extremos
  const finPrevio    = new Date(d.getTime() - 86400000);
  const inicioPrevio = new Date(finPrevio.getTime() - (dias - 1) * 86400000);
  const ymd = (x) => x.toISOString().slice(0, 10);

  return { desde: ymd(inicioPrevio), hasta: ymd(finPrevio) };
}

const marcadores = (n) => Array(n).fill('?').join(', ');

// Cada consulta es independiente (mismo WHERE, distinto agregado) — separadas
// para que obtener() sea la orquestacion y no cargue con el texto SQL de las
// siete a la vez. Todas reciben clause/params ya armados por _where().

/** Una fila por estado, conteo y monto separado por moneda. */
async function _fetchPorEstado(clause, params) {
  const [rows] = await pool.execute(`
    SELECT
      c.estado,
      COUNT(*)                                                      AS cantidad,
      SUM(CASE WHEN c.moneda = 'USD' THEN c.monto_total ELSE 0 END) AS monto_usd,
      SUM(CASE WHEN c.moneda = 'BOB' THEN c.monto_total ELSE 0 END) AS monto_bob
    FROM cotizaciones c
    ${clause}
    GROUP BY c.estado
    ORDER BY c.estado ASC
  `, params);
  return rows;
}

// Totales, conversion y tiempos en una sola pasada: son agregados sobre el
// mismo conjunto de filas y hacerlo en consultas separadas obligaria a
// repetir el WHERE tres veces.
//
// TIMESTAMPDIFF sobre creado_en → fecha_confirmacion mide el ciclo completo
// desde que el ejecutivo la cargo hasta que el cliente dijo que si. Solo
// promedia las que efectivamente cerraron: las abiertas no tienen "duracion"
// todavia y meterlas como cero hundiria el promedio.
async function _fetchResumen(clause, params) {
  const [[resumen]] = await pool.execute(`
    SELECT
      COUNT(*)                                                        AS total,
      SUM(c.estado IN (${marcadores(ESTADOS_EN_LA_CANCHA.length)}))   AS en_la_cancha,
      SUM(c.estado IN (${marcadores(ESTADOS_CERRADOS.length)}))       AS cerradas,
      SUM(c.estado = 'Rechazada')                                     AS rechazadas,
      AVG(CASE WHEN c.estado IN (${marcadores(ESTADOS_CERRADOS.length)}) AND c.fecha_confirmacion IS NOT NULL
               THEN TIMESTAMPDIFF(DAY, c.creado_en, c.fecha_confirmacion) END) AS dias_cierre,
      AVG(CASE WHEN c.moneda = 'USD' AND c.estado IN (${marcadores(ESTADOS_CERRADOS.length)}) THEN c.monto_total END) AS ticket_usd,
      AVG(CASE WHEN c.moneda = 'BOB' AND c.estado IN (${marcadores(ESTADOS_CERRADOS.length)}) THEN c.monto_total END) AS ticket_bob
    FROM cotizaciones c
    ${clause}
  `, [
    ...ESTADOS_EN_LA_CANCHA, ...ESTADOS_CERRADOS, ...ESTADOS_CERRADOS,
    ...ESTADOS_CERRADOS, ...ESTADOS_CERRADOS, ...params,
  ]);
  return resumen;
}

/** "Mis avances" mes a mes: cuantas se cargaron y cuantas se cerraron. */
async function _fetchPorMes(clause, params) {
  const [rows] = await pool.execute(`
    SELECT
      DATE_FORMAT(c.fecha_emision, '%Y-%m')                        AS mes,
      COUNT(*)                                                     AS emitidas,
      SUM(c.estado IN (${marcadores(ESTADOS_CERRADOS.length)}))    AS cerradas
    FROM cotizaciones c
    ${clause}
    GROUP BY mes
    ORDER BY mes DESC
    LIMIT 12
  `, [...ESTADOS_CERRADOS, ...params]);
  return rows;
}

// Enviadas al cliente que todavia no se cerraron ni se rechazaron, con los
// dias que llevan esperando. Es la unica seccion ACCIONABLE del reporte: no
// dice como te fue, dice a quien llamar manana.
async function _fetchPendientes(clause, params) {
  const [rows] = await pool.execute(`
    SELECT
      c.numero_correlativo,
      cl.razon_social                                   AS cliente,
      c.monto_total,
      c.moneda,
      DATEDIFF(CURDATE(), c.fecha_emision)              AS dias_esperando
    FROM cotizaciones c
    INNER JOIN clientes cl ON cl.id = c.id_cliente
    ${clause} AND c.estado = 'Enviada al cliente'
    ORDER BY dias_esperando DESC
    LIMIT 15
  `, params);
  return rows;
}

/** La evidencia concreta detras del porcentaje: que vendio, a quien y cuando. */
async function _fetchConfirmadas(clause, params) {
  const [rows] = await pool.execute(`
    SELECT
      c.numero_correlativo,
      cl.razon_social        AS cliente,
      c.monto_total,
      c.moneda,
      c.fecha_confirmacion
    FROM cotizaciones c
    INNER JOIN clientes cl ON cl.id = c.id_cliente
    ${clause} AND c.estado IN (${marcadores(ESTADOS_CERRADOS.length)})
    ORDER BY c.fecha_confirmacion DESC
    LIMIT 20
  `, [...params, ...ESTADOS_CERRADOS]);
  return rows;
}

// Que vende ESTE ejecutivo. El codigo se unifica entre el catalogo y el
// escrito a mano, igual que en el reporte de consumo: sin eso, el mismo
// repuesto sale partido en dos filas segun como lo cargo.
//
// La subconsulta NO es adorno: MySQL corre con sql_mode=only_full_group_by y
// exige que cada columna no agregada este LITERALMENTE en el GROUP BY.
// Agrupar por el alias de un COALESCE y a la vez seleccionar sus columnas de
// origen lo rechaza. Resolviendo el codigo abajo, arriba se agrupa por
// columnas simples y la condicion se cumple sola. (Mismo motivo y misma forma
// que en clienteItemReport.js.)
async function _fetchTopItems(clause, params) {
  const [rows] = await pool.execute(`
    SELECT
      l.codigo,
      SUBSTRING_INDEX(GROUP_CONCAT(l.descripcion_item ORDER BY CHAR_LENGTH(l.descripcion_item) DESC SEPARATOR '||'), '||', 1) AS descripcion,
      l.marca,
      l.unidad,
      SUM(l.cantidad)              AS cantidad,
      COUNT(DISTINCT l.id_cliente) AS clientes
    FROM (
      SELECT
        COALESCE(NULLIF(p.codigo, ''), NULLIF(d.codigo_parte, ''), d.descripcion_item) AS codigo,
        d.descripcion_item,
        mk.nombre    AS marca,
        d.unidad,
        d.cantidad,
        c.id_cliente
      FROM cotizacion_detalles d
      INNER JOIN cotizaciones c  ON c.id  = d.id_cotizacion
      LEFT  JOIN productos     p  ON p.id  = d.id_producto
      LEFT  JOIN marcas        mk ON mk.id = d.marca_id
      ${clause}
    ) AS l
    GROUP BY l.codigo, l.marca, l.unidad
    ORDER BY cantidad DESC
    LIMIT 15
  `, params);
  return rows;
}

/**
 * @param {Object} opts
 * @param {number} opts.idEjecutivo
 * @param {string} [opts.desde]  YYYY-MM-DD
 * @param {string} [opts.hasta]  YYYY-MM-DD
 * @returns {Promise<Object>}
 */
async function obtener({ idEjecutivo, desde = null, hasta = null, conComparacion = true }) {
  const { clause, params } = _where({ idEjecutivo, desde, hasta });

  const porEstado    = await _fetchPorEstado(clause, params);
  const resumen      = await _fetchResumen(clause, params);
  const porMes       = await _fetchPorMes(clause, params);
  const pendientes   = await _fetchPendientes(clause, params);
  const confirmadas  = await _fetchConfirmadas(clause, params);
  const topItems     = await _fetchTopItems(clause, params);

  // ── Comparacion con el periodo anterior ──────────────────────────────────
  // Un 57 % de conversion no se sabe si es bueno hasta verlo contra el mes
  // pasado. `conComparacion: false` corta la recursion: el periodo previo se
  // calcula a si mismo con la misma funcion y no necesita SU propio previo.
  let comparacion = null;
  if (conComparacion) {
    const previo = _periodoAnterior(desde, hasta);
    if (previo) {
      const antes = await obtener({
        idEjecutivo, desde: previo.desde, hasta: previo.hasta, conComparacion: false,
      });
      comparacion = {
        periodo:    previo,
        conversion: antes.conversion,
        cerradas:   antes.cerradas,
        emitidas:   antes.total,
      };
    }
  }

  const enLaCancha = Number(resumen.en_la_cancha || 0);
  const cerradas   = Number(resumen.cerradas || 0);

  return {
    // LA metrica. Null y no 0 cuando todavia no salio ninguna: "0% de
    // conversion" y "todavia no enviaste nada" son cosas distintas, y mostrar
    // un 0% rojo a alguien que recien arranca es informacion falsa.
    conversion: enLaCancha > 0 ? Number(((cerradas / enLaCancha) * 100).toFixed(1)) : null,

    total:        Number(resumen.total || 0),
    en_la_cancha: enLaCancha,
    cerradas,
    rechazadas:   Number(resumen.rechazadas || 0),
    en_proceso:   Number(resumen.total || 0) - enLaCancha,

    dias_cierre: resumen.dias_cierre != null ? Number(Number(resumen.dias_cierre).toFixed(1)) : null,
    ticket_usd:  resumen.ticket_usd  != null ? Number(Number(resumen.ticket_usd).toFixed(2))  : null,
    ticket_bob:  resumen.ticket_bob  != null ? Number(Number(resumen.ticket_bob).toFixed(2))  : null,

    por_estado: porEstado.map((r) => ({
      estado:    r.estado,
      cantidad:  Number(r.cantidad),
      monto_usd: Number(r.monto_usd || 0),
      monto_bob: Number(r.monto_bob || 0),
    })),

    comparacion,

    pendientes: pendientes.map((r) => ({
      correlativo:    r.numero_correlativo,
      cliente:        r.cliente,
      monto:          Number(r.monto_total || 0),
      moneda:         r.moneda,
      dias_esperando: Number(r.dias_esperando || 0),
    })),

    confirmadas: confirmadas.map((r) => ({
      correlativo: r.numero_correlativo,
      cliente:     r.cliente,
      monto:       Number(r.monto_total || 0),
      moneda:      r.moneda,
      fecha:       r.fecha_confirmacion,
    })),

    top_items: topItems.map((r) => ({
      codigo:      r.codigo,
      descripcion: r.descripcion,
      marca:       r.marca,
      unidad:      r.unidad,
      cantidad:    Number(r.cantidad || 0),
      clientes:    Number(r.clientes || 0),
    })),

    por_mes: porMes.map((r) => ({
      mes:      r.mes,
      emitidas: Number(r.emitidas),
      cerradas: Number(r.cerradas),
    })).reverse(),        // cronologico para el grafico
  };
}

module.exports = { obtener, ESTADOS_EN_LA_CANCHA, ESTADOS_CERRADOS };
