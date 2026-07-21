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

const QuotationModel       = require('../models/QuotationModel');
const reportePdfService    = require('../services/reportePdfService');
const { logEvent, AuditActions } = require('../utils/auditLog');

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

/**
 * resolveEjecutivoScope — decides which executive the report is scoped to,
 * and is the SINGLE place where that authorization decision is made.
 *
 * • Manager roles (Jefe / Administracion / SysAdmin) may pass ?id_ejecutivo=N
 *   to drill into one executive; omitting it keeps the company-wide view.
 * • Every other role is ALWAYS pinned to their own id. A supplied
 *   id_ejecutivo is deliberately ignored rather than rejected, so an Ejecutivo
 *   can never read another executive's figures by crafting the query string.
 *
 * @returns {{ ejecutivoId: number|null } | { error: string }}
 */
function resolveEjecutivoScope(req) {
  if (!MANAGER_ROLES.has(req.user.rol)) {
    return { ejecutivoId: req.user.id };
  }

  const raw = req.query.id_ejecutivo;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { ejecutivoId: null };   // company-wide
  }

  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed < 1 || String(parsed) !== String(raw).trim()) {
    return { error: 'id_ejecutivo debe ser un entero positivo.' };
  }
  return { ejecutivoId: parsed };
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

      const scope = resolveEjecutivoScope(req);
      if (scope.error) {
        return res.status(422).json({ success: false, message: scope.error });
      }

      const progreso = await QuotationModel.getProgreso(range.desde, range.hasta, scope.ejecutivoId);

      // Human-readable label: a single day collapses to just that date.
      const periodo = range.desde === range.hasta
        ? range.desde
        : `${range.desde} a ${range.hasta}`;

      return res.status(200).json({
        success: true,
        periodo,
        rango:        { desde: range.desde, hasta: range.hasta },
        id_ejecutivo: scope.ejecutivoId,
        data:         progreso,
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
      // MANAGER_ROLES receive company-wide aggregates, or a single executive's
      // figures when they explicitly drill in via ?id_ejecutivo=N.
      const scope = resolveEjecutivoScope(req);
      if (scope.error) {
        return res.status(422).json({ success: false, message: scope.error });
      }
      const ejecutivoId = scope.ejecutivoId;

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
        rango:        { desde: range.desde, hasta: range.hasta },
        id_ejecutivo: ejecutivoId,
        data:         report,
      });
    } catch (error) {
      console.error('[ReportesController.getAdvancedReports] Error:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Error al obtener el reporte avanzado. Intente nuevamente.',
      });
    }
  },

  // ---------------------------------------------------------------------------
  // getReportePdf — GET /api/reportes/pdf
  //   Jefe / Administracion / SysAdmin → full company report (same RLS split
  //   as /advanced, plus the /progreso stats grid, plus clientes_por_origen).
  //   Ejecutivo → individual report scoped to their own quotations only
  //   ("solo sus cotizaciones y nada más") — no company stats grid, no other
  //   executives' data, no clientes_por_origen.
  //
  //   Optional query params: fecha_desde, fecha_hasta (YYYY-MM-DD).
  //   Managers default to the current month (mirrors /progreso); Ejecutivo
  //   defaults to all-time (mirrors /advanced) when omitted.
  // ---------------------------------------------------------------------------
  async getReportePdf(req, res) {
    try {
      const rol        = req.user.rol;
      const isManager   = MANAGER_ROLES.has(rol);
      const ejecutivoId = isManager ? null : req.user.id;

      const range = resolveDateRange(req.query, /* defaultToMonth */ isManager);
      if (range.error) {
        return res.status(422).json({ success: false, message: range.error });
      }

      const advanced = await QuotationModel.getAdvancedReports(ejecutivoId, range.desde, range.hasta);
      const progreso = isManager ? await QuotationModel.getProgreso(range.desde, range.hasta) : null;

      const periodo = range.desde && range.hasta
        ? (range.desde === range.hasta ? range.desde : `${range.desde} a ${range.hasta}`)
        : 'Histórico (todas las fechas)';

      const pdfBuffer = await reportePdfService.generateReportePdf({
        mode:           isManager ? 'company' : 'individual',
        periodo,
        rol,
        nombreUsuario:  req.user.nombre_usuario,
        progreso,
        topClientes:    advanced.top_clientes,
        leaderboard:    advanced.leaderboard,
        clientesPorOrigen: advanced.clientes_por_origen,
      });

      // Audit logging failures must never mask a PDF that was already
      // generated successfully — same non-fatal contract as
      // quotationStateController.updateStatus.
      try {
        await logEvent({
          id_usuario:     req.user.id,
          nombre_usuario: req.user.nombre_usuario,
          accion:         AuditActions.GENERAR_REPORTE_PDF,
          entidad:        'reportes',
          id_entidad:     null,
          detalle:        { periodo, modo: isManager ? 'company' : 'individual' },
          ip_origen:      req.ip || req.socket?.remoteAddress || null,
          resultado:      'exito',
        });
      } catch (auditErr) {
        console.warn('[ReportesController.getReportePdf] Audit logging failed (non-fatal):', auditErr.message);
      }

      // Strip accents (NFD-decompose) before the safe-char filter so accented
      // periods don't degrade into runs of underscores — mirrors
      // buildDownloadBaseName's sanitize() in timelineView.js.
      const safePeriodo = periodo
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^\w-]/g, '_');
      const filename = `Reporte_${isManager ? 'General' : 'Individual'}_${safePeriodo}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.status(200).send(pdfBuffer);

    } catch (error) {
      console.error('[ReportesController.getReportePdf] Error:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Error al generar el reporte en PDF. Intente nuevamente.',
      });
    }
  },
};

module.exports = ReportesController;
