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

// ---------------------------------------------------------------------------
// Lista en memoria de tokens revocados (logout) — rechazo instantáneo dentro de
// este proceso. Es sólo un atajo: la revocación durable, que sobrevive a un
// reinicio, la da el contador usuarios.token_version que se verifica más abajo,
// y ése ya funciona en cluster porque lee la base compartida.
//
// Es un Map token → milisegundo de expiración, no un Set, para poder purgar.
// Antes era un Set que no se limpiaba nunca: crecía mientras el proceso viviera
// y, peor, acumulaba tokens YA VENCIDOS que no servían de nada — jwt.verify los
// rechaza por expiración antes de que se llegue a consultar esta lista.
// ---------------------------------------------------------------------------
const revokedTokens = new Map();

// Al superar este tamaño se purgan los vencidos. Purgar en cada revocación
// sería O(n) por logout; así el costo se amortiza.
const PURGE_THRESHOLD = 200;

/** Milisegundo de expiración de un JWT, o null si no se puede leer. */
function tokenExpiryMs(token) {
  try {
    const decoded = jwt.decode(token);
    return decoded?.exp ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Descarta los tokens revocados que ya vencieron.
 * Los que no tienen `exp` legible se conservan: no se puede saber si vencieron
 * y descartarlos por las dudas reabriría una sesión que se cerró a propósito.
 */
function purgeExpiredTokens(now = Date.now()) {
  for (const [token, expMs] of revokedTokens) {
    if (expMs !== null && expMs <= now) revokedTokens.delete(token);
  }
}

/** ¿Este token fue revocado por un logout? */
function isTokenRevoked(token) {
  return revokedTokens.has(token);
}

/** Cuántos tokens hay en la lista (para tests y diagnóstico). */
function revokedTokenCount() {
  return revokedTokens.size;
}

/** Vacía la lista. Sólo para los tests. */
function __clearRevokedTokens() {
  revokedTokens.clear();
}

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

  // 2. Isolate the token string after "Bearer ". slice(7) and NOT
  //    split(' ')[1]: the guard right below needs the token WHOLE (it may
  //    itself start with "Bearer ") to detect the double-prefix case —
  //    split(' ')[1] would cut it at the first space and the guard could
  //    never see more than the literal word "Bearer". Found in the stress
  //    round on 2026-08-25: the guard existed but could never fire.
  let token = authHeader.slice(7).trim();

  // Defensive guard: Swagger UI with scheme:'bearer' prepends "Bearer " automatically.
  // If the user pasted the full "Bearer <jwt>" string into the Swagger UI field,
  // the header arrives as "Bearer Bearer <jwt>". Strip the redundant prefix here
  // so both paste styles (raw token / prefixed token) work correctly.
  if (token.toLowerCase().startsWith('bearer ')) {
    token = token.slice(7).trim();
  }

  // 3. Check if this token has been explicitly revoked (logout scenario)
  if (isTokenRevoked(token)) {
    return res.status(401).json({
      success: false,
      message: 'Token has been revoked. Please log in again.',
    });
  }

  try {
    // 4. Verify the token signature and expiration with the application secret.
    //    jwt.verify throws JsonWebTokenError or TokenExpiredError on failure.
    //    algorithms fijo explícito: defensa en profundidad (auditoría 2026-08-28).
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });

    // 4b. Reject single-purpose tokens (e.g. the 10-minute /api-docs access
    //     token minted by AuthController.getDocsToken). Those payloads carry
    //     a `purpose` claim precisely so they CANNOT be replayed as a normal
    //     session token against any other endpoint — enforce that here since
    //     this is the one middleware every protected route shares.
    if (payload.purpose) {
      return res.status(401).json({
        success: false,
        message: 'This token is not valid for this operation.',
      });
    }

    // 5. Durable revocation check — compare the token's version stamp against the
    //    current persistent counter in the database, and confirm the account is
    //    still active. A logout bumps the counter, and an admin deactivating a
    //    user (or changing their role) also bumps it (see UserController), so
    //    any token minted before either event is rejected here even after the
    //    server has been restarted (the in-memory set above would have been lost).
    //    Fail-open on DB errors: the token is already cryptographically valid, so
    //    a transient DB hiccup must not lock every user out (availability).
    try {
      const session = await UserModel.getSessionState(payload.id);

      if (!session) {
        // User no longer exists — reject.
        return res.status(401).json({
          success: false,
          message: 'Token has been revoked. Please log in again.',
        });
      }

      if (!session.activo) {
        return res.status(401).json({
          success: false,
          message: 'Account has been deactivated. Please contact an administrator.',
        });
      }

      const tokenVersion = payload.token_version ?? 0;
      if (tokenVersion !== session.token_version) {
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
// Agrega un JWT a la lista de revocados. Lo llama el controller de logout.
// Guarda además su expiración para poder purgarlo después.
// ---------------------------------------------------------------------------
function revokeToken(token) {
  if (!token) return;

  revokedTokens.set(token, tokenExpiryMs(token));

  // Purga amortizada: sólo al superar el umbral, no en cada logout.
  if (revokedTokens.size > PURGE_THRESHOLD) purgeExpiredTokens();
}

module.exports = {
  authenticate,
  revokeToken,
  isTokenRevoked,
  purgeExpiredTokens,
  revokedTokenCount,
  __clearRevokedTokens,
};
