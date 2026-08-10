// =============================================================================
// src/utils/parseId.js
// Leer un identificador de la URL, una sola vez.
//
// EL PROBLEMA MEDIDO
// `if (isNaN(id) || id < 1)` estaba escrito 28 veces en nueve controladores, y
// el mensaje que devuelve se había escrito de cuatro formas — EN DOS IDIOMAS:
//
//     10x  'Invalid quotation ID.'
//      3x  'Invalid user ID.'
//      3x  'Invalid client ID.'
//      3x  'ID inválido.'
//
// Es el mismo patrón que las descripciones repetidas de Swagger: duplicado y ya
// desincronizado. Sólo que acá es peor, porque no es documentación para
// desarrolladores: es el texto que ve el usuario cuando algo sale mal, y le
// llega en inglés o en español según qué pantalla haya tocado.
//
// POR QUÉ DEVUELVE UN OBJETO Y NO TIRA UNA EXCEPCIÓN
// Un identificador mal formado no es un error del programa: es una petición
// inválida, y responder 400 es la respuesta correcta, no un fallo. Modelarlo
// como `throw` obligaría a cada controlador a envolverlo en try/catch y después
// distinguir esa excepción de las que sí son problemas reales.
//
// Mismo contrato que los guardianes de stateTransitionGuards.js: `error` es
// null cuando todo está bien, o `{ status, body }` listo para responder.
// =============================================================================

'use strict';

/**
 * Convierte el parámetro de una ruta en un identificador de base de datos.
 *
 * @param   {*}      valor    — normalmente req.params.id, siempre string
 * @param   {string} entidad  — cómo nombrarla en el mensaje ('cotización',
 *                              'cliente', 'usuario'). En minúscula: va en medio
 *                              de una oración.
 * @returns {{ id: number|null, error: {status:number, body:object}|null }}
 *
 * @example
 *   const { id, error } = parseId(req.params.id, 'cotización');
 *   if (error) return res.status(error.status).json(error.body);
 */
function parseId(valor, entidad = 'registro') {
  // Base 10 explícita: sin ella, un id que empiece con '0' se interpretaría
  // como octal en motores viejos, y '0x1A' como hexadecimal.
  const id = parseInt(valor, 10);

  // `isNaN` cubre el texto no numérico ('abc', '', undefined).
  // `< 1` cubre el cero y los negativos, que son numéricamente válidos pero no
  // pueden existir como AUTO_INCREMENT de MySQL.
  //
  // Nótese que parseInt('12abc') devuelve 12 y por lo tanto pasa. Es
  // deliberado: una URL como /api/clientes/12abc apunta sin ambigüedad al 12, y
  // rechazarla sería más estricto que útil.
  if (isNaN(id) || id < 1) {
    return {
      id: null,
      error: {
        status: 400,
        body: {
          success: false,
          // Un solo idioma —español, que es el de los usuarios— y el nombre de
          // la entidad adentro, para que el mensaje diga QUÉ no se encontró.
          message: `El identificador de ${entidad} no es válido.`,
        },
      },
    };
  }

  return { id, error: null };
}

module.exports = { parseId };
