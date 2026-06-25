// =============================================================================
// src/middlewares/authMiddleware.js
// JWT Authentication Middleware (Section 3.7.2 — autenticar.js)
//
// Responsibility: Verify that every protected request carries a valid, non-expired
// JWT. On success, attach the decoded user payload to req.user so downstream
// middlewares and controllers can read identity and role without re-decoding.
//
// Usage:
//   const authenticate = require('./authMiddleware');
//   router.get('/protected', authenticate, controller.handler);
// =============================================================================

'use strict';

const jwt = require('jsonwebtoken'); // JWT signing and verification
const UserModel = require('../models/UserModel'); // Persistent token_version lookup

// In-memory revoked token store — tokens are added here on logout for instant,
// same-process rejection. This is only a fast path: durable revocation that
// survives a server restart is enforced via the persistent usuarios.token_version
// counter checked below. For multi-instance deployments, the token_version check
// already works cluster-wide because it reads the shared database.
const revokedTokens = new Set();

// ---------------------------------------------------------------------------
// authenticate
// Express middleware: verify Bearer JWT and attach req.user
// ---------------------------------------------------------------------------
async function authenticate(req, res, next) {
  // 1. Extract the Authorization header and validate its format
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // No header or wrong scheme — reject immediately with 401
    return res.status(401).json({
      success: false,
      message: 'Access token is required. Use Authorization: Bearer <token>',
    });
  }

  // 2. Isolate the token string after "Bearer "
  let token = authHeader.split(' ')[1];

  // Defensive guard: Swagger UI with scheme:'bearer' prepends "Bearer " automatically.
  // If the user pasted the full "Bearer <jwt>" string into the Swagger UI field,
  // the header arrives as "Bearer Bearer <jwt>" and split(' ')[1] would be the
  // literal string "Bearer" instead of the JWT.  Strip the redundant prefix here
  // so both paste styles (raw token / prefixed token) work correctly.
  if (token && token.toLowerCase().startsWith('bearer ')) {
    token = token.slice(7).trim();
  }

  // 3. Check if this token has been explicitly revoked (logout scenario)
  if (revokedTokens.has(token)) {
    return res.status(401).json({
      success: false,
      message: 'Token has been revoked. Please log in again.',
    });
  }

  try {
    // 4. Verify the token signature and expiration with the application secret.
    //    jwt.verify throws JsonWebTokenError or TokenExpiredError on failure.
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // 5. Durable revocation check — compare the token's version stamp against the
    //    current persistent counter in the database. A logout bumps the counter,
    //    so any token minted before that logout is rejected here even after the
    //    server has been restarted (the in-memory set above would have been lost).
    //    Fail-open on DB errors: the token is already cryptographically valid, so
    //    a transient DB hiccup must not lock every user out (availability).
    try {
      const currentVersion = await UserModel.getTokenVersion(payload.id);

      if (currentVersion === null) {
        // User no longer exists — reject.
        return res.status(401).json({
          success: false,
          message: 'Token has been revoked. Please log in again.',
        });
      }

      const tokenVersion = payload.token_version ?? 0;
      if (tokenVersion !== currentVersion) {
        return res.status(401).json({
          success: false,
          message: 'Session has been ended. Please log in again.',
        });
      }
    } catch (versionErr) {
      console.warn('[authMiddleware] token_version check skipped (non-fatal):', versionErr.message);
    }

    // 6. Attach decoded user data to the request object for downstream use.
    //    Controllers and role middleware read req.user — never trust the raw body.
    req.user = {
      id:             payload.id,             // INT — primary key in usuarios
      nombre_usuario: payload.nombre_usuario, // VARCHAR — username for audit logs
      rol:            payload.rol,            // VARCHAR — role name (Ejecutivo, Jefe, etc.)
    };

    // 7. Attach the raw token so the logout controller can revoke it
    req.token = token;

    next(); // Proceed to the next middleware or controller
  } catch {
    // Both TokenExpiredError and JsonWebTokenError are treated as 401
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token. Please log in again.',
    });
  }
}

// ---------------------------------------------------------------------------
// revokeToken
// Add a JWT to the in-memory revoked set.
// Called by the logout controller after a successful logout request.
// ---------------------------------------------------------------------------
function revokeToken(token) {
  revokedTokens.add(token); // Set.add is O(1)
}

module.exports = { authenticate, revokeToken };
