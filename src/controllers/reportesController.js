// =============================================================================
// src/controllers/reportesController.js
// Reportes & Analytics Controller
//
// Endpoints:
//   GET /api/reportes/progreso  — Restricted to Jefe / SysAdmin.
//     Returns three aggregated datasets:
//       • Monthly quoting volume (current month, USD + BOB)
//       • Conversion ratio: Aceptada vs Rechazada (all-time)
//       • Per-executive performance breakdown (current month)
// =============================================================================

'use strict';

const QuotationModel = require('../models/QuotationModel');

const ReportesController = {

  // ---------------------------------------------------------------------------
  // getProgreso — GET /api/reportes/progreso  (Jefe / SysAdmin only)
  //
  // Executes three optimised SQL aggregation queries (COUNT, SUM, GROUP BY)
  // via QuotationModel.getProgreso() and returns the combined analytics payload.
  //
  // Response shape:
  // {
  //   "success": true,
  //   "periodo": "YYYY-MM",
  //   "data": {
  //     "volumen":       { total_mes_usd, total_mes_bob, total_cotizaciones },
  //     "conversion":    { total_aceptadas, total_rechazadas, ratio_pct },
  //     "por_ejecutivo": [ { ejecutivo, total, aceptadas, rechazadas, pendientes, en_revision, volumen_usd } ]
  //   }
  // }
  // ---------------------------------------------------------------------------
  async getProgreso(req, res) {
    try {
      const progreso = await QuotationModel.getProgreso();

      // Build a human-readable period string (e.g. "2026-06") for the response
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
};

module.exports = ReportesController;
