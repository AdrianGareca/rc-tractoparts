// =============================================================================
// src/models/DelegacionModel.js
// Data Access Layer — delegaciones_rol
//
// Provides a single read-only query used by the delegation middleware to
// resolve whether the authenticated user currently holds an active temporal
// delegation of Jefe-level authority.
//
// Business rules enforced at the query level:
//   • activo = 1          — soft-delete / revocation flag
//   • NOW() BETWEEN ...   — strict time-window check performed by the DB,
//                           avoiding any client-clock drift issues
//   • LIMIT 1             — if multiple overlapping delegations exist for the
//                           same delegado, the one expiring latest wins
// =============================================================================

'use strict';

const { pool } = require('../config/db');

const DelegacionModel = {

  // ---------------------------------------------------------------------------
  // findActiveDelegacion
  // Returns the active delegation record for id_usuario_delegado if one exists
  // whose time window contains the current DB server time, or null otherwise.
  //
  // @param  {number} id_usuario_delegado — PK of the user requesting authority
  // @returns {Promise<Object|null>}
  // ---------------------------------------------------------------------------
  async findActiveDelegacion(id_usuario_delegado) {
    // The connection pool is configured with timezone '+00:00' (UTC) and the
    // frontend datetime-local inputs send Bolivia local time strings (e.g.
    // "2026-06-18T10:00") which are stored as-is.  MySQL's NOW() runs in UTC
    // (4 hours ahead of Bolivia / America/La_Paz, UTC-4), so comparing NOW()
    // against locally-stored times causes delegations to expire instantly.
    //
    // Fix: compute the current Bolivia local time in Node.js using the IANA
    // timezone database and pass it as a bound parameter.  The sv-SE locale
    // reliably returns an ISO-like "YYYY-MM-DD HH:mm:ss" string; .slice(0,19)
    // ensures exactly that format for MySQL DATETIME comparison.
    const nowBolivia = new Date()
      .toLocaleString('sv-SE', { timeZone: 'America/La_Paz' })
      .slice(0, 19);  // → "2026-06-18 10:00:30"

    const [rows] = await pool.execute(
      `SELECT
         d.id,
         d.id_usuario_jefe,
         u.nombre_completo  AS jefe_nombre,
         u.nombre_usuario   AS jefe_usuario,
         d.fecha_inicio,
         d.fecha_fin
       FROM   delegaciones_rol d
       JOIN   usuarios u ON u.id = d.id_usuario_jefe
       WHERE  d.id_usuario_delegado = ?
         AND  d.activo = 1
         AND  ? BETWEEN d.fecha_inicio AND d.fecha_fin
       ORDER  BY d.fecha_fin DESC
       LIMIT  1`,
      [id_usuario_delegado, nowBolivia]
    );

    return rows[0] || null;
  },

  // ---------------------------------------------------------------------------
  // createDelegacion
  // Insert a new temporal delegation record.
  // Business rule: fecha_fin must be strictly after fecha_inicio.
  //
  // @param {Object} data
  //   id_usuario_jefe      {number}  — PK of the delegating Jefe
  //   id_usuario_delegado  {number}  — PK of the receiving user
  //   fecha_inicio         {string}  — ISO datetime string
  //   fecha_fin            {string}  — ISO datetime string
  // @returns {Promise<number>} insertId
  // ---------------------------------------------------------------------------
  async createDelegacion({ id_usuario_jefe, id_usuario_delegado, fecha_inicio, fecha_fin }) {
    const [result] = await pool.execute(
      `INSERT INTO delegaciones_rol
         (id_usuario_jefe, id_usuario_delegado, fecha_inicio, fecha_fin, activo)
       VALUES (?, ?, ?, ?, 1)`,
      [id_usuario_jefe, id_usuario_delegado, fecha_inicio, fecha_fin]
    );
    return result.insertId;
  },

  // ---------------------------------------------------------------------------
  // revocarDelegacion
  // Soft-deactivate a delegation record (activo = 0).
  //
  // @param {number} id   — delegation PK
  // @param {number} id_usuario_jefe — ensures only the owner Jefe can revoke
  // @returns {Promise<boolean>}
  // ---------------------------------------------------------------------------
  async revocarDelegacion(id, id_usuario_jefe) {
    const [result] = await pool.execute(
      'UPDATE delegaciones_rol SET activo = 0 WHERE id = ? AND id_usuario_jefe = ?',
      [id, id_usuario_jefe]
    );
    return result.affectedRows > 0;
  },

  // ---------------------------------------------------------------------------
  // findByJefe
  // List all delegations (active + inactive) created by a given Jefe.
  //
  // @param {number} id_usuario_jefe
  // @returns {Promise<Array<Object>>}
  // ---------------------------------------------------------------------------
  async findByJefe(id_usuario_jefe) {
    const [rows] = await pool.execute(
      `SELECT
         d.id,
         d.id_usuario_delegado,
         ud.nombre_completo AS delegado_nombre,
         ud.nombre_usuario  AS delegado_usuario,
         ud.id_rol,
         r.nombre           AS delegado_rol,
         d.fecha_inicio,
         d.fecha_fin,
         d.activo,
         d.creado_en
       FROM   delegaciones_rol d
       JOIN   usuarios ud ON ud.id = d.id_usuario_delegado
       JOIN   roles    r  ON r.id  = ud.id_rol
       WHERE  d.id_usuario_jefe = ?
       ORDER  BY d.creado_en DESC`,
      [id_usuario_jefe]
    );
    return rows;
  },

  // ---------------------------------------------------------------------------
  // findEjecutivos
  // Returns active users with the 'Ejecutivo' role — used to populate
  // the delegate selection dropdown in the UI.
  //
  // @returns {Promise<Array<{id, nombre_completo, nombre_usuario}>>}
  // ---------------------------------------------------------------------------
  async findEjecutivos() {
    const [rows] = await pool.execute(
      `SELECT u.id, u.nombre_completo, u.nombre_usuario
       FROM   usuarios u
       JOIN   roles    r ON r.id = u.id_rol
       WHERE  r.nombre IN ('Ejecutivo', 'Administracion')
         AND  u.activo = 1
       ORDER  BY u.nombre_completo ASC`
    );
    return rows;
  },
};

module.exports = DelegacionModel;
