// =============================================================================
// src/controllers/quotation/licitacionLinkGuard.js
// Verificar que la licitación a la que se ata una cotización exista Y no esté
// en un estado terminal que ya no admite nuevas cotizaciones.
//
// DE DÓNDE SALE
// Estaba escrito dos veces en quotationController.js —una en createQuotation y
// otra en updateQuotation— y el segundo comentario decía textualmente «Mirror
// createQuotation». La duplicación era consciente, que es la peor clase: se
// sabía que estaba y se aceptó, así que nadie iba a arreglarla sola.
//
// POR QUÉ ESTA COMPROBACIÓN EXISTE, SI LA CLAVE FORÁNEA YA PROTEGE
// Porque protege distinto. Sin este control, un id_licitacion inexistente llega
// hasta el INSERT y MySQL lo rechaza con una violación de clave foránea, que
// sube como excepción y sale por el manejador genérico: HTTP 500 con «error
// interno». El usuario no tiene forma de saber que el problema era el número de
// licitación que eligió.
//
// Con el control, es un 422 que nombra el número. La restricción de la base
// sigue estando: es la última línea de defensa contra una carrera —que la
// licitación se archive entre esta consulta y el INSERT—, no la primera.
//
// SEGUNDO BUG DE LA MISMA RONDA (2026-08-26): este guardián sólo verificaba
// EXISTENCIA, nunca el ESTADO. Se podía crear o editar una cotización
// vinculándola a una licitación ya 'Archivada' o 'No adjudicada' —el concurso
// ya se perdió o se cerró— sin ningún aviso. Ahora esos dos estados bloquean
// un vínculo NUEVO o CAMBIADO con un 422. Una cotización que YA estaba atada a
// esa licitación antes de que se archivara/perdiera no se desata sola: si el
// body no está CAMBIANDO el vínculo, se deja pasar (mismo criterio de "no
// trabar lo que ya existía" que clienteLinkGuard.js aplica para el cliente).
// =============================================================================

'use strict';

const LicitacionModel = require('../../models/LicitacionModel');

// Estados terminales/de desenlace: una licitación acá ya no admite que se le
// aten cotizaciones NUEVAS. 'Adjudicada' se deja afuera a propósito — sigue
// siendo razonable seguir cotizando/facturando sobre una licitación ganada.
const ESTADOS_QUE_BLOQUEAN_NUEVO_VINCULO = ['Archivada', 'No adjudicada'];

/**
 * @param   {*}      idLicitacion  — req.body.id_licitacion, tal como llegó
 * @param   {string} contexto      — nombre del controlador, sólo para el aviso
 * @param   {Object} [opts]
 * @param   {*}      [opts.idLicitacionActual] — el id_licitacion que la
 *   cotización YA tenía guardado (sólo aplica en updateQuotation). Cuando se
 *   pasa y coincide con idLicitacion, la edición no está cambiando el vínculo
 *   — no se bloquea por el estado de la licitación, sólo por creación o por
 *   un cambio real de vínculo. Ver el comentario largo más arriba. Mismo
 *   patrón que clienteLinkGuard.js usa para idClienteActual.
 * @returns {Promise<{status:number, body:object}|null>} null si está todo bien
 */
async function verificarVinculoLicitacion(idLicitacion, contexto, { idLicitacionActual } = {}) {
  // `== null` cubre null Y undefined con una sola comparación. Los dos
  // significan lo mismo acá: la cotización no se ata a ninguna licitación, que
  // es el caso NORMAL — la mayoría son sueltas. Un null explícito además es
  // cómo se desata una que sí estaba atada.
  if (idLicitacion == null) return null;

  const parsedId = parseInt(idLicitacion, 10);

  // Si el vínculo NO está cambiando (edición que reenvía el mismo
  // id_licitacion que la cotización ya tenía), no se re-evalúa el estado: el
  // vínculo preexistente no se corta porque la licitación haya avanzado
  // después. El chequeo de estado es sólo para un vínculo NUEVO o distinto.
  if (idLicitacionActual != null && parseInt(idLicitacionActual, 10) === parsedId) {
    return null;
  }

  try {
    const lic = await LicitacionModel.findById(parsedId);

    if (!lic) {
      return {
        status: 422,
        body: {
          success: false,
          // Se nombra el número que mandó el usuario, no un mensaje genérico:
          // si eligió mal en una lista larga, el número le dice cuál.
          message: `La licitación #${idLicitacion} indicada no existe.`,
        },
      };
    }

    if (ESTADOS_QUE_BLOQUEAN_NUEVO_VINCULO.includes(lic.estado)) {
      return {
        status: 422,
        body: {
          success: false,
          message: `La licitación #${idLicitacion} (${lic.codigo}) está '${lic.estado}' y ya no admite ` +
                    'vincular cotizaciones nuevas.',
        },
      };
    }
  } catch (err) {
    // Un fallo de la CONSULTA no bloquea la operación: la restricción de clave
    // foránea sigue puesta en la base y va a rechazar un vínculo inválido de
    // todos modos. Bloquear acá convertiría un problema de lectura en la
    // imposibilidad de guardar una cotización que quizá ni tiene licitación
    // mal puesta.
    console.warn(`[${contexto}] Licitación lookup failed (non-fatal):`, err.message);
  }

  return null;
}

module.exports = { verificarVinculoLicitacion };
