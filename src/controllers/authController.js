// =============================================================================
// src/controllers/authController.js
// Authentication Controller — HU01: Login and Logout
//
// Sprint 2 hardening: added explicit hash.trim() as a defensive measure
// against any database driver that might pad fixed-width columns, even though
// our schema declares password_hash as VARCHAR(255). The trim costs nothing
// and makes the comparison resilient to column-type regressions.
// =============================================================================

'use strict';

const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const UserModel = require('../models/UserModel');
const { revokeToken }             = require('../middlewares/authMiddleware');
const { logEvent, AuditActions }  = require('../utils/auditLog');

const AuthController = {

  // ---------------------------------------------------------------------------
  // login — POST /api/auth/login
  //
  // Steps:
  //   1. Validate required fields
  //   2. Look up the user by username (INNER JOIN with roles)
  //   3. Reject inactive accounts
  //   4. Reject locked accounts (brute-force protection)
  //   5. Compare the submitted password against the stored bcrypt hash
  //   6. On success: reset failed-attempt counter, issue JWT, log event
  //   7. On failure: increment failed-attempt counter, log event
  // ---------------------------------------------------------------------------
  async login(req, res) {
    const { nombre_usuario, password } = req.body;

    // ── 1. Field presence check ───────────────────────────────────────────────
    if (!nombre_usuario || !password) {
      return res.status(422).json({
        success: false,
        message: 'Both nombre_usuario and password are required.',
      });
    }

    // Trim whitespace to tolerate accidental spaces (common on mobile / Swagger UI)
    const trimmedUsername = String(nombre_usuario).trim();
    const clientIp        = req.ip || req.socket?.remoteAddress || null;

    try {
      // ── 2. User lookup ────────────────────────────────────────────────────────
      const user = await UserModel.findByUsername(trimmedUsername);

      // Generic 401 — never reveal whether the username exists or not
      if (!user) {
        return res.status(401).json({ success: false, message: 'Invalid credentials.' });
      }

      // ── 3. Active account check ───────────────────────────────────────────────
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

        // Return the same generic message to prevent username enumeration
        return res.status(401).json({ success: false, message: 'Invalid credentials.' });
      }

      // ── 4. Brute-force lockout check ──────────────────────────────────────────
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
          message: `Account temporarily locked due to repeated failed login attempts. ` +
                   `Try again after ${unlockTime}.`,
        });
      }

      // ── 5. Password comparison ────────────────────────────────────────────────
      // .trim() on the stored hash is a defensive measure: if the database column
      // were ever misconfigured as CHAR (fixed-width, space-padded), MySQL would
      // return trailing spaces that silently break bcrypt's internal string checks.
      // VARCHAR(255) is correct and should never pad, but this costs nothing.
      const storedHash      = String(user.password_hash).trim();
      const passwordMatches = await bcrypt.compare(password, storedHash);

      if (!passwordMatches) {
        await UserModel.incrementFailedAttempts(user.id);

        await logEvent({
          id_usuario:    user.id,
          nombre_usuario: user.nombre_usuario,
          accion:        AuditActions.LOGIN_FAILED,
          entidad:       'usuarios',
          id_entidad:    user.id,
          detalle:       { reason: 'wrong_password', attempts: (user.intentos_fallidos || 0) + 1 },
          ip_origen:     clientIp,
          resultado:     'fallo',
        });

        return res.status(401).json({ success: false, message: 'Invalid credentials.' });
      }

      // ── 6. Authentication successful ──────────────────────────────────────────

      // Reset failed-attempt counter and record last-access timestamp
      await UserModel.updateLoginSuccess(user.id);

      // Build the JWT payload — include only what downstream middleware needs.
      // user.rol is the role NAME string (e.g. 'Jefe') from the JOIN with roles.
      const tokenPayload = {
        id:             user.id,
        nombre_usuario: user.nombre_usuario,
        rol:            user.rol,   // Always the string name from the roles table JOIN
        // Persistent revocation stamp. The auth middleware compares this against
        // usuarios.token_version on every request, so a logout (which bumps the
        // counter) invalidates this token even after a server restart.
        token_version:  user.token_version ?? 0,
      };

      const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '8h',
        algorithm: 'HS256',
      });

      await logEvent({
        id_usuario:    user.id,
        nombre_usuario: user.nombre_usuario,
        accion:        AuditActions.LOGIN,
        entidad:       'usuarios',
        id_entidad:    user.id,
        ip_origen:     clientIp,
        resultado:     'exito',
      });

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
            // Delegación de Funciones flag — the SPA stores this in AuthSession to
            // conditionally render the "Aprobar Internamente" action for delegated
            // executives. Authorization is still enforced server-side (the state
            // controller re-reads the flag fresh from the DB).
            can_approve_quotations: Boolean(user.can_approve_quotations),
          },
        },
      });
    } catch (error) {
      console.error('[AuthController.login] Unexpected error:', error.message);

      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred. Please try again later.',
      });
    }
  },

  // ---------------------------------------------------------------------------
  // logout — POST /api/auth/logout
  // Adds the current JWT to the in-memory revoked set. The authenticate
  // middleware has already verified the token and attached req.token.
  // ---------------------------------------------------------------------------
  async logout(req, res) {
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    try {
      // Fast path: drop the exact token into the in-memory revocation set so it
      // is rejected immediately within this running process.
      revokeToken(req.token);

      // Durable path: bump the user's token_version so EVERY token issued to this
      // user is invalidated and the revocation survives a server restart.
      try {
        await UserModel.incrementTokenVersion(req.user.id);
      } catch (versionErr) {
        console.warn('[AuthController.logout] token_version bump failed (non-fatal):', versionErr.message);
      }

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
