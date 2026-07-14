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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * isValidDate — true only for a real calendar date in 'YYYY-MM-DD' form.
 * The regex alone accepts impossible values like 2026-13-99; this also
 * round-trips the parsed date so those never reach the SQL layer.
 */
function isValidDate(s) {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/**
 * resolveDateRange — parses fecha_desde / fecha_hasta from a query object and
 * returns { desde, hasta } (both 'YYYY-MM-DD') or an { error } message.
 *
 * @param {object}  query          — req.query
 * @param {boolean} defaultToMonth — when true, a missing bound defaults to the
 *   current month (used by /progreso, which always needs a concrete range);
 *   when false, missing bounds stay null (used by /advanced, where "no range"
 *   means all-time).
 */
function resolveDateRange(query, defaultToMonth) {
  let desde = query.fecha_desde;
  let hasta = query.fecha_hasta;

  if (desde && !isValidDate(desde)) return { error: 'fecha_desde debe ser una fecha válida (YYYY-MM-DD).' };
  if (hasta && !isValidDate(hasta)) return { error: 'fecha_hasta debe ser una fecha válida (YYYY-MM-DD).' };

  if (defaultToMonth) {
    const now   = new Date();
    const first = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    // Day 0 of next month = last calendar day of the current month.
    const lastD = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const last  = `${lastD.getFullYear()}-${String(lastD.getMonth() + 1).padStart(2, '0')}-${String(lastD.getDate()).padStart(2, '0')}`;
    desde = desde || first;
    hasta = hasta || last;
  }

  if (desde && hasta && desde > hasta) {
    return { error: 'fecha_desde no puede ser mayor que fecha_hasta.' };
  }

  return { desde: desde || null, hasta: hasta || null };
}

const ReportesController = {

  // ---------------------------------------------------------------------------
  // getProgreso — GET /api/reportes/progreso  (Jefe / Administracion / SysAdmin)
  //   Optional query params: fecha_desde, fecha_hasta (YYYY-MM-DD).
  //   Defaults to the current month when omitted.
  // ---------------------------------------------------------------------------
  async getProgreso(req, res) {
    try {
      const range = resolveDateRange(req.query, /* defaultToMonth */ true);
      if (range.error) {
        return res.status(422).json({ success: false, message: range.error });
      }

      const progreso = await QuotationModel.getProgreso(range.desde, range.hasta);

      // Human-readable label: a single day collapses to just that date.
      const periodo = range.desde === range.hasta
        ? range.desde
        : `${range.desde} a ${range.hasta}`;

      return res.status(200).json({
        success: true,
        periodo,
        rango:   { desde: range.desde, hasta: range.hasta },
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

      // Optional date range. Unlike /progreso, a missing bound means "all-time"
      // (defaultToMonth=false) so the executive personal dashboard is unchanged.
      const range = resolveDateRange(req.query, /* defaultToMonth */ false);
      if (range.error) {
        return res.status(422).json({ success: false, message: range.error });
      }

      const report = await QuotationModel.getAdvancedReports(ejecutivoId, range.desde, range.hasta);

      return res.status(200).json({
        success: true,
        rol,
        rango:   { desde: range.desde, hasta: range.hasta },
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
