// =============================================================================
// src/models/BrandModel.js
// Data Access Layer — marcas (spare part brands catalog)
//
// Sprint 3: getAll, create
// =============================================================================

'use strict';

const { pool } = require('../config/db');

const BrandModel = {

  // ---------------------------------------------------------------------------
  // getAll — returns all active brands ordered alphabetically.
  // Used by GET /api/marcas to populate the dropdown in the quotation form.
  // ---------------------------------------------------------------------------
  async getAll() {
    const [rows] = await pool.execute(
      'SELECT id, nombre FROM marcas WHERE activo = 1 ORDER BY nombre ASC'
    );
    return rows;
  },

  // ---------------------------------------------------------------------------
  // findByNombre — case-insensitive exact lookup by trimmed name.
  // Used to enforce the uniqueness invariant before INSERT.
  // ---------------------------------------------------------------------------
  async findByNombre(nombre) {
    const [rows] = await pool.execute(
      'SELECT id, nombre, activo FROM marcas WHERE LOWER(nombre) = LOWER(?) LIMIT 1',
      [nombre.trim()]
    );
    return rows[0] ?? null;
  },

  // ---------------------------------------------------------------------------
  // create — inserts a new brand and returns the full created record.
  //
  // @param {string} nombre - Raw brand name from user input.
  //   • Leading/trailing whitespace is removed before storage.
  //   • Case-insensitive uniqueness is enforced by the caller (controller)
  //     with findByNombre before reaching this method.
  // @returns {{ id, nombre, activo }}
  // ---------------------------------------------------------------------------
  async create(nombre) {
    const trimmed = nombre.trim();

    const [result] = await pool.execute(
      'INSERT INTO marcas (nombre) VALUES (?)',
      [trimmed]
    );

    return { id: result.insertId, nombre: trimmed, activo: 1 };
  },
};

module.exports = BrandModel;
