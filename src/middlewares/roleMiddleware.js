// =============================================================================
// src/middlewares/roleMiddleware.js
// Role-Based Access Control (RBAC) Middleware (Section 3.7.3 — autorizar.js)
//
// Responsibility: After authentication confirms the caller's identity, this
// middleware verifies that the caller's role is in the list of allowed roles
// for the specific endpoint. Requests with an unauthorized role are rejected
// with HTTP 403 Forbidden — they never reach the controller.
//
// Usage:
//   const authorize = require('./roleMiddleware');
//   const { authenticate } = require('./authMiddleware');
//
//   // Only the "Jefe" role can approve quotations
//   router.post('/:id/aprobar', authenticate, authorize(['Jefe']), ctrl.aprobar);
//
//   // Executives and Admin can create quotations
//   router.post('/', authenticate, authorize(['Ejecutivo', 'Administracion']), ctrl.crear);
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// authorize
// Factory function — returns an Express middleware configured for the given roles.
// allowedRoles: string[] — role names allowed to access this endpoint.
// ---------------------------------------------------------------------------
function authorize(allowedRoles) {
  // Validate argument at definition time to catch configuration errors early
  if (!Array.isArray(allowedRoles) || allowedRoles.length === 0) {
    throw new Error('[roleMiddleware] authorize() requires a non-empty array of roles.');
  }

  // Return the actual Express middleware function
  return function roleGuard(req, res, next) {
    // Defensive check: authenticate middleware must have run first and set req.user
    if (!req.user || !req.user.rol) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required before authorization.',
      });
    }

    // Use the effective role if resolveDelegacion has already promoted it
    // (e.g. a delegated Ejecutivo acting with temporary Jefe authority).
    // Fall back to the token role when the delegation middleware was not run.
    const userRole = req.user.rol_efectivo || req.user.rol;

    // Check whether the authenticated user's role is in the allowed list
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${allowedRoles.join(' or ')}. ` +
                 `Your role: ${userRole}.`,
      });
    }

    // Role is authorized — continue to the next middleware or controller
    next();
  };
}

module.exports = authorize;
