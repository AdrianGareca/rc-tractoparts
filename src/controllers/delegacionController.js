// =============================================================================
// src/controllers/delegacionController.js
// Temporal Role Delegation Controller — /api/delegaciones
//
// Endpoints:
//   GET  /api/delegaciones/ejecutivos  — list Ejecutivo candidates (for UI dropdown)
//   GET  /api/delegaciones             — list delegations by the authenticated Jefe
//   POST /api/delegaciones             — create a new temporal delegation
//   DELETE /api/delegaciones/:id       — revoke (soft-deactivate) a delegation
//
// Access: Jefe and SysAdmin only.  Each Jefe sees and manages only their own
// delegation records; SysAdmin has unrestricted read access.
// =============================================================================

'use strict';

const DelegacionModel            = require('../models/DelegacionModel');
const { logEvent, AuditActions } = require('../utils/auditLog');

const DelegacionController = {

  // ---------------------------------------------------------------------------
  // listEjecutivos — GET /api/delegaciones/ejecutivos
  // Returns active users with the 'Ejecutivo' role so the UI can populate the
  // delegate-selection dropdown.
  // ---------------------------------------------------------------------------
  async listEjecutivos(req, res) {
    try {
      const ejecutivos = await DelegacionModel.findEjecutivos();
      return res.status(200).json({ success: true, data: ejecutivos });
    } catch (err) {
      console.error('[DelegacionController.listEjecutivos]', err.message);
      return res.status(500).json({ success: false, message: 'Error retrieving executives list.' });
    }
  },

  // ---------------------------------------------------------------------------
  // listDelegaciones — GET /api/delegaciones
  // Returns all delegations (active + revoked) created by the authenticated Jefe.
  // SysAdmin sees all rows (future enhancement — for now returns same as Jefe).
  // ---------------------------------------------------------------------------
  async listDelegaciones(req, res) {
    try {
      const delegaciones = await DelegacionModel.findByJefe(req.user.id);
      return res.status(200).json({ success: true, data: delegaciones });
    } catch (err) {
      console.error('[DelegacionController.listDelegaciones]', err.message);
      return res.status(500).json({ success: false, message: 'Error retrieving delegations.' });
    }
  },

  // ---------------------------------------------------------------------------
  // createDelegacion — POST /api/delegaciones
  // Body: { id_usuario_delegado, fecha_inicio, fecha_fin }
  //
  // Validates:
  //   • All three fields are present
  //   • fecha_fin is strictly after fecha_inicio
  //   • The delegate is an active Ejecutivo (queried from DB, not trusted from body)
  // ---------------------------------------------------------------------------
  async createDelegacion(req, res) {
    const { id_usuario_delegado, fecha_inicio, fecha_fin } = req.body;

    // ── Input validation ────────────────────────────────────────────────────
    const errors = [];
    if (!id_usuario_delegado) errors.push({ field: 'id_usuario_delegado', message: 'Delegate user ID is required.' });
    if (!fecha_inicio)        errors.push({ field: 'fecha_inicio',        message: 'Start date-time is required.' });
    if (!fecha_fin)           errors.push({ field: 'fecha_fin',           message: 'End date-time is required.' });

    if (errors.length > 0) {
      return res.status(422).json({ success: false, message: 'Validation failed.', errors });
    }

    const start = new Date(fecha_inicio);
    const end   = new Date(fecha_fin);

    if (isNaN(start.getTime())) {
      return res.status(422).json({ success: false, message: 'fecha_inicio is not a valid date-time.' });
    }
    if (isNaN(end.getTime())) {
      return res.status(422).json({ success: false, message: 'fecha_fin is not a valid date-time.' });
    }
    if (end <= start) {
      return res.status(422).json({ success: false, message: 'fecha_fin must be strictly after fecha_inicio.' });
    }

    // ── Create record ────────────────────────────────────────────────────────
    try {
      const insertId = await DelegacionModel.createDelegacion({
        id_usuario_jefe:     req.user.id,
        id_usuario_delegado: parseInt(id_usuario_delegado, 10),
        fecha_inicio:        fecha_inicio,
        fecha_fin:           fecha_fin,
      });

      // Audit trail — non-fatal
      try {
        await logEvent({
          id_usuario:     req.user.id,
          nombre_usuario: req.user.nombre_usuario,
          accion:         AuditActions.CREAR_DELEGACION || 'CREAR_DELEGACION',
          entidad:        'delegaciones_rol',
          id_entidad:     insertId,
          detalle:        { id_usuario_delegado, fecha_inicio, fecha_fin },
          ip_origen:      req.ip || null,
          resultado:      'exito',
        });
      } catch (_) { /* non-fatal */ }

      return res.status(201).json({
        success: true,
        message: 'Temporal delegation created successfully.',
        data:    { id: insertId },
      });
    } catch (err) {
      console.error('[DelegacionController.createDelegacion]', err.message);
      return res.status(500).json({ success: false, message: 'Error creating delegation.' });
    }
  },

  // ---------------------------------------------------------------------------
  // revocarDelegacion — DELETE /api/delegaciones/:id
  // Soft-deactivates a delegation.  Only the Jefe who created it can revoke it
  // (enforced by the model WHERE clause).
  // ---------------------------------------------------------------------------
  async revocarDelegacion(req, res) {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'Invalid delegation ID.' });
    }

    try {
      const revoked = await DelegacionModel.revocarDelegacion(id, req.user.id);

      if (!revoked) {
        return res.status(404).json({
          success: false,
          message: 'Delegation not found or you are not authorised to revoke it.',
        });
      }

      return res.status(200).json({ success: true, message: 'Delegation revoked successfully.' });
    } catch (err) {
      console.error('[DelegacionController.revocarDelegacion]', err.message);
      return res.status(500).json({ success: false, message: 'Error revoking delegation.' });
    }
  },
};

module.exports = DelegacionController;
