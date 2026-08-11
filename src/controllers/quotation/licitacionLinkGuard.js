// =============================================================================
// src/controllers/quotation/licitacionLinkGuard.js
// Verificar que la licitación a la que se ata una cotización exista.
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
// =============================================================================

'use strict';

const LicitacionModel = require('../../models/LicitacionModel');

/**
 * @param   {*}      idLicitacion — req.body.id_licitacion, tal como llegó
 * @param   {string} contexto     — nombre del controlador, sólo para el aviso
 * @returns {Promise<{status:number, body:object}|null>} null si está todo bien
 */
async function verificarVinculoLicitacion(idLicitacion, contexto) {
  // `== null` cubre null Y undefined con una sola comparación. Los dos
  // significan lo mismo acá: la cotización no se ata a ninguna licitación, que
  // es el caso NORMAL — la mayoría son sueltas. Un null explícito además es
  // cómo se desata una que sí estaba atada.
  if (idLicitacion == null) return null;

  try {
    const lic = await LicitacionModel.findById(parseInt(idLicitacion, 10));

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
