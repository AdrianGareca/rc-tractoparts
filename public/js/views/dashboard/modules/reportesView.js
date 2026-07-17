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

import api, { showToast } from '../../../services/apiClient.js';
import { escHtml }        from '../helpers.js';
import { saveBlobAs }     from './timelineView.js';

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
    case 'todo':
      return ['', ''];
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
// downloadReportePdf — GET /api/reportes/pdf for the given range (both bounds
// empty means "histórico/todo el rango" — the backend interprets a missing
// range as all-time for Ejecutivo callers, or the current month for
// managers). Backend RLS decides company vs individual content; the frontend
// only forwards whatever range is currently selected.
// ---------------------------------------------------------------------------
async function downloadReportePdf(btn, desde, hasta) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = '…';
  try {
    const qs = desde && hasta
      ? `?fecha_desde=${encodeURIComponent(desde)}&fecha_hasta=${encodeURIComponent(hasta)}`
      : '';
    const response = await api.get('/api/reportes/pdf' + qs);
    const blob     = await response.blob();
    const fileName = `Reporte_${desde || 'historico'}_${hasta || ''}.pdf`.replace(/[^\w.\-]/g, '_');
    const outcome  = await saveBlobAs(blob, fileName, {
      description: 'Documento PDF',
      accept:      { 'application/pdf': ['.pdf'] },
    });
    if (outcome === 'saved') {
      showToast('PDF guardado en la ubicación elegida.', 'success', 2500);
    } else if (outcome === 'downloaded') {
      showToast('PDF descargado a tu carpeta de Descargas.', 'info', 3500);
    }
  } catch (err) {
    showToast(err.data?.message || err.message || 'No se pudo generar el PDF.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

// ---------------------------------------------------------------------------
// _buildClientesPorOrigenTable
// Renders the "Clientes por Origen" HTML table (company/manager reports only
// — never computed for the Ejecutivo's individual report).
//
// @param {Array}  rows  — clientes_por_origen array from /api/reportes/advanced
// @returns {string}     — HTML string for the <table> block
// ---------------------------------------------------------------------------
function _buildClientesPorOrigenTable(rows) {
  const safeRows = rows ?? [];
  const tbody = safeRows.length === 0
    ? `<tr><td colspan="3" style="text-align:center;padding:2rem;color:var(--text-muted);">
         Sin clientes clasificados todavía.
       </td></tr>`
    : safeRows.map((o) => `
        <tr>
          <td class="fw-600">${escHtml(o.origen)}</td>
          <td class="text-right">${Number(o.total_clientes ?? 0)}</td>
          <td class="text-right fw-600">
            ${Number(o.total_usd ?? 0) > 0
              ? `<span style="color:#10B981;">USD ${Number(o.total_usd).toFixed(2)}</span>`
              : ''}
            ${Number(o.total_bob ?? 0) > 0
              ? `<span style="color:#8B5CF6;margin-left:.25rem;">BOB ${Number(o.total_bob).toFixed(2)}</span>`
              : ''}
            ${Number(o.total_usd ?? 0) === 0 && Number(o.total_bob ?? 0) === 0 ? '—' : ''}
          </td>
        </tr>`).join('');

  return `
    <div class="card" style="margin-bottom:1rem;">
      <div class="card-header">
        <h3>📍 Clientes por Origen</h3>
        <span class="text-muted text-sm">De dónde vienen los clientes activos — clasificación editable en Gestión de Clientes</span>
      </div>
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Origen</th>
              <th class="text-right">Clientes</th>
              <th class="text-right">Volumen del Período</th>
            </tr>
          </thead>
          <tbody>${tbody}</tbody>
        </table>
      </div>
    </div>`;
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
// renderExecutiveMetrics
// Ejecutivo's personal report — fetches /api/reportes/advanced, which the
// backend row-level-security-scopes to the caller's own quotations, and adds
// a date-range filter bar plus a "Generar PDF" button ("solo sus
// cotizaciones y nada más" — GET /api/reportes/pdf applies the same RLS,
// never company-wide data for this role).
//
// Default range is "Todo el historial" (both bounds empty = all-time).
//
// @param {HTMLElement} panel — Container element (#metrics-section)
// ---------------------------------------------------------------------------
export async function renderExecutiveMetrics(panel) {
  panel.innerHTML = `
    <div class="card" style="margin-bottom:1rem;">
      <div class="card-header">
        <h3>📅 Filtrar mi Reporte</h3>
        <span class="text-muted text-sm">Filtra tus propias cotizaciones por un día o un rango de fechas</span>
      </div>
      <div class="filter-bar" style="padding:1rem;">
        <div class="form-group">
          <label class="form-label">Rango rápido</label>
          <select class="form-control" id="mym-preset" style="min-width:150px;">
            <option value="todo" selected>Todo el historial</option>
            <option value="hoy">Hoy</option>
            <option value="ayer">Ayer</option>
            <option value="7d">Últimos 7 días</option>
            <option value="30d">Últimos 30 días</option>
            <option value="mes">Este mes</option>
            <option value="mespasado">Mes pasado</option>
            <option value="anio">Este año</option>
            <option value="custom">Personalizado…</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Desde</label>
          <input class="form-control" type="date" id="mym-desde" style="min-width:150px;" />
        </div>
        <div class="form-group">
          <label class="form-label">Hasta</label>
          <input class="form-control" type="date" id="mym-hasta" style="min-width:150px;" />
        </div>
        <button class="btn btn-primary btn-sm" id="mym-apply" style="align-self:flex-end;">Filtrar</button>
        <button class="btn btn-ghost btn-sm" id="mym-pdf" style="align-self:flex-end;">📄 Generar PDF</button>
      </div>
    </div>
    <div id="mym-data"><div class="page-loading"><div class="spinner"></div></div></div>
  `;

  const presetEl = panel.querySelector('#mym-preset');
  const desdeEl  = panel.querySelector('#mym-desde');
  const hastaEl  = panel.querySelector('#mym-hasta');

  presetEl.addEventListener('change', () => {
    if (presetEl.value === 'custom') return;
    const [d, h] = presetRange(presetEl.value);
    desdeEl.value = d;
    hastaEl.value = h;
  });

  [desdeEl, hastaEl].forEach((el) =>
    el.addEventListener('input', () => { presetEl.value = 'custom'; })
  );

  panel.querySelector('#mym-apply').addEventListener('click', () => {
    loadExecutiveMetrics(panel, desdeEl.value, hastaEl.value);
  });

  panel.querySelector('#mym-pdf').addEventListener('click', (e) =>
    downloadReportePdf(e.currentTarget, desdeEl.value, hastaEl.value));

  await loadExecutiveMetrics(panel, '', '');
}

// ---------------------------------------------------------------------------
// loadExecutiveMetrics — fetches /api/reportes/advanced for the given range
// (empty desde/hasta = all-time) and renders into #mym-data, leaving the
// filter bar untouched.
// ---------------------------------------------------------------------------
async function loadExecutiveMetrics(panel, desde, hasta) {
  const dataEl = panel.querySelector('#mym-data');
  if (!dataEl) return;

  dataEl.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';
  try {
    const qs = desde && hasta
      ? `?fecha_desde=${encodeURIComponent(desde)}&fecha_hasta=${encodeURIComponent(hasta)}`
      : '';
    const res  = await api.get('/api/reportes/advanced' + qs);
    const rol  = res.rol ?? 'Ejecutivo';
    const { top_clientes = [], leaderboard = [] } = res.data ?? {};
    dataEl.innerHTML =
      _buildTopClientesTable(top_clientes) +
      _buildLeaderboardTable(leaderboard, rol);
  } catch (err) {
    dataEl.innerHTML = `<div class="empty-state"><p>Error cargando métricas: ${escHtml(err.message)}</p></div>`;
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
        <button class="btn btn-ghost btn-sm" id="rep-pdf" style="align-self:flex-end;">📄 Generar PDF</button>
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

  panel.querySelector('#rep-pdf').addEventListener('click', (e) =>
    downloadReportePdf(e.currentTarget, desdeEl.value, hastaEl.value));

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
      clientes_por_origen = [],
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

      <!-- ── BI: Clientes por Origen ── -->
      ${_buildClientesPorOrigenTable(clientes_por_origen)}
    `;
}
