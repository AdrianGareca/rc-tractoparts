// =============================================================================
// public/js/views/dashboard/strategies/managerStrategy.js
// STRATEGY: ManagerStrategy (Jefe / SysAdmin roles)
//   • Global overview, pending-approval queue, all quotations,
//     User CRUD panel, Audit Logs workspace
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
import { CommandInvoker, ChangeStatusCommand, ApproveQuotationCommand } from '../commands.js';
import { DashboardStrategy } from './dashboardStrategy.js';

export class ManagerStrategy extends DashboardStrategy {
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
        <button class="tab-btn" data-tab="clientes">Gestión de Clientes</button>
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
      case 'clientes':   await mountClientsTab(panel);             break;
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
                    <td class="fw-600">${escHtml(r.numero_correlativo)}</td>
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
        body.innerHTML = buildProformaHTML(q, id, true);
        wirePdfButton(body, id, q.numero_correlativo, q.cliente_nombre);
        wireExcelButton(body, id, q.numero_correlativo, q.cliente_nombre);

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
          this._confirmStateChange(id, 'Confirmada',
            'Confirmar Cotización — Cierre de Venta',
            'El cliente ha confirmado los términos. Esta acción registra el cierre de venta y congela cualquier modificación adicional.',
            'Observaciones de cierre (opcional)',
            false,
            '🏆 ¡Cierre de venta registrado! La cotización ha sido confirmada.');
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
    await mountAllQuotationsTab(panel, {
      detailAttr:   'data-view-detail',
      onViewDetail: (id, correlativo) => this._viewFullDetail(id, correlativo),
    });
  }

  // ── Full detail view from "Todas las Cotizaciones" (Jefe — with action buttons) ──

  async _viewFullDetail(id, correlativo) {
    try {
      const data = await api.get(`/api/cotizaciones/${id}`);
      const q    = data.data;
      UI.openModal(`Proforma ${correlativo ?? q.numero_correlativo}`, (body) => {
        body.innerHTML = buildProformaHTML(q, id, 'jefe');
        wirePdfButton(body, id, correlativo ?? q.numero_correlativo, q.cliente_nombre);
        wireExcelButton(body, id, correlativo ?? q.numero_correlativo, q.cliente_nombre);
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
          this._confirmStateChange(id, 'Confirmada',
            'Confirmar Cotización — Cierre de Venta',
            'El cliente ha confirmado los términos. Esta acción registra el cierre de venta y congela cualquier modificación adicional.',
            'Observaciones de cierre (opcional)',
            false,
            '🏆 ¡Cierre de venta registrado! La cotización ha sido confirmada.');
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

      panel.querySelector('#btn-create-user')?.addEventListener('click', () =>
        this._showCreateUserModal());

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

  // ── User CRUD modals — shared with AdminStrategy via userCrudModals.js ─────
  // Each just supplies "how to refresh after a successful mutation" for this
  // strategy's panel.

  _showCreateUserModal() {
    showCreateUserModal(() => this._renderUsers(document.getElementById('manager-panel')));
  }

  _showEditUserModal(id, nombre, idRol, canApprove) {
    showEditUserModal(id, nombre, idRol, canApprove,
      () => this._renderUsers(document.getElementById('manager-panel')));
  }

  _confirmDeactivateUser(id, username) {
    confirmDeactivateUser(id, username,
      () => this._renderUsers(document.getElementById('manager-panel')));
  }

  _confirmActivateUser(id, username) {
    confirmActivateUser(id, username,
      () => this._renderUsers(document.getElementById('manager-panel')));
  }

  // ── Tab: Audit Logs ────────────────────────────────────────────────────────

  async _renderAuditLogs(panel) {
    await mountAuditLogTab(panel);
  }
}
