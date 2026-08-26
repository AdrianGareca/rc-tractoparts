// =============================================================================
// src/controllers/quotation/clienteLinkGuard.js
// Verificar que el cliente al que se ata una cotización exista Y esté activo.
//
// MISMO PATRON QUE licitacionLinkGuard.js, MISMA RAZON DE SER
// Sin este control, un id_cliente inexistente llega hasta el INSERT y MySQL lo
// rechaza con una violación de clave foránea, que sube como excepción y sale
// por el manejador genérico: HTTP 500 "error interno". Encontrado
// estresando la app el 2026-08-25 — el mismo control ya existía para
// id_licitacion, pero nunca se escribió el equivalente para id_cliente.
//
// DE PASO RESUELVE UN SEGUNDO BUG DE LA MISMA RONDA: se podía crear una
// cotización para un cliente ya DESACTIVADO (soft-delete) sin ningún aviso.
// ClientModel.findById ya filtra `activo = 1` — usarlo acá como el chequeo de
// existencia hace que un cliente desactivado también caiga en el mismo 422,
// con un mensaje que lo dice explícitamente en vez de confundirlo con "no
// existe".
// =============================================================================

'use strict';

const ClientModel = require('../../models/ClientModel');

/**
 * @param   {*}      idCliente — req.body.id_cliente, tal como llegó
 * @param   {string} contexto  — nombre del controlador, sólo para el aviso
 * @returns {Promise<{status:number, body:object}|null>} null si está todo bien
 */
async function verificarCliente(idCliente, contexto) {
  const parsedId = parseInt(idCliente, 10);

  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    return {
      status: 422,
      body: { success: false, message: `id_cliente inválido: "${idCliente}".` },
    };
  }

  try {
    // findByIdAny (no findById) para poder distinguir "no existe" de
    // "existe pero está desactivado" y devolver el mensaje que corresponde.
    const cliente = await ClientModel.findByIdAny(parsedId);

    if (!cliente) {
      return {
        status: 422,
        body: {
          success: false,
          // Se nombra el número que mandó el usuario, no un mensaje genérico:
          // si eligió mal en una lista larga, el número le dice cuál.
          message: `El cliente #${parsedId} indicado no existe.`,
        },
      };
    }

    if (!cliente.activo) {
      return {
        status: 422,
        body: {
          success: false,
          message: `El cliente #${parsedId} (${cliente.razon_social}) está desactivado. Reactivalo antes de cotizarle, o elegí otro cliente.`,
        },
      };
    }
  } catch (err) {
    // Un fallo de la CONSULTA no bloquea la operación: la restricción de clave
    // foránea sigue puesta en la base y va a rechazar un vínculo inválido de
    // todos modos. Bloquear acá convertiría un problema de lectura en la
    // imposibilidad de guardar una cotización que quizá tiene un cliente bien puesto.
    console.warn(`[${contexto}] Cliente lookup failed (non-fatal):`, err.message);
  }

  return null;
}

module.exports = { verificarCliente };
