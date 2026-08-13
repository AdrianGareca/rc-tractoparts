// =============================================================================
// src/controllers/licitacion/persistirDocumentos.js
// Guardar los documentos de una licitación: todos, o ninguno.
//
// POR QUÉ EXISTE — la subida parcial dejaba documentos fantasma.
//
// El bucle vivía adentro de uploadDocumentos, sin transacción, y el `catch` de
// cierre borraba del disco TODOS los archivos de la petición. Con cinco
// archivos y una falla al guardar el tercero quedaba esto:
//
//     filas en la base    1, 2      (ya insertadas, nadie las sacaba)
//     archivos en disco   ninguno   (los borró la limpieza general)
//
// Dos documentos visibles en la pantalla de la licitación que al descargarse
// contestan «El archivo ya no está disponible en el servidor». Para siempre, y
// sin forma de saber por qué. Encima quien subió recibió un 500 y va a repetir
// la subida: quedan las dos filas rotas más las cinco nuevas.
//
// POR QUÉ NO UNA TRANSACCIÓN DE MySQL
// Porque la mitad del trabajo NO está en MySQL. Los archivos ya están en disco
// —multer los escribe antes de que corra el controlador— y un ROLLBACK no los
// borra. Haría falta igual una vuelta atrás a mano para el disco, así que la
// transacción resolvería sólo la mitad fácil y escondería la otra.
//
// POR QUÉ EL MODELO SE INYECTA
// Para provocar el fallo del tercer INSERT contra la base de verdad habría que
// romper la tabla a propósito en medio de la petición. Con el modelo como
// parámetro, el fallo se pide y ya está — que es lo que hace
// tests/unit/subidaParcialDocumentos.test.js.
// =============================================================================

'use strict';

/** Dónde viven los documentos de licitación, relativo a la raíz del proyecto. */
const CARPETA = 'storage/licitaciones';

/**
 * Inserta una fila por archivo. Si alguna falla, deshace las anteriores y
 * vuelve a lanzar el error original.
 *
 * @param {object}   opts
 * @param {Array}    opts.files          los archivos como los deja multer
 * @param {number}   opts.idLicitacion
 * @param {object}   opts.usuario        { id, nombre_usuario }
 * @param {object}   opts.modelo         { create, deleteById } — inyectado
 * @param {Function} opts.mimeDe         extensión -> MIME verificado
 * @param {Function} opts.borrarDeDisco  best-effort, no debe lanzar
 * @returns {Promise<Array<{id:number, nombre_original:string, tamano_bytes:number}>>}
 * @throws  el error original del primer INSERT que falle
 */
async function persistirDocumentos({
  files,
  idLicitacion,
  usuario,
  modelo,
  mimeDe = () => 'application/octet-stream',
  borrarDeDisco = async () => {},
}) {
  const creados = [];

  try {
    for (const file of files) {
      const docId = await modelo.create({
        id_licitacion:   idLicitacion,
        nombre_original: file.originalname,
        // Se arma con join('/') y no con path.join: es una ruta que se guarda en
        // la base y se sirve por HTTP, así que tiene que ser igual en Windows y
        // en Linux. path.join pondría barras invertidas en Windows y la
        // descarga fallaría en producción.
        ruta_archivo:    [CARPETA, file.filename].join('/'),
        // El MIME sale de la verificación por número mágico, NUNCA del
        // Content-Type que declaró el cliente.
        mime_type:       mimeDe(file),
        tamano_bytes:    file.size,
        id_usuario:      usuario.id,
        nombre_usuario:  usuario.nombre_usuario,
      });

      // Se guarda el id que devolvió la base, no el índice del bucle: es el que
      // usa la pantalla para armar el enlace de descarga.
      creados.push({
        id:              docId,
        nombre_original: file.originalname,
        tamano_bytes:    file.size,
        // Se recuerda para poder deshacer: si falla un INSERT posterior, este
        // archivo tiene que salir del disco junto con su fila.
        _ruta:           [CARPETA, file.filename].join('/'),
      });
    }

    // Se saca la marca interna antes de devolver: quien llama arma la respuesta
    // JSON con esto y `_ruta` expondría la estructura de carpetas del servidor.
    return creados.map(({ _ruta, ...publico }) => publico);

  } catch (err) {
    // ── Vuelta atrás ──────────────────────────────────────────────────────────
    // Cada paso va en su propio try: si el DELETE falla porque la base se cayó
    // —que es justo lo que puede haber provocado el error original—, el
    // segundo error NO puede tapar al primero. El que sirve para diagnosticar
    // es el original; este es una consecuencia.
    for (const doc of creados) {
      try { await modelo.deleteById(doc.id); }
      catch (e) { console.warn('[persistirDocumentos] No se pudo deshacer la fila', doc.id, e.message); }
      try { await borrarDeDisco(doc._ruta); }
      catch (e) { console.warn('[persistirDocumentos] No se pudo borrar el archivo', doc._ruta, e.message); }
    }

    throw err;
  }
}

module.exports = { persistirDocumentos, CARPETA };
