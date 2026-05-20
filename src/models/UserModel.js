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
  // @param   {Object} data - { nombre_completo, nombre_usuario, password_hash, id_rol }
  // @returns {number}      - insertId of the new record
  // ---------------------------------------------------------------------------
  async create({ nombre_completo, nombre_usuario, password_hash, id_rol }) {
    const sql = `
      INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol)
      VALUES (?, ?, ?, ?)
    `;

    const [result] = await pool.execute(sql, [
      nombre_completo,
      nombre_usuario,
      password_hash,
      id_rol,
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
  // update
  // Partial update of a user's profile fields (Jefe only).
  // Only the fields present in the data object are updated.
  //
  // @param {number} id   - User primary key
  // @param {Object} data - Partial fields to update
  // @returns {boolean}   - true if any row was affected
  // ---------------------------------------------------------------------------
  async update(id, data) {
    const allowedFields = ['nombre_completo', 'id_rol', 'activo', 'password_hash'];

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

  // ---------------------------------------------------------------------------
  // hasCotizaciones
  // Check whether a user has associated quotations.
  // If true, the user must be deactivated (soft delete) instead of deleted.
  //
  // @param  {number}  id - User primary key
  // @returns {boolean}
  // ---------------------------------------------------------------------------
  async hasCotizaciones(id) {
    const sql = `
      SELECT COUNT(*) AS total
      FROM cotizaciones
      WHERE id_ejecutivo = ?
      LIMIT 1
    `;

    const [rows] = await pool.execute(sql, [id]);
    return rows[0].total > 0;
  },
};

module.exports = UserModel;
