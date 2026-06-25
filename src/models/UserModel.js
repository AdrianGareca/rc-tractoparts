// =============================================================================
// src/models/UserModel.js
// Data Access Layer — usuarios table (Section 3.5.2)
//
// This is the ONLY module that executes SQL against the usuarios table.
// Controllers and services must never write raw SQL; they call these methods.
// All queries are parameterized to prevent SQL injection (RNF12).
// =============================================================================

'use strict';

const { pool } = require('../config/db'); // Shared connection pool

const UserModel = {

  // ---------------------------------------------------------------------------
  // findByUsername
  // Find an active or inactive user by their login name.
  // Used by the login flow to validate credentials.
  //
  // @param   {string}  nombreUsuario - The login username
  // @returns {Object|null}           - Full user row including password_hash and role name
  // ---------------------------------------------------------------------------
  async findByUsername(nombreUsuario) {
    const sql = `
      SELECT
        u.id,
        u.nombre_completo,
        u.nombre_usuario,
        u.password_hash,
        u.id_rol,
        r.nombre        AS rol,       -- role name string used in JWT payload
        u.activo,
        u.can_approve_quotations,     -- Delegación de Funciones (surfaced to the session for UI gating)
        u.token_version,              -- Persistent revocation counter (survives server restart)
        u.intentos_fallidos,
        u.bloqueado_hasta,
        u.ultimo_acceso
      FROM usuarios u
      INNER JOIN roles r ON r.id = u.id_rol
      WHERE u.nombre_usuario = ?
      LIMIT 1
    `;

    const [rows] = await pool.execute(sql, [nombreUsuario]);
    return rows[0] || null; // Return the first row or null if not found
  },

  // ---------------------------------------------------------------------------
  // findById
  // Find a user by primary key. Used for user management endpoints.
  //
  // @param   {number}  id - User primary key
  // @returns {Object|null}
  // ---------------------------------------------------------------------------
  async findById(id) {
    const sql = `
      SELECT
        u.id,
        u.nombre_completo,
        u.nombre_usuario,
        u.id_rol,
        r.nombre AS rol,
        u.activo,
        u.can_approve_quotations,
        u.ultimo_acceso,
        u.creado_en
      FROM usuarios u
      INNER JOIN roles r ON r.id = u.id_rol
      WHERE u.id = ?
      LIMIT 1
    `;

    const [rows] = await pool.execute(sql, [id]);
    return rows[0] || null;
  },

  // ---------------------------------------------------------------------------
  // findAll
  // List all users with their role names. Available only to the Jefe role.
  //
  // @returns {Array<Object>}
  // ---------------------------------------------------------------------------
  async findAll() {
    const sql = `
      SELECT
        u.id,
        u.nombre_completo,
        u.nombre_usuario,
        u.id_rol,
        r.nombre AS rol,
        u.activo,
        u.can_approve_quotations,
        u.ultimo_acceso,
        u.creado_en
      FROM usuarios u
      INNER JOIN roles r ON r.id = u.id_rol
      ORDER BY u.creado_en DESC
    `;

    const [rows] = await pool.execute(sql);
    return rows;
  },

  // ---------------------------------------------------------------------------
  // create
  // Insert a new user. The password must already be hashed by the service layer.
  //
  // @param   {Object} data - { nombre_completo, nombre_usuario, password_hash, id_rol,
  //                            can_approve_quotations? }
  // @returns {number}      - insertId of the new record
  //
  // can_approve_quotations defaults to 0 (no delegation). The controller is the
  // sole authority that decides whether to forward a non-zero value — see the
  // anti-escalation guard in userController.createUser.
  // ---------------------------------------------------------------------------
  async create({ nombre_completo, nombre_usuario, password_hash, id_rol, can_approve_quotations = 0 }) {
    const sql = `
      INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, can_approve_quotations)
      VALUES (?, ?, ?, ?, ?)
    `;

    const [result] = await pool.execute(sql, [
      nombre_completo,
      nombre_usuario,
      password_hash,
      id_rol,
      can_approve_quotations ? 1 : 0,
    ]);

    return result.insertId; // Return the new user's primary key
  },

  // ---------------------------------------------------------------------------
  // updateLoginSuccess
  // Reset failed-login counter and update last-access timestamp after a successful login.
  //
  // @param {number} id - User primary key
  // ---------------------------------------------------------------------------
  async updateLoginSuccess(id) {
    const sql = `
      UPDATE usuarios
      SET
        intentos_fallidos = 0,
        bloqueado_hasta   = NULL,
        ultimo_acceso     = NOW()
      WHERE id = ?
    `;

    await pool.execute(sql, [id]);
  },

  // ---------------------------------------------------------------------------
  // incrementFailedAttempts
  // Increase the failed-login counter. If the threshold is reached, set the
  // bloqueado_hasta timestamp to lock the account for LOCK_DURATION_MINUTES.
  //
  // @param {number} id - User primary key
  // ---------------------------------------------------------------------------
  async incrementFailedAttempts(id) {
    const maxAttempts   = parseInt(process.env.MAX_LOGIN_ATTEMPTS, 10)    || 3;
    const lockMinutes   = parseInt(process.env.LOCK_DURATION_MINUTES, 10) || 15;

    // Use a single atomic UPDATE to increment and conditionally lock
    const sql = `
      UPDATE usuarios
      SET
        intentos_fallidos = intentos_fallidos + 1,
        bloqueado_hasta   = CASE
          WHEN (intentos_fallidos + 1) >= ?
          THEN DATE_ADD(NOW(), INTERVAL ? MINUTE)
          ELSE bloqueado_hasta
        END
      WHERE id = ?
    `;

    await pool.execute(sql, [maxAttempts, lockMinutes, id]);
  },

  // ---------------------------------------------------------------------------
  // getTokenVersion
  // Returns the current persistent session/token version for a user, or null if
  // the user no longer exists. Consumed by the auth middleware on every request
  // to validate that a JWT has not been invalidated by a logout (RNF — secure
  // session teardown that survives server restarts).
  //
  // @param  {number} id - User primary key
  // @returns {number|null}
  // ---------------------------------------------------------------------------
  async getTokenVersion(id) {
    const [rows] = await pool.execute(
      'SELECT token_version FROM usuarios WHERE id = ? LIMIT 1',
      [id]
    );
    return rows[0] ? rows[0].token_version : null;
  },

  // ---------------------------------------------------------------------------
  // incrementTokenVersion
  // Atomically bumps the user's token_version, instantly invalidating every JWT
  // previously issued to that user (all active sessions/devices). Called on
  // logout. Because the counter lives in the database, the revocation persists
  // across server restarts — unlike a volatile in-memory set.
  //
  // @param {number} id - User primary key
  // ---------------------------------------------------------------------------
  async incrementTokenVersion(id) {
    await pool.execute(
      'UPDATE usuarios SET token_version = token_version + 1 WHERE id = ?',
      [id]
    );
  },

  // ---------------------------------------------------------------------------
  // update
  // Partial update of a user's profile fields (Jefe only).
  // Only the fields present in the data object are updated.
  //
  // @param {number} id   - User primary key
  // @param {Object} data - Partial fields to update
  // @returns {boolean}   - true if any row was affected
  // ---------------------------------------------------------------------------
  async update(id, data) {
    const allowedFields = ['nombre_completo', 'id_rol', 'activo', 'password_hash', 'can_approve_quotations'];

    // Build a dynamic SET clause for only the provided fields
    const setClauses = [];
    const values     = [];

    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        setClauses.push(`${field} = ?`); // e.g. "nombre_completo = ?"
        values.push(data[field]);        // bind value
      }
    }

    if (setClauses.length === 0) {
      return false; // Nothing to update
    }

    values.push(id); // WHERE clause parameter

    const sql = `UPDATE usuarios SET ${setClauses.join(', ')} WHERE id = ?`;
    const [result] = await pool.execute(sql, values);

    return result.affectedRows > 0;
  },
};

module.exports = UserModel;
