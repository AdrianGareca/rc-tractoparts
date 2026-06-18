// =============================================================================
// src/controllers/reportesController.js
// Reportes & Analytics Controller
//
// Endpoints:
//   GET /api/reportes/progreso          — Jefe / SysAdmin only.
//     Returns monthly volume, conversion ratio, and per-executive breakdown.
//
//   GET /api/reportes/advanced          — Jefe / Administracion / Ejecutivo.
//     Returns Top 10 Client table and Executive Leaderboard.
//     Row-Level Security: Ejecutivo callers receive ONLY their own data.
//     Jefe / Administracion / SysAdmin receive company-wide aggregates.
// =============================================================================

'use strict';

const QuotationModel = require('../models/QuotationModel');

// Roles that may view company-wide aggregate data
const MANAGER_ROLES = new Set(['Jefe', 'Administracion', 'SysAdmin']);

const ReportesController = {

  // ---------------------------------------------------------------------------
  // getProgreso — GET /api/reportes/progreso  (Jefe / SysAdmin only)
  // ---------------------------------------------------------------------------
  async getProgreso(req, res) {
    try {
      const progreso = await QuotationModel.getProgreso();

      const now    = new Date();
      const periodo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      return res.status(200).json({
        success: true,
        periodo,
        data:    progreso,
      });
    } catch (error) {
      console.error('[ReportesController.getProgreso] Error:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Error al obtener el reporte de progreso. Intente nuevamente.',
      });
    }
  },

  // ---------------------------------------------------------------------------
  // getAdvancedReports — GET /api/reportes/advanced
  //
  // Row-Level Security:
  //   • Jefe / Administracion / SysAdmin → ejecutivoId = null (company-wide)
  //   • Ejecutivo                        → ejecutivoId = req.user.id (own data only)
  //
  // Response shape:
  // {
  //   "success": true,
  //   "rol": "<caller role>",
  //   "data": {
  //     "top_clientes":  [ { cliente, nit, proformas_emitidas, total_usd, total_bob } ],
  //     "leaderboard":   [ { ejecutivo, total_creadas, total_aprobadas,
  //                          tasa_aprobacion, total_usd, total_bob } ]
  //   }
  // }
  // ---------------------------------------------------------------------------
  async getAdvancedReports(req, res) {
    try {
      const rol = req.user.rol;

      // Enforce row-level isolation: executives only see their own records.
      // MANAGER_ROLES bypass the filter and receive company-wide aggregates.
      const ejecutivoId = MANAGER_ROLES.has(rol) ? null : req.user.id;

      const report = await QuotationModel.getAdvancedReports(ejecutivoId);

      return res.status(200).json({
        success: true,
        rol,
        data:    report,
      });
    } catch (error) {
      console.error('[ReportesController.getAdvancedReports] Error:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Error al obtener el reporte avanzado. Intente nuevamente.',
      });
    }
  },
};

module.exports = ReportesController;
