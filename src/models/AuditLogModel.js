// =============================================================================
// src/models/AuditLogModel.js
// Data Access Layer — bitacora_auditoria (READ side)
//
// The WRITE side already exists and is wired across the whole app:
// src/utils/auditLog.js#logEvent() inserts one immutable row per significant
// event (login, create, approve, state change, download, etc.) into
// bitacora_auditoria. This model provides the paginated, filtered READ side
// that powers the "Registros de Auditoría" tab (Jefe / Administracion /
// SysAdmin).
//
// NOTE: this is intentionally a separate file from the legacy
// src/models/AuditModel.js, which manages the OLDER, now-unused `auditoria`
// table (its only consumer, src/middlewares/auditMiddleware.js, is never
// imported anywhere in the app). Kept untouched to avoid disturbing dead-but-
// harmless legacy code; bitacora_auditoria is the single system actually in
// use end-to-end.
// =============================================================================

'use strict';

const { pool } = require('../config/db');

// ---------------------------------------------------------------------------
// _buildWhereClause
// Parameterized WHERE clause shared by findAll and countAll.
//
// Accepted filter keys:
//   usuario     {string}  Partial match on nombre_usuario (LIKE)
//   accion      {string}  Exact match against a known AuditActions code
//   entidad     {string}  Exact match on the affected table name
//   resultado   {string}  'exito' | 'fallo'
//   fecha_desde {string}  Lower bound on creado_en (YYYY-MM-DD, inclusive)
//   fecha_hasta {string}  Upper bound on creado_en (YYYY-MM-DD, inclusive —
//                         implemented as `< fecha_hasta + 1 day` since
//                         creado_en is a DATETIME; this avoids silently
//                         dropping events from the last hours of that day).
// ---------------------------------------------------------------------------
function _buildWhereClause(filters = {}) {
  const conditions = [];
  const values     = [];

  if (filters.usuario && filters.usuario.trim()) {
    conditions.push('a.nombre_usuario LIKE ?');
    values.push(`%${filters.usuario.trim()}%`);
  }

  if (filters.accion) {
    conditions.push('a.accion = ?');
    values.push(filters.accion);
  }

  if (filters.entidad) {
    conditions.push('a.entidad = ?');
    values.push(filters.entidad);
  }

  if (filters.resultado) {
    conditions.push('a.resultado = ?');
    values.push(filters.resultado);
  }

  if (filters.fecha_desde) {
    conditions.push('a.creado_en >= ?');
    values.push(filters.fecha_desde);
  }

  if (filters.fecha_hasta) {
    // DATE_ADD keeps the arithmetic in MySQL — the bound parameter stays a
    // plain YYYY-MM-DD string, no JS-side date math or timezone drift.
    conditions.push('a.creado_en < DATE_ADD(?, INTERVAL 1 DAY)');
    values.push(filters.fecha_hasta);
  }

  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    values,
  };
}

const AuditLogModel = {

  // ---------------------------------------------------------------------------
  // findAll — paginated, filtered, most-recent-first.
  // @param  {Object} filters    - see _buildWhereClause
  // @param  {Object} pagination - { page, limit }
  // @returns {Promise<Array<Object>>}
  // ---------------------------------------------------------------------------
  async findAll(filters = {}, pagination = {}) {
    const page   = Math.max(1, parseInt(pagination.page,  10) || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(pagination.limit, 10) || 25));
    const offset = (page - 1) * limit;

    const { clause: whereClause, values: whereValues } = _buildWhereClause(filters);

    // LIMIT/OFFSET embedded as validated integer literals — mysql2 v3 prepared
    // statements mistype bound LIMIT/OFFSET params as DOUBLE (mirrors the same
    // guard already used in QuotationModel.findAll).
    const sql = `
      SELECT
        a.id,
        a.id_usuario,
        a.nombre_usuario,
        a.accion,
        a.entidad,
        a.id_entidad,
        a.detalle,
        a.ip_origen,
        a.resultado,
        a.creado_en
      FROM bitacora_auditoria a
      ${whereClause}
      ORDER BY a.creado_en DESC, a.id DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const [rows] = await pool.execute(sql, whereValues);
    return rows;
  },

  // ---------------------------------------------------------------------------
  // countAll — COUNT(*) with the same WHERE as findAll (pagination totals).
  // ---------------------------------------------------------------------------
  async countAll(filters = {}) {
    const { clause: whereClause, values: whereValues } = _buildWhereClause(filters);
    const sql = `SELECT COUNT(*) AS total FROM bitacora_auditoria a ${whereClause}`;
    const [rows] = await pool.execute(sql, whereValues);
    return rows[0].total;
  },

  // ---------------------------------------------------------------------------
  // distinctEntidades — populates the "Tabla" filter dropdown with only the
  // entity names that actually occur in the data, instead of a hardcoded list
  // that could silently drift from what logEvent() callers actually pass.
  // ---------------------------------------------------------------------------
  async distinctEntidades() {
    const [rows] = await pool.execute(
      `SELECT DISTINCT entidad FROM bitacora_auditoria WHERE entidad IS NOT NULL ORDER BY entidad`
    );
    return rows.map((r) => r.entidad);
  },
};

module.exports = AuditLogModel;
