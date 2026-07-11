// =============================================================================
// src/controllers/auditoriaController.js
// Audit Log Controller — GET /api/auditoria (Jefe / Administracion / SysAdmin)
//
// Read-side of the bitacora_auditoria system (see src/utils/auditLog.js for
// the write side, wired into every controller across the app).
// =============================================================================

'use strict';

const AuditLogModel = require('../models/AuditLogModel');
const { AuditActions } = require('../utils/auditLog');

const VALID_ACCIONES  = Object.values(AuditActions);
const VALID_RESULTADOS = ['exito', 'fallo'];
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const AuditoriaController = {

  // ---------------------------------------------------------------------------
  // getAuditLogs — GET /api/auditoria  (Jefe / Administracion / SysAdmin)
  // Full filter set + pagination. See AuditLogModel._buildWhereClause for the
  // complete list of accepted query parameters.
  // ---------------------------------------------------------------------------
  async getAuditLogs(req, res) {
    try {
      const filters = {};

      if (req.query.usuario) filters.usuario = String(req.query.usuario);

      if (req.query.accion) {
        if (!VALID_ACCIONES.includes(req.query.accion)) {
          return res.status(422).json({
            success: false,
            message: `Invalid accion '${req.query.accion}'. Valid values: [${VALID_ACCIONES.join(', ')}]`,
          });
        }
        filters.accion = req.query.accion;
      }

      if (req.query.entidad) filters.entidad = String(req.query.entidad);

      if (req.query.resultado) {
        if (!VALID_RESULTADOS.includes(req.query.resultado)) {
          return res.status(422).json({
            success: false,
            message: `resultado must be one of: [${VALID_RESULTADOS.join(', ')}]`,
          });
        }
        filters.resultado = req.query.resultado;
      }

      if (req.query.fecha_desde) {
        if (!dateRegex.test(req.query.fecha_desde)) {
          return res.status(422).json({ success: false, message: 'fecha_desde must be in YYYY-MM-DD format.' });
        }
        filters.fecha_desde = req.query.fecha_desde;
      }

      if (req.query.fecha_hasta) {
        if (!dateRegex.test(req.query.fecha_hasta)) {
          return res.status(422).json({ success: false, message: 'fecha_hasta must be in YYYY-MM-DD format.' });
        }
        filters.fecha_hasta = req.query.fecha_hasta;
      }

      if (filters.fecha_desde && filters.fecha_hasta && filters.fecha_desde > filters.fecha_hasta) {
        return res.status(422).json({ success: false, message: 'fecha_desde cannot be later than fecha_hasta.' });
      }

      const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));

      const [rows, totalRecords] = await Promise.all([
        AuditLogModel.findAll(filters, { page, limit }),
        AuditLogModel.countAll(filters),
      ]);

      const totalPages = Math.ceil(totalRecords / limit) || 1;

      return res.status(200).json({
        success: true,
        data:    rows,
        pagination: {
          page, limit, totalRecords, totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      });
    } catch (error) {
      console.error('[AuditoriaController.getAuditLogs] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to retrieve audit logs.' });
    }
  },

  // ---------------------------------------------------------------------------
  // getFilterOptions — GET /api/auditoria/opciones  (Jefe / Administracion / SysAdmin)
  // Lightweight endpoint the frontend calls once to populate the "Acción" and
  // "Tabla" filter dropdowns. Acciones come from the static AuditActions
  // allowlist (matches what getAuditLogs will accept); entidades are read live
  // from the data so the list can never drift from what's actually stored.
  // ---------------------------------------------------------------------------
  async getFilterOptions(req, res) {
    try {
      const entidades = await AuditLogModel.distinctEntidades();
      return res.status(200).json({
        success: true,
        data: {
          acciones:  VALID_ACCIONES,
          entidades,
          resultados: VALID_RESULTADOS,
        },
      });
    } catch (error) {
      console.error('[AuditoriaController.getFilterOptions] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to retrieve filter options.' });
    }
  },
};

module.exports = AuditoriaController;
