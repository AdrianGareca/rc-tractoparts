// =============================================================================
// src/utils/uploadFilename.js
// Nombre seguro para los archivos que se escriben a disco al subirlos.
//
// POR QUÉ EXISTE — path traversal en la escritura de archivos.
//
// Las rutas de subida interpolaban req.params.id directamente en el nombre:
//     `LICDOC-${req.params.id}-${unique}${ext}`
//
// Multer resuelve el destino con path.join(destino, nombre), así que un id con
// ../ escapaba del directorio. Y llega: Express decodifica los params DESPUÉS
// de hacer el match de la ruta, de modo que
//     POST /api/licitaciones/..%2f..%2f..%2ftmp%2fevil/documentos
// entrega req.params.id === '../../../tmp/evil'.
//
// El agravante es el ORDEN: multer escribe el archivo antes de que corra el
// controller, o sea antes de validar el id y antes de verificar permisos. Sin
// esta función, cualquier usuario autenticado que alcanzara la ruta podía
// escribir —y sobrescribir— archivos en cualquier parte del filesystem.
//
// Cubierto por tests/unit/uploadFilename.test.js.
// =============================================================================

'use strict';

const path   = require('path');
const crypto = require('crypto');

/**
 * Reduce un segmento de id a algo que no pueda alterar la ruta.
 * Se queda SOLO con caracteres alfanuméricos: cualquier separador, punto o
 * secuencia .. desaparece por construcción, sin depender de una lista negra.
 *
 * @param   {*} raw — típicamente req.params.id
 * @returns {string} el id saneado, o 'draft' si no quedó nada utilizable
 */
function sanitizeIdSegment(raw) {
  const limpio = String(raw ?? '').replace(/[^A-Za-z0-9]/g, '');
  return limpio || 'draft';
}

/**
 * Extensión segura de un nombre original.
 * path.extname ya devuelve sólo el último tramo, pero se filtra igual para que
 * un ".../../x" no pueda aportar separadores.
 */
function sanitizeExtension(originalname) {
  const ext = path.extname(String(originalname ?? '')).toLowerCase();
  const limpio = ext.replace(/[^a-z0-9.]/g, '');
  return /^\.[a-z0-9]+$/.test(limpio) ? limpio : '';
}

/**
 * Arma el nombre con el que se guarda un archivo subido.
 * Garantiza que el resultado NO contiene separadores de ruta, así que
 * path.join(destino, nombre) siempre queda dentro de `destino`.
 *
 * @param   {Object} opts
 *   prefix       {string} — etiqueta del tipo de archivo (LICDOC, COT, EXCEL…)
 *   id           {*}      — id de la entidad, tal como viene de req.params
 *   originalname {string} — nombre con el que llegó el archivo
 * @returns {string}
 */
function buildUploadFilename({ prefix = 'FILE', id, originalname = '' } = {}) {
  const safePrefix = String(prefix).replace(/[^A-Za-z0-9]/g, '') || 'FILE';
  const safeId     = sanitizeIdSegment(id);
  const ext        = sanitizeExtension(originalname);
  const unique     = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  return `${safePrefix}-${safeId}-${unique}${ext}`;
}

module.exports = { buildUploadFilename, sanitizeIdSegment, sanitizeExtension };
