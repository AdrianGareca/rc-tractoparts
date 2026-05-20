// =============================================================================
// src/controllers/authController.js
// Authentication Controller — HU01: Login and Logout
// (Section 3.10 — POST /api/auth/login, POST /api/auth/logout)
//
// Responsibilities:
//   - Validate request payload
//   - Delegate business logic to UserModel
//   - Issue or invalidate JWT tokens
//   - Return structured JSON responses per the API contract (Section 3.10)
// =============================================================================

'use strict';

const bcrypt    = require('bcryptjs');           // Password hash comparison
const jwt       = require('jsonwebtoken');        // JWT signing
const UserModel = require('../models/UserModel'); // Data access layer
const { revokeToken } = require('../middlewares/authMiddleware'); // Token revocation store
const { logEvent, AuditActions } = require('../utils/auditLog'); // Audit logger

const AuthController = {

  // ---------------------------------------------------------------------------
  // login
  // POST /api/auth/login
  //
  // Steps:
  //   1. Validate required fields in the request body
  //   2. Look up the user by username
  //   3. Check if the account is active and not locked
  //   4. Compare the provided password against the stored bcrypt hash
  //   5. On success: reset failed-attempt counter, issue JWT, log the event
  //   6. On failure: increment failed-attempt counter, log the failed attempt
  // ---------------------------------------------------------------------------
  async login(req, res) {
    const { nombre_usuario, password } = req.body;

    // --- 1. Input validation ---
    if (!nombre_usuario || !password) {
      return res.status(422).json({
        success: false,
        message: 'Both nombre_usuario and password are required.',
      });
    }

    // Trim whitespace to tolerate accidental spaces (common on mobile keyboards)
    const trimmedUsername = String(nombre_usuario).trim();
    const clientIp        = req.ip || req.socket?.remoteAddress || null;

    try {
      // --- 2. Look up user ---
      const user = await UserModel.findByUsername(trimmedUsername);

      if (!user) {
        // Do not reveal whether the username exists — generic error per HU01 acceptance criteria
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials.',
        });
      }

      // --- 3a. Check if the account is active ---
      if (!user.activo) {
        await logEvent({
          id_usuario:    user.id,
          nombre_usuario: user.nombre_usuario,
          accion:        AuditActions.LOGIN_FAILED,
          entidad:       'usuarios',
          id_entidad:    user.id,
          detalle:       { reason: 'account_inactive' },
          ip_origen:     clientIp,
          resultado:     'fallo',
        });

        return res.status(401).json({
          success: false,
          message: 'Invalid credentials.', // Generic — do not expose inactive status
        });
      }

      // --- 3b. Check if the account is temporarily locked ---
      if (user.bloqueado_hasta && new Date(user.bloqueado_hasta) > new Date()) {
        const unlockTime = new Date(user.bloqueado_hasta).toISOString();

        await logEvent({
          id_usuario:    user.id,
          nombre_usuario: user.nombre_usuario,
          accion:        AuditActions.LOGIN_FAILED,
          entidad:       'usuarios',
          id_entidad:    user.id,
          detalle:       { reason: 'account_locked', bloqueado_hasta: unlockTime },
          ip_origen:     clientIp,
          resultado:     'fallo',
        });

        return res.status(401).json({
          success: false,
          message: `Account temporarily locked due to repeated failed attempts. ` +
                   `Try again after ${unlockTime}.`,
        });
      }

      // --- 4. Compare password against stored bcrypt hash ---
      const passwordMatches = await bcrypt.compare(password, user.password_hash);

      if (!passwordMatches) {
        // Increment the failed-attempt counter (may trigger account lock)
        await UserModel.incrementFailedAttempts(user.id);

        await logEvent({
          id_usuario:    user.id,
          nombre_usuario: user.nombre_usuario,
          accion:        AuditActions.LOGIN_FAILED,
          entidad:       'usuarios',
          id_entidad:    user.id,
          detalle:       { reason: 'wrong_password', attempts: user.intentos_fallidos + 1 },
          ip_origen:     clientIp,
          resultado:     'fallo',
        });

        return res.status(401).json({
          success: false,
          message: 'Invalid credentials.', // Generic — never specify which field failed
        });
      }

      // --- 5. Authentication successful ---

      // Reset failed attempts and update last-access timestamp
      await UserModel.updateLoginSuccess(user.id);

      // Build the JWT payload — only include data needed by downstream middleware
      const tokenPayload = {
        id:             user.id,
        nombre_usuario: user.nombre_usuario,
        rol:            user.rol, // e.g. "Ejecutivo", "Administracion", "Jefe"
      };

      // Sign the token with the application secret; lifetime from .env
      const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
        expiresIn:  process.env.JWT_EXPIRES_IN || '8h',
        algorithm:  'HS256', // Symmetric signature — secret stays on the server
      });

      // Log the successful login event
      await logEvent({
        id_usuario:    user.id,
        nombre_usuario: user.nombre_usuario,
        accion:        AuditActions.LOGIN,
        entidad:       'usuarios',
        id_entidad:    user.id,
        ip_origen:     clientIp,
        resultado:     'exito',
      });

      // Return the token and minimal profile data; never return password_hash
      return res.status(200).json({
        success: true,
        message: 'Authentication successful.',
        data: {
          token,
          user: {
            id:              user.id,
            nombre_completo: user.nombre_completo,
            nombre_usuario:  user.nombre_usuario,
            rol:             user.rol,
          },
        },
      });
    } catch (error) {
      // Unexpected database or runtime error
      console.error('[AuthController.login] Error:', error.message);

      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred. Please try again later.',
      });
    }
  },

  // ---------------------------------------------------------------------------
  // logout
  // POST /api/auth/logout
  //
  // Adds the current request's JWT to the in-memory revoked set.
  // The authenticate middleware attaches req.token; it is guaranteed to exist here
  // because this route is protected by that middleware.
  // ---------------------------------------------------------------------------
  async logout(req, res) {
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    try {
      // Revoke the token so it cannot be reused before expiry
      revokeToken(req.token);

      await logEvent({
        id_usuario:    req.user.id,
        nombre_usuario: req.user.nombre_usuario,
        accion:        AuditActions.LOGOUT,
        entidad:       'usuarios',
        id_entidad:    req.user.id,
        ip_origen:     clientIp,
        resultado:     'exito',
      });

      return res.status(200).json({
        success: true,
        message: 'Logged out successfully. Token has been invalidated.',
      });
    } catch (error) {
      console.error('[AuthController.logout] Error:', error.message);

      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred during logout.',
      });
    }
  },
};

module.exports = AuthController;
