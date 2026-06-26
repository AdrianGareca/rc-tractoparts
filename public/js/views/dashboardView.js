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

// ── Dashboard sub-modules ─────────────────────────────────────────────────────
import {
  STATE_BADGE, ROLE_BADGE, STAT_COLOR,
  badgeHtml, roleBadgeHtml, fmtDate, escHtml, fmtAmount,
} from './dashboard/helpers.js';
import { wirePdfButton, wireExcelButton, buildTimelineHtml } from './dashboard/modules/timelineView.js';
import { renderReportes, renderAdvancedReports } from './dashboard/modules/reportesView.js';
import { refreshNotifBadge, requestNotifPermission, startNotifPolling } from './dashboard/modules/notificationsView.js';

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
  const jefeMode     = viewMode === true  || viewMode === 'jefe';
  const adminMode    = viewMode === 'admin';
  // 'delegate' — read-only Executive view PLUS a single "Aprobar Internamente"
  // action, shown only to executives holding the delegated can_approve_quotations
  // flag (Delegación de Funciones). It deliberately exposes nothing else.
  const delegateMode = viewMode === 'delegate';

  const detalles = q.detalles ?? [];
  const subtotal = detalles.reduce((sum, d) => sum + parseFloat(d.subtotal || 0), 0);
  const iva      = subtotal * 0.13;
  const total    = subtotal + iva;

  const detallesRows = detalles.length > 0
    ? detalles.map(d => {
        // Prefer the catalog Part Number (via productos FK); fall back to the
        // ad-hoc codigo_parte stored directly in the line item.
        const codigoParte = d.producto_codigo || d.codigo_parte;
        return `
        <tr>
          <td>${escHtml(d.descripcion_item)}</td>
          <td class="text-muted text-sm">${codigoParte ? escHtml(codigoParte) : '—'}</td>
          ${d.marca_nombre ? `<td class="text-muted text-sm">${escHtml(d.marca_nombre)}</td>` : '<td class="text-muted text-sm">—</td>'}
          <td class="text-right">${Number(d.cantidad).toFixed(4).replace(/\.?0+$/, '')}</td>
          <td class="text-right">${Number(d.precio_unitario).toFixed(2)}</td>
          <td class="text-right fw-600">${Number(d.subtotal).toFixed(2)}</td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);">Sin ítems registrados</td></tr>`;

  // Jefe action grid — contextual buttons based on current state
  const canApprove      = jefeMode && ['Pendiente', 'En revision', 'En espera'].includes(q.estado);
  const canEnviarCliente= jefeMode && ['Pendiente', 'En revision', 'En espera', 'Aprobada internamente'].includes(q.estado);
  const canAceptar      = jefeMode && ['Aprobada internamente', 'Enviada al cliente'].includes(q.estado);
  const canRechazar     = jefeMode && !['Aceptada', 'Archivada', 'Rechazada'].includes(q.estado);
  const canHold         = jefeMode && ['Pendiente', 'En revision', 'Aprobada internamente', 'Enviada al cliente'].includes(q.estado);
  // 'Aprobada internamente' is intentionally excluded: the Jefe ROLE_TRANSITIONS
  // matrix has NO 'Aprobada internamente' → 'Pendiente' edge, so offering
  // "Solicitar Cambios" there would always 403. Aligns the UI with the backend.
  const canRetract      = jefeMode && ['En revision', 'En espera', 'Enviada al cliente'].includes(q.estado);
  // High-privilege revert: only Jefe/SysAdmin can revert a Rechazada quotation
  const canRevertir = jefeMode && q.estado === 'Rechazada';

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
        ${canEnviarCliente ? `<button class="btn btn-success" id="btn-enviar-cliente"
          style="background:#16a34a;border-color:#15803d;grid-column:1/-1;">
          🟢 Aprobar y Enviar al Cliente
        </button>` : ''}
        ${canAceptar ? `<button class="btn btn-primary" id="btn-aceptar" style="grid-column:1/-1;">
          🏆 Aceptar Cotización — Cierre de Venta
        </button>` : ''}
        ${canRechazar ? `<button class="btn btn-danger btn-sm" id="btn-rechazar">
          ❌ Rechazar
        </button>` : ''}
      </div>
    </div>
    ${canRevertir ? `
    <div class="approval-actions" style="margin-top:1rem;border-top:2px solid #F59E0B;padding-top:1rem;">
      <h4 class="approval-actions-title" style="color:#B45309;">🔄 Revertir Rechazo</h4>
      <p class="text-sm" style="color:var(--text-secondary);margin-bottom:.75rem;">
        Como autoridad comercial superior, puede revaluar esta cotización y reintroducirla
        en el flujo de aprobación. Las observaciones de rechazo previas serán preservadas
        en el historial de estados.
      </p>
      <div style="display:flex;gap:.75rem;flex-wrap:wrap;">
        <button class="btn btn-warning btn-sm" id="btn-revertir-pendiente"
                style="background:#F59E0B;color:#000;border:none;">
          🔄 Revertir a Pendiente
        </button>
        <button class="btn btn-warning btn-sm" id="btn-revertir-revision"
                style="background:#F97316;color:#fff;border:none;">
          🔄 Revertir a En Revisión
        </button>
      </div>
    </div>` : ''}
    ` : '';

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

  // Delegated-executive action — a single "Aprobar Internamente" button, rendered
  // only in delegate mode and only from a legitimate pre-approval source state.
  // Mirrors exactly what the backend additive delegation branch will accept.
  const delegateButtons = (delegateMode && ['Pendiente', 'En revision', 'En espera'].includes(q.estado)) ? `
    <div class="approval-actions" style="border-top:2px solid #16a34a;margin-top:1.5rem;padding-top:1.25rem;">
      <h4 class="approval-actions-title" style="color:#15803d;">🔑 Delegación de Funciones</h4>
      <p class="text-sm" style="color:var(--text-secondary);margin-bottom:.75rem;">
        Cuentas con autorización delegada para aprobar internamente esta cotización.
      </p>
      <button class="btn btn-success" id="btn-aprobar-delegado">
        ✅ Aprobar Internamente
      </button>
    </div>` : '';

  // Read-only admin comment block — shown to ALL authenticated roles when a
  // comment exists, so Ejecutivos can see supervisor notes.  In Jefe mode an
  // empty-state placeholder is also rendered so the section is never invisible.
  // Hidden in adminMode because that mode already provides an editable textarea.
  const adminCommentBlock = !adminMode && q.comentarios_admin
    ? `<div class="form-group" style="margin-top:1rem;padding:1rem;background:var(--bg-secondary,#f8f9fa);border-left:3px solid #F97316;border-radius:4px;">
      <span class="form-label" style="color:#F97316;">💬 Comentario del Administrador</span>
      <p class="proforma-description" style="margin-top:.25rem;">${escHtml(q.comentarios_admin)}</p>
    </div>`
    : jefeMode && !adminMode
      ? `<div class="form-group" style="margin-top:1rem;padding:1rem;background:var(--bg-secondary,#f8f9fa);border-left:3px solid #F97316;border-radius:4px;">
      <span class="form-label" style="color:#F97316;">💬 Comentario del Administrador</span>
      <p class="proforma-description text-muted" style="margin-top:.25rem;font-style:italic;">Sin comentarios del Administrador.</p>
    </div>`
      : '';

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
              <th>Cód. Parte</th>
              <th>Marca</th>
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

      <!-- PDF + Excel viewer buttons -->
      <div class="proforma-pdf-bar">
        ${q.pdf_ruta ? `
        <button class="btn btn-outline btn-sm" id="btn-ver-pdf" type="button">
          📄 Ver PDF Adjunto
        </button>
        <span class="text-muted text-xs">Se abre en una nueva pestaña</span>` : `
        <span class="text-muted text-sm">Sin documento PDF adjunto.</span>`}
        ${q.excel_ruta ? `
        <button
          type="button"
          id="btn-ver-excel"
          class="btn btn-sm"
          style="display:inline-flex;align-items:center;gap:.35rem;
                 background:#16a34a;color:#fff;border:1px solid #15803d;"
        >
          📊 Descargar Excel
        </button>` : ''}
      </div>

      ${jefeButtons}
      ${adminButtons}
      ${delegateButtons}
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
  // Dashboard partitioning: 'mias' = quotations owned by the logged-in user,
  // 'equipo' = the rest of the team's. #allRows caches the last server fetch so
  // switching tabs re-partitions IN MEMORY without a new DB query.
  #scope          = 'mias';
  #allRows        = [];
  #loadAbortCtrl  = null;

  constructor(user) { super(); this.#user = user; }

  async render(container) {
    this.#container = container;

    container.innerHTML = `
      <div id="stats-section" class="stats-grid"></div>

      <!-- Proformas del Día — daily intake widget -->
      <div id="proformas-hoy-section"></div>

      <!-- Métricas personales BI — loaded after quotations -->
      <div id="metrics-section"></div>

      <div class="card">
        <div class="card-header">
          <h3>Cotizaciones</h3>
          <button class="btn btn-primary btn-sm" id="btn-new-quotation">+ Nueva Cotización</button>
        </div>

        <!-- Scope segmented control: personal workspace vs. team activity.
             Switching is purely client-side (re-partitions the cached array). -->
        <div class="tab-bar" id="exec-scope-tabs" style="margin-bottom:1rem;">
          <button class="tab-btn active" data-scope="mias" type="button">
            Mis Cotizaciones <span class="badge" data-scope-count="mias">0</span>
          </button>
          <button class="tab-btn" data-scope="equipo" type="button">
            Cotizaciones del Equipo <span class="badge" data-scope-count="equipo">0</span>
          </button>
        </div>

        <!-- Filter bar -->
        <div class="filter-bar">
          <div class="form-group">
            <label class="form-label">Estado</label>
            <select class="form-control" id="filter-estado" style="min-width:140px;">
              <option value="">Todos</option>
              <option>Pendiente</option>
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

    // Scope tabs — pure in-memory re-partition, NO server round-trip.
    this.#container.querySelectorAll('#exec-scope-tabs .tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (this.#scope === btn.dataset.scope) return;
        this.#scope = btn.dataset.scope;
        this.#container.querySelectorAll('#exec-scope-tabs .tab-btn')
          .forEach((b) => b.classList.toggle('active', b === btn));
        this._renderQuotationsTable();
      });
    });

    await Promise.all([
      this._loadSummary(),
      this._loadQuotations(),
      this._loadProformasHoy(),
      this._loadMetrics(),
    ]);
  }

  async refresh() {
    if (this.#container) await Promise.all([
      this._loadSummary(),
      this._loadQuotations(),
      this._loadProformasHoy(),
      this._loadMetrics(),
    ]);
  }

  async _loadMetrics() {
    const section = document.getElementById('metrics-section');
    if (!section) return;
    await renderAdvancedReports(section);
  }

  async _loadProformasHoy() {
    const section = document.getElementById('proformas-hoy-section');
    if (!section) return;
    try {
      const data = await api.get('/api/cotizaciones?hoy=true&limit=50&sort_by=creado_en&sort_order=DESC');
      const rows = data.data ?? [];
      const today = new Date().toLocaleDateString('es-BO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

      if (rows.length === 0) {
        section.innerHTML = `
          <div class="card" style="border-left:4px solid #3B82F6;margin-bottom:1rem;">
            <div class="card-header" style="padding-bottom:.5rem;">
              <h4 style="margin:0;color:#3B82F6;">📅 Proformas del Día — ${escHtml(today)}</h4>
            </div>
            <p class="text-muted" style="padding:.5rem 1rem 1rem;">Sin proformas emitidas hoy.</p>
          </div>`;
        return;
      }

      section.innerHTML = `
        <div class="card" style="border-left:4px solid #3B82F6;margin-bottom:1rem;">
          <div class="card-header" style="padding-bottom:.5rem;">
            <h4 style="margin:0;color:#3B82F6;">📅 Proformas del Día — ${escHtml(today)}</h4>
            <span class="badge" style="background:#3B82F6;color:#fff;">${rows.length} emitida${rows.length > 1 ? 's' : ''}</span>
          </div>
          <div class="table-wrapper" style="margin:0;">
            <table class="data-table" style="font-size:.85rem;">
              <thead>
                <tr><th>Correlativo</th><th>Cliente</th><th>Monto</th><th>Estado</th></tr>
              </thead>
              <tbody>
                ${rows.map(r => `
                  <tr>
                    <td class="fw-600">${escHtml(r.numero_correlativo)}</td>
                    <td>${escHtml(r.cliente_nombre ?? '—')}</td>
                    <td>${fmtAmount(r.monto_total, r.moneda)}</td>
                    <td>${badgeHtml(r.estado)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
    } catch (_) { /* non-fatal — widget failure must not break main view */ }
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

  // Fetches the company quotation set ONCE per refresh (server-side estado/q
  // filters still apply) and caches it. Partitioning into "Mis" / "Equipo" and
  // tab switching are then handled entirely in memory by _renderQuotationsTable.
  async _loadQuotations() {
    const section = document.getElementById('quotations-section');
    if (!section) return;

    // Cancel any in-flight request before firing a new one
    this.#loadAbortCtrl?.abort();
    this.#loadAbortCtrl = new AbortController();
    const { signal } = this.#loadAbortCtrl;

    section.innerHTML = '<div class="page-loading"><div class="spinner"></div><span>Cargando…</span></div>';

    const estado = document.getElementById('filter-estado')?.value ?? '';
    const q      = document.getElementById('filter-q')?.value.trim() ?? '';

    // limit=200 mirrors the API's hard cap (QuotationModel.findAll) so a single
    // fetch covers the full working set; both partitions are derived client-side.
    const params = new URLSearchParams({
      page: 1, limit: 200,
      sort_by: this.#sortBy, sort_order: this.#sortOrd,
      ...(estado && { estado }),
      ...(q && { q }),
    });

    try {
      const data = await api.get(`/api/cotizaciones?${params}`, { signal });
      this.#allRows = data.data ?? [];
      this._renderQuotationsTable();
    } catch (err) {
      if (err.name === 'AbortError') return;
      section.innerHTML = `<div class="empty-state"><p>Error cargando cotizaciones: ${escHtml(err.message)}</p></div>`;
    }
  }

  // Renders the table for the active scope from the cached array. No DB query.
  _renderQuotationsTable() {
    const section = document.getElementById('quotations-section');
    if (!section) return;

    const myId   = Number(this.#user.id);
    const mine   = this.#allRows.filter((r) => Number(r.id_ejecutivo) === myId);
    const team   = this.#allRows.filter((r) => Number(r.id_ejecutivo) !== myId);

    // Keep the tab badges in sync with the cached dataset.
    const setCount = (scope, n) => {
      const el = this.#container.querySelector(`[data-scope-count="${scope}"]`);
      if (el) el.textContent = n;
    };
    setCount('mias', mine.length);
    setCount('equipo', team.length);

    const isTeam = this.#scope === 'equipo';
    const rows   = isTeam ? team : mine;
    // 'Estado' row action is hidden for standard/delegated Ejecutivos — their
    // status changes flow through the "Ver" modal (proper UX). Management roles
    // inside this strategy (e.g. Administracion) retain the quick action.
    const showStatusBtn = this.#user.rol !== 'Ejecutivo';

    const footer = document.getElementById('pagination-footer');

    if (rows.length === 0) {
      section.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <h4>${isTeam ? 'Sin cotizaciones del equipo' : 'Sin cotizaciones propias'}</h4>
          <p>${isTeam
            ? 'No hay cotizaciones de otros miembros del equipo con los filtros aplicados.'
            : 'Aún no has registrado cotizaciones con los filtros aplicados.'}</p>
        </div>`;
      if (footer) footer.innerHTML = '';
      return;
    }

    section.innerHTML = `
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>N° Correlativo</th><th>Cliente</th>
              ${isTeam ? '<th>Ejecutivo</th>' : ''}
              <th>Fecha</th><th>Monto</th>
              <th>Estado</th><th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td class="fw-600">${r.numero_correlativo}</td>
                <td>${r.cliente_nombre ? escHtml(r.cliente_nombre) : r.id_cliente}</td>
                ${isTeam ? `<td>${escHtml(r.ejecutivo_nombre ?? '—')}</td>` : ''}
                <td>${fmtDate(r.fecha_emision)}</td>
                <td>${fmtAmount(r.monto_total, r.moneda)}</td>
                <td>${badgeHtml(r.estado)}</td>
                <td>
                  <div class="table-actions">
                    <button class="btn btn-ghost btn-sm" data-action="view" data-id="${r.id}">Ver</button>
                    ${showStatusBtn
                      ? `<button class="btn btn-ghost btn-sm" data-action="status" data-id="${r.id}" data-estado="${r.estado}">Estado</button>`
                      : ''}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;

    section.querySelectorAll('[data-action="view"]').forEach((btn) => {
      btn.addEventListener('click', () => this._viewQuotation(btn.dataset.id));
    });
    section.querySelectorAll('[data-action="status"]').forEach((btn) => {
      btn.addEventListener('click', () =>
        this._changeStatus(btn.dataset.id, btn.dataset.estado, btn));
    });

    if (footer) {
      footer.innerHTML = `
        <span class="pagination-info">
          Mostrando ${rows.length} ${isTeam ? 'del equipo' : 'propia(s)'} · ${this.#allRows.length} en total
        </span>`;
    }
  }

  async _viewQuotation(id) {
    try {
      const [quotData, histData] = await Promise.allSettled([
        api.get(`/api/cotizaciones/${id}`),
        api.get(`/api/cotizaciones/${id}/historial`),
      ]);

      if (quotData.status === 'rejected') throw quotData.reason;

      const q       = quotData.value.data;
      const history = histData.status === 'fulfilled' ? (histData.value.data ?? []) : [];

      // Delegación de Funciones — render the "Aprobar Internamente" action only
      // when this executive holds the delegated flag. From a pre-approval state
      // _buildProformaHTML('delegate') adds the single approve button.
      const delegated  = AuthSession.canApproveQuotations();
      // Editable only while the quotation is still a 'Pendiente' draft owned by
      // this executive (matches the backend PUT /:id ownership + state guard).
      const isOwner    = q.id_ejecutivo === this.#user.id;
      const editable   = isOwner && q.estado === 'Pendiente';

      UI.openModal(`Cotización ${q.numero_correlativo}`, (body) => {
        body.innerHTML = _buildProformaHTML(q, id, delegated ? 'delegate' : false);

        if (editable) {
          body.insertAdjacentHTML('afterbegin', `
            <div style="display:flex;justify-content:flex-end;margin-bottom:1rem;">
              <button class="btn btn-primary btn-sm" id="btn-editar-cotizacion">✏️ Editar Cotización</button>
            </div>`);
          body.querySelector('#btn-editar-cotizacion')?.addEventListener('click', () =>
            this._editQuotation(q));
        }

        if (delegated) {
          body.querySelector('#btn-aprobar-delegado')?.addEventListener('click', () => {
            this._confirmDelegatedApproval(id);
          });
        }

        wirePdfButton(body, id, q.numero_correlativo);
        wireExcelButton(body, id, q.numero_correlativo);
        body.insertAdjacentHTML('beforeend', buildTimelineHtml(history));
      });
    } catch (err) {
      showToast(`No se pudo cargar la cotización: ${err.message}`, 'error');
    }
  }

  // ── Delegated approval confirmation (Delegación de Funciones) ────────────────
  // Transitions the quotation to 'Aprobada internamente' via the standard state
  // endpoint. The backend authorizes this only because the executive carries the
  // can_approve_quotations flag (re-read fresh from the DB server-side).
  _confirmDelegatedApproval(id) {
    UI.openModal('Aprobar Internamente', (body) => {
      body.innerHTML = `
        <div class="confirm-dialog">
          <h4>✅ ¿Confirmar aprobación interna?</h4>
          <p class="text-sm" style="color:var(--text-secondary);">
            Estás usando tu autorización delegada para aprobar esta cotización.
          </p>
        </div>
        <div class="form-group">
          <label class="form-label" for="del-obs">Observación (opcional)</label>
          <textarea class="form-control" id="del-obs" rows="2"></textarea>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:1rem;">
          <button class="btn btn-ghost" id="del-cancel">Cancelar</button>
          <button class="btn btn-success" id="del-confirm">✅ Sí, Aprobar</button>
        </div>`;

      body.querySelector('#del-cancel')?.addEventListener('click', UI.closeModal);
      body.querySelector('#del-confirm')?.addEventListener('click', () => {
        const obs = body.querySelector('#del-obs')?.value.trim() ?? '';
        const btn = body.querySelector('#del-confirm');
        CommandInvoker.run(new ChangeStatusCommand(id, 'Aprobada internamente', obs), {
          btn,
          successMsg: 'Cotización aprobada internamente.',
          onSuccess:  () => { UI.closeModal(); this.refresh(); },
        });
      });
    });
  }

  // ── Edit an existing 'Pendiente' quotation (Solicitar Cambios workflow) ──────
  // Mounts the shared quotation form in edit mode, pre-populated with the current
  // header + line items, and PUTs the changes to PUT /api/cotizaciones/:id.
  _editQuotation(q) {
    UI.openModal(`Editar Cotización ${q.numero_correlativo}`, (body) => {
      mountQuotationForm(body, {
        quotation: q,
        onSuccess: (updated) => {
          UI.closeModal();
          showToast(`Cotización ${updated?.numero_correlativo ?? q.numero_correlativo} actualizada.`, 'success');
          this.refresh();
        },
        onCancel: () => UI.closeModal(),
      });
    });
  }

  _changeStatus(id, currentStatus, triggerBtn) {
    // Mirrors QuotationModel.VALID_STATES exactly. 'Borrador' is a display-only
    // badge, NOT a valid ENUM/transition target — sending it returns 422.
    const VALID_STATES = [
      'Pendiente','En revision','En espera',
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
        <button class="tab-btn" data-tab="reportes">📊 Reportes</button>
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
      case 'approvals':  await this._renderApprovals(panel);       break;
      case 'quotations': await this._renderAllQuotations(panel);   break;
      case 'users':      await this._renderUsers(panel);           break;
      case 'audit':      await this._renderAuditLogs(panel);       break;
      case 'reportes':   await this._renderReportes(panel);        break;
    }
  }

  // ── Tab: Reportes — delegated to reportesView module ───────────────────────

  async _renderReportes(panel) {
    await renderReportes(panel);
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
                    <td>${escHtml(r.ejecutivo_nombre ?? '—')}</td>
                    <td>${escHtml(r.cliente_nombre ?? String(r.id_cliente))}</td>
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
      panel.innerHTML = `<div class="empty-state"><p>Error: ${escHtml(err.message)}</p></div>`;
    }
  }

  // ── Full proforma detail + state-machine action panel (Jefe view) ──────────

  async _viewApprovalDetail(id) {
    try {
      const data = await api.get(`/api/cotizaciones/${id}`);
      const q    = data.data;

      UI.openModal(`Proforma ${q.numero_correlativo} — Decisión de Jefe`, (body) => {
        body.innerHTML = _buildProformaHTML(q, id, true);
        wirePdfButton(body, id, q.numero_correlativo);
        wireExcelButton(body, id, q.numero_correlativo);

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

        body.querySelector('#btn-enviar-cliente')?.addEventListener('click', () => {
          this._confirmEnviarCliente(id);
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

        // ── Revert rejection buttons (Jefe / SysAdmin only) ─────────────────────
        body.querySelector('#btn-revertir-pendiente')?.addEventListener('click', () => {
          this._confirmRevertRejection(id, 'Pendiente');
        });
        body.querySelector('#btn-revertir-revision')?.addEventListener('click', () => {
          this._confirmRevertRejection(id, 'En revision');
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

  // ── Confirm direct "Aprobar y Enviar al Cliente" transition ─────────────────
  // Allows the Jefe to skip 'Aprobada internamente' and send directly to the
  // client in a single step. The transition is logged to cotizacion_historial_estados.

  _confirmEnviarCliente(id) {
    this._confirmStateChange(
      id,
      'Enviada al cliente',
      'Aprobar y Enviar al Cliente',
      'La cotización pasará directamente al estado "Enviada al cliente", omitiendo la aprobación interna intermedia. Esta acción queda registrada en el historial de estados.',
      'Nota para el historial (opcional)',
      false,
      '🟢 Cotización aprobada y enviada al cliente exitosamente.'
    );
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
                    <td>${escHtml(r.ejecutivo_nombre ?? '—')}</td>
                    <td>${escHtml(r.cliente_nombre ?? String(r.id_cliente))}</td>
                    <td>${fmtAmount(r.monto_total, r.moneda)}</td>
                    <td>${badgeHtml(r.estado)}</td>
                    <td>${fmtDate(r.fecha_emision)}</td>
                    <td>
                      <button class="btn btn-ghost btn-sm" data-view-detail="${r.id}"
                              data-correlativo="${escHtml(r.numero_correlativo)}">
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
      panel.innerHTML = `<div class="empty-state"><p>Error: ${escHtml(err.message)}</p></div>`;
    }
  }

  // ── Full detail view from "Todas las Cotizaciones" (Jefe — with action buttons) ──

  async _viewFullDetail(id, correlativo) {
    try {
      const data = await api.get(`/api/cotizaciones/${id}`);
      const q    = data.data;
      UI.openModal(`Proforma ${correlativo ?? q.numero_correlativo}`, (body) => {
        body.innerHTML = _buildProformaHTML(q, id, 'jefe');
        wirePdfButton(body, id, correlativo ?? q.numero_correlativo);
        wireExcelButton(body, id, correlativo ?? q.numero_correlativo);
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
        body.querySelector('#btn-enviar-cliente')?.addEventListener('click', () =>
          this._confirmEnviarCliente(id));
        body.querySelector('#btn-rechazar')?.addEventListener('click', () =>
          this._showApproveDialog(id, false));

        // FIX: #btn-aceptar was missing from _viewFullDetail — wired here so
        // quotations in 'Aprobada internamente' / 'Enviada al cliente' reached
        // from the "Todas las Cotizaciones" tab can complete the sale closure.
        body.querySelector('#btn-aceptar')?.addEventListener('click', () => {
          this._confirmStateChange(id, 'Aceptada',
            'Aceptar Cotización — Cierre de Venta',
            'El cliente ha aceptado los términos. Esta acción registra el cierre de venta y congela cualquier modificación adicional.',
            'Observaciones de cierre (opcional)',
            false,
            '🏆 ¡Cierre de venta registrado! La cotización ha sido aceptada.');
        });

        // Revert rejection buttons
        body.querySelector('#btn-revertir-pendiente')?.addEventListener('click', () => {
          this._confirmRevertRejection(id, 'Pendiente');
        });
        body.querySelector('#btn-revertir-revision')?.addEventListener('click', () => {
          this._confirmRevertRejection(id, 'En revision');
        });
      }, { wide: true });
    } catch (err) {
      showToast(`No se pudo cargar la cotización: ${err.message}`, 'error');
    }
  }

  // ── Confirm revert rejection — Jefe / SysAdmin exclusive ────────────────────────

  _confirmRevertRejection(id, targetState) {
    const label = targetState === 'Pendiente'
      ? 'Revertir a Pendiente (Borrador para Correcciones)'
      : 'Revertir a En Revisión (Flujo de Aprobación)';

    UI.openModal('🔄 Revertir Rechazo / Revaluar Cotización', (body) => {
      body.innerHTML = `
        <div style="background:#FEF9C3;border:1px solid #F59E0B;border-radius:6px;padding:.75rem 1rem;margin-bottom:1rem;">
          <strong style="color:#B45309;">⚠️ Acción de Alta Autoridad</strong>
          <p class="text-sm" style="color:#78350F;margin:.25rem 0 0;">
            Esta acción revierte el estado de <strong>Rechazada</strong> a
            <strong>${escHtml(targetState)}</strong> y reinyecta la cotización en el flujo de trabajo.
            El historial de rechazo se preservará en la trazabilidad de estados.
          </p>
        </div>
        <div class="form-group">
          <label class="form-label" for="rev-obs">Justificación de la Revaluación *</label>
          <textarea class="form-control" id="rev-obs" rows="3"
                    placeholder="Ej: Nueva información del proveedor cambia las condiciones comerciales."></textarea>
          <span class="field-error" id="rev-err"></span>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:1rem;">
          <button class="btn btn-ghost" id="rev-cancel">Cancelar</button>
          <button class="btn btn-sm" id="rev-confirm"
                  style="background:#F59E0B;color:#000;border:none;font-weight:600;">
            🔄 Confirmar Revertir Rechazo
          </button>
        </div>`;

      body.querySelector('#rev-cancel')?.addEventListener('click', UI.closeModal);
      body.querySelector('#rev-confirm')?.addEventListener('click', () => {
        const obs   = body.querySelector('#rev-obs')?.value.trim() ?? '';
        const errEl = body.querySelector('#rev-err');
        if (!obs) { errEl.textContent = 'La justificación es requerida.'; return; }
        errEl.textContent = '';

        const rollbackNote = `[REVERTIR RECHAZO] ${obs}`;
        const btn = body.querySelector('#rev-confirm');

        CommandInvoker.run(
          new ChangeStatusCommand(id, targetState, rollbackNote),
          {
            btn,
            successMsg: `🔄 Cotización revertida a "${targetState}" exitosamente. Reinyectada en el flujo.`,
            onSuccess:  () => { UI.closeModal(); this.refresh(); },
          }
        );
      });
    });
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
                                data-nombre="${u.nombre_completo}" data-rol="${u.id_rol}"
                                data-canapprove="${u.can_approve_quotations ? 1 : 0}">Editar</button>
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
          this._showEditUserModal(btn.dataset.userEdit, btn.dataset.nombre, btn.dataset.rol, btn.dataset.canapprove)));

      panel.querySelectorAll('[data-user-deact]').forEach(btn =>
        btn.addEventListener('click', () =>
          this._confirmDeactivateUser(btn.dataset.userDeact, btn.dataset.uname)));

    } catch (err) {
      panel.innerHTML = `<div class="empty-state"><p>Error cargando usuarios: ${escHtml(err.message)}</p></div>`;
    }
  }

  _showCreateUserModal() {
    // Delegación de Funciones — only Jefe/Administracion/SysAdmin may set the flag.
    const canDelegate = ['Jefe', 'Administracion', 'SysAdmin'].includes(AuthSession.getRole());
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
        ${canDelegate ? `
        <div class="form-group">
          <label class="form-label checkbox-label">
            <input type="checkbox" id="nu-canapprove" />
            <span>Delegación de Funciones: Permitir aprobar cotizaciones</span>
          </label>
        </div>` : ''}
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

        const payload = { nombre_completo: nombre, nombre_usuario: usuario, password, id_rol };
        if (canDelegate) payload.can_approve_quotations = !!body.querySelector('#nu-canapprove')?.checked;

        const btn = body.querySelector('#nu-confirm');
        CommandInvoker.run(
          new CreateUserCommand(payload),
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

  _showEditUserModal(id, nombre, idRol, canApprove) {
    // Delegación de Funciones — only Jefe/Administracion/SysAdmin may set the flag.
    const canDelegate = ['Jefe', 'Administracion', 'SysAdmin'].includes(AuthSession.getRole());
    const isDelegated = String(canApprove) === '1' || canApprove === true;
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
        ${canDelegate ? `
        <div class="form-group">
          <label class="form-label checkbox-label">
            <input type="checkbox" id="eu-canapprove" ${isDelegated ? 'checked' : ''} />
            <span>Delegación de Funciones: Permitir aprobar cotizaciones</span>
          </label>
        </div>` : ''}
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
        if (canDelegate) updateData.can_approve_quotations = !!body.querySelector('#eu-canapprove')?.checked;

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
        panel.innerHTML = `<div class="empty-state"><p>Error: ${escHtml(err.message)}</p></div>`;
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
        <button class="tab-btn" data-tab="reportes">📊 Reportes</button>
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
      case 'review':     await this._renderReviewQueue(panel);    break;
      case 'quotations': await this._renderAllQuotations(panel);  break;
      case 'users':      await this._renderUsers(panel);          break;
      case 'audit':      await this._renderAuditLogs(panel);      break;
      case 'reportes':   await this._renderReportes(panel);       break;
    }
  }

  async _renderReportes(panel) {
    await renderAdvancedReports(panel);
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
                    <td>${escHtml(r.ejecutivo_nombre ?? '—')}</td>
                    <td>${escHtml(r.cliente_nombre ?? String(r.id_cliente))}</td>
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
      panel.innerHTML = `<div class="empty-state"><p>Error: ${escHtml(err.message)}</p></div>`;
    }
  }

  // ── Admin proforma detail (comment box + En Espera only) ──────────────────

  async _viewAdminDetail(id) {
    try {
      const data = await api.get(`/api/cotizaciones/${id}`);
      const q    = data.data;

      UI.openModal(`Revisión Administrador — ${q.numero_correlativo}`, (body) => {
        body.innerHTML = _buildProformaHTML(q, id, 'admin');
        wirePdfButton(body, id, q.numero_correlativo);
        wireExcelButton(body, id, q.numero_correlativo);

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
                    <td>${escHtml(r.ejecutivo_nombre ?? '—')}</td>
                    <td>${escHtml(r.cliente_nombre ?? String(r.id_cliente))}</td>
                    <td>${fmtAmount(r.monto_total, r.moneda)}</td>
                    <td>${badgeHtml(r.estado)}</td>
                    <td>${fmtDate(r.fecha_emision)}</td>
                    <td>
                      <button class="btn btn-ghost btn-sm" data-admin-view="${r.id}"
                              data-correlativo="${escHtml(r.numero_correlativo)}">
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
      panel.innerHTML = `<div class="empty-state"><p>Error: ${escHtml(err.message)}</p></div>`;
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
                                data-nombre="${u.nombre_completo}" data-rol="${u.id_rol}"
                                data-canapprove="${u.can_approve_quotations ? 1 : 0}">Editar</button>
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
          this._showEditUserModal(btn.dataset.userEdit, btn.dataset.nombre, btn.dataset.rol, btn.dataset.canapprove)));
      panel.querySelectorAll('[data-user-deact]').forEach(btn =>
        btn.addEventListener('click', () =>
          this._confirmDeactivateUser(btn.dataset.userDeact, btn.dataset.uname)));

    } catch (err) {
      panel.innerHTML = `<div class="empty-state"><p>Error cargando usuarios: ${escHtml(err.message)}</p></div>`;
    }
  }

  _showCreateUserModal() {
    // Delegación de Funciones — only Jefe/Administracion/SysAdmin may set the flag.
    const canDelegate = ['Jefe', 'Administracion', 'SysAdmin'].includes(AuthSession.getRole());
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
        ${canDelegate ? `
        <div class="form-group">
          <label class="form-label checkbox-label">
            <input type="checkbox" id="nu2-canapprove" />
            <span>Delegación de Funciones: Permitir aprobar cotizaciones</span>
          </label>
        </div>` : ''}
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
        const payload = { nombre_completo: nombre, nombre_usuario: usuario, password, id_rol };
        if (canDelegate) payload.can_approve_quotations = !!body.querySelector('#nu2-canapprove')?.checked;

        const btn = body.querySelector('#nu2-confirm');
        CommandInvoker.run(
          new CreateUserCommand(payload),
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

  _showEditUserModal(id, nombre, idRol, canApprove) {
    // Delegación de Funciones — only Jefe/Administracion/SysAdmin may set the flag.
    const canDelegate = ['Jefe', 'Administracion', 'SysAdmin'].includes(AuthSession.getRole());
    const isDelegated = String(canApprove) === '1' || canApprove === true;
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
        ${canDelegate ? `
        <div class="form-group">
          <label class="form-label checkbox-label">
            <input type="checkbox" id="eu2-canapprove" ${isDelegated ? 'checked' : ''} />
            <span>Delegación de Funciones: Permitir aprobar cotizaciones</span>
          </label>
        </div>` : ''}
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
        if (canDelegate) updateData.can_approve_quotations = !!body.querySelector('#eu2-canapprove')?.checked;
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

    // Guard — user object missing or corrupted (storage eviction / logout race)
    if (!user?.id) {
      AuthSession.clearSession();
      window.location.href = '/';
      return;
    }

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

    // ── Notification badge (Ejecutivo only) ───────────────────────────────
    // Start periodic polling so the badge stays current across soft navigations.
    // startNotifPolling fetches immediately then re-polls every 90 s.
    if (role === 'Ejecutivo') {
      requestNotifPermission();
      startNotifPolling(UI);
    }

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

  // ── Notification badge — delegated to notificationsView module ──────────────
  async _refreshNotifBadge() {
    await refreshNotifBadge(UI);
  }
}

// =============================================================================
// Bootstrap — ES modules are deferred; DOM is fully parsed at this point.
// =============================================================================
new DashboardController().init();
