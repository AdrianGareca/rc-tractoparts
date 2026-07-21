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
      <div id="allq-results"><div class="page-loading"><div class="spinner"></div></div></div>
      <div class="card-footer" id="allq-pagination"></div>
    </div>`;

  const $ = (sel) => panel.querySelector(sel);

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
    results.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

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
        $('#allq-pagination').innerHTML = '';
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

      renderPagination(data.pagination?.totalPages ?? 1);
    } catch (err) {
      results.innerHTML = `<div class="empty-state"><p>Error: ${escHtml(err.message)}</p></div>`;
      $('#allq-pagination').innerHTML = '';
    }
  }

  function renderPagination(totalPages) {
    const foot = $('#allq-pagination');
    if (totalPages <= 1) { foot.innerHTML = ''; return; }
    foot.innerHTML = `
      <button class="btn btn-ghost btn-sm" id="allq-prev" ${state.page <= 1 ? 'disabled' : ''}>‹ Anterior</button>
      <span class="text-sm" style="margin:0 .75rem;">Página ${state.page} de ${totalPages}</span>
      <button class="btn btn-ghost btn-sm" id="allq-next" ${state.page >= totalPages ? 'disabled' : ''}>Siguiente ›</button>`;
    $('#allq-prev')?.addEventListener('click', () => { if (state.page > 1)          { state.page--; load(); } });
    $('#allq-next')?.addEventListener('click', () => { if (state.page < totalPages) { state.page++; load(); } });
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
