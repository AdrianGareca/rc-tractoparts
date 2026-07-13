// =============================================================================
// public/js/views/dashboard/modules/clientsView.js
// "Gestión de Clientes" tab — paginated list of ALL clients (active and
// inactive), with search, create, edit, deactivate, and reactivate. Shared by
// every dashboard strategy (Ejecutivo, Jefe, Administracion) so the entire
// flow lives here once instead of being duplicated per strategy.
//
// Reads from GET /api/clientes/all (src/controllers/clientController.js) —
// distinct from GET /api/clientes, which is the 20-result autocomplete used
// by the quotation form's inline client search.
//
// Exports:
//   mountClientsTab(panel) — renders the search bar + table + pagination and
//                             wires all interactions. Self-contained.
// =============================================================================

import api, { showToast } from '../../../services/apiClient.js';
import { escHtml }         from '../helpers.js';
import { openClienteModal } from './clientModal.js';

// ---------------------------------------------------------------------------
// mountClientsTab
// @param {HTMLElement} panel — tab panel (or modal body) to render into
// ---------------------------------------------------------------------------
export async function mountClientsTab(panel) {
  const state = { page: 1, limit: 20, q: '' };

  // ── 1. Paint the static shell ONCE ───────────────────────────────────────
  panel.innerHTML = `
    <div class="card">
      <div class="card-header" style="flex-wrap:wrap;gap:.75rem;">
        <h3>🏢 Gestión de Clientes</h3>
        <div style="display:flex;gap:.5rem;align-items:center;">
          <span class="text-muted text-sm" id="clients-total"></span>
          <button class="btn btn-primary btn-sm" id="clients-new">+ Nuevo Cliente</button>
        </div>
      </div>
      <div class="filter-bar">
        <div class="form-group">
          <label class="form-label">Buscar</label>
          <input class="form-control" type="search" id="clients-search"
                 placeholder="Razón social o NIT…" style="min-width:220px;" />
        </div>
        <button class="btn btn-ghost btn-sm" id="clients-search-btn" style="align-self:flex-end;">Buscar</button>
      </div>
      <div id="clients-results"><div class="page-loading"><div class="spinner"></div></div></div>
      <div class="card-footer" id="clients-pagination"></div>
    </div>`;

  const $ = (sel) => panel.querySelector(sel);

  // ── 2. Fetch + render, reading the current filter/page state ────────────
  async function load() {
    const results = $('#clients-results');
    results.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

    const params = new URLSearchParams({ page: String(state.page), limit: String(state.limit) });
    if (state.q) params.set('q', state.q);

    try {
      const data = await api.get(`/api/clientes/all?${params.toString()}`);
      const rows = data.data ?? [];
      $('#clients-total').textContent = `${data.pagination?.totalRecords ?? rows.length} cliente(s)`;

      if (rows.length === 0) {
        results.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">🏢</div>
            <h4>Sin resultados</h4>
            <p>No hay clientes que coincidan con la búsqueda.</p>
          </div>`;
        $('#clients-pagination').innerHTML = '';
        return;
      }

      results.innerHTML = `
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>Razón Social</th><th>NIT</th><th>Contacto</th>
                <th>Email</th><th>Teléfono</th><th>Estado</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((c) => `
                <tr>
                  <td class="fw-600">${escHtml(c.razon_social)}</td>
                  <td>${c.nit      ? escHtml(c.nit)      : '—'}</td>
                  <td>${c.contacto ? escHtml(c.contacto) : '—'}</td>
                  <td>${c.email    ? escHtml(c.email)    : '—'}</td>
                  <td>${c.telefono ? escHtml(c.telefono) : '—'}</td>
                  <td>
                    <span class="badge ${c.activo ? 'badge-active' : 'badge-inactive'}">
                      ${c.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td>
                    <div class="table-actions">
                      <button class="btn btn-ghost btn-sm" data-client-edit="${c.id}">Editar</button>
                      ${c.activo
                        ? `<button class="btn btn-danger btn-sm" data-client-deact="${c.id}">Desactivar</button>`
                        : `<button class="btn btn-success btn-sm" data-client-act="${c.id}">Activar</button>`}
                    </div>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;

      // "Editar" — reuses the shared Nuevo/Editar Cliente sub-modal.
      results.querySelectorAll('[data-client-edit]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const client = rows.find((c) => String(c.id) === btn.dataset.clientEdit);
          if (!client) return;
          openClienteModal({ mode: 'edit', client, onSaved: load, mountTarget: document.body });
        });
      });

      // "Desactivar" — soft delete (DELETE /api/clientes/:id), confirmed first.
      results.querySelectorAll('[data-client-deact]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const client = rows.find((c) => String(c.id) === btn.dataset.clientDeact);
          if (!client) return;

          const ok = await confirmDialog({
            title:        'Confirmar Desactivación',
            message:      `¿Desactivar al cliente "${escHtml(client.razon_social)}"? ` +
                          `Podrá reactivarse luego editándolo.`,
            confirmLabel: 'Sí, Desactivar',
            confirmClass: 'btn-danger',
          });
          if (!ok) return;

          try {
            await api.delete(`/api/clientes/${client.id}`);
            showToast(`Cliente "${client.razon_social}" desactivado.`, 'success');
            load();
          } catch (err) {
            showToast(err.data?.message || err.message || 'Error al desactivar el cliente.', 'error');
          }
        });
      });

      // "Activar" — reactivation goes through the general update endpoint
      // (mirrors UserController.updateUser: reactivation is just a field on
      // the general update, not a dedicated endpoint).
      results.querySelectorAll('[data-client-act]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const client = rows.find((c) => String(c.id) === btn.dataset.clientAct);
          if (!client) return;

          try {
            await api.put(`/api/clientes/${client.id}`, {
              razon_social: client.razon_social,
              nit:          client.nit,
              contacto:     client.contacto,
              email:        client.email,
              telefono:     client.telefono,
              activo:       true,
            });
            showToast(`Cliente "${client.razon_social}" reactivado.`, 'success');
            load();
          } catch (err) {
            showToast(err.data?.message || err.message || 'Error al reactivar el cliente.', 'error');
          }
        });
      });

      renderPagination(data.pagination?.totalPages ?? 1);
    } catch (err) {
      results.innerHTML = `<div class="empty-state"><p>Error: ${escHtml(err.data?.message || err.message)}</p></div>`;
      $('#clients-pagination').innerHTML = '';
    }
  }

  function renderPagination(totalPages) {
    const foot = $('#clients-pagination');
    if (totalPages <= 1) { foot.innerHTML = ''; return; }
    foot.innerHTML = `
      <button class="btn btn-ghost btn-sm" id="clients-prev" ${state.page <= 1 ? 'disabled' : ''}>‹ Anterior</button>
      <span class="text-sm" style="margin:0 .75rem;">Página ${state.page} de ${totalPages}</span>
      <button class="btn btn-ghost btn-sm" id="clients-next" ${state.page >= totalPages ? 'disabled' : ''}>Siguiente ›</button>`;
    $('#clients-prev')?.addEventListener('click', () => { if (state.page > 1)          { state.page--; load(); } });
    $('#clients-next')?.addEventListener('click', () => { if (state.page < totalPages) { state.page++; load(); } });
  }

  // ── 3. Wire the static controls ──────────────────────────────────────────
  $('#clients-new').addEventListener('click', () => {
    openClienteModal({ mode: 'create', client: null, onSaved: load, mountTarget: document.body });
  });

  $('#clients-search-btn').addEventListener('click', () => {
    state.q = $('#clients-search').value.trim();
    state.page = 1;
    load();
  });
  $('#clients-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { state.q = e.target.value.trim(); state.page = 1; load(); }
  });

  // ── 4. Initial load ───────────────────────────────────────────────────────
  await load();
}

// ---------------------------------------------------------------------------
// confirmDialog — tiny reusable confirm overlay (reuses the app's
// .sub-modal-overlay component). This standalone module has no access to
// dashboardView.js's local UI.openModal helper, so it renders its own.
// `message` is trusted HTML — callers must escHtml() any interpolated
// user-controlled text (e.g. a client name) before building the string.
// ---------------------------------------------------------------------------
function confirmDialog({ title, message, confirmLabel, confirmClass = 'btn-danger' }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'sub-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `
      <div class="sub-modal">
        <div class="sub-modal-header">
          <h4>${escHtml(title)}</h4>
          <button type="button" class="btn-icon sub-modal-close" id="cd-close" aria-label="Cerrar">✕</button>
        </div>
        <div class="sub-modal-body">
          <p>${message}</p>
          <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:1.25rem;">
            <button type="button" class="btn btn-ghost" id="cd-cancel">Cancelar</button>
            <button type="button" class="btn ${confirmClass}" id="cd-confirm">${escHtml(confirmLabel)}</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const close = (result) => { overlay.remove(); resolve(result); };
    overlay.querySelector('#cd-close')?.addEventListener('click', () => close(false));
    overlay.querySelector('#cd-cancel')?.addEventListener('click', () => close(false));
    overlay.querySelector('#cd-confirm')?.addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
  });
}
