// =============================================================================
// public/js/views/dashboard/modules/allQuotationsTab.js
// SHARED: "Todas las Cotizaciones" filterable tab (Jefe + Admin)
//
// Both ManagerStrategy and AdminStrategy render an identical filterable table,
// differing only in how the "Ver Detalle" button opens the record. This module
// helper owns the entire flow — filter bar, executive dropdown, server-side
// filtering, pagination and reset-to-page-1 — so the logic lives in one place.
//
// Backend contract (already implemented, all params validated + parameterized):
//   GET /api/cotizaciones?estado=&id_ejecutivo=&fecha_desde=&fecha_hasta=&q=&page=&limit=&sort_by=&sort_order=
//
// Extracted verbatim from dashboardView.js as part of the file-size cleanup
// — no behavioral change.
//
// @param {HTMLElement} panel  — tab panel to render into
// @param {Object} opts
//   opts.detailAttr   {string}   data-* attribute used on the detail button
//   opts.onViewDetail {Function} (id, correlativo) => void
// =============================================================================

import api from '../../../services/apiClient.js';
import { escHtml, badgeHtml, fmtDate, fmtAmount } from '../helpers.js';
import { tableSkeleton } from '../../../shared/skeleton.js';
import { mountPagination, ETIQUETAS_FECHA } from '../../../shared/pagination.js';

// Must mirror sql/init.sql cotizaciones.estado ENUM EXACTLY (legacy 'Aceptada'
// is intentionally omitted — it was superseded by 'Confirmada'). Any mismatch
// makes the backend reject the filter with HTTP 422.
const ALL_QUOTATION_STATES = [
  'Pendiente', 'En revision', 'En espera', 'Aprobada internamente',
  'Enviada al cliente', 'Confirmada', 'Rechazada', 'Archivada',
];

export async function mountAllQuotationsTab(panel, { detailAttr, onViewDetail }) {
  // Closure state — persists while this tab stays mounted.
  const state = { page: 1, limit: 50 };

  // ── 1. Paint the static shell (filter bar + results container) ONCE ─────────
  panel.innerHTML = `
    <div class="card">
      <div class="card-header" style="flex-wrap:wrap;gap:.75rem;">
        <h3>Todas las Cotizaciones</h3>
        <span class="text-muted text-sm" id="allq-total"></span>
      </div>
      <div class="filter-bar" style="display:flex;flex-wrap:wrap;gap:.75rem;align-items:flex-end;padding:0 1rem 1rem;">
        <div class="form-group">
          <label class="form-label">Estado</label>
          <select class="form-control" id="allq-estado" style="min-width:150px;">
            <option value="">Todos</option>
            ${ALL_QUOTATION_STATES.map((s) => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Ejecutivo</label>
          <select class="form-control" id="allq-ejecutivo" style="min-width:170px;">
            <option value="">Todos</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Desde</label>
          <input class="form-control" type="date" id="allq-desde" />
        </div>
        <div class="form-group">
          <label class="form-label">Hasta</label>
          <input class="form-control" type="date" id="allq-hasta" />
        </div>
        <div class="form-group">
          <label class="form-label">Buscar</label>
          <input class="form-control" type="search" id="allq-q" placeholder="Correlativo, cliente, NIT…" style="min-width:190px;" />
        </div>
        <button class="btn btn-primary btn-sm" id="allq-apply" style="align-self:flex-end;">Aplicar Filtros</button>
        <button class="btn btn-ghost btn-sm"   id="allq-clear" style="align-self:flex-end;">Limpiar</button>
      </div>
      <div class="card-toolbar" id="allq-pagination"></div>
      <div id="allq-results">${tableSkeleton({ columnas: 8, etiqueta: 'Cargando cotizaciones' })}</div>
    </div>`;

  const $ = (sel) => panel.querySelector(sel);

  // Handle del control de paginación montado, para desmontarlo antes de
  // volver a dibujarlo (ver renderPagination).
  let destroyPagination = null;

  // Vaciar el pie sin desmontar antes dejaba vivos los listeners de document del
  // menú desplegable: el HTML desaparecía pero los handlers seguían ahí, y cada
  // búsqueda que no devolvía nada apilaba un par más.
  const clearPagination = () => {
    destroyPagination?.();
    destroyPagination = null;
    const pie = $('#allq-pagination');
    if (pie) pie.innerHTML = '';
  };

  // ── 2. Populate the Ejecutivo dropdown from /api/usuarios ────────────────────
  // Non-fatal: if it fails, the dropdown just stays with "Todos".
  try {
    const usersResp  = await api.get('/api/usuarios');
    const ejecutivos = (usersResp.data ?? [])
      .filter((u) => u.rol === 'Ejecutivo' && u.activo)
      .sort((a, b) => a.nombre_completo.localeCompare(b.nombre_completo));
    const sel = $('#allq-ejecutivo');
    for (const u of ejecutivos) {
      const opt = document.createElement('option');
      opt.value       = u.id;
      opt.textContent = u.nombre_completo;
      sel.appendChild(opt);
    }
  } catch { /* dropdown degrades gracefully to "Todos" only */ }

  // ── 3. Fetch + render, reading the current filter state ─────────────────────
  async function load() {
    const results = $('#allq-results');
    results.innerHTML = tableSkeleton({ columnas: 8, etiqueta: 'Cargando cotizaciones' });

    const params = new URLSearchParams({
      page:       String(state.page),
      limit:      String(state.limit),
      sort_by:    'creado_en',
      sort_order: 'DESC',
    });
    const estado = $('#allq-estado').value;
    const ejec   = $('#allq-ejecutivo').value;
    const desde  = $('#allq-desde').value;
    const hasta  = $('#allq-hasta').value;
    const q      = $('#allq-q').value.trim();
    if (estado) params.set('estado', estado);
    if (ejec)   params.set('id_ejecutivo', ejec);
    if (desde)  params.set('fecha_desde', desde);
    if (hasta)  params.set('fecha_hasta', hasta);
    if (q)      params.set('q', q);

    try {
      const data = await api.get(`/api/cotizaciones?${params.toString()}`);
      const rows = data.data ?? [];
      $('#allq-total').textContent = `${data.pagination?.totalRecords ?? rows.length} total`;

      if (rows.length === 0) {
        results.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">📋</div>
            <h4>Sin resultados</h4>
            <p>No hay cotizaciones que coincidan con los filtros aplicados.</p>
          </div>`;
        clearPagination();
        return;
      }

      results.innerHTML = `
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>Correlativo</th><th>Ejecutivo</th><th>Cliente</th>
                <th>Monto</th><th>Estado</th><th>Fecha</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((r) => `
                <tr>
                  <td class="fw-600">${escHtml(r.numero_correlativo)}</td>
                  <td>${escHtml(r.ejecutivo_nombre ?? '—')}</td>
                  <td>${escHtml(r.cliente_nombre ?? String(r.id_cliente))}</td>
                  <td>${fmtAmount(r.monto_total, r.moneda)}</td>
                  <td>${badgeHtml(r.estado)}</td>
                  <td>${fmtDate(r.fecha_emision)}</td>
                  <td>
                    <button class="btn btn-ghost btn-sm" ${detailAttr}="${r.id}"
                            data-correlativo="${escHtml(r.numero_correlativo)}">
                      🔍 Ver Detalle
                    </button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;

      results.querySelectorAll(`[${detailAttr}]`).forEach((btn) => {
        btn.addEventListener('click', () =>
          onViewDetail(btn.getAttribute(detailAttr), btn.dataset.correlativo));
      });

      renderPagination(data.pagination);
    } catch (err) {
      results.innerHTML = `<div class="empty-state"><p>Error: ${escHtml(err.message)}</p></div>`;
      clearPagination();
    }
  }

  // El control lo dibuja el módulo compartido (public/js/shared/pagination.js):
  // los cuatro paneles tenían esta función copiada, idéntica salvo el prefijo.
  // destroyPagination quita los listeners de document del menú anterior antes
  // de montar el nuevo; sin eso cada recarga apilaría un par más.
  function renderPagination(paginacion) {
    destroyPagination?.();
    destroyPagination = mountPagination($('#allq-pagination'), paginacion, {
      etiquetas: ETIQUETAS_FECHA,
      onChange: ({ page, limit }) => {
        state.page  = page;
        state.limit = limit;
        load();
      },
    });
  }

  // ── 4. Wire filters ─────────────────────────────────────────────────────────
  // Dropdowns fire on 'change'; text + dates apply via button or Enter.
  // Every entry point resets to page 1 so the user never lands on a now-empty page.
  $('#allq-estado').addEventListener('change',    () => { state.page = 1; load(); });
  $('#allq-ejecutivo').addEventListener('change', () => { state.page = 1; load(); });
  $('#allq-apply').addEventListener('click',      () => { state.page = 1; load(); });
  $('#allq-q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { state.page = 1; load(); }
  });
  $('#allq-clear').addEventListener('click', () => {
    $('#allq-estado').value    = '';
    $('#allq-ejecutivo').value = '';
    $('#allq-desde').value     = '';
    $('#allq-hasta').value     = '';
    $('#allq-q').value         = '';
    state.page = 1;
    load();
  });

  // ── 5. Initial load ─────────────────────────────────────────────────────────
  await load();
}
