// =============================================================================
// public/js/views/dashboard/strategies/adminStrategy.js
// STRATEGY: AdminStrategy (Administracion role)
// Tabs: Cola de Revisión, Todas las Cotizaciones, Gestión de Usuarios, Auditoría
// Key difference from ManagerStrategy:
//   • Can add comments & put quotations "En espera" — but CANNOT approve/reject
//   • Sees Jefe's approval queue in read-only mode (Cola de Revisión)
//   • Has full User CRUD access (same as Jefe per spec)
//
// Extracted verbatim from dashboardView.js as part of the file-size cleanup
// — no behavioral change.
// =============================================================================

import api, { showToast } from '../../../services/apiClient.js';
import { escHtml, badgeHtml, fmtAmount, fmtDate, roleBadgeHtml } from '../helpers.js';
import { wirePdfButton, wireExcelButton } from '../modules/timelineView.js';
import { renderReportes }      from '../modules/reportesView.js';
import { mountClientsTab }     from '../modules/clientsView.js';
import { mountAuditLogTab }    from '../modules/auditView.js';
import { mountAllQuotationsTab } from '../modules/allQuotationsTab.js';
import { buildProformaHTML }   from '../modules/proformaTemplate.js';
import {
  showCreateUserModal, showEditUserModal, confirmDeactivateUser, confirmActivateUser,
} from '../modules/userCrudModals.js';
import { UI }                  from '../modalUI.js';
import {
  CommandInvoker, ChangeStatusCommand, SetComentarioAdminCommand, HoldWithCommentCommand,
} from '../commands.js';
import { DashboardStrategy } from './dashboardStrategy.js';

export class AdminStrategy extends DashboardStrategy {
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
        <button class="tab-btn" data-tab="clientes">Gestión de Clientes</button>
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
      case 'clientes':   await mountClientsTab(panel);            break;
      case 'audit':      await this._renderAuditLogs(panel);      break;
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
                    <td class="fw-600">${escHtml(r.numero_correlativo)}</td>
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
        body.innerHTML = buildProformaHTML(q, id, 'admin');
        wirePdfButton(body, id, q.numero_correlativo, q.cliente_nombre);
        wireExcelButton(body, id, q.numero_correlativo, q.cliente_nombre);

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

        // Wire "Solicitar Cambios" button (Administracion → Pendiente)
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
    await mountAllQuotationsTab(panel, {
      detailAttr:   'data-admin-view',
      onViewDetail: (id) => this._viewAdminDetail(id),
    });
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
                    <td>${escHtml(u.nombre_completo)}</td>
                    <td class="fw-600">${escHtml(u.nombre_usuario)}</td>
                    <td>${roleBadgeHtml(u.rol)}</td>
                    <td>
                      <span class="badge ${u.activo ? 'badge-active' : 'badge-inactive'}">
                        ${u.activo ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td>
                      <div class="table-actions">
                        <button class="btn btn-ghost btn-sm" data-user-edit="${u.id}"
                                data-nombre="${escHtml(u.nombre_completo)}" data-rol="${u.id_rol}"
                                data-canapprove="${u.can_approve_quotations ? 1 : 0}">Editar</button>
                        ${u.activo
                          ? `<button class="btn btn-danger btn-sm" data-user-deact="${u.id}"
                                data-uname="${escHtml(u.nombre_usuario)}">Desactivar</button>`
                          : `<button class="btn btn-success btn-sm" data-user-act="${u.id}"
                                data-uname="${escHtml(u.nombre_usuario)}">Activar</button>`}
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

      panel.querySelectorAll('[data-user-act]').forEach(btn =>
        btn.addEventListener('click', () =>
          this._confirmActivateUser(btn.dataset.userAct, btn.dataset.uname)));

    } catch (err) {
      panel.innerHTML = `<div class="empty-state"><p>Error cargando usuarios: ${escHtml(err.message)}</p></div>`;
    }
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
    await mountAuditLogTab(panel);
  }
}
