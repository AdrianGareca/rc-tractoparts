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

// In-memory revoked token store — tokens are added here on logout.
// This set is cleared on server restart; acceptable for an 8-hour JWT lifetime.
// For multi-instance deployments, replace with a shared Redis store.
const revokedTokens = new Set();

// ---------------------------------------------------------------------------
// authenticate
// Express middleware: verify Bearer JWT and attach req.user
// ---------------------------------------------------------------------------
function authenticate(req, res, next) {
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

    // 5. Attach decoded user data to the request object for downstream use.
    //    Controllers and role middleware read req.user — never trust the raw body.
    req.user = {
      id:             payload.id,             // INT — primary key in usuarios
      nombre_usuario: payload.nombre_usuario, // VARCHAR — username for audit logs
      rol:            payload.rol,            // VARCHAR — role name (Ejecutivo, Jefe, etc.)
    };

    // 6. Attach the raw token so the logout controller can revoke it
    req.token = token;

    next(); // Proceed to the next middleware or controller
  } catch (error) {
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
