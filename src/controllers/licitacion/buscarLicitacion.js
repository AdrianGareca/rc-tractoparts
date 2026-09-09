// =============================================================================
// src/controllers/licitacion/buscarLicitacion.js
// Leer el id de la URL y traer la licitación, o devolver el error listo.
//
// EL PROBLEMA MEDIDO
// Este bloque estaba escrito SIETE veces, palabra por palabra, en tres
// controladores distintos:
//
//     const { id, error: idError } = parseId(req.params.id, 'licitación');
//     if (idError) return res.status(idError.status).json(idError.body);
//     try {
//       const licitacion = await LicitacionModel.findById(id);
//       if (!licitacion) {
//         return res.status(404).json({ success: false, message: `No se encontró la licitación con ID ${id}.` });
//       }
//       …lo único que cambiaba de un sitio a otro…
//
// Son cinco líneas de preámbulo antes de llegar a lo que cada endpoint hace de
// verdad. Y el mensaje del 404 estaba copiado siete veces: cambiar cómo se le
// habla al usuario obligaba a encontrar las siete.
//
// Es el mismo caso que resolvió utils/parseId.js, que unificó veintiocho copias
// de `if (isNaN(id) || id < 1)` escritas en dos idiomas. Esto es el paso
// siguiente de esa misma serie: parseId dejó de repetir la validación del
// número, y esto deja de repetir la búsqueda del registro.
//
// POR QUÉ NO RECIBE `res` NI RESPONDE POR SU CUENTA
// La tentación era pasarle `res` y que respondiera el 400 o el 404 ahí mismo,
// devolviendo null. Eso ahorra una línea más en cada sitio, pero crea una
// trampa: quien llame y se olvide del `return` sigue ejecutando el resto del
// endpoint DESPUÉS de que la respuesta ya salió, y Express avisa con un
// «Cannot set headers after they are sent» en producción, no en las pruebas.
//
// Devolver `{ error }` y dejar que el controlador responda mantiene el mismo
// contrato que parseId y que los guardianes de stateTransitionGuards.js: quien
// lee el código ve el `return res.status(...)` donde siempre estuvo.
//
// POR QUÉ VIVE ACÁ Y NO EN utils/
// Necesita LicitacionModel, y utils/ no importa modelos — es la separación que
// mantiene a esa carpeta usable desde cualquier capa. Este ayudante es de la
// capa de controladores y vive con ellos.
// =============================================================================

'use strict';

const LicitacionModel = require('../../models/LicitacionModel');
const { parseId } = require('../../utils/parseId');

/**
 * Resuelve el `:id` de la URL a una licitación existente.
 *
 * Mismo contrato que parseId: `error` es null cuando todo salió bien, o
 * `{ status, body }` listo para pasarle a res.
 *
 * @param   {*} valorId — normalmente req.params.id
 * @returns {Promise<{ id: number|null, licitacion: object|null, error: {status:number, body:object}|null }>}
 *
 * @example
 *   const { id, licitacion, error } = await buscarLicitacion(req.params.id);
 *   if (error) return res.status(error.status).json(error.body);
 */
async function buscarLicitacion(valorId) {
  const { id, error } = parseId(valorId, 'licitación');
  if (error) return { id: null, licitacion: null, error };

  const licitacion = await LicitacionModel.findById(id);

  if (!licitacion) {
    return {
      id,
      licitacion: null,
      error: {
        status: 404,
        body: {
          success: false,
          // El mensaje que estaba repetido siete veces. Ahora se cambia acá.
          message: `No se encontró la licitación con ID ${id}.`,
        },
      },
    };
  }

  return { id, licitacion, error: null };
}

module.exports = { buscarLicitacion };
