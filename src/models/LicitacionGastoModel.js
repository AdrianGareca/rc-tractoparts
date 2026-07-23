// =============================================================================
// src/models/LicitacionGastoModel.js
// Data Access Layer — licitacion_gastos
//
// Operating expenses charged to an adjudicated licitación for the profit/loss
// analysis. Layering: only this model runs SQL against licitacion_gastos.
// =============================================================================

'use strict';

const { pool } = require('../config/db');

// ---------------------------------------------------------------------------
// create — Insert one expense row.
// ---------------------------------------------------------------------------
async function create({ id_licitacion, concepto, monto, moneda, id_usuario, nombre_usuario }) {
  const [result] = await pool.execute(
    `INSERT INTO licitacion_gastos
       (id_licitacion, concepto, monto, moneda, id_usuario, nombre_usuario)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id_licitacion, concepto, monto, moneda || 'BOB', id_usuario, nombre_usuario]
  );
  return result.insertId;
}

// ---------------------------------------------------------------------------
// findByLicitacion — All expenses for a licitación, newest first.
// ---------------------------------------------------------------------------
async function findByLicitacion(id_licitacion) {
  const [rows] = await pool.execute(
    `SELECT id, id_licitacion, concepto, monto, moneda, id_usuario, nombre_usuario, creado_en
       FROM licitacion_gastos
      WHERE id_licitacion = ?
      ORDER BY creado_en DESC`,
    [id_licitacion]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// findById — Single row (used by delete to verify the URL's :id matches).
// ---------------------------------------------------------------------------
async function findById(id) {
  const [rows] = await pool.execute(
    `SELECT id, id_licitacion, concepto, monto, moneda, id_usuario, nombre_usuario, creado_en
       FROM licitacion_gastos
      WHERE id = ?
      LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// sumByLicitacion — Total expenses for a licitación (used in the P&L result).
// ---------------------------------------------------------------------------
async function sumByLicitacion(id_licitacion) {
  const [rows] = await pool.execute(
    'SELECT COALESCE(SUM(monto), 0) AS total FROM licitacion_gastos WHERE id_licitacion = ?',
    [id_licitacion]
  );
  return rows[0].total;
}

// ---------------------------------------------------------------------------
// deleteById — Remove one expense row.
// ---------------------------------------------------------------------------
async function deleteById(id) {
  const [result] = await pool.execute('DELETE FROM licitacion_gastos WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

module.exports = {
  create,
  findByLicitacion,
  findById,
  sumByLicitacion,
  deleteById,
};
