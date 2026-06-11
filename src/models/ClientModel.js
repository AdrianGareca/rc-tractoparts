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
    const like = `%${String(q).trim()}%`;
    const [rows] = await pool.execute(
      `SELECT id, razon_social, nit, contacto, email, telefono
         FROM clientes
        WHERE activo = 1
          AND (razon_social LIKE ? OR nit LIKE ?)
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
};

module.exports = ClientModel;
