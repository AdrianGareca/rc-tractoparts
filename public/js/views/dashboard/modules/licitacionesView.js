// =============================================================================
// public/js/views/dashboard/modules/licitacionesView.js
// "Licitaciones" tab — paginated, filterable list of licitaciones + a detail
// sub-modal (linked cotizaciones, budget comparison, state timeline, and
// role-aware transition buttons).
//
// Shared by every strategy that surfaces licitaciones:
//   • ProyectosStrategy   — canManage (create/edit own), transitions per matrix
//   • ManagerStrategy/Admin — read + full override transitions
//   • Delegated Ejecutivo — read + limited transitions, defaultEstado=Cotizando
//
// mountLicitacionesTab(panel, opts)
//   opts.canCreate     {boolean} show "+ Nueva Licitación" (Proyectos/Jefe/SysAdmin)
//   opts.defaultEstado {string}  preselect an estado filter (e.g. 'Cotizando')
//   opts.onCreateCotizacion {function(licitacion)} optional — when provided, the
//                              detail shows a "Crear cotización vinculada" button
//                              (used by the delegated Ejecutivo path).
//
// Role/ownership/transition rules are read from AuthSession and mirror
// LicitacionModel.LICITACION_ROLE_TRANSITIONS (kept in sync deliberately — the
// browser cannot call the server-side matrix; the backend re-validates anyway).
// =============================================================================

import api from '../../../services/apiClient.js';
import { escHtml, fmtDate, licitacionBadgeHtml } from '../helpers.js';
import { openLicitacionModal } from './licitacionModal.js';

// La lista de estados sale de licitacion/permissions.js, que también tiene la
// matriz de transiciones y los permisos (cubiertos por
// tests/unit/licitacionPermissions.test.js).
import { ESTADOS } from './licitacion/permissions.js';
import { openLicitacionDetail } from './licitacion/detailModal.js';

// ---------------------------------------------------------------------------
// mountLicitacionesTab
// ---------------------------------------------------------------------------
export async function mountLicitacionesTab(panel, opts = {}) {
  const { canCreate = false, defaultEstado = '', onCreateCotizacion = null } = opts;
  const state = { page: 1, limit: 20, q: '', estado: defaultEstado };

  panel.innerHTML = `
    <div class="card">
      <div class="card-header" style="flex-wrap:wrap;gap:.75rem;">
        <h3>📑 Licitaciones</h3>
        <div style="display:flex;gap:.5rem;align-items:center;">
          <span class="text-muted text-sm" id="lic-total"></span>
          ${canCreate ? '<button class="btn btn-primary btn-sm" id="lic-new">+ Nueva Licitación</button>' : ''}
        </div>
      </div>
      <div class="filter-bar" style="display:flex;gap:.75rem;flex-wrap:wrap;align-items:flex-end;">
        <div class="form-group" style="margin:0;">
          <label class="form-label">Buscar</label>
          <input class="form-control" type="search" id="lic-search" placeholder="Código, nombre o convocante…" style="min-width:220px;" />
        </div>
        <div class="form-group" style="margin:0;">
          <label class="form-label">Estado</label>
          <select class="form-control" id="lic-estado">
            <option value="">Todos</option>
            ${ESTADOS.map((e) => `<option value="${e}" ${e === defaultEstado ? 'selected' : ''}>${e}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn-ghost btn-sm" id="lic-search-btn">Filtrar</button>
      </div>
      <div id="lic-results"><div class="page-loading"><div class="spinner"></div></div></div>
      <div class="card-footer" id="lic-pagination"></div>
    </div>`;

  const $ = (sel) => panel.querySelector(sel);

  async function load() {
    const results = $('#lic-results');
    results.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

    const params = new URLSearchParams({ page: String(state.page), limit: String(state.limit) });
    if (state.q)      params.set('q', state.q);
    if (state.estado) params.set('estado', state.estado);

    try {
      const body = await api.get(`/api/licitaciones?${params.toString()}`);
      const rows = body.data ?? [];
      $('#lic-total').textContent = `${body.total ?? rows.length} licitación(es)`;

      if (rows.length === 0) {
        results.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">📑</div>
            <h4>Sin licitaciones</h4>
            <p>No hay licitaciones que coincidan con el filtro.</p>
          </div>`;
        $('#lic-pagination').innerHTML = '';
        return;
      }

      results.innerHTML = `
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>Código</th><th>Nombre</th><th>Convocante</th>
                <th>Estado</th><th>Cotiz.</th><th>Límite</th><th>Responsable</th><th></th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((l) => `
                <tr>
                  <td class="fw-600">${escHtml(l.codigo)}</td>
                  <td>${escHtml(l.nombre)}</td>
                  <td>${escHtml(l.cliente_nombre ?? '—')}</td>
                  <td>${licitacionBadgeHtml(l.estado)}</td>
                  <td style="text-align:center;">${l.total_cotizaciones ?? 0}</td>
                  <td>${fmtDate(l.fecha_limite)}</td>
                  <td>${escHtml(l.responsable_nombre ?? '—')}</td>
                  <td><button class="btn btn-ghost btn-sm" data-lic-view="${l.id}">Ver</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;

      results.querySelectorAll('[data-lic-view]').forEach((btn) => {
        btn.addEventListener('click', () => openDetail(btn.dataset.licView));
      });

      renderPagination(body.totalPages ?? 1);
    } catch (err) {
      results.innerHTML = `<div class="empty-state"><p>Error: ${escHtml(err.data?.message || err.message)}</p></div>`;
      $('#lic-pagination').innerHTML = '';
    }
  }

  function renderPagination(totalPages) {
    const foot = $('#lic-pagination');
    if (totalPages <= 1) { foot.innerHTML = ''; return; }
    foot.innerHTML = `
      <button class="btn btn-ghost btn-sm" id="lic-prev" ${state.page <= 1 ? 'disabled' : ''}>‹ Anterior</button>
      <span class="text-sm" style="margin:0 .75rem;">Página ${state.page} de ${totalPages}</span>
      <button class="btn btn-ghost btn-sm" id="lic-next" ${state.page >= totalPages ? 'disabled' : ''}>Siguiente ›</button>`;
    $('#lic-prev')?.addEventListener('click', () => { if (state.page > 1)          { state.page--; load(); } });
    $('#lic-next')?.addEventListener('click', () => { if (state.page < totalPages) { state.page++; load(); } });
  }

  // ── Detail sub-modal ───────────────────────────────────────────────────────
  // Vive en licitacion/detailModal.js. Le pasamos `load` para que el listado
  // se refresque cuando el detalle cambia algo (transicion, gasto, documento).

  const openDetail = (id) => openLicitacionDetail(id, {
    onChanged: load,
    onCreateCotizacion,
  });

  // ── Wire static controls ────────────────────────────────────────────────────
  if (canCreate) {
    $('#lic-new')?.addEventListener('click', () => {
      openLicitacionModal({ mode: 'create', licitacion: null, mountTarget: document.body, onSaved: () => load() });
    });
  }
  $('#lic-search-btn').addEventListener('click', () => {
    state.q = $('#lic-search').value.trim();
    state.estado = $('#lic-estado').value;
    state.page = 1;
    load();
  });
  $('#lic-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { state.q = e.target.value.trim(); state.estado = $('#lic-estado').value; state.page = 1; load(); }
  });
  $('#lic-estado').addEventListener('change', () => { state.estado = $('#lic-estado').value; state.page = 1; load(); });

  await load();
}
