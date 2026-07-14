// =============================================================================
// public/js/views/dashboard/modules/reportesView.js
// Reportes Dashboard UI — Performance stats grid + BI analytics tables.
//
// Extracted from ManagerStrategy._renderReportes in dashboardView.js.
//
// Exports:
//   renderReportes(panel)       — Jefe / SysAdmin: stats grid + full BI tables
//   renderAdvancedReports(panel)— All roles: Top Clients table + Leaderboard
//                                 (row-level security enforced by the backend)
// =============================================================================

import api           from '../../../services/apiClient.js';
import { escHtml }   from '../helpers.js';

// ---------------------------------------------------------------------------
// Date helpers for the reports range filter.
// ymd() formats a Date as local 'YYYY-MM-DD' (NOT toISOString, which is UTC and
// would shift the day for negative timezones like Bolivia's UTC-4).
// ---------------------------------------------------------------------------
function ymd(d) {
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Maps a quick-range preset id to a [desde, hasta] pair of 'YYYY-MM-DD' strings. */
function presetRange(preset) {
  const now = new Date();
  switch (preset) {
    case 'hoy':
      return [ymd(now), ymd(now)];
    case 'ayer': {
      const y = new Date(now); y.setDate(now.getDate() - 1);
      return [ymd(y), ymd(y)];
    }
    case '7d': {
      const s = new Date(now); s.setDate(now.getDate() - 6);
      return [ymd(s), ymd(now)];
    }
    case '30d': {
      const s = new Date(now); s.setDate(now.getDate() - 29);
      return [ymd(s), ymd(now)];
    }
    case 'mespasado': {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last  = new Date(now.getFullYear(), now.getMonth(), 0); // day 0 = last day of prev month
      return [ymd(first), ymd(last)];
    }
    case 'anio':
      return [ymd(new Date(now.getFullYear(), 0, 1)), ymd(now)];
    case 'mes':
    default:
      return [ymd(new Date(now.getFullYear(), now.getMonth(), 1)), ymd(now)];
  }
}

// ---------------------------------------------------------------------------
// _buildTopClientesTable
// Renders the "Top 10 Clientes de Mayor Impacto" HTML table.
// Guards against null/empty data with a clean empty-state row.
//
// @param {Array}  rows  — top_clientes array from /api/reportes/advanced
// @returns {string}     — HTML string for the <table> block
// ---------------------------------------------------------------------------
function _buildTopClientesTable(rows) {
  const safeRows = rows ?? [];
  const tbody = safeRows.length === 0
    ? `<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--text-muted);">
         Sin registros de clientes para este período.
       </td></tr>`
    : safeRows.map((c, i) => `
        <tr>
          <td class="text-right fw-600" style="color:var(--text-secondary);width:2.5rem;">${i + 1}</td>
          <td class="fw-600">${escHtml(c.cliente)}</td>
          <td class="text-muted text-sm">${escHtml(c.nit)}</td>
          <td class="text-right">${Number(c.proformas_emitidas ?? 0)}</td>
          <td class="text-right fw-600">
            ${Number(c.total_usd ?? 0) > 0
              ? `<span style="color:#10B981;">USD ${Number(c.total_usd).toFixed(2)}</span>`
              : ''}
            ${Number(c.total_bob ?? 0) > 0
              ? `<span style="color:#8B5CF6;margin-left:.25rem;">BOB ${Number(c.total_bob).toFixed(2)}</span>`
              : ''}
            ${Number(c.total_usd ?? 0) === 0 && Number(c.total_bob ?? 0) === 0 ? '—' : ''}
          </td>
        </tr>`).join('');

  return `
    <div class="card" style="margin-bottom:1rem;">
      <div class="card-header">
        <h3>📊 Top 10 Clientes de Mayor Impacto</h3>
        <span class="text-muted text-sm">Basado en cotizaciones Confirmadas / Enviadas al cliente</span>
      </div>
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th class="text-right">#</th>
              <th>Cliente / Empresa</th>
              <th>NIT</th>
              <th class="text-right">Proformas Emitidas</th>
              <th class="text-right">Total Facturado</th>
            </tr>
          </thead>
          <tbody>${tbody}</tbody>
        </table>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// _buildLeaderboardTable
// Renders the "Rendimiento del Equipo de Ventas" (managers) or
// "Mi Rendimiento Personal" (Ejecutivo) HTML table.
//
// @param {Array}  rows      — leaderboard array from /api/reportes/advanced
// @param {string} rol       — caller's role from the API response
// @returns {string}         — HTML string for the <table> block
// ---------------------------------------------------------------------------
function _buildLeaderboardTable(rows, rol) {
  const isEjecutivo = rol === 'Ejecutivo';
  const title       = isEjecutivo
    ? '📈 Mi Rendimiento Personal'
    : '👥 Rendimiento del Equipo de Ventas';
  const subtitle    = isEjecutivo
    ? 'Historial acumulado de tu actividad comercial'
    : 'Leaderboard histórico de ejecutivos — ordenado por volumen generado';

  const safeRows = rows ?? [];
  const tbody = safeRows.length === 0
    ? `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-muted);">
         Sin registros de ejecutivos para este período.
       </td></tr>`
    : safeRows.map((e) => {
        const tasa   = parseFloat(e.tasa_aprobacion ?? 0);
        const color  = tasa >= 60 ? '#10B981' : tasa >= 40 ? '#F59E0B' : '#EF4444';
        return `
          <tr>
            <td class="fw-600">${escHtml(e.ejecutivo)}</td>
            <td class="text-right">${Number(e.total_creadas ?? 0)}</td>
            <td class="text-right" style="color:#10B981;">${Number(e.total_aprobadas ?? 0)}</td>
            <td class="text-right fw-600" style="color:${color};">${tasa.toFixed(1)}%</td>
            <td class="text-right fw-600">
              ${Number(e.total_usd ?? 0) > 0
                ? `<span style="color:#3B82F6;">USD ${Number(e.total_usd).toFixed(2)}</span>`
                : ''}
              ${Number(e.total_bob ?? 0) > 0
                ? `<span style="color:#8B5CF6;margin-left:.25rem;">BOB ${Number(e.total_bob).toFixed(2)}</span>`
                : ''}
              ${Number(e.total_usd ?? 0) === 0 && Number(e.total_bob ?? 0) === 0 ? '—' : ''}
            </td>
          </tr>`;
      }).join('');

  return `
    <div class="card">
      <div class="card-header">
        <h3>${title}</h3>
        <span class="text-muted text-sm">${subtitle}</span>
      </div>
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Ejecutivo</th>
              <th class="text-right">Proformas Creadas</th>
              <th class="text-right">Aprobadas por Jefe</th>
              <th class="text-right">Tasa de Aprobación</th>
              <th class="text-right">Total Generado</th>
            </tr>
          </thead>
          <tbody>${tbody}</tbody>
        </table>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// renderAdvancedReports
// Fetches /api/reportes/advanced (accessible to all authenticated roles) and
// renders the Top Clients table + the Leaderboard into the given panel.
// The backend enforces row-level security: Ejecutivo callers receive only
// their own records; Jefe / Administracion / SysAdmin receive company-wide data.
//
// @param {HTMLElement} panel — Container element
// ---------------------------------------------------------------------------
export async function renderAdvancedReports(panel) {
  panel.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';
  try {
    const res  = await api.get('/api/reportes/advanced');
    const rol  = res.rol ?? 'Ejecutivo';
    const {
      top_clientes = [],
      leaderboard  = [],
    } = res.data ?? {};

    panel.innerHTML =
      _buildTopClientesTable(top_clientes) +
      _buildLeaderboardTable(leaderboard, rol);
  } catch (err) {
    panel.innerHTML = `<div class="empty-state"><p>Error cargando métricas: ${escHtml(err.message)}</p></div>`;
  }
}

// ---------------------------------------------------------------------------
// renderReportes
// Full analytics dashboard for Jefe / SysAdmin.
// Fetches both /api/reportes/progreso AND /api/reportes/advanced and renders:
//   1. Monthly stats grid (volumen, tasa de éxito, aceptadas, rechazadas)
//   2. Per-executive monthly breakdown table (existing)
//   3. Top 10 Clients BI table (new)
//   4. Executive Leaderboard BI table (new)
//
// @param {HTMLElement} panel — Container element (manager-panel)
// ---------------------------------------------------------------------------
export async function renderReportes(panel) {
  // Default range: from the 1st of the current month up to today.
  const [defDesde, defHasta] = presetRange('mes');

  // Render the persistent filter bar + a data container that re-renders on demand.
  panel.innerHTML = `
    <div class="card" style="margin-bottom:1rem;">
      <div class="card-header">
        <h3>📅 Período del Reporte</h3>
        <span class="text-muted text-sm">Filtra las métricas por un día o un rango de fechas</span>
      </div>
      <div class="filter-bar" style="padding:1rem;">
        <div class="form-group">
          <label class="form-label">Rango rápido</label>
          <select class="form-control" id="rep-preset" style="min-width:150px;">
            <option value="hoy">Hoy</option>
            <option value="ayer">Ayer</option>
            <option value="7d">Últimos 7 días</option>
            <option value="30d">Últimos 30 días</option>
            <option value="mes" selected>Este mes</option>
            <option value="mespasado">Mes pasado</option>
            <option value="anio">Este año</option>
            <option value="custom">Personalizado…</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Desde</label>
          <input class="form-control" type="date" id="rep-desde" value="${defDesde}" style="min-width:150px;" />
        </div>
        <div class="form-group">
          <label class="form-label">Hasta</label>
          <input class="form-control" type="date" id="rep-hasta" value="${defHasta}" style="min-width:150px;" />
        </div>
        <button class="btn btn-primary btn-sm" id="rep-apply" style="align-self:flex-end;">Aplicar</button>
      </div>
    </div>
    <div id="reportes-data"><div class="page-loading"><div class="spinner"></div></div></div>
  `;

  const presetEl = panel.querySelector('#rep-preset');
  const desdeEl  = panel.querySelector('#rep-desde');
  const hastaEl  = panel.querySelector('#rep-hasta');

  // Choosing a quick-range preset fills the two date inputs.
  presetEl.addEventListener('change', () => {
    if (presetEl.value === 'custom') return;
    const [d, h] = presetRange(presetEl.value);
    desdeEl.value = d;
    hastaEl.value = h;
  });

  // Manually editing either date switches the preset selector to "Personalizado".
  [desdeEl, hastaEl].forEach((el) =>
    el.addEventListener('input', () => { presetEl.value = 'custom'; })
  );

  panel.querySelector('#rep-apply').addEventListener('click', () => {
    loadReportesData(panel, desdeEl.value, hastaEl.value);
  });

  await loadReportesData(panel, defDesde, defHasta);
}

// ---------------------------------------------------------------------------
// loadReportesData — fetches both report endpoints for the given date range and
// renders the data section (leaving the filter bar untouched).
// ---------------------------------------------------------------------------
async function loadReportesData(panel, desde, hasta) {
  const dataEl = panel.querySelector('#reportes-data');
  if (!dataEl) return;

  if (!desde || !hasta) {
    dataEl.innerHTML = `<div class="empty-state"><p>Selecciona una fecha de inicio y una de fin.</p></div>`;
    return;
  }
  if (desde > hasta) {
    dataEl.innerHTML = `<div class="empty-state"><p>La fecha "Desde" no puede ser mayor que "Hasta".</p></div>`;
    return;
  }

  dataEl.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';
  try {
    const qs = `?fecha_desde=${encodeURIComponent(desde)}&fecha_hasta=${encodeURIComponent(hasta)}`;
    // Fire both requests in parallel — independent data sets
    const [progresoRes, advancedRes] = await Promise.all([
      api.get('/api/reportes/progreso' + qs),
      api.get('/api/reportes/advanced' + qs),
    ]);
    dataEl.innerHTML = buildReportesDataHTML(progresoRes, advancedRes);
  } catch (err) {
    dataEl.innerHTML = `<div class="empty-state"><p>Error cargando reportes: ${escHtml(err.message)}</p></div>`;
  }
}

// ---------------------------------------------------------------------------
// buildReportesDataHTML — builds the full analytics HTML (stats grid + monthly
// executive breakdown + BI tables) from the two API responses.
// ---------------------------------------------------------------------------
function buildReportesDataHTML(progresoRes, advancedRes) {
    // ── Progreso data ─────────────────────────────────────────────────────
    const {
      volumen       = {},
      conversion    = {},
      por_ejecutivo = [],
    } = progresoRes.data ?? {};
    const periodo = progresoRes.periodo ?? '—';

    const volUSD     = Number(volumen.total_mes_usd   ?? 0).toFixed(2);
    const volBOB     = Number(volumen.total_mes_bob   ?? 0).toFixed(2);
    const totalCot   = volumen.total_cotizaciones ?? 0;
    const ratioPct   = conversion.ratio_pct       ?? '0.0';
    const aceptadas  = conversion.total_aceptadas  ?? 0;
    const rechazadas = conversion.total_rechazadas ?? 0;
    const ratioColor = parseFloat(ratioPct) >= 50 ? '#10B981' : '#EF4444';

    // ── Advanced BI data ──────────────────────────────────────────────────
    const rol = advancedRes.rol ?? 'Jefe';
    const {
      top_clientes = [],
      leaderboard  = [],
    } = advancedRes.data ?? {};

    return `
      <!-- ── Stats grid ── -->
      <div class="card" style="margin-bottom:1rem;">
        <div class="card-header">
          <h3>📊 Dashboard de Rendimiento — ${escHtml(periodo)}</h3>
        </div>
        <div class="stats-grid" style="padding:1rem 1rem 0;">
          <div class="stat-card" style="--stat-accent:#3B82F6;">
            <div class="stat-card-value">${volUSD}</div>
            <div class="stat-card-label">Volumen USD (período)</div>
          </div>
          <div class="stat-card" style="--stat-accent:#8B5CF6;">
            <div class="stat-card-value">${volBOB}</div>
            <div class="stat-card-label">Volumen BOB (período)</div>
          </div>
          <div class="stat-card" style="--stat-accent:#F59E0B;">
            <div class="stat-card-value">${totalCot}</div>
            <div class="stat-card-label">Cotizaciones (período)</div>
          </div>
          <div class="stat-card" style="--stat-accent:${ratioColor};">
            <div class="stat-card-value">${ratioPct}%</div>
            <div class="stat-card-label">Tasa de Éxito (período)</div>
          </div>
          <div class="stat-card" style="--stat-accent:#10B981;">
            <div class="stat-card-value">${aceptadas}</div>
            <div class="stat-card-label">Confirmadas (período)</div>
          </div>
          <div class="stat-card" style="--stat-accent:#EF4444;">
            <div class="stat-card-value">${rechazadas}</div>
            <div class="stat-card-label">Rechazadas (período)</div>
          </div>
        </div>
      </div>

      <!-- ── Per-executive breakdown for the selected range ── -->
      <div class="card" style="margin-bottom:1rem;">
        <div class="card-header">
          <h3>Rendimiento por Ejecutivo — ${escHtml(periodo)}</h3>
        </div>
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>Ejecutivo</th>
                <th class="text-right">Total</th>
                <th class="text-right">Confirmadas</th>
                <th class="text-right">Rechazadas</th>
                <th class="text-right">Pendientes</th>
                <th class="text-right">En Revisión</th>
                <th class="text-right">Volumen USD</th>
              </tr>
            </thead>
            <tbody>
              ${por_ejecutivo.length === 0
                ? `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text-muted);">Sin datos para el período seleccionado.</td></tr>`
                : por_ejecutivo.map(e => `
                    <tr>
                      <td class="fw-600">${escHtml(e.ejecutivo)}</td>
                      <td class="text-right">${e.total}</td>
                      <td class="text-right" style="color:#10B981;">${e.aceptadas}</td>
                      <td class="text-right" style="color:#EF4444;">${e.rechazadas}</td>
                      <td class="text-right" style="color:#F59E0B;">${e.pendientes}</td>
                      <td class="text-right" style="color:#F97316;">${e.en_revision}</td>
                      <td class="text-right fw-600">USD ${Number(e.volumen_usd).toFixed(2)}</td>
                    </tr>`).join('')
              }
            </tbody>
          </table>
        </div>
      </div>

      <!-- ── BI: Top 10 Clients ── -->
      ${_buildTopClientesTable(top_clientes)}

      <!-- ── BI: Executive Leaderboard ── -->
      ${_buildLeaderboardTable(leaderboard, rol)}
    `;
}
