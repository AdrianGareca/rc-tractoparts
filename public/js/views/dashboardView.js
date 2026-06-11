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
  'En espera':             'badge-en-espera',
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
  'SysAdmin':       'badge-role-sysadmin',
};

const STAT_COLOR = {
  'Pendiente':             '#F59E0B',
  'En revision':           '#F97316',
  'En espera':             '#6366F1',
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

/**
 * escHtml — HTML-entity-encode a value before interpolating into innerHTML.
 * Prevents stored-XSS when rendering user-controlled strings (OWASP A03).
 * @param   {any} str  - Value to encode (null/undefined become empty string)
 * @returns {string}
 */
function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtAmount(n, currency = 'USD') {
  if (n == null) return '—';
  return `${currency} ${Number(n).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// _buildProformaHTML
// Generates the full read-only proforma view HTML for a quotation object.
// Used by the Executive's "Ver" detail, the Jefe's approval decision, and
// the Administrador's review panel.
//   @param {Object}  q         — full quotation data (from findById, includes detalles[])
//   @param {number}  id        — quotation ID (for PDF link)
//   @param {boolean|string} viewMode
//     false | 'executive' — Executive read-only view (no action buttons)
//     true  | 'jefe'      — Jefe full action grid + read-only admin comments
//     'admin'             — Administrador view: comment textarea + "En Espera" button
// ---------------------------------------------------------------------------
function _buildProformaHTML(q, id, viewMode) {
  const jefeMode  = viewMode === true  || viewMode === 'jefe';
  const adminMode = viewMode === 'admin';

  const detalles = q.detalles ?? [];
  const subtotal = detalles.reduce((sum, d) => sum + parseFloat(d.subtotal || 0), 0);
  const iva      = subtotal * 0.13;
  const total    = subtotal + iva;

  const detallesRows = detalles.length > 0
    ? detalles.map(d => `
        <tr>
          <td>${escHtml(d.descripcion_item)}</td>
          <td class="text-right">${Number(d.cantidad).toFixed(4).replace(/\.?0+$/, '')}</td>
          <td class="text-right">${Number(d.precio_unitario).toFixed(2)}</td>
          <td class="text-right fw-600">${Number(d.subtotal).toFixed(2)}</td>
        </tr>`).join('')
    : `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);">Sin ítems registrados</td></tr>`;

  // Jefe action grid — contextual buttons based on current state
  const canApprove  = jefeMode && ['Pendiente', 'En revision', 'En espera'].includes(q.estado);
  const canAceptar  = jefeMode && ['Aprobada internamente', 'Enviada al cliente'].includes(q.estado);
  const canRechazar = jefeMode && !['Aceptada', 'Archivada', 'Rechazada'].includes(q.estado);
  const canHold     = jefeMode && ['Pendiente', 'En revision', 'Aprobada internamente', 'Enviada al cliente'].includes(q.estado);
  const canRetract  = jefeMode && ['En revision', 'En espera', 'Aprobada internamente', 'Enviada al cliente'].includes(q.estado);

  const jefeButtons = jefeMode ? `
    <div class="approval-actions">
      <h4 class="approval-actions-title">Decisión del Jefe</h4>
      <div class="approval-actions-grid">
        ${canRetract ? `<button class="btn btn-warning btn-sm" id="btn-solicitar-cambios">
          ↩ Solicitar Cambios
        </button>` : ''}
        ${canHold ? `<button class="btn btn-hold btn-sm" id="btn-en-espera">
          ⏸ Poner en Espera
        </button>` : ''}
        ${canApprove ? `<button class="btn btn-success" id="btn-aprobar">
          ✅ Aprobar Cotización
        </button>` : ''}
        ${canAceptar ? `<button class="btn btn-primary" id="btn-aceptar" style="grid-column:1/-1;">
          🏆 Aceptar Cotización — Cierre de Venta
        </button>` : ''}
        ${canRechazar ? `<button class="btn btn-danger btn-sm" id="btn-rechazar">
          ❌ Rechazar
        </button>` : ''}
      </div>
    </div>` : '';

  // Admin action panel — comment box + "En Espera" button only
  const adminButtons = adminMode ? `
    <div class="approval-actions" style="border-top:1px solid var(--border);margin-top:1.5rem;padding-top:1.25rem;">
      <h4 class="approval-actions-title">Revisión del Administrador</h4>
      <div class="form-group" style="margin-bottom:.75rem;">
        <label class="form-label" for="admin-comment-input">Comentario de Supervisión</label>
        <textarea class="form-control" id="admin-comment-input" rows="3"
                  placeholder="Ej: Verificar disponibilidad con proveedor antes de aprobar..."
                  style="resize:vertical;">${q.comentarios_admin ?? ''}</textarea>
        <span class="field-error" id="admin-comment-err"></span>
      </div>
      <div style="display:flex;gap:.75rem;flex-wrap:wrap;">
        <button class="btn btn-ghost btn-sm" id="btn-save-comment">
          💾 Guardar Comentario
        </button>
        <button class="btn btn-hold btn-sm" id="btn-admin-en-espera">
          ⏸ Poner en Espera con Comentario
        </button>
      </div>
    </div>` : '';

  // Read-only admin comment block — always shown in Jefe mode.
  // When no comment exists, a clean placeholder prevents layout confusion.
  const adminCommentBlock = jefeMode ? `
    <div class="form-group" style="margin-top:1rem;padding:1rem;background:var(--bg-secondary,#f8f9fa);border-left:3px solid #F97316;border-radius:4px;">
      <span class="form-label" style="color:#F97316;">💬 Comentario del Administrador</span>
      ${q.comentarios_admin
        ? `<p class="proforma-description" style="margin-top:.25rem;">${escHtml(q.comentarios_admin)}</p>`
        : `<p class="proforma-description text-muted" style="margin-top:.25rem;font-style:italic;">Sin comentarios del Administrador.</p>`
      }
    </div>` : '';

  return /* html */ `
    <div class="proforma-detail">

      <!-- Status + metadata bar -->
      <div class="proforma-meta-bar">
        <div class="proforma-meta-item">
          <span class="form-label">Estado</span>
          <p>${badgeHtml(q.estado)}</p>
        </div>
        <div class="proforma-meta-item">
          <span class="form-label">Cliente</span>
          <p class="fw-600">${escHtml(q.cliente_nombre ?? q.id_cliente)}</p>
          ${q.cliente_nit ? `<small class="text-muted">NIT: ${escHtml(q.cliente_nit)}</small>` : ''}
        </div>
        <div class="proforma-meta-item">
          <span class="form-label">Ejecutivo</span>
          <p>${escHtml(q.ejecutivo_nombre ?? '—')}</p>
        </div>
        <div class="proforma-meta-item">
          <span class="form-label">Fecha Emisión</span>
          <p>${fmtDate(q.fecha_emision)}</p>
        </div>
        <div class="proforma-meta-item">
          <span class="form-label">Fecha de Validez</span>
          <p>${fmtDate(q.fecha_validez)}</p>
        </div>
        <div class="proforma-meta-item">
          <span class="form-label">Moneda</span>
          <p>${q.moneda}</p>
        </div>
      </div>

      <!-- Description -->
      <div class="form-group" style="margin-bottom:1rem;">
        <span class="form-label">Descripción</span>
        <p class="proforma-description">${escHtml(q.descripcion)}</p>
      </div>

      <!-- Line items table -->
      <div class="table-wrapper proforma-items-wrapper" style="margin-bottom:1rem;">
        <table class="data-table proforma-items-table">
          <thead>
            <tr>
              <th>Descripción del Ítem</th>
              <th class="text-right">Cantidad</th>
              <th class="text-right">Precio Unit. (${q.moneda})</th>
              <th class="text-right">Subtotal (${q.moneda})</th>
            </tr>
          </thead>
          <tbody>${detallesRows}</tbody>
        </table>
      </div>

      <!-- Totals panel -->
      <div class="proforma-totals">
        <div class="proforma-total-row">
          <span>Subtotal</span>
          <span class="fw-600">${q.moneda} ${subtotal.toFixed(2)}</span>
        </div>
        <div class="proforma-total-row">
          <span>IVA Bolivia (13%)</span>
          <span>${q.moneda} ${iva.toFixed(2)}</span>
        </div>
        <div class="proforma-total-row proforma-grand-total">
          <span>TOTAL CON IVA</span>
          <span class="fw-600">${q.moneda} ${total.toFixed(2)}</span>
        </div>
      </div>

      ${q.obs_aprobacion ? `
      <div class="form-group" style="margin-top:1rem;">
        <span class="form-label">Observaciones de Aprobación</span>
        <p class="proforma-description">${escHtml(q.obs_aprobacion)}</p>
      </div>` : ''}

      ${q.observaciones ? `
      <div class="form-group" style="margin-top:.5rem;">
        <span class="form-label">Observaciones Generales</span>
        <p class="proforma-description">${escHtml(q.observaciones)}</p>
      </div>` : ''}

      <!-- Admin comment — read-only in Jefe mode -->
      ${adminCommentBlock}

      <!-- PDF viewer button -->
      ${q.pdf_ruta ? `
      <div class="proforma-pdf-bar">
        <a class="btn btn-outline btn-sm" href="/api/cotizaciones/${id}/pdf" target="_blank"
           rel="noopener noreferrer">
          📄 Ver PDF Adjunto
        </a>
        <span class="text-muted text-xs">Se abre en una nueva pestaña</span>
      </div>` : `
      <div class="proforma-pdf-bar">
        <span class="text-muted text-sm">Sin documento PDF adjunto.</span>
      </div>`}

      ${jefeButtons}
      ${adminButtons}
    </div>
  `;
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
      observaciones: this.#obs,   // controller reads req.body.observaciones
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

/** PATCH /api/cotizaciones/:id/comentario-admin — Save admin supervision comment */
class SetComentarioAdminCommand extends Command {
  #id; #comment;
  constructor(id, comment) { super(); this.#id = id; this.#comment = comment; }
  async execute() {
    return api.patch(`/api/cotizaciones/${this.#id}/comentario-admin`, {
      comentario_admin: this.#comment,
    });
  }
}

/** PUT /api/cotizaciones/:id/estado — Change quotation status with optional admin comment */
class HoldWithCommentCommand extends Command {
  #id; #comment;
  constructor(id, comment) { super(); this.#id = id; this.#comment = comment; }
  async execute() {
    return api.put(`/api/cotizaciones/${this.#id}/estado`, {
      nuevo_estado:    'En espera',
      observacion:     this.#comment,
      comentario_admin: this.#comment,  // persisted in dedicated column for Jefe to read
    });
  }
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
              <option>En revision</option><option>En espera</option>
              <option>Aprobada internamente</option>
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
        body.innerHTML = _buildProformaHTML(q, id, false);
      });
    } catch (err) {
      showToast(`No se pudo cargar la cotización: ${err.message}`, 'error');
    }
  }

  _changeStatus(id, currentStatus, triggerBtn) {
    const VALID_STATES = [
      'Borrador','Pendiente','En revision','En espera',
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
            <h3>Cola de Aprobación (${rows.length})</h3>
            <span class="text-muted text-sm">Haz clic en "Revisar y Decidir" para ver la proforma completa</span>
          </div>
          <div class="table-wrapper">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Correlativo</th><th>Estado</th><th>Ejecutivo</th>
                  <th>Cliente</th><th>Monto</th><th>Fecha</th>
                  <th>Vence</th><th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(r => `
                  <tr>
                    <td class="fw-600">${r.numero_correlativo}</td>
                    <td>${badgeHtml(r.estado)}</td>
                    <td>${r.ejecutivo_nombre ?? '—'}</td>
                    <td>${r.cliente_nombre ?? r.id_cliente}</td>
                    <td>${fmtAmount(r.monto_total, r.moneda)}</td>
                    <td>${fmtDate(r.fecha_emision)}</td>
                    <td>${fmtDate(r.fecha_validez)}</td>
                    <td>
                      <button class="btn btn-primary btn-sm" data-review="${r.id}"
                              style="white-space:nowrap;">
                        📋 Revisar y Decidir
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>`;

      panel.querySelectorAll('[data-review]').forEach(btn => {
        btn.addEventListener('click', () => this._viewApprovalDetail(btn.dataset.review));
      });

    } catch (err) {
      panel.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
    }
  }

  // ── Full proforma detail + state-machine action panel (Jefe view) ──────────

  async _viewApprovalDetail(id) {
    try {
      const data = await api.get(`/api/cotizaciones/${id}`);
      const q    = data.data;

      UI.openModal(`Proforma ${q.numero_correlativo} — Decisión de Jefe`, (body) => {
        body.innerHTML = _buildProformaHTML(q, id, true);

        // Wire the 4 state-machine action buttons
        body.querySelector('#btn-solicitar-cambios')?.addEventListener('click', () => {
          this._confirmStateChange(id, 'Pendiente',
            'Solicitar Cambios',
            'La cotización volverá al Ejecutivo para correcciones.',
            'Observaciones para el ejecutivo *',
            true,
            'Cambios solicitados — cotización regresada al ejecutivo.');
        });

        body.querySelector('#btn-en-espera')?.addEventListener('click', () => {
          this._confirmStateChange(id, 'En espera',
            'Poner en Espera',
            'La decisión queda suspendida mientras se verifica disponibilidad de stock con el proveedor.',
            'Motivo de la espera (opcional)',
            false,
            'Cotización puesta en espera.');
        });

        body.querySelector('#btn-aprobar')?.addEventListener('click', () => {
          this._showApproveDialog(id, true);
        });

        body.querySelector('#btn-rechazar')?.addEventListener('click', () => {
          this._showApproveDialog(id, false);
        });

        body.querySelector('#btn-aceptar')?.addEventListener('click', () => {
          this._confirmStateChange(id, 'Aceptada',
            'Aceptar Cotización — Cierre de Venta',
            'El cliente ha aceptado los términos. Esta acción registra el cierre de venta y congela cualquier modificación adicional.',
            'Observaciones de cierre (opcional)',
            false,
            '🏆 ¡Cierre de venta registrado! La cotización ha sido aceptada.');
        });
      }, { wide: true });
    } catch (err) {
      showToast(`No se pudo cargar la cotización: ${err.message}`, 'error');
    }
  }

  // ── Generic state-transition confirmation dialog (Solicitar Cambios / En Espera) ──

  _confirmStateChange(id, newState, title, description, obsLabel, obsRequired, successMsg) {
    UI.openModal(title, (body) => {
      body.innerHTML = `
        <p class="text-sm" style="color:var(--text-secondary);margin-bottom:1rem;">
          ${description}
        </p>
        <div class="form-group">
          <label class="form-label" for="sc-obs">${obsLabel}</label>
          <textarea class="form-control" id="sc-obs" rows="3"
                    placeholder="${obsRequired ? 'Requerido' : 'Opcional'}"></textarea>
          <span class="field-error" id="sc-err"></span>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:1rem;">
          <button class="btn btn-ghost" id="sc-cancel">Cancelar</button>
          <button class="btn btn-primary" id="sc-confirm">${title}</button>
        </div>`;

      body.querySelector('#sc-cancel')?.addEventListener('click', UI.closeModal);
      body.querySelector('#sc-confirm')?.addEventListener('click', () => {
        const obs    = body.querySelector('#sc-obs')?.value.trim() ?? '';
        const errEl  = body.querySelector('#sc-err');
        if (obsRequired && !obs) {
          errEl.textContent = 'Este campo es requerido.';
          return;
        }
        const btn = body.querySelector('#sc-confirm');
        CommandInvoker.run(new ChangeStatusCommand(id, newState, obs), {
          btn,
          successMsg,
          onSuccess: () => { UI.closeModal(); this.refresh(); },
        });
      });
    });
  }

  _showApproveDialog(id, aprobado, _triggerBtn) {
    const title  = aprobado ? 'Aprobar Cotización' : 'Rechazar Cotización';
    const label  = aprobado ? 'Observaciones (opcional)' : 'Justificación del rechazo *';

    UI.openModal(title, (body) => {
      body.innerHTML = `
        <div class="confirm-dialog">
          <h4>${aprobado ? '✅ ¿Confirmar aprobación?' : '❌ ¿Confirmar rechazo?'}</h4>
          <p>Cotización: <strong>#${id}</strong></p>
          ${aprobado ? `<p class="text-sm" style="color:var(--text-secondary);">Se generará el número oficial de correlativo y se bloqueará la edición.</p>` : ''}
        </div>
        <div class="form-group">
          <label class="form-label" for="obs-approval">${label}</label>
          <textarea class="form-control" id="obs-approval" rows="3"
                    placeholder="${aprobado ? 'Ej: Precios verificados con proveedor.' : 'Requerido para rechazar'}"></textarea>
          <span class="field-error" id="err-obs"></span>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:1rem;">
          <button class="btn btn-ghost"  id="cancel-approve">Cancelar</button>
          <button class="btn ${aprobado ? 'btn-success' : 'btn-danger'}" id="confirm-approve">
            ${aprobado ? '✅ Sí, Aprobar' : '❌ Sí, Rechazar'}
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
          successMsg: aprobado ? 'Cotización aprobada. El correlativo oficial ha sido generado.' : 'Cotización rechazada.',
          onSuccess:  () => { UI.closeModal(); this.refresh(); },
        });
      });
    });
  }

  // ── Tab: All quotations ────────────────────────────────────────────────────

  async _renderAllQuotations(panel) {
    panel.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';
    try {
      const data = await api.get('/api/cotizaciones?limit=50&sort_by=creado_en&sort_order=DESC');
      const rows = data.data ?? [];

      if (rows.length === 0) {
        panel.innerHTML = `
          <div class="card">
            <div class="card-header"><h3>Todas las Cotizaciones</h3></div>
            <div class="empty-state">
              <div class="empty-state-icon">📋</div>
              <h4>Sin cotizaciones registradas</h4>
              <p>No hay cotizaciones en el sistema.</p>
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
                  <th>Monto</th><th>Estado</th><th>Fecha</th><th>Acciones</th>
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
                    <td>
                      <button class="btn btn-ghost btn-sm" data-view-detail="${r.id}"
                              data-correlativo="${r.numero_correlativo}">
                        🔍 Ver Detalle
                      </button>
                    </td>
                  </tr>`).join('')
                }
              </tbody>
            </table>
          </div>
        </div>`;

      panel.querySelectorAll('[data-view-detail]').forEach(btn => {
        btn.addEventListener('click', () =>
          this._viewFullDetail(btn.dataset.viewDetail, btn.dataset.correlativo));
      });
    } catch (err) {
      panel.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
    }
  }

  // ── Full detail view from "Todas las Cotizaciones" (Jefe — with action buttons) ──

  async _viewFullDetail(id, correlativo) {
    try {
      const data = await api.get(`/api/cotizaciones/${id}`);
      const q    = data.data;
      UI.openModal(`Proforma ${correlativo ?? q.numero_correlativo}`, (body) => {
        body.innerHTML = _buildProformaHTML(q, id, 'jefe');
        // Wire action buttons (same as approval detail)
        body.querySelector('#btn-solicitar-cambios')?.addEventListener('click', () => {
          this._confirmStateChange(id, 'Pendiente',
            'Solicitar Cambios',
            'La cotización volverá al Ejecutivo para correcciones.',
            'Observaciones para el ejecutivo *', true,
            'Cambios solicitados — cotización regresada al ejecutivo.');
        });
        body.querySelector('#btn-en-espera')?.addEventListener('click', () => {
          this._confirmStateChange(id, 'En espera',
            'Poner en Espera',
            'La decisión queda suspendida mientras se verifica disponibilidad.',
            'Motivo de la espera (opcional)', false,
            'Cotización puesta en espera.');
        });
        body.querySelector('#btn-aprobar')?.addEventListener('click', () =>
          this._showApproveDialog(id, true));
        body.querySelector('#btn-rechazar')?.addEventListener('click', () =>
          this._showApproveDialog(id, false));
      }, { wide: true });
    } catch (err) {
      showToast(`No se pudo cargar la cotización: ${err.message}`, 'error');
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

  openModal(title, renderFn, { wide = false } = {}) {
    const overlay  = document.getElementById('modal-overlay');
    const dialog   = document.getElementById('modal-dialog');
    const body     = document.getElementById('modal-body');
    const titleEl  = document.getElementById('modal-title');
    if (!overlay || !body || !titleEl) return;

    titleEl.textContent = title;
    body.innerHTML      = '';

    // Toggle wide layout for complex views (proforma detail)
    if (dialog) {
      dialog.classList.toggle('modal-wide', wide);
    }

    renderFn(body);

    overlay.classList.add('open');
    this.open = true;

    // Close on overlay backdrop click
    overlay.onclick = (e) => { if (e.target === overlay) UI.closeModal(); };
  },

  closeModal() {
    const overlay = document.getElementById('modal-overlay');
    const dialog  = document.getElementById('modal-dialog');
    if (overlay) overlay.classList.remove('open');
    if (dialog)  dialog.classList.remove('modal-wide');
    UI.open = false;
  },
};

// =============================================================================
// STRATEGY: AdminStrategy (Administracion role)
// Tabs: Cola de Revisión, Todas las Cotizaciones, Gestión de Usuarios, Auditoría
// Key difference from ManagerStrategy:
//   • Can add comments & put quotations "En espera" — but CANNOT approve/reject
//   • Sees Jefe's approval queue in read-only mode (Cola de Revisión)
//   • Has full User CRUD access (same as Jefe per spec)
// =============================================================================
class AdminStrategy extends DashboardStrategy {
  #container;
  #user;
  #activeTab = 'review';

  constructor(user) { super(); this.#user = user; }

  async render(container) {
    this.#container = container;

    container.innerHTML = `
      <div class="tab-bar" id="admin-tabs">
        <button class="tab-btn active" data-tab="review">Cola de Revisión</button>
        <button class="tab-btn" data-tab="quotations">Todas las Cotizaciones</button>
        <button class="tab-btn" data-tab="users">Gestión de Usuarios</button>
        <button class="tab-btn" data-tab="audit">Registros de Auditoría</button>
      </div>
      <div id="admin-panel"></div>
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
    const panel = document.getElementById('admin-panel');
    if (!panel) return;
    switch (tab) {
      case 'review':     await this._renderReviewQueue(panel); break;
      case 'quotations': await this._renderAllQuotations(panel); break;
      case 'users':      await this._renderUsers(panel);        break;
      case 'audit':      await this._renderAuditLogs(panel);    break;
    }
  }

  // ── Tab: Review queue (read + hold + comment) ─────────────────────────────

  async _renderReviewQueue(panel) {
    panel.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';
    try {
      const data = await api.get('/api/cotizaciones/pendientes-aprobacion');
      const rows = data.data ?? [];

      if (rows.length === 0) {
        panel.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">✅</div>
            <h4>Cola vacía</h4>
            <p>No hay cotizaciones pendientes de revisión.</p>
          </div>`;
        return;
      }

      panel.innerHTML = `
        <div class="card">
          <div class="card-header">
            <h3>Cola de Revisión (${rows.length})</h3>
            <span class="text-muted text-sm">Puede añadir comentarios y poner en espera</span>
          </div>
          <div class="table-wrapper">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Correlativo</th><th>Ejecutivo</th>
                  <th>Cliente</th><th>Monto</th><th>Fecha</th>
                  <th>Vence</th><th>Acciones</th>
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
                    <td>${fmtDate(r.fecha_validez)}</td>
                    <td>
                      <button class="btn btn-primary btn-sm" data-review="${r.id}"
                              style="white-space:nowrap;">
                        📋 Revisar
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>`;

      panel.querySelectorAll('[data-review]').forEach(btn => {
        btn.addEventListener('click', () => this._viewAdminDetail(btn.dataset.review));
      });

    } catch (err) {
      panel.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
    }
  }

  // ── Admin proforma detail (comment box + En Espera only) ──────────────────

  async _viewAdminDetail(id) {
    try {
      const data = await api.get(`/api/cotizaciones/${id}`);
      const q    = data.data;

      UI.openModal(`Revisión Administrador — ${q.numero_correlativo}`, (body) => {
        body.innerHTML = _buildProformaHTML(q, id, 'admin');

        // Wire "Save comment only" button
        body.querySelector('#btn-save-comment')?.addEventListener('click', () => {
          const comment = body.querySelector('#admin-comment-input')?.value ?? '';
          const errEl   = body.querySelector('#admin-comment-err');
          const btn     = body.querySelector('#btn-save-comment');
          errEl.textContent = '';
          CommandInvoker.run(new SetComentarioAdminCommand(id, comment), {
            btn,
            successMsg: 'Comentario guardado.',
            onError: (err) => { errEl.textContent = err.data?.message || err.message; },
          });
        });

        // Wire "Poner en Espera con Comentario" button
        body.querySelector('#btn-admin-en-espera')?.addEventListener('click', () => {
          const comment = body.querySelector('#admin-comment-input')?.value.trim() ?? '';
          const errEl   = body.querySelector('#admin-comment-err');
          const btn     = body.querySelector('#btn-admin-en-espera');
          if (!comment) {
            errEl.textContent = 'El comentario es requerido para poner en espera.';
            return;
          }
          errEl.textContent = '';
          CommandInvoker.run(new HoldWithCommentCommand(id, comment), {
            btn,
            successMsg: 'Cotización puesta en espera. Comentario guardado.',
            onSuccess:  () => { UI.closeModal(); this.refresh(); },
            onError:    (err) => { errEl.textContent = err.data?.message || err.message; },
          });
        });
      }, { wide: true });
    } catch (err) {
      showToast(`No se pudo cargar la cotización: ${err.message}`, 'error');
    }
  }

  // ── Tab: All quotations (full detail, admin view) ─────────────────────────

  async _renderAllQuotations(panel) {
    panel.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';
    try {
      const data = await api.get('/api/cotizaciones?limit=50&sort_by=creado_en&sort_order=DESC');
      const rows = data.data ?? [];

      if (rows.length === 0) {
        panel.innerHTML = `
          <div class="card">
            <div class="card-header"><h3>Todas las Cotizaciones</h3></div>
            <div class="empty-state">
              <div class="empty-state-icon">📋</div>
              <h4>Sin cotizaciones registradas</h4>
              <p>No hay cotizaciones en el sistema.</p>
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
                  <th>Monto</th><th>Estado</th><th>Fecha</th><th>Acciones</th>
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
                    <td>
                      <button class="btn btn-ghost btn-sm" data-admin-view="${r.id}"
                              data-correlativo="${r.numero_correlativo}">
                        🔍 Ver Detalle
                      </button>
                    </td>
                  </tr>`).join('')
                }
              </tbody>
            </table>
          </div>
        </div>`;

      panel.querySelectorAll('[data-admin-view]').forEach(btn => {
        btn.addEventListener('click', () => this._viewAdminDetail(btn.dataset.adminView));
      });
    } catch (err) {
      panel.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
    }
  }

  // ── Tab: User Management ─────────────────────────────────────────────────
  // Admin has full CRUD access per the hierarchy spec (same as Jefe).
  async _renderUsers(panel) {
    panel.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';
    try {
      const data  = await api.get('/api/usuarios');
      const users = data.data ?? [];

      panel.innerHTML = `
        <div class="card">
          <div class="card-header">
            <h3>Gestión de Usuarios</h3>
            <button class="btn btn-primary btn-sm" id="btn-create-user-admin">+ Nuevo Usuario</button>
          </div>
          <div class="table-wrapper">
            <table class="data-table">
              <thead>
                <tr><th>ID</th><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr>
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

      panel.querySelector('#btn-create-user-admin')?.addEventListener('click', () => this._showCreateUserModal());
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
            <label class="form-label" for="nu2-nombre">Nombre Completo *</label>
            <input class="form-control" type="text" id="nu2-nombre" />
          </div>
          <div class="form-group">
            <label class="form-label" for="nu2-usuario">Nombre de Usuario *</label>
            <input class="form-control" type="text" id="nu2-usuario" autocapitalize="none" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="nu2-password">Contraseña *</label>
            <input class="form-control" type="password" id="nu2-password" />
          </div>
          <div class="form-group">
            <label class="form-label" for="nu2-rol">Rol *</label>
            <select class="form-control" id="nu2-rol">
              <option value="1">Ejecutivo</option>
              <option value="2">Administracion</option>
              <option value="3">Jefe</option>
            </select>
          </div>
        </div>
        <div class="form-alert" id="nu2-alert"></div>
        <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:1rem;">
          <button class="btn btn-ghost" id="nu2-cancel">Cancelar</button>
          <button class="btn btn-primary" id="nu2-confirm">Crear Usuario</button>
        </div>`;

      body.querySelector('#nu2-cancel')?.addEventListener('click', UI.closeModal);
      body.querySelector('#nu2-confirm')?.addEventListener('click', () => {
        const nombre   = body.querySelector('#nu2-nombre')?.value.trim();
        const usuario  = body.querySelector('#nu2-usuario')?.value.trim();
        const password = body.querySelector('#nu2-password')?.value;
        const id_rol   = parseInt(body.querySelector('#nu2-rol')?.value, 10);
        const alertEl  = body.querySelector('#nu2-alert');
        if (!nombre || !usuario || !password) {
          alertEl.textContent = 'Todos los campos marcados con * son requeridos.';
          alertEl.className   = 'form-alert show alert-error';
          return;
        }
        const btn = body.querySelector('#nu2-confirm');
        CommandInvoker.run(
          new CreateUserCommand({ nombre_completo: nombre, nombre_usuario: usuario, password, id_rol }),
          {
            btn,
            successMsg: `Usuario "${usuario}" creado exitosamente.`,
            onSuccess:  () => { UI.closeModal(); this._renderUsers(document.getElementById('admin-panel')); },
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
          <label class="form-label" for="eu2-nombre">Nombre Completo</label>
          <input class="form-control" type="text" id="eu2-nombre" value="${nombre ?? ''}" />
        </div>
        <div class="form-group">
          <label class="form-label" for="eu2-rol">Rol</label>
          <select class="form-control" id="eu2-rol">
            <option value="1" ${idRol == 1 ? 'selected' : ''}>Ejecutivo</option>
            <option value="2" ${idRol == 2 ? 'selected' : ''}>Administracion</option>
            <option value="3" ${idRol == 3 ? 'selected' : ''}>Jefe</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="eu2-password">Nueva Contraseña (dejar vacío para no cambiar)</label>
          <input class="form-control" type="password" id="eu2-password" />
        </div>
        <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:1rem;">
          <button class="btn btn-ghost" id="eu2-cancel">Cancelar</button>
          <button class="btn btn-primary" id="eu2-confirm">Guardar Cambios</button>
        </div>`;

      body.querySelector('#eu2-cancel')?.addEventListener('click', UI.closeModal);
      body.querySelector('#eu2-confirm')?.addEventListener('click', () => {
        const updateData = {
          nombre_completo: body.querySelector('#eu2-nombre')?.value.trim(),
          id_rol:          parseInt(body.querySelector('#eu2-rol')?.value, 10),
        };
        const pw = body.querySelector('#eu2-password')?.value;
        if (pw) updateData.password = pw;
        const btn = body.querySelector('#eu2-confirm');
        CommandInvoker.run(new UpdateUserCommand(id, updateData), {
          btn,
          successMsg: 'Usuario actualizado exitosamente.',
          onSuccess:  () => { UI.closeModal(); this._renderUsers(document.getElementById('admin-panel')); },
        });
      });
    });
  }

  _confirmDeactivateUser(id, username) {
    UI.openModal('Confirmar Desactivación', (body) => {
      body.innerHTML = `
        <div class="confirm-dialog">
          <h4>¿Desactivar al usuario "${username}"?</h4>
          <p>El usuario no podrá acceder al sistema.</p>
          <div style="display:flex;justify-content:center;gap:.75rem;">
            <button class="btn btn-ghost" id="dc2-cancel">Cancelar</button>
            <button class="btn btn-danger" id="dc2-confirm">Sí, Desactivar</button>
          </div>
        </div>`;

      body.querySelector('#dc2-cancel')?.addEventListener('click', UI.closeModal);
      body.querySelector('#dc2-confirm')?.addEventListener('click', () => {
        const btn = body.querySelector('#dc2-confirm');
        CommandInvoker.run(new DeactivateUserCommand(id), {
          btn,
          successMsg: `Usuario "${username}" desactivado.`,
          onSuccess:  () => { UI.closeModal(); this._renderUsers(document.getElementById('admin-panel')); },
        });
      });
    });
  }

  // ── Tab: Audit logs ───────────────────────────────────────────────────────
  async _renderAuditLogs(panel) {
    panel.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';
    try {
      const data = await api.get('/api/auditoria?limit=50');
      const rows = data.data ?? [];
      panel.innerHTML = `
        <div class="card">
          <div class="card-header"><h3>Registros de Auditoría (últimos 50)</h3></div>
          <div class="table-wrapper">
            <table class="data-table">
              <thead>
                <tr><th>Fecha</th><th>Usuario</th><th>Tabla</th><th>Acción</th><th>Registro</th><th>IP</th></tr>
              </thead>
              <tbody>
                ${rows.length === 0
                  ? `<tr><td colspan="6" style="text-align:center;padding:2rem;">Sin registros.</td></tr>`
                  : rows.map(r => `<tr>
                      <td class="text-sm">${fmtDate(r.fecha_hora)}</td>
                      <td>${r.id_usuario ?? '—'}</td>
                      <td>${r.tabla_afectada}</td>
                      <td><code style="font-size:.75rem;">${r.accion}</code></td>
                      <td>${r.id_registro_afectado ?? '—'}</td>
                      <td class="text-muted text-xs">${r.ip_cliente}</td>
                    </tr>`).join('')
                }
              </tbody>
            </table>
          </div>
        </div>`;
    } catch (err) {
      panel.innerHTML = `
        <div class="card">
          <div class="card-header"><h3>Registros de Auditoría</h3></div>
          <div class="card-body">
            <div class="empty-state">
              <div class="empty-state-icon">🔍</div>
              <h4>Endpoint en desarrollo</h4>
              <p>La tabla <code>auditoria</code> está activa en la BD.<br>
              El endpoint <code>GET /api/auditoria</code> estará disponible próximamente.</p>
            </div>
          </div>
        </div>`;
    }
  }
}

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

    // STRATEGY SELECTION based on role hierarchy:
    //   Jefe / SysAdmin → ManagerStrategy  (full authority: approve, reject, all tabs)
    //   Administracion  → AdminStrategy    (review + hold + comment; no approve/reject)
    //   Ejecutivo       → ExecutiveStrategy (own quotations only)
    this.#strategy = (role === 'Jefe' || role === 'SysAdmin')
      ? new ManagerStrategy(user)
      : role === 'Administracion'
        ? new AdminStrategy(user)
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
    } else if (role === 'Administracion') {
      links = `
        <span class="sidebar-section-label">Panel Principal</span>
        <button class="sidebar-link active" data-section="review">
          <span class="link-icon">📝</span> Cola de Revisión
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

        // ManagerStrategy and AdminStrategy both have _renderPanel
        if (this.#strategy instanceof ManagerStrategy || this.#strategy instanceof AdminStrategy) {
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
