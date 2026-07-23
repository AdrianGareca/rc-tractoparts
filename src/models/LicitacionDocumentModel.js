// =============================================================================
// src/models/LicitacionDocumentModel.js
// Data Access Layer — licitacion_documentos
//
// Multi-file attachments (PDF, Word, Excel, images) uploaded to a licitación.
// Layering: only this model executes SQL against licitacion_documentos;
// src/controllers/licitacionDocumentController.js owns the file-system side
// (multer storage, magic-number verification, disk cleanup).
// =============================================================================

'use strict';

const { pool } = require('../config/db');

// ---------------------------------------------------------------------------
// create — Insert one document record. Called once per uploaded file.
// ---------------------------------------------------------------------------
async function create({ id_licitacion, nombre_original, ruta_archivo, mime_type, tamano_bytes, id_usuario, nombre_usuario }) {
  const [result] = await pool.execute(
    `INSERT INTO licitacion_documentos
       (id_licitacion, nombre_original, ruta_archivo, mime_type, tamano_bytes, id_usuario, nombre_usuario)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id_licitacion, nombre_original, ruta_archivo, mime_type, tamano_bytes, id_usuario, nombre_usuario]
  );
  return result.insertId;
}

// ---------------------------------------------------------------------------
// findByLicitacion — All documents attached to a licitación, newest first.
// ---------------------------------------------------------------------------
async function findByLicitacion(id_licitacion) {
  const [rows] = await pool.execute(
    `SELECT id, id_licitacion, nombre_original, mime_type, tamano_bytes,
            id_usuario, nombre_usuario, creado_en
       FROM licitacion_documentos
      WHERE id_licitacion = ?
      ORDER BY creado_en DESC`,
    [id_licitacion]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// findById — Full row (includes ruta_archivo) — used by the download/delete
// handlers, which also need id_licitacion to verify the URL's :id matches.
// ---------------------------------------------------------------------------
async function findById(id) {
  const [rows] = await pool.execute(
    `SELECT id, id_licitacion, nombre_original, ruta_archivo, mime_type, tamano_bytes,
            id_usuario, nombre_usuario, creado_en
       FROM licitacion_documentos
      WHERE id = ?
      LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// deleteById — Removes the DB row. The caller is responsible for deleting the
// physical file from disk (this model never touches the filesystem).
// ---------------------------------------------------------------------------
async function deleteById(id) {
  const [result] = await pool.execute('DELETE FROM licitacion_documentos WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

module.exports = {
  create,
  findByLicitacion,
  findById,
  deleteById,
};
