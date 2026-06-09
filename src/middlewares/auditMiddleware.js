// =============================================================================
// src/middlewares/auditMiddleware.js
// Audit Middleware & Helper — HU11: Sprint 2 Audit Log System
//
// Provides two exports:
//
//   1. auditAction(req, tabla, accion, id_registro, detalles?)
//      Fire-and-forget helper called directly inside controllers after a
//      successful operation.  Extracts req.user and req.ip automatically.
//      Returns immediately; DB write happens asynchronously via setImmediate.
//
//   2. buildAuditMiddleware(accion, tabla_afectada)
//      Factory that returns an Express middleware.  Intercepts res.json to
//      capture the response status code and triggers the audit INSERT only
//      when the response is a 2xx success.  Use as route-level middleware
//      for simple, uniform audit needs where no extra detail context is needed.
//
// Both paths delegate to AuditModel.insertAudit which is itself non-throwing.
// =============================================================================

'use strict';

const { insertAudit } = require('../models/AuditModel');

// ---------------------------------------------------------------------------
// _resolveIp
// Extract the real client IP from the request, falling back gracefully.
// Works correctly when 'trust proxy' is set to 1 in Express (Nginx scenario).
// ---------------------------------------------------------------------------
function _resolveIp(req) {
  return (
    req.ip ||
    req.socket?.remoteAddress ||
    req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
    '0.0.0.0'
  );
}

// ---------------------------------------------------------------------------
// auditAction
// Direct call helper — use inside controller bodies after a successful write.
//
// @param {import('express').Request} req     - Express request (provides user + IP)
// @param {string}  tabla_afectada            - Name of the affected table/entity
// @param {string}  accion                    - Action code (see AuditModel.Actions)
// @param {number|null} id_registro_afectado  - Primary key of the affected record
// @param {Object|null} detalles              - Optional extra context (JSON-serializable)
// ---------------------------------------------------------------------------
function auditAction(req, tabla_afectada, accion, id_registro_afectado = null, detalles = null) {
  const id_usuario = req.user?.id ?? null;
  const ip_cliente = _resolveIp(req);

  // setImmediate defers execution to after the current I/O event completes,
  // ensuring the audit INSERT never adds latency to the response path.
  setImmediate(() => {
    insertAudit({
      id_usuario,
      tabla_afectada,
      accion,
      id_registro_afectado,
      detalles,
      ip_cliente,
    });
  });
}

// ---------------------------------------------------------------------------
// buildAuditMiddleware
// Route-level middleware factory.  Wraps res.json to trigger the audit INSERT
// only on successful (2xx) responses.  Suitable for simple cases where the
// controller does not need to pass extra detail context.
//
// Usage:
//   router.post('/resource', authenticate, buildAuditMiddleware('CREAR', 'tabla'), controller);
//
// @param {string} accion          - Action code written to auditoria.accion
// @param {string} tabla_afectada  - Table name written to auditoria.tabla_afectada
// @returns {import('express').RequestHandler}
// ---------------------------------------------------------------------------
function buildAuditMiddleware(accion, tabla_afectada) {
  return function auditMiddleware(req, res, next) {
    const originalJson = res.json.bind(res);

    // Override res.json so we can intercept the final status code
    res.json = function auditedJson(body) {
      // Only log on success (2xx range)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const id_usuario             = req.user?.id ?? null;
        const id_registro_afectado   = req.params?.id ? parseInt(req.params.id, 10) : null;
        const ip_cliente             = _resolveIp(req);

        setImmediate(() => {
          insertAudit({
            id_usuario,
            tabla_afectada,
            accion,
            id_registro_afectado,
            detalles: null,
            ip_cliente,
          });
        });
      }

      // Always delegate to the original res.json — do not alter response
      return originalJson(body);
    };

    next();
  };
}

module.exports = { auditAction, buildAuditMiddleware };
