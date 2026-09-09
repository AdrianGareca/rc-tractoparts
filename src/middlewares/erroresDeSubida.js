// =============================================================================
// src/middlewares/erroresDeSubida.js
// Qué se le responde a quien sube un archivo que no entra o que no se acepta.
//
// EL PROBLEMA MEDIDO
// Este manejador estaba escrito dos veces —quotationRoutes.js y
// licitacionRoutes.js— con la misma estructura y DOS IDIOMAS distintos:
//
//     cotizaciones:  `File upload error: ${err.message}`
//     licitaciones:  `Error al subir el archivo: ${err.message}`
//
// Es exactamente el caso que documenta utils/parseId.js: la duplicación sola
// sería prolijidad, pero ésta ya se desincronizó en el texto que ve el usuario.
// Subir un archivo demasiado grande le contestaba en inglés desde la pantalla
// de cotizaciones y en castellano desde la de licitaciones.
//
// Se unificó en castellano, que es la política del proyecto («la aplicación le
// habla al usuario en español» — ver el trinquete de parseIdCompartido.test.js).
//
// POR QUÉ 413 Y NO 422 CUANDO EL ARCHIVO ES DEMASIADO GRANDE
// Los dos routers interceptaban TODO MulterError antes de que llegara al
// manejador global de src/app.js, que sí responde 413 para ese caso. Así que el
// MISMO motivo de rechazo —el archivo pesa de más— devolvía 413 o 422 según por
// dónde hubiera entrado. Se arregló en la ronda de estrés del 2026-08-26,
// primero en un router y después en el otro; acá queda en un solo lugar para
// que no puedan volver a separarse.
//
// El resto de los MulterError (demasiados archivos, campo inesperado) sigue
// siendo 422: son peticiones mal formadas, no un problema de tamaño.
//
// DEBE DECLARARSE DESPUÉS DE TODAS LAS RUTAS
// Es un middleware de error de cuatro argumentos. Express sólo se los pasa a
// los que estén registrados después de lo que falló, así que puesto arriba no
// atrapa nada — y no avisa.
// =============================================================================

'use strict';

const multer = require('multer');

/**
 * Arma el manejador de errores de subida de un router.
 *
 * @param {Object}   [opciones]
 * @param {string[]} [opciones.prefijosDeCliente] — mensajes de error propios que
 *   describen una petición inválida y no un fallo del servidor, así que se
 *   responden 422 con su texto tal cual en vez de caer en el 500 genérico.
 *   Los usa licitacionRoutes para su filtro de extensiones; cotizaciones no
 *   tiene filtro (verifica el contenido después de escribir, por número mágico).
 * @returns {Function} middleware de error (err, req, res, next)
 */
function erroresDeSubida({ prefijosDeCliente = [] } = {}) {
  return (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 422;
      return res.status(status).json({
        success: false,
        message: `Error al subir el archivo: ${err.message}`,
      });
    }

    if (prefijosDeCliente.some((p) => typeof err?.message === 'string' && err.message.startsWith(p))) {
      return res.status(422).json({ success: false, message: err.message });
    }

    // Cualquier otra cosa es un problema de verdad: al manejador global, que
    // lo registra y no filtra detalles internos al cliente.
    next(err);
  };
}

module.exports = { erroresDeSubida };
