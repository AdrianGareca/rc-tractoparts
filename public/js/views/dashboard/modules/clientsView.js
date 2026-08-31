// =============================================================================
// public/js/views/dashboard/modules/clientsView.js
// "Gestión de clientes" tab — paginated list of ALL clients (active and
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
import { tableSkeleton } from '../../../shared/skeleton.js';
import { ETIQUETAS_ALFABETICAS } from '../../../shared/pagination.js';
import { createListSection } from '../../../shared/listSection.js';

// ---------------------------------------------------------------------------
// mountClientsTab
// @param {HTMLElement} panel — tab panel (or modal body) to render into
// ---------------------------------------------------------------------------
/** Buscador + contenedor de resultados. Función PURA. */
function buildShellHtml() {
  return `
    <div class="card">
      <div class="card-header flex-wrap gap-2">
        <h3>Gestión de clientes</h3>
        <div class="flex gap-1 items-center">
          <span class="text-muted text-sm" id="clients-total"></span>
          <button class="btn btn-primary btn-sm" id="clients-new">+ Nuevo cliente</button>
        </div>
      </div>
      <div class="filter-bar">
        <div class="form-group">
          <label class="form-label">Buscar</label>
          <input class="form-control fc-wide" type="search" id="clients-search"
                 placeholder="Razón social o NIT…" />
        </div>
        <button class="btn btn-ghost btn-sm filter-action" id="clients-search-btn">Buscar</button>
      </div>
      <div class="card-toolbar" id="clients-pagination"></div>
      <div id="clients-results">${tableSkeleton({ columnas: 7, etiqueta: 'Cargando clientes' })}</div>
    </div>`;
}

/** Una fila de la tabla. Pura. */
function buildRowHtml(c) {
  return `
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
                </tr>`;
}

export async function mountClientsTab(panel) {
  const state = { page: 1, limit: 20, q: '' };

  // ── 1. Paint the static shell ONCE ───────────────────────────────────────
  panel.innerHTML = buildShellHtml();

  const $ = (sel) => panel.querySelector(sel);

  // El ciclo cargando/vacio/error/paginar es identico en los cuatro paneles
  // y vive en shared/listSection.js. Lo propio de cada uno (columnas,
  // filtros, acciones) se queda aca, que es donde se lee mejor.
  const seccion = createListSection({
    resultsEl:    $('#clients-results'),
    paginationEl: $('#clients-pagination'),
    columnas:     6,
    etiqueta:     'Cargando clientes',
    etiquetas:    ETIQUETAS_ALFABETICAS,
    onPageChange: ({ page, limit }) => { state.page = page; state.limit = limit; load(); },
  });

  // ── 2. Fetch + render, reading the current filter/page state ────────────
  async function load() {
    seccion.loading();

    const params = new URLSearchParams({ page: String(state.page), limit: String(state.limit) });
    if (state.q) params.set('q', state.q);

    try {
      // seccion.pedir ordena las llegadas: si el usuario busco «san», corrigio
      // a «sanchez» y la primera consulta (mas amplia) tarda mas, la tabla
      // terminaba mostrando los resultados de «san» con el campo diciendo
      // «sanchez» — y la paginacion montada con el total equivocado.
      const { vigente, valor: data } = await seccion.pedir(() =>
        api.get(`/api/clientes/all?${params.toString()}`));
      if (!vigente) return;

      const rows = data.data ?? [];
      $('#clients-total').textContent = `${data.pagination?.totalRecords ?? rows.length} cliente(s)`;

      if (rows.length === 0) {
        seccion.empty({
          icono:  'clientes',
          titulo: 'Sin resultados',
          texto:  'No hay clientes que coincidan con la búsqueda.',
        });
        seccion.clearPagination();
        return;
      }

      seccion.content(`
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>Razón social</th><th>NIT</th><th>Contacto</th>
                <th>Email</th><th>Teléfono</th><th>Estado</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(buildRowHtml).join('')}
            </tbody>
          </table>
        </div>`);

      // "Editar" — reuses the shared Nuevo/Editar Cliente sub-modal.
      seccion.el.querySelectorAll('[data-client-edit]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const client = rows.find((c) => String(c.id) === btn.dataset.clientEdit);
          if (!client) return;
          openClienteModal({ mode: 'edit', client, onSaved: load, mountTarget: document.body });
        });
      });

      // "Desactivar" — soft delete (DELETE /api/clientes/:id), confirmed first.
      seccion.el.querySelectorAll('[data-client-deact]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const client = rows.find((c) => String(c.id) === btn.dataset.clientDeact);
          if (!client) return;

          const ok = await confirmDialog({
            title:        'Confirmar desactivación',
            message:      `¿Desactivar al cliente "${escHtml(client.razon_social)}"? ` +
                          `Podrá reactivarse luego editándolo.`,
            confirmLabel: 'Sí, desactivar',
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
      seccion.el.querySelectorAll('[data-client-act]').forEach((btn) => {
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

      seccion.paginate(data.pagination);
    } catch (err) {
      seccion.error(err);
    }
  }

  // El control lo dibuja el módulo compartido (public/js/shared/pagination.js):
  // los cuatro paneles tenían esta función copiada, idéntica salvo el prefijo.
  // destroyPagination quita los listeners de document del menú anterior antes
  // de montar el nuevo; sin eso cada recarga apilaría un par más.

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

  // Devuelve la limpieza del panel. Sin esto, cada visita a la pestana
  // dejaba DOS escuchas huerfanas en document (las del menu de paginacion),
  // cada una reteniendo por closure una tabla que ya no esta en el DOM. A
  // las treinta idas y vueltas hay sesenta manejadores corriendo en cada
  // clic de la pagina y treinta subarboles que el recolector no puede
  // liberar: la pestana se va poniendo lenta y no se recupera hasta
  // recargar. Es acumulativo en sesiones largas, que es el uso real.
  return () => seccion.destroy();
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
          <div class="modal-actions">
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
