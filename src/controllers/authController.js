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

// A static, valid-format bcrypt hash (cost 12, matching the default
// BCRYPT_ROUNDS) with no corresponding real password. Used to burn an
// equivalent amount of CPU time on a bcrypt.compare() call when the username
// lookup misses, so a nonexistent-username response takes roughly as long as
// a wrong-password response. Without this, an attacker can enumerate valid
// usernames purely from response-time (unknown user = instant 401, no
// bcrypt call; known user with wrong password = ~80-150ms bcrypt.compare).
const DUMMY_BCRYPT_HASH = '$2a$12$CwTycUXWue0Thq9StjUM0uJ8mEywNw12KVUwEVQjLzQKtUyq93U9m';

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

      // Generic 401 — never reveal whether the username exists or not.
      // Burn an equivalent bcrypt.compare() cost against a dummy hash so this
      // path takes roughly as long as the wrong-password path below — otherwise
      // the response-time gap itself reveals whether the username is valid.
      if (!user) {
        await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
        return res.status(401).json({ success: false, message: 'Invalid credentials.' });
      }

      // ── 3. Active account check ───────────────────────────────────────────────
      if (!user.activo) {
        await bcrypt.compare(password, DUMMY_BCRYPT_HASH); // keep timing uniform

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
      // If this write fails, the token is still only revoked in THIS process'
      // in-memory set (the fast path above) — other instances / a restart would
      // still accept it. Surface that to the client instead of silently
      // claiming full success, so the frontend can react (e.g. force-clear the
      // locally-stored token regardless).
      let durableRevocationFailed = false;
      try {
        await UserModel.incrementTokenVersion(req.user.id);
      } catch (versionErr) {
        durableRevocationFailed = true;
        console.error('[AuthController.logout] token_version bump FAILED — durable revocation incomplete:', versionErr.message);
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
        message: durableRevocationFailed
          ? 'Logged out locally. Full session revocation is pending — please discard the token on this device.'
          : 'Logged out successfully. Token has been invalidated.',
        warning: durableRevocationFailed,
      });
    } catch (error) {
      console.error('[AuthController.logout] Error:', error.message);

      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred during logout.',
      });
    }
  },

  // ---------------------------------------------------------------------------
  // getDocsToken — GET /api/auth/docs-token  (Jefe / SysAdmin only, route-guarded)
  //
  // Issues a short-lived, single-purpose JWT used ONLY to open /api-docs.
  // Swagger UI is browser-navigated (a direct GET, not an XHR from apiClient),
  // so it cannot carry an Authorization header — the gate in src/app.js reads
  // the token from a ?token= query param instead. Deliberately NOT the user's
  // full 8h session token: a dedicated 10-minute token scoped to purpose
  // 'api-docs' means a leaked docs URL (pasted in chat, browser history) has a
  // tiny blast radius and cannot be replayed against any other endpoint.
  // ---------------------------------------------------------------------------
  async getDocsToken(req, res) {
    try {
      const token = jwt.sign(
        { id: req.user.id, rol: req.user.rol, purpose: 'api-docs' },
        process.env.JWT_SECRET,
        { expiresIn: '10m', algorithm: 'HS256' }
      );

      return res.status(200).json({ success: true, data: { token } });
    } catch (error) {
      console.error('[AuthController.getDocsToken] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to issue documentation access token.' });
    }
  },
};

module.exports = AuthController;
