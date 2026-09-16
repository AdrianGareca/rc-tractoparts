// =============================================================================
// public/js/views/dashboard/strategies/adminStrategy.js
// STRATEGY: AdminStrategy (Administracion role)
// Tabs: Cola de revisión, Todas las cotizaciones, Gestión de usuarios, Auditoría
// Key difference from ManagerStrategy:
//   • Can add comments & put quotations "En espera" — but CANNOT approve/reject
//   • Sees Jefe's approval queue in read-only mode (Cola de revisión)
//   • Has full User CRUD access (same as Jefe per spec)
//
// Extracted verbatim from dashboardView.js as part of the file-size cleanup
// — no behavioral change.
// =============================================================================

import api, { showToast } from '../../../services/apiClient.js';
// roleBadgeHtml salió de acá junto con la tabla de usuarios: ahora la usa
// modules/usersTab.js, que es el único lugar de esta pantalla que pinta roles.
import { escHtml, badgeHtml, fmtAmount, fmtDate } from '../helpers.js';
import { wirePdfButton, wireExcelButton, wireSeguimientoVenta } from '../modules/timelineView.js';
import { renderReportes }      from '../modules/reportesView.js';
import { mountClientsTab }     from '../modules/clientsView.js';
import { mountAuditLogTab }    from '../modules/auditView.js';
import { mountAllQuotationsTab } from '../modules/allQuotationsTab.js';
import { mountLicitacionesTab } from '../modules/licitacionesView.js';
import { mountUsersTab }       from '../modules/usersTab.js';
import { buildProformaHTML }   from '../modules/proformaTemplate.js';
import {
  showCreateUserModal, showEditUserModal, confirmDeactivateUser, confirmActivateUser,
} from '../modules/userCrudModals.js';
import { UI }                  from '../modalUI.js';
import {
  CommandInvoker, ChangeStatusCommand, SetComentarioAdminCommand, HoldWithCommentCommand,
} from '../commands.js';
import { DashboardStrategy, wireTabs } from './dashboardStrategy.js';
import { emptyState }        from '../../../shared/listSection.js';
import { tableSkeleton } from '../../../shared/skeleton.js';
import { mountClienteItemReport } from '../modules/clienteItemReport.js';
// La cola (paginada) es la misma para el Jefe y el Administrador.
import { mountColaAprobacion } from '../modules/colaAprobacion.js';

export class AdminStrategy extends DashboardStrategy {
  #container;
  #user;
  #activeTab = 'review';
  // La limpieza del panel montado, para llamarla ANTES de montar el
  // siguiente. Sin esto cada cambio de pestana dejaba dos escuchas
  // huerfanas en document (las del menu de paginacion), cada una
  // reteniendo por closure una tabla que ya no esta en el DOM.
  #limpiarPanel = null;

  constructor(user) { super(); this.#user = user; }

  async render(container) {
    this.#container = container;

    container.innerHTML = `
      <div class="tab-bar" id="admin-tabs">
        <button class="tab-btn active" data-tab="review">Cola de revisión</button>
        <button class="tab-btn" data-tab="quotations">Todas las cotizaciones</button>
        <button class="tab-btn" data-tab="licitaciones">Licitaciones</button>
        <button class="tab-btn" data-tab="users">Gestión de usuarios</button>
        <button class="tab-btn" data-tab="clientes">Gestión de clientes</button>
        <button class="tab-btn" data-tab="audit">Registros de auditoría</button>
        <button class="tab-btn" data-tab="consumo">Consumo por cliente</button>
        <button class="tab-btn" data-tab="reportes">Reportes</button>
      </div>
      <div id="admin-panel"></div>
    `;

    // El apagar/encender de las pestañas vive en dashboardStrategy.js: era
    // idéntico en las tres estrategias que las tienen. El estado se queda acá
    // porque #activeTab es privado de esta clase.
    wireTabs(container, (tab) => {
      this.#activeTab = tab;
      this._renderPanel(tab);
    });

    await this._renderPanel(this.#activeTab);
  }

  async refresh() {
    if (this.#container) await this._renderPanel(this.#activeTab);
  }

  async _renderPanel(tab) {
    // Se desmonta lo anterior antes de pisar el innerHTML: los montadores
    // devuelven su limpieza justamente para esto.
    this.#limpiarPanel?.();
    this.#limpiarPanel = null;

    const panel = document.getElementById('admin-panel');
    if (!panel) return;
    switch (tab) {
      case 'review':     this.#limpiarPanel = await this._renderReviewQueue(panel); break;
      case 'quotations': await this._renderAllQuotations(panel);  break;
      case 'licitaciones': this.#limpiarPanel = await mountLicitacionesTab(panel, { canCreate: false }); break;
      case 'users':      await this._renderUsers(panel);          break;
      case 'clientes':   this.#limpiarPanel = await mountClientsTab(panel);            break;
      case 'audit':      await this._renderAuditLogs(panel);      break;
      case 'consumo':    await mountClienteItemReport(panel);          break;
      case 'reportes':   await this._renderReportes(panel);       break;
    }
  }

  async _renderReportes(panel) {
    // Administracion now sees the SAME full analytics dashboard as the Jefe
    // (stats grid + per-executive breakdown + BI tables), with date-range
    // filtering — not just the trimmed advanced view.
    await renderReportes(panel);
  }

  // ── Tab: Review queue (read + hold + comment) ─────────────────────────────

  async _renderReviewQueue(panel) {
    // Paginada desde la ronda de estrés del 2026-09-15, y compartida con la
    // cola del Jefe: ver modules/colaAprobacion.js.
    return mountColaAprobacion(panel, {
      titulo:     'Cola de revisión',
      ayuda:      'Puede añadir comentarios y poner en espera',
      conEstado:  false,
      textoBoton: 'Revisar',
      textoVacio: 'No hay cotizaciones pendientes de revisión.',
      onRevisar:  (id) => this._viewAdminDetail(id),
    });
  }

  // ── Admin proforma detail (comment box + En Espera only) ──────────────────

  async _viewAdminDetail(id) {
    try {
      const data = await api.get(`/api/cotizaciones/${id}`);
      const q    = data.data;

      UI.openModal(`Revisión Administrador — ${q.numero_correlativo}`, (body) => {
        body.innerHTML = buildProformaHTML(q, id, 'admin');
        wirePdfButton(body, id, q.numero_correlativo, q.cliente_nombre);
        wireExcelButton(body, id, q.numero_correlativo, q.cliente_nombre);
        wireSeguimientoVenta(body, id, q.id_ejecutivo, () => this.refresh());

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

        // Wire "Poner en espera con Comentario" button
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

        // Wire "Solicitar cambios" button (Administracion → Pendiente)
        body.querySelector('#btn-admin-solicitar-cambios')?.addEventListener('click', () => {
          const comment = body.querySelector('#admin-comment-input')?.value.trim() ?? '';
          const errEl2  = body.querySelector('#admin-comment-err');
          const btn     = body.querySelector('#btn-admin-solicitar-cambios');
          if (!comment) {
            errEl2.textContent = 'El comentario es requerido para solicitar cambios.';
            return;
          }
          errEl2.textContent = '';
          CommandInvoker.run(new ChangeStatusCommand(id, 'Pendiente', comment), {
            btn,
            successMsg: 'Cambios solicitados. La cotización ha vuelto al ejecutivo.',
            onSuccess:  () => { UI.closeModal(); this.refresh(); },
            onError:    (apiErr) => { errEl2.textContent = apiErr.data?.message || apiErr.message; },
          });
        });
      }, { wide: true });
    } catch (err) {
      showToast(`No se pudo cargar la cotización: ${err.message}`, 'error');
    }
  }

  // ── Tab: All quotations (full detail, admin view) ─────────────────────────

  async _renderAllQuotations(panel) {
    this.#limpiarPanel = await mountAllQuotationsTab(panel, {
      detailAttr:   'data-admin-view',
      onViewDetail: (id) => this._viewAdminDetail(id),
    });
  }

  // ── Tab: User Management ─────────────────────────────────────────────────
  // Admin has full CRUD access per the hierarchy spec (same as Jefe).
  //
  // La tabla y su cableado viven en modules/usersTab.js: eran las mismas ~70
  // líneas que ManagerStrategy, y ya se habían desincronizado una vez (ver el
  // comentario de ese archivo). Acá se queda sólo lo propio de esta strategy:
  // el id de su botón y a qué modal va cada acción.
  async _renderUsers(panel) {
    await mountUsersTab(panel, {
      botonCrearId: 'btn-create-user-admin',
      onCrear:      () => this._showCreateUserModal(),
      onEditar:     (id, nombre, rol, canApprove) => this._showEditUserModal(id, nombre, rol, canApprove),
      onDesactivar: (id, uname) => this._confirmDeactivateUser(id, uname),
      onActivar:    (id, uname) => this._confirmActivateUser(id, uname),
    });
  }

  // ── User CRUD modals — shared with ManagerStrategy via userCrudModals.js ───
  // Each just supplies "how to refresh after a successful mutation" for this
  // strategy's panel.

  _showCreateUserModal() {
    showCreateUserModal(() => this._renderUsers(document.getElementById('admin-panel')));
  }

  _showEditUserModal(id, nombre, idRol, canApprove) {
    showEditUserModal(id, nombre, idRol, canApprove,
      () => this._renderUsers(document.getElementById('admin-panel')));
  }

  _confirmDeactivateUser(id, username) {
    confirmDeactivateUser(id, username,
      () => this._renderUsers(document.getElementById('admin-panel')));
  }

  _confirmActivateUser(id, username) {
    confirmActivateUser(id, username,
      () => this._renderUsers(document.getElementById('admin-panel')));
  }

  // ── Tab: Audit logs ───────────────────────────────────────────────────────
  async _renderAuditLogs(panel) {
    this.#limpiarPanel = await mountAuditLogTab(panel);
  }
}
