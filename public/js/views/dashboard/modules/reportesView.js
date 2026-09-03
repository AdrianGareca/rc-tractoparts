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
// Evita que una respuesta lenta de un pedido viejo pise a una mas nueva.
import { crearTurnero } from '../../../shared/ultimaGana.js';
import { escHtml }        from '../helpers.js';
import { saveBlobAs }     from './timelineView.js';
import { tableSkeleton } from '../../../shared/skeleton.js';
import { renderMisMetricas } from './misMetricas.js';
import { anillo, aguja, contarHasta } from '../../../shared/graficos.js';

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
  // A partial range (only one of the two dates filled) would otherwise be
  // silently dropped below (desde && hasta) and fall back to the backend's
  // default period with no indication to the user — mirror the explicit
  // validation loadReportesData already does for the on-screen filter.
  if ((desde && !hasta) || (!desde && hasta)) {
    showToast('Selecciona una fecha de inicio y una de fin, o dejá ambas vacías para el histórico completo.', 'error');
    return;
  }

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
// Renders the "Clientes por origen" HTML table (company/manager reports only
// — never computed for the Ejecutivo's individual report).
//
// @param {Array}  rows  — clientes_por_origen array from /api/reportes/advanced
// @returns {string}     — HTML string for the <table> block
// ---------------------------------------------------------------------------
function _buildClientesPorOrigenTable(rows) {
  const safeRows = rows ?? [];
  const tbody = safeRows.length === 0
    ? `<tr><td colspan="3" class="empty-cell">
         Sin clientes clasificados todavía.
       </td></tr>`
    : safeRows.map((o) => `
        <tr>
          <td class="fw-600">${escHtml(o.origen)}</td>
          <td class="text-right">${Number(o.total_clientes ?? 0)}</td>
          <td class="text-right fw-600">
            ${Number(o.total_usd ?? 0) > 0
              ? `<span class="text-green">USD ${Number(o.total_usd).toFixed(2)}</span>`
              : ''}
            ${Number(o.total_bob ?? 0) > 0
              ? `<span class="text-violet ml-025">BOB ${Number(o.total_bob).toFixed(2)}</span>`
              : ''}
            ${Number(o.total_usd ?? 0) === 0 && Number(o.total_bob ?? 0) === 0 ? '—' : ''}
          </td>
        </tr>`).join('');

  return `
    <div class="card mb-2">
      <div class="card-header">
        <h3>Clientes por origen</h3>
        <span class="text-muted text-sm">De dónde vienen los clientes activos — clasificación editable en Gestión de clientes</span>
      </div>
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Origen</th>
              <th class="text-right">Clientes</th>
              <th class="text-right">Volumen del período</th>
            </tr>
          </thead>
          <tbody>${tbody}</tbody>
        </table>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// _buildTopClientesTable
// La tabla de clientes. Guarda contra datos nulos con un estado vacio limpio.
//
// EL TITULO CAMBIA SEGUN QUIEN MIRA, y no es cosmetica: son dos preguntas
// distintas. El Jefe quiere saber QUIENES PESAN MAS en la empresa, asi que ve
// los diez de mayor volumen. El ejecutivo quiere ver SU CARTERA completa —
// recortarla a diez le escondia clientes propios en su propio reporte, que fue
// exactamente lo que reporto.
//
// @param {Array}   rows       — top_clientes de /api/reportes/advanced
// @param {boolean} [propio]   — true cuando el reporte es del ejecutivo mismo
// @returns {string}           — HTML del bloque <table>
// ---------------------------------------------------------------------------
function _buildTopClientesTable(rows, propio = false) {
  const safeRows = rows ?? [];
  const tbody = safeRows.length === 0
    ? `<tr><td colspan="${propio ? 4 : 5}" class="empty-cell">
         ${propio
           ? 'Todavía no hay clientes con cotizaciones confirmadas o enviadas en este período.'
           : 'Sin registros de clientes para este período.'}
       </td></tr>`
    : safeRows.map((c, i) => `
        <tr>
          ${propio ? '' : `<td class="text-right fw-600 rank-cell">${i + 1}</td>`}
          <td class="fw-600">${escHtml(c.cliente)}</td>
          <td class="text-muted text-sm">${escHtml(c.nit)}</td>
          <td class="text-right">${Number(c.proformas_emitidas ?? 0)}</td>
          <td class="text-right fw-600">
            ${Number(c.total_usd ?? 0) > 0
              ? `<span class="text-green">USD ${Number(c.total_usd).toFixed(2)}</span>`
              : ''}
            ${Number(c.total_bob ?? 0) > 0
              ? `<span class="text-violet ml-025">BOB ${Number(c.total_bob).toFixed(2)}</span>`
              : ''}
            ${Number(c.total_usd ?? 0) === 0 && Number(c.total_bob ?? 0) === 0 ? '—' : ''}
          </td>
        </tr>`).join('');

  return `
    <div class="card mb-2">
      <div class="card-header">
        <h3>${propio ? 'Mis clientes' : 'Clientes de mayor impacto'}</h3>
        <span class="text-muted text-sm">
          ${propio ? `${safeRows.length} cliente(s)` : 'Los diez de mayor volumen'} ·
          cotizaciones confirmadas o enviadas al cliente
        </span>
      </div>
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              ${propio ? '' : '<th class="text-right">#</th>'}
              <th>Cliente / empresa</th>
              <th>NIT</th>
              <th class="text-right">Proformas emitidas</th>
              <th class="text-right">Total facturado</th>
            </tr>
          </thead>
          <tbody>${tbody}</tbody>
        </table>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// _buildLeaderboardTable
// Renders the "Rendimiento del equipo de ventas" (managers) or
// "Mi rendimiento personal" (Ejecutivo) HTML table.
//
// @param {Array}  rows      — leaderboard array from /api/reportes/advanced
// @param {string} rol       — caller's role from the API response
// @returns {string}         — HTML string for the <table> block
// ---------------------------------------------------------------------------
function _buildLeaderboardTable(rows, rol) {
  const isEjecutivo = rol === 'Ejecutivo';
  const title       = isEjecutivo
    ? 'Mi rendimiento personal'
    : 'Rendimiento del equipo de ventas';
  const subtitle    = isEjecutivo
    ? 'Historial acumulado de tu actividad comercial'
    : 'Leaderboard histórico de ejecutivos — ordenado por volumen generado';

  const safeRows = rows ?? [];
  const tbody = safeRows.length === 0
    ? `<tr><td colspan="6" class="empty-cell">
         Sin registros de ejecutivos para este período.
       </td></tr>`
    : safeRows.map((e) => {
        const tasa   = parseFloat(e.tasa_aprobacion ?? 0);
        const color  = tasa >= 60 ? 'var(--clr-green)' : tasa >= 40 ? 'var(--clr-amber)' : 'var(--clr-red)';
        return `
          <tr>
            <td class="fw-600">${escHtml(e.ejecutivo)}</td>
            <td class="text-right">${Number(e.total_creadas ?? 0)}</td>
            <td class="text-right text-green">${Number(e.total_aprobadas ?? 0)}</td>
            <td class="text-right fw-600" style="color:${color};">${tasa.toFixed(1)}%</td>
            <td class="text-right fw-600">
              ${Number(e.total_usd ?? 0) > 0
                ? `<span class="text-blue">USD ${Number(e.total_usd).toFixed(2)}</span>`
                : ''}
              ${Number(e.total_bob ?? 0) > 0
                ? `<span class="text-violet ml-025">BOB ${Number(e.total_bob).toFixed(2)}</span>`
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
              <th class="text-right">Proformas creadas</th>
              <th class="text-right">Aprobadas por Jefe</th>
              <th class="text-right">Tasa de aprobación</th>
              <th class="text-right">Total generado</th>
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
    <div class="card mb-2">
      <div class="card-header">
        <h3>Filtrar mi reporte</h3>
        <span class="text-muted text-sm">Filtra tus propias cotizaciones por un día o un rango de fechas</span>
      </div>
      <div class="filter-bar">
        <div class="form-group">
          <label class="form-label">Rango rápido</label>
          <select class="form-control fc-narrow" id="mym-preset">
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
          <input class="form-control fc-narrow" type="date" id="mym-desde" />
        </div>
        <div class="form-group">
          <label class="form-label">Hasta</label>
          <input class="form-control fc-narrow" type="date" id="mym-hasta" />
        </div>
        <button class="btn btn-primary btn-sm filter-action" id="mym-apply">Filtrar</button>
        <button class="btn btn-ghost btn-sm filter-action" id="mym-pdf">Generar PDF</button>
      </div>
    </div>
    <div id="mym-data">${tableSkeleton({ columnas: 5, etiqueta: 'Cargando reporte' })}</div>
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

  dataEl.innerHTML = tableSkeleton({ columnas: 5, etiqueta: 'Cargando reporte' });
  try {
    const qs = desde && hasta
      ? `?fecha_desde=${encodeURIComponent(desde)}&fecha_hasta=${encodeURIComponent(hasta)}`
      : '';
    const res  = await api.get('/api/reportes/advanced' + qs);
    const rol  = res.rol ?? 'Ejecutivo';
    const { top_clientes = [], leaderboard = [] } = res.data ?? {};

    // Las metricas propias van ARRIBA — conversion, tiempos, desglose por
    // estado y evolucion — y las dos tablas que ya existian quedan debajo como
    // complemento. Antes el reporte del ejecutivo era solo esas dos tablas.
    dataEl.innerHTML = `
      <div id="mym-indicadores"></div>
      ${_buildTopClientesTable(top_clientes, true)}
      ${_buildLeaderboardTable(leaderboard, rol)}`;

    await renderMisMetricas(dataEl.querySelector('#mym-indicadores'), { desde, hasta });
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
    <div class="card mb-2">
      <div class="card-header">
        <h3>Período del reporte</h3>
        <span class="text-muted text-sm">Filtra las métricas por fecha, ejecutivo y moneda</span>
      </div>
      <div class="filter-bar">
        <div class="form-group">
          <label class="form-label">Rango rápido</label>
          <select class="form-control fc-narrow" id="rep-preset">
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
          <input class="form-control fc-narrow" type="date" id="rep-desde" value="${defDesde}" />
        </div>
        <div class="form-group">
          <label class="form-label">Hasta</label>
          <input class="form-control fc-narrow" type="date" id="rep-hasta" value="${defHasta}" />
        </div>
        <div class="form-group">
          <label class="form-label">Ejecutivo</label>
          <select class="form-control fc-medium" id="rep-ejecutivo">
            <option value="">Todos</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Moneda</label>
          <select class="form-control fc-xnarrow" id="rep-moneda">
            <option value="BOB" selected>Bolivianos (BOB)</option>
            <option value="USD">Dólares (USD)</option>
          </select>
        </div>
        <button class="btn btn-primary btn-sm filter-action" id="rep-apply">Aplicar</button>
        <button class="btn btn-ghost btn-sm filter-action" id="rep-pdf">Generar PDF</button>
      </div>
    </div>
    <div id="reportes-data">${tableSkeleton({ columnas: 5, etiqueta: 'Cargando reporte' })}</div>
  `;

  const presetEl = panel.querySelector('#rep-preset');
  const desdeEl  = panel.querySelector('#rep-desde');
  const hastaEl  = panel.querySelector('#rep-hasta');
  const ejecEl   = panel.querySelector('#rep-ejecutivo');
  const monedaEl = panel.querySelector('#rep-moneda');

  // Populate the Ejecutivo dropdown from /api/usuarios — same source and
  // filtering as the "Todas las cotizaciones" tab, so both filter bars always
  // offer the identical list. Non-fatal: on failure it stays as "Todos" only.
  try {
    const usersResp  = await api.get('/api/usuarios');
    const ejecutivos = (usersResp.data ?? [])
      .filter((u) => u.rol === 'Ejecutivo' && u.activo)
      .sort((a, b) => a.nombre_completo.localeCompare(b.nombre_completo));
    for (const u of ejecutivos) {
      const opt = document.createElement('option');
      opt.value       = u.id;
      opt.textContent = u.nombre_completo;
      ejecEl.appendChild(opt);
    }
  } catch { /* dropdown degrades gracefully to "Todos" only */ }

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
    loadReportesData(panel, desdeEl.value, hastaEl.value, ejecEl.value, monedaEl.value);
  });

  // The currency selector is a pure display switch: both BOB and USD totals
  // already come back in every response, so it re-renders from the cached
  // payload instead of hitting the API again. Nothing is converted between
  // currencies — each total counts only the quotations issued in that currency.
  monedaEl.addEventListener('change', () => {
    const cached = panel._reportesCache;
    if (!cached) return;
    const dataEl = panel.querySelector('#reportes-data');
    if (dataEl) {
      dataEl.innerHTML = buildReportesDataHTML(
        cached.progresoRes, cached.advancedRes, monedaEl.value, cached.ejecutivoId
      );
      montarGraficosReportes(dataEl, cached.progresoRes);
    }
  });

  panel.querySelector('#rep-pdf').addEventListener('click', (e) =>
    downloadReportePdf(e.currentTarget, desdeEl.value, hastaEl.value));

  await loadReportesData(panel, defDesde, defHasta, '', monedaEl.value);
}

// ---------------------------------------------------------------------------
// loadReportesData — fetches both report endpoints for the given date range,
// optionally scoped to one executive, and renders the data section (leaving the
// filter bar untouched).
//
// @param {string} ejecutivoId — '' for the company-wide view, or a user id
// @param {string} moneda      — 'BOB' | 'USD', which volume figure to display
// ---------------------------------------------------------------------------
async function loadReportesData(panel, desde, hasta, ejecutivoId = '', moneda = 'BOB') {
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

  dataEl.innerHTML = tableSkeleton({ columnas: 5, etiqueta: 'Cargando reporte' });

  // El turnero vive en el panel: cada pantalla de reportes tiene el suyo, y
  // sobrevive entre llamadas porque el panel es el mismo elemento.
  //
  // SIN ESTO, EL JEFE VE DATOS DE OTRO PERIODO SIN ENTERARSE. Elegia «Este
  // ano» y apretaba Aplicar (consulta pesada, tres segundos); sin esperar
  // elegia «Hoy» y apretaba otra vez (cuatrocientos milisegundos). Terminaba
  // primero la de hoy, y dos segundos y medio despues llegaba la del ano y
  // pisaba la pantalla. Los numeros eran reales, solo que de otro periodo: no
  // habia error, ni parpadeo, ni nada que lo delatara.
  panel._turneroReportes = panel._turneroReportes ?? crearTurnero();

  try {
    let qs = `?fecha_desde=${encodeURIComponent(desde)}&fecha_hasta=${encodeURIComponent(hasta)}`;
    if (ejecutivoId) qs += `&id_ejecutivo=${encodeURIComponent(ejecutivoId)}`;

    const { vigente, valor } = await panel._turneroReportes.ejecutar(() =>
      // Las dos consultas en paralelo: son conjuntos de datos independientes.
      Promise.all([
        api.get('/api/reportes/progreso' + qs),
        api.get('/api/reportes/advanced' + qs),
      ])
    );

    // Llego tarde: ya hay un pedido mas nuevo en pantalla. Ni se pinta ni se
    // cachea — la cache tambien pisaba, asi que cambiar de moneda volvia a
    // dibujar los numeros equivocados sin ninguna peticion nueva.
    if (!vigente) return;

    const [progresoRes, advancedRes] = valor;

    // Se guardan los payloads crudos para que cambiar de moneda redibuje al
    // instante sin una segunda vuelta (las dos monedas vienen siempre).
    panel._reportesCache = { progresoRes, advancedRes, ejecutivoId };
    dataEl.innerHTML = buildReportesDataHTML(progresoRes, advancedRes, moneda, ejecutivoId);
    montarGraficosReportes(dataEl, progresoRes);
  } catch (err) {
    panel._reportesCache = null;
    dataEl.innerHTML = `<div class="empty-state"><p>Error cargando reportes: ${escHtml(err.message)}</p></div>`;
  }
}

// ---------------------------------------------------------------------------
// _buildSeguimientoVentaCard
// Pipeline de venta con el cliente (independiente del Estado de aprobación
// interno) — cuenta cotizaciones por estado_venta dentro del período elegido.
// @returns {string} — HTML string for the <div class="card"> block
// ---------------------------------------------------------------------------
function _buildSeguimientoVentaCard(seg, periodo, alcance) {
  return `
      <div class="card mb-2">
        <div class="card-header">
          <h3>Seguimiento Comercial — ${escHtml(periodo)}${alcance}</h3>
          <span class="text-muted text-sm">Pipeline de venta con el cliente, no el flujo de aprobación interno</span>
        </div>
        <div class="stats-grid stats-grid-en-tarjeta">
          <div class="stat-card stat-accent-blue">
            <div class="stat-card-value">${seg.interesado}</div>
            <div class="stat-card-label">Interesado</div>
          </div>
          <div class="stat-card stat-accent-amber">
            <div class="stat-card-value">${seg.en_negociacion}</div>
            <div class="stat-card-label">En negociación</div>
          </div>
          <div class="stat-card stat-accent-green">
            <div class="stat-card-value">${seg.confirmado}</div>
            <div class="stat-card-label">Confirmado</div>
          </div>
          <div class="stat-card stat-accent-red">
            <div class="stat-card-value">${seg.no_le_interesa}</div>
            <div class="stat-card-label">No le interesa</div>
          </div>
          <div class="stat-card stat-accent-green">
            <div class="stat-card-value">${seg.venta_concretada}</div>
            <div class="stat-card-label">Venta concretada</div>
          </div>
          <div class="stat-card stat-accent-violet">
            <div class="stat-card-value">${seg.otro}</div>
            <div class="stat-card-label">Otro</div>
          </div>
          <div class="stat-card stat-accent-gray">
            <div class="stat-card-value">${seg.sin_seguimiento}</div>
            <div class="stat-card-label">Sin seguimiento</div>
          </div>
        </div>
      </div>`;
}

// ---------------------------------------------------------------------------
// buildReportesDataHTML — builds the full analytics HTML (stats grid + monthly
// executive breakdown + BI tables) from the two API responses.
// ---------------------------------------------------------------------------
// _buildPanelRendimiento
// La tarjeta de cabecera del reporte de Jefe / Administración: los dos gráficos
// y la grilla de indicadores del período.
//
// POR QUÉ ESTÁ APARTE
// Vivía dentro de buildReportesDataHTML. Al sumarle los lienzos, esa función
// pasó de 124 a 133 líneas y el trinquete de tests/unit/funcionesLargas.test.js
// la frenó. El tope sólo puede BAJAR, así que la salida no era subirlo: era
// partir por donde ya había una costura — esta tarjeta es una unidad completa,
// se arma con valores ya calculados y no toca nada de lo que viene después.
//
// Los <canvas> van vacíos: los dibuja montarGraficosReportes() una vez que el
// HTML está en el documento y el navegador les calculó un ancho.
// ---------------------------------------------------------------------------
function _buildPanelRendimiento(v) {
  return `
      <!-- ── Cabecera: gráficos + indicadores del período ── -->
      <div class="card mb-2">
        <div class="card-header">
          <h3>Dashboard de Rendimiento — ${escHtml(v.periodo)}${v.alcance}</h3>
          ${v.ejecutivoId
            ? `<span class="text-muted text-sm">Métricas de un solo ejecutivo — no son los totales de la empresa</span>`
            : ''}
        </div>
        <div class="fila-graficos">
          <div class="lienzo-anillo">
            <canvas data-grafico="rep-exito" height="150" role="img"
                    aria-label="Tasa de éxito del período: ${v.ratioPct} por ciento."></canvas>
          </div>
          <div class="lienzo-anillo">
            <canvas data-grafico="rep-seguimiento" height="150" role="img"
                    aria-label="Reparto del seguimiento comercial. El detalle exacto está en la tabla de abajo."></canvas>
          </div>
        </div>
        <div class="stats-grid stats-grid-en-tarjeta">
          <div class="stat-card" style="--stat-accent:${v.monAccent};">
            <div class="stat-card-value">${v.volSel}</div>
            <div class="stat-card-label">Volumen ${v.monLabel} (período)</div>
          </div>
          <div class="stat-card" style="--stat-accent:var(--clr-amber);">
            <div class="stat-card-value">${v.totalCot}</div>
            <div class="stat-card-label">Cotizaciones (período)</div>
          </div>
          <div class="stat-card" style="--stat-accent:${v.ratioColor};">
            <div class="stat-card-value">${v.ratioPct}%</div>
            <div class="stat-card-label">Tasa de Éxito (período)</div>
          </div>
          <div class="stat-card" style="--stat-accent:var(--clr-green);">
            <div class="stat-card-value">${v.aceptadas}</div>
            <div class="stat-card-label">Confirmadas (período)</div>
          </div>
          <div class="stat-card" style="--stat-accent:var(--clr-red);">
            <div class="stat-card-value">${v.rechazadas}</div>
            <div class="stat-card-label">Rechazadas (período)</div>
          </div>
        </div>
      </div>
`;
}

// ---------------------------------------------------------------------------
function buildReportesDataHTML(progresoRes, advancedRes, moneda = 'BOB', ejecutivoId = '') {
    // ── Progreso data ─────────────────────────────────────────────────────
    const {
      volumen           = {},
      conversion        = {},
      seguimiento_venta = {},
      por_ejecutivo     = [],
    } = progresoRes.data ?? {};
    const periodo = progresoRes.periodo ?? '—';

    // Currency display switch — NOT a conversion. Each figure counts only the
    // quotations issued in that currency, so BOB and USD are independent totals
    // and never add up to a combined "grand total".
    const isUSD      = moneda === 'USD';
    const monLabel   = isUSD ? 'USD' : 'BOB';
    const monAccent  = isUSD ? 'var(--clr-blue)' : 'var(--clr-violet)';
    const volSel     = Number(
      (isUSD ? volumen.total_mes_usd : volumen.total_mes_bob) ?? 0
    ).toFixed(2);

    const totalCot   = volumen.total_cotizaciones ?? 0;
    const ratioPct   = conversion.ratio_pct       ?? '0.0';
    const aceptadas  = conversion.total_aceptadas  ?? 0;
    const rechazadas = conversion.total_rechazadas ?? 0;
    const ratioColor = parseFloat(ratioPct) >= 50 ? 'var(--clr-green)' : 'var(--clr-red)';

    // ── Seguimiento comercial (independiente del Estado de aprobación) ─────
    const seg = {
      interesado:      seguimiento_venta.interesado      ?? 0,
      en_negociacion:   seguimiento_venta.en_negociacion   ?? 0,
      confirmado:       seguimiento_venta.confirmado       ?? 0,
      no_le_interesa:   seguimiento_venta.no_le_interesa   ?? 0,
      venta_concretada: seguimiento_venta.venta_concretada ?? 0,
      otro:             seguimiento_venta.otro             ?? 0,
      sin_seguimiento:  seguimiento_venta.sin_seguimiento  ?? 0,
    };

    // ── Advanced BI data ──────────────────────────────────────────────────
    const rol = advancedRes.rol ?? 'Jefe';
    const {
      top_clientes = [],
      leaderboard  = [],
      clientes_por_origen = [],
    } = advancedRes.data ?? {};

    // When one executive is selected, por_ejecutivo collapses to that single
    // row — take their name from it so every heading states plainly whose
    // figures are on screen rather than silently showing a narrowed report.
    const scopedTo = ejecutivoId ? (por_ejecutivo[0]?.ejecutivo ?? null) : null;
    const alcance  = scopedTo
      ? ` · ${escHtml(scopedTo)}`
      : (ejecutivoId ? ' · Ejecutivo seleccionado' : '');

    return `
      ${_buildPanelRendimiento({ periodo, alcance, ejecutivoId, ratioPct,
                                monAccent, volSel, monLabel, totalCot,
                                ratioColor, aceptadas, rechazadas })}

      <!-- ── Seguimiento comercial — independiente del Estado de aprobación ── -->
      ${_buildSeguimientoVentaCard(seg, periodo, alcance)}

      <!-- ── Per-executive breakdown for the selected range ── -->
      <div class="card mb-2">
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
                <th class="text-right">Volumen ${monLabel}</th>
              </tr>
            </thead>
            <tbody>
              ${por_ejecutivo.length === 0
                ? `<tr><td colspan="7" class="empty-cell">Sin datos para el período seleccionado.</td></tr>`
                : por_ejecutivo.map(e => `
                    <tr>
                      <td class="fw-600">${escHtml(e.ejecutivo)}</td>
                      <td class="text-right">${e.total}</td>
                      <td class="text-right text-green">${e.aceptadas}</td>
                      <td class="text-right text-red">${e.rechazadas}</td>
                      <td class="text-right text-amber">${e.pendientes}</td>
                      <td class="text-right text-orange">${e.en_revision}</td>
                      <td class="text-right fw-600">${monLabel} ${Number(
                        (isUSD ? e.volumen_usd : e.volumen_bob) ?? 0
                      ).toFixed(2)}</td>
                    </tr>`).join('')
              }
            </tbody>
          </table>
        </div>
      </div>

      <!-- ── BI: clientes de mayor impacto (vista de empresa) ── -->
      ${_buildTopClientesTable(top_clientes)}

      <!-- ── BI: Executive Leaderboard ── -->
      ${_buildLeaderboardTable(leaderboard, rol)}

      <!-- ── BI: Clientes por origen ── -->
      <!-- Omitted when scoped to one executive: the backend only computes this
           for company-wide reports (it counts ACTIVE CLIENTS, not quotations,
           so it is not an executive-level metric). Rendering it would show an
           empty "sin clientes clasificados" table that wrongly reads as
           "there is no data" instead of "this metric does not apply here". -->
      ${ejecutivoId ? '' : _buildClientesPorOrigenTable(clientes_por_origen)}
    `;
}

// ---------------------------------------------------------------------------
// montarGraficosReportes
// Los gráficos del reporte de Jefe / Administración.
//
// POR QUÉ EXISTE ESTA FUNCIÓN Y NO SE REUSA LA DEL EJECUTIVO
// Son dos pantallas distintas con dos formas de los datos distintas. El
// ejecutivo mira SU evolución mes a mes (por_mes) y en qué anda cada cotización
// suya. El Jefe mira el período completo de la empresa: qué proporción se cerró
// y en qué punto del embudo comercial está lo que no.
//
// Los dos números ya venían en /api/reportes/progreso y se imprimían sueltos:
// la tasa de éxito como un porcentaje en una tarjeta, y el seguimiento como
// siete casillas. Acá no se calcula nada nuevo, sólo se dibuja lo que ya había.
//
// SI FALLA, NO SE LLEVA EL REPORTE PUESTO
// Todo en try/catch: un gráfico es un agregado. Que no se pueda dibujar no
// puede dejar sin números a quien entró a verlos.
// ---------------------------------------------------------------------------
const COLOR_SEGUIMIENTO = [
  ['venta_concretada', 'Venta concretada', '--clr-green'],
  ['confirmado',       'Confirmado',       '--clr-teal'],
  ['en_negociacion',   'En negociación',   '--clr-blue'],
  ['interesado',       'Interesado',       '--clr-amber'],
  ['otro',             'Otro',             '--clr-violet'],
  ['no_le_interesa',   'No le interesa',   '--clr-red'],
  ['sin_seguimiento',  'Sin seguimiento',  '--clr-gray'],
];

function montarGraficosReportes(dataEl, progresoRes) {
  try {
    const datos = progresoRes?.data ?? {};

    const lienzoExito = dataEl.querySelector('[data-grafico="rep-exito"]');
    if (lienzoExito) {
      aguja(lienzoExito, parseFloat(datos.conversion?.ratio_pct ?? 0) || 0);
    }

    const lienzoSeg = dataEl.querySelector('[data-grafico="rep-seguimiento"]');
    const seg = datos.seguimiento_venta ?? {};
    if (lienzoSeg) {
      anillo(lienzoSeg, COLOR_SEGUIMIENTO.map(([clave, etiqueta, token]) => ({
        etiqueta,
        valor: Number(seg[clave]) || 0,
        token,
      })));
    }

    // Las cifras de las tarjetas suben desde cero. Sólo las numéricas: un
    // volumen con decimales o un porcentaje se formatean como corresponde, y
    // cualquier otra cosa se deja intacta.
    dataEl.querySelectorAll('.stat-card-value').forEach((celda) => {
      const texto = celda.textContent.trim();
      const m = /^(\d+(?:\.\d+)?)\s*%?$/.exec(texto);
      if (!m) return;
      const n = Number(m[1]);
      if (!isFinite(n)) return;
      const esPct = texto.endsWith('%');
      const decimales = (m[1].split('.')[1] ?? '').length;
      contarHasta(celda, n, (v) => (esPct
        ? v.toFixed(decimales || 1) + '%'
        : v.toFixed(decimales)));
    });
  } catch (e) {
    console.warn('[reportes] No se pudieron dibujar los gráficos:', e.message);
  }
}
