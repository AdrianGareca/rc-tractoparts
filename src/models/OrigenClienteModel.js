// =============================================================================
// src/models/OrigenClienteModel.js
// Data Access Layer — origenes_cliente (client acquisition/type catalog)
//
// Mirrors BrandModel.js exactly — same shape, same getAll/findByNombre/create
// contract, just a different catalog table.
// =============================================================================

'use strict';

const { pool } = require('../config/db');

const OrigenClienteModel = {

  // ---------------------------------------------------------------------------
  // getAll — returns all active client origins ordered alphabetically.
  // Used by GET /api/origenes-cliente to populate the dropdown in the client
  // management modal.
  // ---------------------------------------------------------------------------
  async getAll() {
    const [rows] = await pool.execute(
      'SELECT id, nombre FROM origenes_cliente WHERE activo = 1 ORDER BY nombre ASC'
    );
    return rows;
  },

  // ---------------------------------------------------------------------------
  // findByNombre — case-insensitive exact lookup by trimmed name.
  // Used to enforce the uniqueness invariant before INSERT.
  // ---------------------------------------------------------------------------
  async findByNombre(nombre) {
    const [rows] = await pool.execute(
      'SELECT id, nombre, activo FROM origenes_cliente WHERE LOWER(nombre) = LOWER(?) LIMIT 1',
      [nombre.trim()]
    );
    return rows[0] ?? null;
  },

  // ---------------------------------------------------------------------------
  // create — inserts a new client origin and returns the full created record.
  //
  // @param {string} nombre - Raw name from user input.
  //   • Leading/trailing whitespace is removed before storage.
  //   • Case-insensitive uniqueness is enforced by the caller (controller)
  //     with findByNombre before reaching this method.
  // @returns {{ id, nombre, activo }}
  // ---------------------------------------------------------------------------
  async create(nombre) {
    const trimmed = nombre.trim();

    const [result] = await pool.execute(
      'INSERT INTO origenes_cliente (nombre) VALUES (?)',
      [trimmed]
    );

    return { id: result.insertId, nombre: trimmed, activo: 1 };
  },
};

module.exports = OrigenClienteModel;
