// =============================================================================
// src/models/ClientModel.js
// Data Access Layer — clientes table
//
// Provides search (autocomplete), create, and findById operations.
// All queries use parameterised statements (no string interpolation) to
// prevent SQL injection.
// =============================================================================

'use strict';

const { pool } = require('../config/db');

const ClientModel = {

  // ---------------------------------------------------------------------------
  // search — GET /api/clientes?q=<term>
  // Returns up to 20 active clients whose razon_social or NIT match the query.
  // Used by the frontend autocomplete dropdown.
  // ---------------------------------------------------------------------------
  async search(q = '') {
    // Escape LIKE metacharacters so autocomplete queries like "50%" or "item_1"
    // do not silently expand into SQL wildcards and over-match.
    const escaped = String(q).trim().replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    const like = `%${escaped}%`;
    const [rows] = await pool.execute(
      `SELECT id, razon_social, nit, contacto, email, telefono
         FROM clientes
        WHERE activo = 1
          AND (razon_social LIKE ? ESCAPE '\\\\' OR nit LIKE ? ESCAPE '\\\\')
        ORDER BY razon_social ASC
        LIMIT 20`,
      [like, like]
    );
    return rows;
  },

  // ---------------------------------------------------------------------------
  // findById — Return a single active client by primary key.
  // ---------------------------------------------------------------------------
  async findById(id) {
    const [[row]] = await pool.execute(
      `SELECT id, razon_social, nit, contacto, email, telefono
         FROM clientes
        WHERE id = ? AND activo = 1
        LIMIT 1`,
      [parseInt(id, 10)]
    );
    return row || null;
  },

  // ---------------------------------------------------------------------------
  // findByIdAny — Return a client by primary key regardless of active status.
  // Used by the client-management screen so a deactivated client can still be
  // viewed/edited/reactivated (findById would 404 on it since it filters
  // activo = 1).
  // ---------------------------------------------------------------------------
  async findByIdAny(id) {
    const [[row]] = await pool.execute(
      `SELECT id, razon_social, nit, contacto, email, telefono, activo
         FROM clientes
        WHERE id = ?
        LIMIT 1`,
      [parseInt(id, 10)]
    );
    return row || null;
  },

  // ---------------------------------------------------------------------------
  // findAllPaginated — Full client list (active AND inactive) for the
  // management screen, as opposed to `search()` which is capped at 20 active
  // results for the quotation-form autocomplete.
  // @param {Object} opts
  //   q      {string} - optional filter on razon_social/nit
  //   page   {number} - 1-indexed page number
  //   limit  {number} - rows per page (capped at 100)
  // ---------------------------------------------------------------------------
  async findAllPaginated({ q = '', page = 1, limit = 20 } = {}) {
    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset   = (pageNum - 1) * limitNum;

    const trimmed = String(q).trim();
    let whereClause = '';
    let whereValues = [];
    if (trimmed) {
      const escaped = trimmed.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
      const like = `%${escaped}%`;
      whereClause = `WHERE (razon_social LIKE ? ESCAPE '\\\\' OR nit LIKE ? ESCAPE '\\\\')`;
      whereValues = [like, like];
    }

    const [rows] = await pool.execute(
      `SELECT id, razon_social, nit, contacto, email, telefono, activo
         FROM clientes
         ${whereClause}
        ORDER BY razon_social ASC
        LIMIT ${limitNum} OFFSET ${offset}`,
      whereValues
    );
    return rows;
  },

  // ---------------------------------------------------------------------------
  // countAll — Total client count matching the same filter as findAllPaginated,
  // used to compute total pages for the management screen.
  // ---------------------------------------------------------------------------
  async countAll({ q = '' } = {}) {
    const trimmed = String(q).trim();
    let whereClause = '';
    let whereValues = [];
    if (trimmed) {
      const escaped = trimmed.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
      const like = `%${escaped}%`;
      whereClause = `WHERE (razon_social LIKE ? ESCAPE '\\\\' OR nit LIKE ? ESCAPE '\\\\')`;
      whereValues = [like, like];
    }

    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM clientes ${whereClause}`,
      whereValues
    );
    return rows[0].total;
  },

  // ---------------------------------------------------------------------------
  // findByNit — Return a single active client whose NIT matches exactly.
  // Used to tell the caller WHICH client already owns a NIT on a 409 conflict,
  // instead of only reporting that a conflict happened.
  // ---------------------------------------------------------------------------
  async findByNit(nit) {
    if (!nit) return null;
    const [[row]] = await pool.execute(
      `SELECT id, razon_social, nit, contacto, email, telefono
         FROM clientes
        WHERE activo = 1 AND nit = ?
        LIMIT 1`,
      [String(nit).trim()]
    );
    return row || null;
  },

  // ---------------------------------------------------------------------------
  // create — INSERT a new client record.
  // Returns the insertId of the newly created row.
  // Throws ER_DUP_ENTRY if the NIT already exists (handled by controller).
  // ---------------------------------------------------------------------------
  async create({ razon_social, nit, contacto, email, telefono }) {
    const [result] = await pool.execute(
      `INSERT INTO clientes (razon_social, nit, contacto, email, telefono)
       VALUES (?, ?, ?, ?, ?)`,
      [
        String(razon_social).trim(),
        nit      ? String(nit).trim()      : null,
        contacto ? String(contacto).trim() : null,
        email    ? String(email).trim()    : null,
        telefono ? String(telefono).trim() : null,
      ]
    );
    return result.insertId;
  },

  // ---------------------------------------------------------------------------
  // update — UPDATE an existing client's editable fields, including its
  // active/inactive status. The controller resolves `activo` before calling
  // this (defaulting to the client's current value when the caller doesn't
  // intend to change it), so this method always receives an explicit 0/1.
  // No `activo = 1` guard in the WHERE clause — unlike create's NIT-conflict
  // check, editing/reactivating an already-inactive client is a valid,
  // intended operation here (the controller's own findByIdAny 404 check
  // already establishes the row exists before this runs).
  // Returns true if a row was updated, false if the id does not exist.
  // Throws ER_DUP_ENTRY if the new NIT belongs to a DIFFERENT client (handled
  // by controller, same as create).
  // ---------------------------------------------------------------------------
  async update(id, { razon_social, nit, contacto, email, telefono, activo }) {
    const [result] = await pool.execute(
      `UPDATE clientes
          SET razon_social = ?,
              nit          = ?,
              contacto     = ?,
              email        = ?,
              telefono     = ?,
              activo       = ?
        WHERE id = ?`,
      [
        String(razon_social).trim(),
        nit      ? String(nit).trim()      : null,
        contacto ? String(contacto).trim() : null,
        email    ? String(email).trim()    : null,
        telefono ? String(telefono).trim() : null,
        activo ? 1 : 0,
        parseInt(id, 10),
      ]
    );
    return result.affectedRows > 0;
  },
};

module.exports = ClientModel;
