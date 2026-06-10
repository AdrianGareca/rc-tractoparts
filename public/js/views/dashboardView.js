// =============================================================================
// public/js/views/dashboardView.js
// Main Dashboard Controller
//
// BEHAVIORAL PATTERN: STRATEGY
//   Role-based rendering is delegated to concrete Strategy objects.
//   The DashboardController selects a strategy at startup and stores it;
//   all subsequent renders/refreshes go through the strategy interface.
//
//     DashboardStrategy  (abstract interface)
//       ├─ ExecutiveStrategy  — Ejecutivo / Administracion
//       │    • Summary stats, own quotation table, "Nueva Cotización" action
//       └─ ManagerStrategy   — Jefe
//            • Global overview, pending-approval queue, all quotations,
//              User CRUD panel, Audit Logs workspace
//
// BEHAVIORAL PATTERN: COMMAND
//   Critical mutations are encapsulated as Command objects with a single
//   execute() method. The CommandInvoker runs them with loading-state
//   management and toast feedback, decoupling the UI trigger from the action.
//
//     Command (abstract)
//       ├─ ApproveQuotationCommand  — POST /:id/aprobar
//       ├─ ChangeStatusCommand      — PUT  /:id/estado
//       ├─ DeactivateUserCommand    — DELETE /api/usuarios/:id
//       └─ CreateUserCommand        — POST   /api/usuarios
// =============================================================================

import AuthSession           from '../services/authSession.js';
import api, { showToast }   from '../services/apiClient.js';
import { mountQuotationForm } from './quotationForm.js';

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATE_BADGE = {
  'Borrador':              'badge-borrador',
  'Pendiente':             'badge-pendiente',
  'En revision':           'badge-en-revision',
  'Aprobada internamente': 'badge-aprobada',
  'Enviada al cliente':    'badge-enviada',
  'Aceptada':              'badge-aceptada',
  'Rechazada':             'badge-rechazada',
  'Archivada':             'badge-archivada',
};

const ROLE_BADGE = {
  'Jefe':           'badge-role-jefe',
  'Ejecutivo':      'badge-role-ejecutivo',
  'Administracion': 'badge-role-admin',
};

const STAT_COLOR = {
  'Pendiente':             '#F59E0B',
  'En revision':           '#F97316',
  'Aprobada internamente': '#10B981',
  'Enviada al cliente':    '#3B82F6',
  'Aceptada':              '#8B5CF6',
  'Rechazada':             '#EF4444',
};

function badgeHtml(estado) {
  const cls = STATE_BADGE[estado] ?? 'badge-borrador';
  return `<span class="badge ${cls}">${estado}</span>`;
}

function roleBadgeHtml(rol) {
  const cls = ROLE_BADGE[rol] ?? '';
  return `<span class="badge ${cls}">${rol}</span>`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return iso.slice(0, 10);
}

function fmtAmount(n, currency = 'USD') {
  if (n == null) return '—';
  return `${currency} ${Number(n).toFixed(2)}`;
}

// =============================================================================
// COMMAND PATTERN — Abstract base
// =============================================================================
class Command {
  /** @returns {Promise<any>} */
  async execute() {
    throw new Error('Command.execute() must be implemented by subclass.');
  }
}

// ── Concrete Commands ─────────────────────────────────────────────────────────

/** POST /api/cotizaciones/:id/aprobar  — Approve or reject a quotation */
class ApproveQuotationCommand extends Command {
  #id; #aprobado; #obs;
  constructor(id, aprobado, obs = '') {
    super();
    this.#id      = id;
    this.#aprobado= aprobado;
    this.#obs     = obs;
  }
  async execute() {
    return api.post(`/api/cotizaciones/${this.#id}/aprobar`, {
      aprobado:      this.#aprobado,
      obs_aprobacion:this.#obs,
    });
  }
}

/** PUT /api/cotizaciones/:id/estado — Change quotation status */
class ChangeStatusCommand extends Command {
  #id; #newStatus; #obs;
  constructor(id, newStatus, obs = '') {
    super();
    this.#id        = id;
    this.#newStatus = newStatus;
    this.#obs       = obs;
  }
  async execute() {
    return api.put(`/api/cotizaciones/${this.#id}/estado`, {
      nuevo_estado: this.#newStatus,
      observacion:  this.#obs,
    });
  }
}

/** DELETE /api/usuarios/:id — Soft-deactivate a user */
class DeactivateUserCommand extends Command {
  #id;
  constructor(id) { super(); this.#id = id; }
  async execute() { return api.delete(`/api/usuarios/${this.#id}`); }
}

/** POST /api/usuarios — Create a new user */
class CreateUserCommand extends Command {
  #data;
  constructor(data) { super(); this.#data = data; }
  async execute() { return api.post('/api/usuarios', this.#data); }
}

/** PUT /api/usuarios/:id — Update a user record */
class UpdateUserCommand extends Command {
  #id; #data;
  constructor(id, data) { super(); this.#id = id; this.#data = data; }
  async execute() { return api.put(`/api/usuarios/${this.#id}`, this.#data); }
}

// ── Command Invoker ───────────────────────────────────────────────────────────

/**
 * CommandInvoker
 * Executes a Command with:
 *   • Optional button loading state (disabled + spinner text)
 *   • Automatic toast feedback on success/failure
 */
const CommandInvoker = {
  async run(command, { btn, successMsg, onSuccess, onError } = {}) {
    const originalText = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = '…'; }

    try {
      const result = await command.execute();
      showToast(successMsg || 'Acción completada con éxito.', 'success');
      if (onSuccess) onSuccess(result);
    } catch (err) {
      const msg = err.data?.message || err.message || 'Error al ejecutar la acción.';
      showToast(msg, 'error');
      if (onError) onError(err);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
  },
};

// =============================================================================
// STRATEGY PATTERN — Abstract interface
// =============================================================================
class DashboardStrategy {
  /** @param {HTMLElement} container */
  // eslint-disable-next-line no-unused-vars
  async render(container) {
    throw new Error('DashboardStrategy.render() must be implemented.');
  }

  /** Called after a mutation to reload the current view */
  async refresh() {}
}

// =============================================================================
// STRATEGY: ExecutiveStrategy (Ejecutivo / Administracion roles)
// =============================================================================
class ExecutiveStrategy extends DashboardStrategy {
  #container;
  #user;
  #page    = 1;
  #sortBy  = 'creado_en';
  #sortOrd = 'DESC';

  constructor(user) { super(); this.#user = user; }

  async render(container) {
    this.#container = container;

    container.innerHTML = `
      <div id="stats-section" class="stats-grid"></div>

      <div class="card">
        <div class="card-header">
          <h3>Mis Cotizaciones</h3>
          <button class="btn btn-primary btn-sm" id="btn-new-quotation">+ Nueva Cotización</button>
        </div>

        <!-- Filter bar -->
        <div class="filter-bar">
          <div class="form-group">
            <label class="form-label">Estado</label>
            <select class="form-control" id="filter-estado" style="min-width:140px;">
              <option value="">Todos</option>
              <option>Borrador</option><option>Pendiente</option>
              <option>En revision</option><option>Aprobada internamente</option>
              <option>Enviada al cliente</option><option>Aceptada</option>
              <option>Rechazada</option><option>Archivada</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Buscar</label>
            <input class="form-control" type="search" id="filter-q" placeholder="Correlativo, cliente…" style="min-width:180px;" />
          </div>
          <button class="btn btn-ghost btn-sm" id="btn-filter-apply" style="align-self:flex-end;">Filtrar</button>
        </div>

        <div id="quotations-section"></div>

        <div class="card-footer" id="pagination-footer"></div>
      </div>
    `;

    document.getElementById('btn-new-quotation')?.addEventListener('click', () => {
      UI.openModal('Nueva Cotización', (body) => {
        mountQuotationForm(body, {
          onSuccess: (q) => {
            UI.closeModal();
            showToast(`Cotización ${q?.numero_correlativo ?? ''} creada exitosamente.`, 'success');
            this.refresh();
          },
          onCancel: () => UI.closeModal(),
        });
      });
    });

    document.getElementById('btn-filter-apply')?.addEventListener('click', () => {
      this.#page = 1;
      this._loadQuotations();
    });

    document.getElementById('filter-q')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { this.#page = 1; this._loadQuotations(); }
    });

    await Promise.all([this._loadSummary(), this._loadQuotations()]);
  }

  async refresh() {
    if (this.#container) await Promise.all([this._loadSummary(), this._loadQuotations()]);
  }

  async _loadSummary() {
    try {
      const data = await api.get('/api/cotizaciones/resumen');
      const totals = data.data || {};
      const statsEl = document.getElementById('stats-section');
      if (!statsEl) return;

      const highlighted = ['Pendiente', 'En revision', 'Aprobada internamente', 'Aceptada'];
      statsEl.innerHTML = [
        { label: 'Total',      value: data.grandTotal ?? 0, color: '#3B82F6' },
        ...highlighted.map(s => ({
          label: s, value: totals[s] ?? 0, color: STAT_COLOR[s] ?? '#6B7280'
        })),
      ].map(s => `
        <div class="stat-card" style="--stat-accent:${s.color}">
          <div class="stat-card-value">${s.value}</div>
          <div class="stat-card-label">${s.label}</div>
        </div>
      `).join('');
    } catch (_) { /* non-fatal */ }
  }

  async _loadQuotations() {
    const section = document.getElementById('quotations-section');
    if (!section) return;

    section.innerHTML = '<div class="page-loading"><div class="spinner"></div><span>Cargando…</span></div>';

    const estado = document.getElementById('filter-estado')?.value ?? '';
    const q      = document.getElementById('filter-q')?.value.trim() ?? '';

    const params = new URLSearchParams({
      page: this.#page, limit: 15,
      sort_by: this.#sortBy, sort_order: this.#sortOrd,
      ...(estado && { estado }),
      ...(q && { q }),
    });

    try {
      const data = await api.get(`/api/cotizaciones?${params}`);
      const rows = data.data ?? [];

      if (rows.length === 0) {
        section.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">📋</div>
            <h4>Sin cotizaciones</h4>
            <p>No se encontraron cotizaciones con los filtros aplicados.</p>
          </div>`;
        document.getElementById('pagination-footer').innerHTML = '';
        return;
      }

      section.innerHTML = `
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>N° Correlativo</th><th>Cliente</th>
                <th>Fecha</th><th>Monto</th>
                <th>Estado</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => `
                <tr>
                  <td class="fw-600">${r.numero_correlativo}</td>
                  <td>${r.cliente_nombre ?? r.id_cliente}</td>
                  <td>${fmtDate(r.fecha_emision)}</td>
                  <td>${fmtAmount(r.monto_total, r.moneda)}</td>
                  <td>${badgeHtml(r.estado)}</td>
                  <td>
                    <div class="table-actions">
                      <button class="btn btn-ghost btn-sm" data-action="view" data-id="${r.id}">Ver</button>
                      <button class="btn btn-ghost btn-sm" data-action="status" data-id="${r.id}" data-estado="${r.estado}">Estado</button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>`;

      // Row action listeners
      section.querySelectorAll('[data-action="view"]').forEach(btn => {
        btn.addEventListener('click', () => this._viewQuotation(btn.dataset.id));
      });
      section.querySelectorAll('[data-action="status"]').forEach(btn => {
        btn.addEventListener('click', () =>
          this._changeStatus(btn.dataset.id, btn.dataset.estado, btn));
      });

      // Pagination
      const p = data.pagination;
      document.getElementById('pagination-footer').innerHTML = p ? `
        <span class="pagination-info">Página ${p.page} de ${p.totalPages} · ${p.totalRecords} registros</span>
        <button class="btn btn-ghost btn-sm" ${!p.hasPrev ? 'disabled' : ''} data-pg="${p.page - 1}">‹ Ant.</button>
        <button class="btn btn-ghost btn-sm" ${!p.hasNext ? 'disabled' : ''} data-pg="${p.page + 1}">Sig. ›</button>
      ` : '';

      document.getElementById('pagination-footer')?.querySelectorAll('[data-pg]').forEach(btn => {
        btn.addEventListener('click', () => { this.#page = parseInt(btn.dataset.pg, 10); this._loadQuotations(); });
      });

    } catch (err) {
      section.innerHTML = `<div class="empty-state"><p>Error cargando cotizaciones: ${err.message}</p></div>`;
    }
  }

  async _viewQuotation(id) {
    try {
      const data = await api.get(`/api/cotizaciones/${id}`);
      const q    = data.data;
      UI.openModal(`Cotización ${q.numero_correlativo}`, (body) => {
        body.innerHTML = `
          <div class="form-row">
            <div><span class="form-label">Estado</span><p>${badgeHtml(q.estado)}</p></div>
            <div><span class="form-label">Cliente ID</span><p>${q.id_cliente}</p></div>
            <div><span class="form-label">Fecha Emisión</span><p>${fmtDate(q.fecha_emision)}</p></div>
            <div><span class="form-label">Monto Total</span><p>${fmtAmount(q.monto_total, q.moneda)}</p></div>
          </div>
          <div class="form-group mt-2">
            <span class="form-label">Descripción</span>
            <p style="color:var(--text-secondary);font-size:.9rem;">${q.descripcion}</p>
          </div>
          ${q.pdf_ruta ? `
          <div class="mt-2">
            <a class="btn btn-ghost btn-sm" href="/api/cotizaciones/${id}/pdf" target="_blank">
              📄 Descargar PDF
            </a>
          </div>` : ''}
        `;
      });
    } catch (err) {
      showToast(`No se pudo cargar la cotización: ${err.message}`, 'error');
    }
  }

  _changeStatus(id, currentStatus, triggerBtn) {
    const VALID_STATES = [
      'Borrador','Pendiente','En revision',
      'Aprobada internamente','Enviada al cliente',
      'Aceptada','Rechazada','Archivada',
    ];

    UI.openModal('Cambiar Estado', (body) => {
      body.innerHTML = `
        <p style="color:var(--text-secondary);margin-bottom:1rem;">
          Estado actual: ${badgeHtml(currentStatus)}
        </p>
        <div class="form-group">
          <label class="form-label" for="new-status">Nuevo Estado</label>
          <select class="form-control" id="new-status">
            ${VALID_STATES.map(s => `<option value="${s}" ${s === currentStatus ? 'disabled' : ''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="status-obs">Observación (opcional)</label>
          <textarea class="form-control" id="status-obs" rows="2"></textarea>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:1rem;">
          <button class="btn btn-ghost" id="cancel-status">Cancelar</button>
          <button class="btn btn-primary" id="confirm-status">Actualizar</button>
        </div>
      `;

      body.querySelector('#cancel-status')?.addEventListener('click', UI.closeModal);
      body.querySelector('#confirm-status')?.addEventListener('click', () => {
        const newStatus = body.querySelector('#new-status')?.value;
        const obs       = body.querySelector('#status-obs')?.value.trim() ?? '';
        const btn       = body.querySelector('#confirm-status');
        CommandInvoker.run(new ChangeStatusCommand(id, newStatus, obs), {
          btn,
          successMsg: `Estado actualizado a "${newStatus}".`,
          onSuccess: () => { UI.closeModal(); this.refresh(); },
        });
      });
    });
  }
}

// =============================================================================
// STRATEGY: ManagerStrategy (Jefe role)
// =============================================================================
class ManagerStrategy extends DashboardStrategy {
  #container;
  #user;
  #activeTab = 'approvals';

  constructor(user) { super(); this.#user = user; }

  async render(container) {
    this.#container = container;

    container.innerHTML = `
      <div class="tab-bar" id="manager-tabs">
        <button class="tab-btn active" data-tab="approvals">Cola de Aprobación</button>
        <button class="tab-btn" data-tab="quotations">Todas las Cotizaciones</button>
        <button class="tab-btn" data-tab="users">Gestión de Usuarios</button>
        <button class="tab-btn" data-tab="audit">Registros de Auditoría</button>
      </div>
      <div id="manager-panel"></div>
    `;

    container.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.#activeTab = btn.dataset.tab;
        this._renderPanel(btn.dataset.tab);
      });
    });

    await this._renderPanel(this.#activeTab);
  }

  async refresh() {
    if (this.#container) await this._renderPanel(this.#activeTab);
  }

  async _renderPanel(tab) {
    const panel = document.getElementById('manager-panel');
    if (!panel) return;

    switch (tab) {
      case 'approvals':  await this._renderApprovals(panel);  break;
      case 'quotations': await this._renderAllQuotations(panel); break;
      case 'users':      await this._renderUsers(panel);      break;
      case 'audit':      await this._renderAuditLogs(panel);  break;
    }
  }

  // ── Tab: Approval queue ────────────────────────────────────────────────────

  async _renderApprovals(panel) {
    panel.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';
    try {
      const data = await api.get('/api/cotizaciones/pendientes-aprobacion');
      const rows = data.data ?? [];

      if (rows.length === 0) {
        panel.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">✅</div>
            <h4>Cola vacía</h4>
            <p>No hay cotizaciones pendientes de aprobación.</p>
          </div>`;
        return;
      }

      panel.innerHTML = `
        <div class="card">
          <div class="card-header">
            <h3>Cotizaciones en Revisión (${rows.length})</h3>
          </div>
          <div class="table-wrapper">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Correlativo</th><th>Ejecutivo</th>
                  <th>Cliente</th><th>Monto</th><th>Fecha</th><th>Decisión</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(r => `
                  <tr>
                    <td class="fw-600">${r.numero_correlativo}</td>
                    <td>${r.ejecutivo_nombre ?? '—'}</td>
                    <td>${r.cliente_nombre ?? r.id_cliente}</td>
                    <td>${fmtAmount(r.monto_total, r.moneda)}</td>
                    <td>${fmtDate(r.fecha_emision)}</td>
                    <td>
                      <div class="table-actions">
                        <button class="btn btn-success btn-sm"
                                data-approve="true"  data-id="${r.id}">✓ Aprobar</button>
                        <button class="btn btn-danger  btn-sm"
                                data-approve="false" data-id="${r.id}">✗ Rechazar</button>
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>`;

      panel.querySelectorAll('[data-approve]').forEach(btn => {
        btn.addEventListener('click', () =>
          this._showApproveDialog(btn.dataset.id, btn.dataset.approve === 'true', btn));
      });

    } catch (err) {
      panel.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
    }
  }

  _showApproveDialog(id, aprobado, _triggerBtn) {
    const title  = aprobado ? 'Aprobar Cotización' : 'Rechazar Cotización';
    const label  = aprobado ? 'Observaciones (opcional)' : 'Justificación del rechazo *';

    UI.openModal(title, (body) => {
      body.innerHTML = `
        <div class="confirm-dialog">
          <h4>${aprobado ? '¿Confirmar aprobación?' : '¿Confirmar rechazo?'}</h4>
          <p>ID de cotización: <strong>#${id}</strong></p>
        </div>
        <div class="form-group">
          <label class="form-label" for="obs-approval">${label}</label>
          <textarea class="form-control" id="obs-approval" rows="3"
                    placeholder="${aprobado ? '' : 'Requerido para rechazar'}"></textarea>
          <span class="field-error" id="err-obs"></span>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:1rem;">
          <button class="btn btn-ghost"  id="cancel-approve">Cancelar</button>
          <button class="btn ${aprobado ? 'btn-success' : 'btn-danger'}" id="confirm-approve">
            ${aprobado ? 'Sí, Aprobar' : 'Sí, Rechazar'}
          </button>
        </div>`;

      body.querySelector('#cancel-approve')?.addEventListener('click', UI.closeModal);
      body.querySelector('#confirm-approve')?.addEventListener('click', () => {
        const obs = body.querySelector('#obs-approval')?.value.trim() ?? '';
        if (!aprobado && !obs) {
          body.querySelector('#err-obs').textContent = 'La justificación es requerida para rechazar.';
          return;
        }
        const confirmBtn = body.querySelector('#confirm-approve');
        CommandInvoker.run(new ApproveQuotationCommand(id, aprobado, obs), {
          btn:        confirmBtn,
          successMsg: aprobado ? 'Cotización aprobada exitosamente.' : 'Cotización rechazada.',
          onSuccess:  () => { UI.closeModal(); this.refresh(); },
        });
      });
    });
  }

  // ── Tab: All quotations ────────────────────────────────────────────────────

  async _renderAllQuotations(panel) {
    panel.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';
    try {
      const data = await api.get('/api/cotizaciones?limit=25&sort_by=creado_en&sort_order=DESC');
      const rows = data.data ?? [];

      if (rows.length === 0) {
        panel.innerHTML = `
          <div class="card">
            <div class="card-header"><h3>Todas las Cotizaciones</h3></div>
            <div class="empty-state">
              <div class="empty-state-icon">📋</div>
              <h4>Sin cotizaciones registradas</h4>
              <p>No hay cotizaciones pendientes en el sistema.</p>
            </div>
          </div>`;
        return;
      }

      panel.innerHTML = `
        <div class="card">
          <div class="card-header">
            <h3>Todas las Cotizaciones</h3>
            <span class="text-muted text-sm">${data.pagination?.totalRecords ?? rows.length} total</span>
          </div>
          <div class="table-wrapper">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Correlativo</th><th>Ejecutivo</th><th>Cliente</th>
                  <th>Monto</th><th>Estado</th><th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(r => `
                  <tr>
                    <td class="fw-600">${r.numero_correlativo}</td>
                    <td>${r.ejecutivo_nombre ?? '—'}</td>
                    <td>${r.cliente_nombre ?? r.id_cliente}</td>
                    <td>${fmtAmount(r.monto_total, r.moneda)}</td>
                    <td>${badgeHtml(r.estado)}</td>
                    <td>${fmtDate(r.fecha_emision)}</td>
                  </tr>`).join('')
                }
              </tbody>
            </table>
          </div>
        </div>`;
    } catch (err) {
      panel.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
    }
  }

  // ── Tab: User Management (CRUD) ───────────────────────────────────────────

  async _renderUsers(panel) {
    panel.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';
    try {
      const data  = await api.get('/api/usuarios');
      const users = data.data ?? [];

      panel.innerHTML = `
        <div class="card">
          <div class="card-header">
            <h3>Gestión de Usuarios</h3>
            <button class="btn btn-primary btn-sm" id="btn-create-user">+ Nuevo Usuario</button>
          </div>
          <div class="table-wrapper">
            <table class="data-table">
              <thead>
                <tr>
                  <th>ID</th><th>Nombre</th><th>Usuario</th>
                  <th>Rol</th><th>Estado</th><th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                ${users.map(u => `
                  <tr>
                    <td>${u.id}</td>
                    <td>${u.nombre_completo}</td>
                    <td class="fw-600">${u.nombre_usuario}</td>
                    <td>${roleBadgeHtml(u.rol)}</td>
                    <td>
                      <span class="badge ${u.activo ? 'badge-active' : 'badge-inactive'}">
                        ${u.activo ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td>
                      <div class="table-actions">
                        <button class="btn btn-ghost btn-sm" data-user-edit="${u.id}"
                                data-nombre="${u.nombre_completo}" data-rol="${u.id_rol}">Editar</button>
                        ${u.activo ? `
                        <button class="btn btn-danger btn-sm" data-user-deact="${u.id}"
                                data-uname="${u.nombre_usuario}">Desactivar</button>` : ''}
                      </div>
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>`;

      panel.querySelector('#btn-create-user')?.addEventListener('click', () =>
        this._showCreateUserModal());

      panel.querySelectorAll('[data-user-edit]').forEach(btn =>
        btn.addEventListener('click', () =>
          this._showEditUserModal(btn.dataset.userEdit, btn.dataset.nombre, btn.dataset.rol)));

      panel.querySelectorAll('[data-user-deact]').forEach(btn =>
        btn.addEventListener('click', () =>
          this._confirmDeactivateUser(btn.dataset.userDeact, btn.dataset.uname)));

    } catch (err) {
      panel.innerHTML = `<div class="empty-state"><p>Error cargando usuarios: ${err.message}</p></div>`;
    }
  }

  _showCreateUserModal() {
    UI.openModal('Crear Nuevo Usuario', (body) => {
      body.innerHTML = `
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="nu-nombre">Nombre Completo *</label>
            <input class="form-control" type="text" id="nu-nombre" />
          </div>
          <div class="form-group">
            <label class="form-label" for="nu-usuario">Nombre de Usuario *</label>
            <input class="form-control" type="text" id="nu-usuario" autocapitalize="none" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="nu-password">Contraseña *</label>
            <input class="form-control" type="password" id="nu-password" />
          </div>
          <div class="form-group">
            <label class="form-label" for="nu-rol">Rol *</label>
            <select class="form-control" id="nu-rol">
              <option value="1">Ejecutivo</option>
              <option value="2">Administracion</option>
              <option value="3">Jefe</option>
            </select>
          </div>
        </div>
        <div class="form-alert" id="nu-alert"></div>
        <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:1rem;">
          <button class="btn btn-ghost" id="nu-cancel">Cancelar</button>
          <button class="btn btn-primary" id="nu-confirm">Crear Usuario</button>
        </div>`;

      body.querySelector('#nu-cancel')?.addEventListener('click', UI.closeModal);
      body.querySelector('#nu-confirm')?.addEventListener('click', () => {
        const nombre   = body.querySelector('#nu-nombre')?.value.trim();
        const usuario  = body.querySelector('#nu-usuario')?.value.trim();
        const password = body.querySelector('#nu-password')?.value;
        const id_rol   = parseInt(body.querySelector('#nu-rol')?.value, 10);
        const alertEl  = body.querySelector('#nu-alert');

        if (!nombre || !usuario || !password) {
          alertEl.textContent = 'Todos los campos marcados con * son requeridos.';
          alertEl.className   = 'form-alert show alert-error';
          return;
        }

        const btn = body.querySelector('#nu-confirm');
        CommandInvoker.run(
          new CreateUserCommand({ nombre_completo: nombre, nombre_usuario: usuario, password, id_rol }),
          {
            btn,
            successMsg: `Usuario "${usuario}" creado exitosamente.`,
            onSuccess:  () => { UI.closeModal(); this._renderUsers(document.getElementById('manager-panel')); },
            onError:    (err) => {
              alertEl.textContent = err.data?.message || err.message;
              alertEl.className   = 'form-alert show alert-error';
            },
          }
        );
      });
    });
  }

  _showEditUserModal(id, nombre, idRol) {
    UI.openModal('Editar Usuario', (body) => {
      body.innerHTML = `
        <div class="form-group">
          <label class="form-label" for="eu-nombre">Nombre Completo</label>
          <input class="form-control" type="text" id="eu-nombre" value="${nombre ?? ''}" />
        </div>
        <div class="form-group">
          <label class="form-label" for="eu-rol">Rol</label>
          <select class="form-control" id="eu-rol">
            <option value="1" ${idRol == 1 ? 'selected' : ''}>Ejecutivo</option>
            <option value="2" ${idRol == 2 ? 'selected' : ''}>Administracion</option>
            <option value="3" ${idRol == 3 ? 'selected' : ''}>Jefe</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="eu-password">Nueva Contraseña (dejar vacío para no cambiar)</label>
          <input class="form-control" type="password" id="eu-password" />
        </div>
        <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:1rem;">
          <button class="btn btn-ghost" id="eu-cancel">Cancelar</button>
          <button class="btn btn-primary" id="eu-confirm">Guardar Cambios</button>
        </div>`;

      body.querySelector('#eu-cancel')?.addEventListener('click', UI.closeModal);
      body.querySelector('#eu-confirm')?.addEventListener('click', () => {
        const updateData = {
          nombre_completo: body.querySelector('#eu-nombre')?.value.trim(),
          id_rol:          parseInt(body.querySelector('#eu-rol')?.value, 10),
        };
        const pw = body.querySelector('#eu-password')?.value;
        if (pw) updateData.password = pw;

        const btn = body.querySelector('#eu-confirm');
        CommandInvoker.run(new UpdateUserCommand(id, updateData), {
          btn,
          successMsg: 'Usuario actualizado exitosamente.',
          onSuccess:  () => { UI.closeModal(); this._renderUsers(document.getElementById('manager-panel')); },
        });
      });
    });
  }

  _confirmDeactivateUser(id, username) {
    UI.openModal('Confirmar Desactivación', (body) => {
      body.innerHTML = `
        <div class="confirm-dialog">
          <h4>¿Desactivar al usuario "${username}"?</h4>
          <p>El usuario no podrá acceder al sistema. Esta acción puede revertirse editando el usuario.</p>
          <div style="display:flex;justify-content:center;gap:.75rem;">
            <button class="btn btn-ghost" id="dc-cancel">Cancelar</button>
            <button class="btn btn-danger" id="dc-confirm">Sí, Desactivar</button>
          </div>
        </div>`;

      body.querySelector('#dc-cancel')?.addEventListener('click', UI.closeModal);
      body.querySelector('#dc-confirm')?.addEventListener('click', () => {
        const btn = body.querySelector('#dc-confirm');
        CommandInvoker.run(new DeactivateUserCommand(id), {
          btn,
          successMsg: `Usuario "${username}" desactivado.`,
          onSuccess:  () => { UI.closeModal(); this._renderUsers(document.getElementById('manager-panel')); },
        });
      });
    });
  }

  // ── Tab: Audit Logs ────────────────────────────────────────────────────────

  async _renderAuditLogs(panel) {
    panel.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

    // Attempt to fetch audit data from the API
    try {
      const data = await api.get('/api/auditoria?limit=50');
      const rows = data.data ?? [];
      panel.innerHTML = this._buildAuditTable(rows);
    } catch (err) {
      // The audit read endpoint is not yet implemented in the API.
      // Show a graceful placeholder pointing to the Swagger docs.
      if (err.status === 404 || err.status === 403) {
        panel.innerHTML = `
          <div class="card">
            <div class="card-header"><h3>Registros de Auditoría</h3></div>
            <div class="card-body">
              <div class="empty-state">
                <div class="empty-state-icon">🔍</div>
                <h4>Endpoint en desarrollo</h4>
                <p>
                  La tabla <code>auditoria</code> está activa en la base de datos.<br>
                  El endpoint <code>GET /api/auditoria</code> está planificado para el Sprint 3.<br>
                  Mientras tanto, puede consultar los registros directamente en la BD o vía
                  <a href="/api-docs" target="_blank">Swagger UI</a>.
                </p>
              </div>
            </div>
          </div>`;
      } else {
        panel.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
      }
    }
  }

  _buildAuditTable(rows) {
    return `
      <div class="card">
        <div class="card-header"><h3>Registros de Auditoría (últimos 50)</h3></div>
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr><th>Fecha</th><th>Usuario</th><th>Tabla</th><th>Acción</th><th>Registro</th><th>IP</th></tr>
            </thead>
            <tbody>
              ${rows.length === 0
                ? `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-muted);">Sin registros.</td></tr>`
                : rows.map(r => `
                  <tr>
                    <td class="text-sm">${fmtDate(r.fecha_hora)}</td>
                    <td>${r.id_usuario ?? '—'}</td>
                    <td>${r.tabla_afectada}</td>
                    <td><code style="font-size:.75rem;color:var(--clr-amber)">${r.accion}</code></td>
                    <td>${r.id_registro_afectado ?? '—'}</td>
                    <td class="text-muted text-xs">${r.ip_cliente}</td>
                  </tr>`).join('')
              }
            </tbody>
          </table>
        </div>
      </div>`;
  }
}

// =============================================================================
// MODAL UI Helper — thin singleton used by both strategies
// =============================================================================
const UI = {
  open: false,

  openModal(title, renderFn) {
    const overlay = document.getElementById('modal-overlay');
    const body    = document.getElementById('modal-body');
    const titleEl = document.getElementById('modal-title');
    if (!overlay || !body || !titleEl) return;

    titleEl.textContent = title;
    body.innerHTML      = '';
    renderFn(body);

    overlay.classList.add('open');
    this.open = true;

    // Close on overlay backdrop click
    overlay.onclick = (e) => { if (e.target === overlay) UI.closeModal(); };
  },

  closeModal() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.classList.remove('open');
    UI.open = false;
  },
};

// =============================================================================
// DASHBOARD CONTROLLER
// Bootstraps the page, selects the Strategy based on the user's role,
// renders sidebar navigation, and wires global interactions.
// =============================================================================
class DashboardController {
  #strategy = null;

  async init() {
    // Guard — redirect to login if session is absent or expired
    if (!AuthSession.isAuthenticated()) {
      window.location.href = '/';
      return;
    }

    const user = AuthSession.getUser();
    const role = AuthSession.getRole();

    // Populate identity elements
    this._populateIdentity(user, role);

    // STRATEGY SELECTION based on role
    this.#strategy = (role === 'Jefe')
      ? new ManagerStrategy(user)
      : new ExecutiveStrategy(user);

    // Render sidebar
    this._renderSidebar(role);

    // Wire modal close button
    document.getElementById('modal-close')?.addEventListener('click', UI.closeModal);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') UI.closeModal(); });

    // Wire logout button
    this._wireLogout();

    // Wire sidebar mobile toggle
    document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
      document.getElementById('sidebar')?.classList.toggle('sidebar-open');
    });

    // Render the main content via the selected Strategy
    const container = document.getElementById('page-content');
    await this.#strategy.render(container);
  }

  _populateIdentity(user, role) {
    const displayName = user?.nombre_completo ?? user?.nombre_usuario ?? '—';
    const initials    = displayName.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();

    // Topbar
    const tbUser  = document.getElementById('topbar-username');
    const tbBadge = document.getElementById('topbar-role-badge');
    if (tbUser)  tbUser.textContent  = displayName;
    if (tbBadge) { tbBadge.textContent = role ?? ''; tbBadge.className = `badge ${ROLE_BADGE[role] ?? ''}`; }

    // Sidebar footer
    const sbAvatar   = document.getElementById('sidebar-avatar');
    const sbUsername = document.getElementById('sidebar-username');
    const sbRole     = document.getElementById('sidebar-role');
    if (sbAvatar)   sbAvatar.textContent   = initials || '?';
    if (sbUsername) sbUsername.textContent = displayName;
    if (sbRole)     sbRole.textContent     = role ?? '—';
  }

  _renderSidebar(role) {
    const nav = document.getElementById('sidebar-nav');
    if (!nav) return;

    let links = '';

    if (role === 'Jefe') {
      links = `
        <span class="sidebar-section-label">Panel Principal</span>
        <button class="sidebar-link active" data-section="approvals">
          <span class="link-icon">⏳</span> Cola de Aprobación
        </button>
        <button class="sidebar-link" data-section="quotations">
          <span class="link-icon">📋</span> Todas las Cotizaciones
        </button>
        <span class="sidebar-section-label">Administración</span>
        <button class="sidebar-link" data-section="users">
          <span class="link-icon">👥</span> Gestión de Usuarios
        </button>
        <button class="sidebar-link" data-section="audit">
          <span class="link-icon">🔍</span> Registros de Auditoría
        </button>
        <span class="sidebar-section-label">Cuenta</span>
        <button class="sidebar-link sidebar-link-logout" id="btn-logout-sidebar">
          <span class="link-icon">🚪</span> Cerrar Sesión
        </button>`;
    } else {
      links = `
        <span class="sidebar-section-label">Mi Trabajo</span>
        <button class="sidebar-link active" data-section="quotations">
          <span class="link-icon">📋</span> Mis Cotizaciones
        </button>
        <button class="sidebar-link btn-new-cot" data-section="new">
          <span class="link-icon">➕</span> Nueva Cotización
        </button>
        <span class="sidebar-section-label">Cuenta</span>
        <button class="sidebar-link sidebar-link-logout" id="btn-logout-sidebar">
          <span class="link-icon">🚪</span> Cerrar Sesión
        </button>`;
    }

    nav.innerHTML = links;

    // Wire sidebar logout button (present for both roles)
    nav.querySelector('#btn-logout-sidebar')?.addEventListener('click', () => {
      AuthSession.clearSession();
      window.location.href = '/';
    });

    // Sidebar link click → update topbar title + call strategy section
    nav.querySelectorAll('.sidebar-link[data-section]').forEach(btn => {
      btn.addEventListener('click', () => {
        // Special shortcut: "new" opens the modal immediately
        if (btn.dataset.section === 'new') {
          UI.openModal('Nueva Cotización', (body) => {
            mountQuotationForm(body, {
              onSuccess: (q) => {
                UI.closeModal();
                showToast(`Cotización ${q?.numero_correlativo ?? ''} creada.`, 'success');
                this.#strategy.refresh();
              },
              onCancel: UI.closeModal,
            });
          });
          return;
        }

        nav.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
        btn.classList.add('active');

        const title = btn.textContent.trim().replace(/^.{1,3}\s/, '');
        const topbarTitle = document.getElementById('topbar-title');
        if (topbarTitle) topbarTitle.textContent = title;

        // ManagerStrategy has _renderPanel; ExecutiveStrategy uses section logic
        if (this.#strategy instanceof ManagerStrategy) {
          this.#strategy._renderPanel(btn.dataset.section);
        }
      });
    });
  }

  _wireLogout() {
    document.getElementById('btn-logout')?.addEventListener('click', async () => {
      try {
        await api.post('/api/auth/logout', {});
      } catch (_) {
        // Even if logout API fails, clear local session
      }
      AuthSession.clearSession();
      window.location.href = '/';
    });
  }
}

// =============================================================================
// Bootstrap — ES modules are deferred; DOM is fully parsed at this point.
// =============================================================================
new DashboardController().init();
