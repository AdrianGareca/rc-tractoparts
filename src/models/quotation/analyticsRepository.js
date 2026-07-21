// =============================================================================
// src/models/quotation/analyticsRepository.js
// Reporting and business-intelligence aggregates over cotizaciones:
// the dashboard progress panel (getProgreso) and the deep BI report
// (getAdvancedReports), both honouring the Ejecutivo row-level scoping rule.
// =============================================================================

'use strict';

const { pool } = require('../../config/db');

// ---------------------------------------------------------------------------
// getProgreso — Analytics for the Jefe / Administracion / SysAdmin dashboard,
// scoped to a [fechaDesde, fechaHasta] date range (inclusive).
// Returns three data sets in a single DB round-trip:
//   1. total_mes_usd     — Sum of monto_total (USD) within the range
//   2. conversion_ratio  — COUNT(Confirmada) / (COUNT(Confirmada) + COUNT(Rechazada))
//   3. por_ejecutivo     — Per-executive breakdown of all states in the range
//
// @param {string} fechaDesde — 'YYYY-MM-DD' inclusive lower bound
// @param {string} fechaHasta — 'YYYY-MM-DD' inclusive upper bound
// @param {number|null} ejecutivoId — Optional: restrict every dataset to a
//   single executive. null (the default) keeps the company-wide view, so all
//   pre-existing callers are unaffected. The CALLER is responsible for deciding
//   whether the requesting user is allowed to scope by executive — see
//   ReportesController, which only honours it for MANAGER_ROLES.
// ---------------------------------------------------------------------------
async function getProgreso(fechaDesde, fechaHasta, ejecutivoId = null) {
  // fecha_emision is a DATE column, so BETWEEN is an inclusive [desde, hasta]
  // range. The controller always resolves a concrete range (defaulting to the
  // current month) so every query here filters by the same window.
  const rangeParams = [fechaDesde, fechaHasta];

  // Optional per-executive scoping. Built as a clause/param pair so the three
  // queries below stay parameterized (the id is never interpolated into SQL).
  // The two unaliased queries use the bare column; the third aliases the table.
  const hasEjec    = ejecutivoId != null;
  const ejecPlain  = hasEjec ? 'AND id_ejecutivo = ?'   : '';
  const ejecScoped = hasEjec ? 'AND c.id_ejecutivo = ?' : '';
  const ejecParam  = hasEjec ? [parseInt(ejecutivoId, 10)] : [];
  const scopedParams = [...rangeParams, ...ejecParam];

  // Volume within the selected range
  const [volumenRows] = await pool.execute(`
      SELECT
        SUM(CASE WHEN moneda = 'USD' THEN monto_total ELSE 0 END) AS total_mes_usd,
        SUM(CASE WHEN moneda = 'BOB' THEN monto_total ELSE 0 END) AS total_mes_bob,
        COUNT(*)                                                   AS total_cotizaciones
      FROM cotizaciones
      WHERE fecha_emision BETWEEN ? AND ?
        ${ejecPlain}
    `, scopedParams);

  // Conversion ratio within the selected range.
  // Counts both 'Confirmada' (current) and legacy 'Aceptada' rows.
  const [conversionRows] = await pool.execute(`
      SELECT
        SUM(CASE WHEN estado IN ('Confirmada', 'Aceptada') THEN 1 ELSE 0 END) AS total_aceptadas,
        SUM(CASE WHEN estado = 'Rechazada' THEN 1 ELSE 0 END) AS total_rechazadas
      FROM cotizaciones
      WHERE estado IN ('Confirmada', 'Aceptada', 'Rechazada')
        AND fecha_emision BETWEEN ? AND ?
        ${ejecPlain}
    `, scopedParams);

  // Per-executive breakdown within the selected range
  const [porEjecutivoRows] = await pool.execute(`
      SELECT
        u.nombre_completo                                              AS ejecutivo,
        COUNT(*)                                                       AS total,
        SUM(CASE WHEN c.estado IN ('Confirmada', 'Aceptada') THEN 1 ELSE 0 END) AS aceptadas,
        SUM(CASE WHEN c.estado = 'Rechazada' THEN 1 ELSE 0 END)      AS rechazadas,
        SUM(CASE WHEN c.estado = 'Pendiente' THEN 1 ELSE 0 END)      AS pendientes,
        SUM(CASE WHEN c.estado = 'En revision' THEN 1 ELSE 0 END)    AS en_revision,
        SUM(CASE WHEN c.moneda = 'USD' THEN c.monto_total ELSE 0 END) AS volumen_usd,
        SUM(CASE WHEN c.moneda = 'BOB' THEN c.monto_total ELSE 0 END) AS volumen_bob
      FROM cotizaciones c
      INNER JOIN usuarios u ON u.id = c.id_ejecutivo
      WHERE c.fecha_emision BETWEEN ? AND ?
        ${ejecScoped}
      GROUP BY c.id_ejecutivo, u.nombre_completo
      ORDER BY volumen_usd DESC
    `, scopedParams);

  const vol        = volumenRows[0] || {};
  const conv       = conversionRows[0] || {};
  const aceptadas  = parseInt(conv.total_aceptadas  || 0, 10);
  const rechazadas = parseInt(conv.total_rechazadas || 0, 10);
  const total      = aceptadas + rechazadas;

  return {
    volumen: {
      total_mes_usd:      parseFloat(vol.total_mes_usd  || 0).toFixed(2),
      total_mes_bob:      parseFloat(vol.total_mes_bob  || 0).toFixed(2),
      total_cotizaciones: parseInt(vol.total_cotizaciones || 0, 10),
    },
    conversion: {
      total_aceptadas:  aceptadas,
      total_rechazadas: rechazadas,
      ratio_pct:        total > 0 ? ((aceptadas / total) * 100).toFixed(1) : '0.0',
    },
    por_ejecutivo: porEjecutivoRows,
  };
}

// =============================================================================
// getAdvancedReports — Deep business intelligence metrics (HU-BI01)
//
// Returns two analytics datasets shaped for the frontend BI dashboard:
//   • top_clientes     — Top 10 clients ranked by accepted/sent revenue
//   • leaderboard      — Per-executive leaderboard (all-time)
//
// Row-Level Security:
//   When ejecutivoId is supplied (non-null), ALL queries are filtered to
//   that specific ejecutivo only — no aggregate company-wide data leaks to
//   executives. Managers (null ejecutivoId) receive the full company view.
//
// @param {number|null} ejecutivoId — Pass req.user.id for Ejecutivo role,
//                                    null for Jefe / Administracion / SysAdmin.
// @param {string|null} fechaDesde  — Optional 'YYYY-MM-DD' inclusive lower bound.
// @param {string|null} fechaHasta  — Optional 'YYYY-MM-DD' inclusive upper bound.
//                                    The range applies only when BOTH are set.
// =============================================================================
async function getAdvancedReports(ejecutivoId = null, fechaDesde = null, fechaHasta = null) {
  const isEjecutivo = ejecutivoId != null;
  const hasRange    = fechaDesde != null && fechaHasta != null;

  // Build the shared dynamic filters (executive row-level isolation + an
  // optional [fechaDesde, fechaHasta] range) as reusable clause/param pairs.
  // The date range is only applied when BOTH bounds are present, so the
  // executive personal dashboard (no dates) keeps its all-time behaviour.
  const buildFilters = () => {
    const clauses = [];
    const params  = [];
    if (isEjecutivo) { clauses.push('c.id_ejecutivo = ?');            params.push(ejecutivoId); }
    if (hasRange)    { clauses.push('c.fecha_emision BETWEEN ? AND ?'); params.push(fechaDesde, fechaHasta); }
    return { clauses, params };
  };

  // ── Top 10 Clients ──────────────────────────────────────────────────────
  // For Jefe/Admin: company-wide, all executives.
  // For Ejecutivo: restricted to their own accepted/sent quotations.
  const tc      = buildFilters();
  const tcExtra = tc.clauses.length ? ' AND ' + tc.clauses.join(' AND ') : '';
  const topClientesSql = `
        SELECT
          cl.razon_social                               AS cliente,
          cl.nit                                        AS nit,
          COUNT(c.id)                                   AS proformas_emitidas,
          SUM(CASE WHEN c.moneda = 'USD' THEN c.monto_total ELSE 0 END) AS total_usd,
          SUM(CASE WHEN c.moneda = 'BOB' THEN c.monto_total ELSE 0 END) AS total_bob
        FROM cotizaciones c
        INNER JOIN clientes cl ON cl.id = c.id_cliente
        WHERE c.estado IN ('Confirmada', 'Aceptada', 'Enviada al cliente')${tcExtra}
        GROUP BY c.id_cliente, cl.razon_social, cl.nit
        ORDER BY total_usd DESC
        LIMIT 10`;
  const [topClientesRows] = await pool.execute(topClientesSql, tc.params);

  // ── Executive Leaderboard ───────────────────────────────────────────────
  // Aggregates over the range: total created, total approved by Jefe, revenue.
  // When the caller is an Ejecutivo, the leaderboard is scoped to themselves
  // (returns a single-row personal summary rather than a company leaderboard).
  const lb      = buildFilters();
  const lbWhere = lb.clauses.length ? 'WHERE ' + lb.clauses.join(' AND ') : '';
  const leaderboardSql = `
        SELECT
          u.nombre_completo                                                AS ejecutivo,
          COUNT(c.id)                                                      AS total_creadas,
          SUM(CASE WHEN c.estado IN ('Aprobada internamente',
                                     'Enviada al cliente',
                                     'Confirmada',
                                     'Aceptada')         THEN 1 ELSE 0 END) AS total_aprobadas,
          SUM(CASE WHEN c.moneda = 'USD' THEN c.monto_total ELSE 0 END)   AS total_usd,
          SUM(CASE WHEN c.moneda = 'BOB' THEN c.monto_total ELSE 0 END)   AS total_bob
        FROM cotizaciones c
        INNER JOIN usuarios u ON u.id = c.id_ejecutivo
        ${lbWhere}
        GROUP BY c.id_ejecutivo, u.nombre_completo
        ORDER BY total_usd DESC`;
  const [leaderboardRows] = await pool.execute(leaderboardSql, lb.params);

  // Post-process leaderboard: compute approval rate safely (avoid / 0)
  const leaderboard = leaderboardRows.map((row) => {
    const creadas    = parseInt(row.total_creadas   || 0, 10);
    const aprobadas  = parseInt(row.total_aprobadas || 0, 10);
    const tasa       = creadas > 0 ? ((aprobadas / creadas) * 100).toFixed(1) : '0.0';
    return {
      ejecutivo:      row.ejecutivo,
      total_creadas:  creadas,
      total_aprobadas: aprobadas,
      tasa_aprobacion: tasa,
      total_usd:      parseFloat(row.total_usd || 0).toFixed(2),
      total_bob:      parseFloat(row.total_bob || 0).toFixed(2),
    };
  });

  // ── Clientes por Origen ─────────────────────────────────────────────────
  // Manager-only breakdown (never computed for the Ejecutivo's personal
  // report — "solo sus cotizaciones y nada más" per business rule): how many
  // active clients fall into each origen_cliente bucket, and the revenue
  // (within the selected date range, if any) attributed to each bucket.
  // total_clientes counts ALL active clients regardless of date range (it's
  // a client-attribute snapshot, not a period metric); total_usd/total_bob
  // stay period-scoped like the rest of the report.
  let clientesPorOrigen = [];
  if (!isEjecutivo) {
    const origenDateClause = hasRange ? 'AND c.fecha_emision BETWEEN ? AND ?' : '';
    const origenParams     = hasRange ? [fechaDesde, fechaHasta] : [];
    const origenSql = `
          SELECT
            COALESCE(oc.nombre, 'Sin clasificar')                         AS origen,
            COUNT(DISTINCT cl.id)                                         AS total_clientes,
            SUM(CASE WHEN c.moneda = 'USD' THEN c.monto_total ELSE 0 END) AS total_usd,
            SUM(CASE WHEN c.moneda = 'BOB' THEN c.monto_total ELSE 0 END) AS total_bob
          FROM clientes cl
          LEFT JOIN origenes_cliente oc ON oc.id = cl.id_origen_cliente
          LEFT JOIN cotizaciones c
                 ON c.id_cliente = cl.id
                AND c.estado IN ('Confirmada', 'Aceptada', 'Enviada al cliente')
                ${origenDateClause}
          WHERE cl.activo = 1
          GROUP BY oc.id, origen
          ORDER BY total_clientes DESC`;
    const [origenRows] = await pool.execute(origenSql, origenParams);
    clientesPorOrigen = origenRows.map((r) => ({
      origen:         r.origen,
      total_clientes: parseInt(r.total_clientes || 0, 10),
      total_usd:      parseFloat(r.total_usd || 0).toFixed(2),
      total_bob:      parseFloat(r.total_bob || 0).toFixed(2),
    }));
  }

  return {
    top_clientes: topClientesRows.map((r) => ({
      cliente:           r.cliente,
      nit:               r.nit ?? '—',
      proformas_emitidas: parseInt(r.proformas_emitidas || 0, 10),
      total_usd:         parseFloat(r.total_usd || 0).toFixed(2),
      total_bob:         parseFloat(r.total_bob || 0).toFixed(2),
    })),
    leaderboard,
    clientes_por_origen: clientesPorOrigen,
  };
}

module.exports = {
  getProgreso,
  getAdvancedReports,
};
