// =============================================================================
// src/middlewares/delegacionMiddleware.js
// Temporal Role Delegation Resolver
//
// Express middleware — MUST run after authenticate (which populates req.user).
//
// Responsibility:
//   Checks delegaciones_rol for an active, time-bounded delegation record
//   that names the current user as id_usuario_delegado.  On success it
//   promotes req.user.rol_efectivo to 'Jefe' so downstream authorize() and
//   controller role-checks treat the user with full Jefe authority for this
//   request.  The original req.user.rol is never mutated — audit logging
//   can always distinguish a real Jefe from a delegated one.
//
// Attached to req.user on success:
//   req.user.rol_efectivo  {string}  'Jefe'
//   req.user.delegacion    {Object}  { id, id_usuario_jefe, jefe_nombre, jefe_usuario,
//                                      fecha_inicio, fecha_fin }
//
// On failure / no delegation:
//   req.user.rol_efectivo  {string}  mirrors req.user.rol (no change)
//   req.user.delegacion    undefined
//
// Error handling: DB errors are non-fatal and are only logged.  The request
// continues with the user's base role, which the next authorize() call will
// either pass or reject as normal.
// =============================================================================

'use strict';

const DelegacionModel = require('../models/DelegacionModel');

// ---------------------------------------------------------------------------
// resolveDelegacion
// ---------------------------------------------------------------------------
async function resolveDelegacion(req, res, next) {
  // Default: the effective role equals the token role
  req.user.rol_efectivo = req.user.rol;

  // Jefe and SysAdmin already have authority — skip the DB round-trip.
  if (['Jefe', 'SysAdmin'].includes(req.user.rol)) {
    return next();
  }

  try {
    const delegacion = await DelegacionModel.findActiveDelegacion(req.user.id);

    if (delegacion) {
      req.user.rol_efectivo = 'Jefe';
      req.user.delegacion   = delegacion;
    }
  } catch (err) {
    // Non-fatal: log the failure and fall through.
    // The authorize() guard that follows will reject with 403 if the base
    // role is insufficient — the security boundary is maintained.
    console.warn(
      `[delegacionMiddleware] DB lookup failed for user ${req.user.id} (non-fatal):`,
      err.message
    );
  }

  next();
}

module.exports = resolveDelegacion;
