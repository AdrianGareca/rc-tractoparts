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
         AND  NOW() BETWEEN d.fecha_inicio AND d.fecha_fin
       ORDER  BY d.fecha_fin DESC
       LIMIT  1`,
      [id_usuario_delegado]
    );

    return rows[0] || null;
  },
};

module.exports = DelegacionModel;
