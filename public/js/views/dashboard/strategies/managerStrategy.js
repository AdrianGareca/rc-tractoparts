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
import { mountLicitacionesTab } from '../modules/licitacionesView.js';
import { buildProformaHTML }   from '../modules/proformaTemplate.js';
import {
  showCreateUserModal, showEditUserModal, confirmDeactivateUser, confirmActivateUser,
} from '../modules/userCrudModals.js';
import { UI }                  from '../modalUI.js';
import { CommandInvoker, ChangeStatusCommand, ApproveQuotationCommand } from '../commands.js';
import { DashboardStrategy, wireTabs } from './dashboardStrategy.js';
// Faltaba. Sin este import, «Poner en espera», «Solicitar cambios»,
// «Confirmar venta» y «Archivar» tiraban ReferenceError y no hacían NADA.
import { confirmStateChange } from '../modules/stateChangeDialog.js';
import { tableSkeleton } from '../../../shared/skeleton.js';
import { mountClienteItemReport } from '../modules/clienteItemReport.js';
import { emptyState }        from '../../../shared/listSection.js';

export class ManagerStrategy extends DashboardStrategy {
  #container;
  #user;
  #activeTab = 'approvals';
  // La limpieza del panel montado, para llamarla ANTES de montar el
  // siguiente. Sin esto cada cambio de pestana dejaba dos escuchas
  // huerfanas en document (las del menu de paginacion), cada una
  // reteniendo por closure una tabla que ya no esta en el DOM.
  #limpiarPanel = null;

  constructor(user) { super(); this.#user = user; }

  async render(container) {
    this.#container = container;

    container.innerHTML = `
      <div class="tab-bar" id="manager-tabs">
        <button class="tab-btn active" data-tab="approvals">Cola de aprobación</button>
        <button class="tab-btn" data-tab="quotations">Todas las cotizaciones</button>
        <button class="tab-btn" data-tab="licitaciones">Licitaciones</button>
        <button class="tab-btn" data-tab="users">Gestión de usuarios</button>
        <button class="tab-btn" data-tab="clientes">Gestión de clientes</button>
        <button class="tab-btn" data-tab="audit">Registros de auditoría</button>
        <button class="tab-btn" data-tab="consumo">Consumo por cliente</button>
        <button class="tab-btn" data-tab="reportes">Reportes</button>
      </div>
      <div id="manager-panel"></div>
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

    const panel = document.getElementById('manager-panel');
    if (!panel) return;

    switch (tab) {
      case 'approvals':  await this._renderApprovals(panel);       break;
      case 'quotations': await this._renderAllQuotations(panel);   break;
      case 'licitaciones': this.#limpiarPanel = await mountLicitacionesTab(panel, { canCreate: true }); break;
      case 'users':      await this._renderUsers(panel);           break;
      case 'clientes':   this.#limpiarPanel = await mountClientsTab(panel);             break;
      case 'audit':      await this._renderAuditLogs(panel);       break;
      case 'consumo':    await mountClienteItemReport(panel);          break;
      case 'reportes':   await this._renderReportes(panel);        break;
    }
  }

  // ── Tab: Reportes — delegated to reportesView module ───────────────────────

  async _renderReportes(panel) {
    await renderReportes(panel);
  }


  // ── Tab: Approval queue ────────────────────────────────────────────────────

  async _renderApprovals(panel) {
    panel.innerHTML = tableSkeleton({ columnas: 8, etiqueta: 'Cargando datos' });
    try {
      const data = await api.get('/api/cotizaciones/pendientes-aprobacion');
      const rows = data.data ?? [];

      if (rows.length === 0) {
        panel.innerHTML = emptyState({
          icono:  'alDia',
          titulo: 'Cola vacía',
          texto:  'No hay cotizaciones pendientes de aprobación.',
        });
        return;
      }

      panel.innerHTML = `
        <div class="card">
          <div class="card-header">
            <h3>Cola de aprobación (${rows.length})</h3>
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
                      <button class="btn btn-primary btn-sm nowrap" data-review="${r.id}"
                             >
                        Revisar y Decidir
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
            'Solicitar cambios',
            'La cotización volverá al Ejecutivo para correcciones.',
            'Observaciones para el ejecutivo *',
            true,
            'Cambios solicitados — cotización regresada al ejecutivo.');
        });

        body.querySelector('#btn-en-espera')?.addEventListener('click', () => {
          this._confirmStateChange(id, 'En espera',
            'Poner en espera',
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
            'Venta cerrada. La cotización quedó confirmada.');
        });

        body.querySelector('#btn-archivar')?.addEventListener('click', () => {
          this._confirmArchivar(id);
        });

        body.querySelector('#btn-reabrir')?.addEventListener('click', () => {
          this._confirmReabrir(id, q);
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

  // ── Generic state-transition confirmation dialog (Solicitar cambios / En Espera) ──

  // El dialogo vive en modules/stateChangeDialog.js: estaba escrito identico
  // aca y en executiveStrategy, y lo unico que cambiaba era el prefijo de los
  // id. Este metodo queda como envoltorio para no tocar los diez llamados que
  // ya existen, y para inyectar el refresco propio de esta strategy.
  _confirmStateChange(id, newState, title, description, obsLabel, obsRequired, successMsg) {
    confirmStateChange({
      id, newState, title, description, obsLabel, obsRequired, successMsg,
      onSuccess: () => this.refresh(),
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
      'Cotización aprobada y enviada al cliente.'
    );
  }

  _showApproveDialog(id, aprobado, _triggerBtn) {
    const title  = aprobado ? 'Aprobar cotización' : 'Rechazar Cotización';
    const label  = aprobado ? 'Observaciones (opcional)' : 'Justificación del rechazo *';

    UI.openModal(title, (body) => {
      body.innerHTML = `
        <div class="confirm-dialog">
          <h4>${aprobado ? '¿Confirmar aprobación?' : '¿Confirmar rechazo?'}</h4>
          <p>Cotización: <strong>#${id}</strong></p>
          ${aprobado ? `<p class="text-sm text-secondary">Se generará el número oficial de correlativo y se bloqueará la edición.</p>` : ''}
        </div>
        <div class="form-group">
          <label class="form-label" for="obs-approval">${label}</label>
          <textarea class="form-control" id="obs-approval" rows="3"
                    placeholder="${aprobado ? 'Ej: Precios verificados con proveedor.' : 'Requerido para rechazar'}"></textarea>
          <span class="field-error" id="err-obs"></span>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost"  id="cancel-approve">Cancelar</button>
          <button class="btn ${aprobado ? 'btn-success' : 'btn-danger'}" id="confirm-approve">
            ${aprobado ? 'Sí, aprobar' : 'Sí, rechazar'}
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
    this.#limpiarPanel = await mountAllQuotationsTab(panel, {
      detailAttr:   'data-view-detail',
      onViewDetail: (id, correlativo) => this._viewFullDetail(id, correlativo),
    });
  }

  // ── Full detail view from "Todas las cotizaciones" (Jefe — with action buttons) ──

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
            'Solicitar cambios',
            'La cotización volverá al Ejecutivo para correcciones.',
            'Observaciones para el ejecutivo *', true,
            'Cambios solicitados — cotización regresada al ejecutivo.');
        });
        body.querySelector('#btn-en-espera')?.addEventListener('click', () => {
          this._confirmStateChange(id, 'En espera',
            'Poner en espera',
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
        // from the "Todas las cotizaciones" tab can complete the sale closure.
        body.querySelector('#btn-aceptar')?.addEventListener('click', () => {
          this._confirmStateChange(id, 'Confirmada',
            'Confirmar Cotización — Cierre de Venta',
            'El cliente ha confirmado los términos. Esta acción registra el cierre de venta y congela cualquier modificación adicional.',
            'Observaciones de cierre (opcional)',
            false,
            'Venta cerrada. La cotización quedó confirmada.');
        });

        body.querySelector('#btn-archivar')?.addEventListener('click', () =>
          this._confirmArchivar(id));

        body.querySelector('#btn-reabrir')?.addEventListener('click', () =>
          this._confirmReabrir(id, q));

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

  // ── Archivar ───────────────────────────────────────────────────────────────
  // El backend siempre permitió archivar desde cualquier estado no terminal,
  // pero la proforma nunca dibujó el botón. Se reusa el diálogo genérico: la
  // nota es opcional porque archivar es la salida normal, no una excepción.

  _confirmArchivar(id) {
    this._confirmStateChange(
      id,
      'Archivada',
      'Archivar Cotización',
      'La cotización pasa a Archivada y sale de los listados activos. Es un estado final: no se puede volver atrás desde ahí.',
      'Nota para el historial (opcional)',
      false,
      'Cotización archivada.'
    );
  }

  // ── La llave del jefe — reabrir una venta cerrada ──────────────────────────
  // Caso de uso: la venta ya estaba confirmada y el cliente pidió corregir
  // datos. La cotización vuelve a 'Pendiente', que es el único estado donde el
  // ejecutivo dueño puede volver a editarla; después se re-confirma.
  //
  // No se reusa _confirmStateChange aunque la mecánica sea la misma: este
  // diálogo tiene que verse distinto. Es la diferencia entre un paso del flujo
  // y una excepción que queda registrada con nombre y apellido.

  _confirmReabrir(id, q) {
    const referencia = q?.numero_correlativo ? `#${q.numero_correlativo}` : `#${id}`;

    UI.openModal('Reabrir venta cerrada', (body) => {
      body.innerHTML = `
        <div class="llave-jefe" style="margin-top:0;padding:1rem;border-radius:6px;">
          <strong style="color:var(--clr-amber-soft);">Acción excepcional</strong>
          <p class="text-sm" style="color:var(--text-secondary);margin:.4rem 0 0;">
            La cotización <strong>${escHtml(referencia)}</strong> es una
            <strong>venta cerrada</strong>. Al reabrirla vuelve a
            <strong>Pendiente</strong> y el ejecutivo podrá editarla otra vez.
            Corregido el dato, se vuelve a confirmar.
          </p>
          <p class="text-sm" style="color:var(--text-secondary);margin:.5rem 0 0;">
            Queda registrado quién la reabrió, cuándo y por qué — en el historial
            de la cotización y en la bitácora de auditoría.
          </p>
        </div>
        <div class="form-group mt-2">
          <label class="form-label" for="reab-motivo">Motivo de la reapertura *</label>
          <textarea class="form-control" id="reab-motivo" rows="3"
                    placeholder="Ej: El cliente pidió corregir el NIT y la cantidad del ítem 2."></textarea>
          <span class="field-error" id="reab-err"></span>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="reab-cancel">Cancelar</button>
          <button class="btn btn-sm llave-jefe-btn" id="reab-confirm">
            Reabrir para corrección
          </button>
        </div>`;

      body.querySelector('#reab-cancel')?.addEventListener('click', UI.closeModal);
      body.querySelector('#reab-confirm')?.addEventListener('click', () => {
        const motivo = body.querySelector('#reab-motivo')?.value.trim() ?? '';
        const errEl  = body.querySelector('#reab-err');

        // El servidor también lo exige (422); esto sólo evita el viaje de ida y
        // vuelta y da el mensaje en el campo, no en un toast.
        if (!motivo) { errEl.textContent = 'El motivo es obligatorio para reabrir una venta cerrada.'; return; }
        errEl.textContent = '';

        CommandInvoker.run(
          new ChangeStatusCommand(id, 'Pendiente', `[REAPERTURA] ${motivo}`),
          {
            btn:        body.querySelector('#reab-confirm'),
            successMsg: 'Venta reabierta. La cotización volvió a Pendiente y el ejecutivo fue notificado.',
            onSuccess:  () => { UI.closeModal(); this.refresh(); },
          }
        );
      });
    });
  }

  // ── Confirm revert rejection — Jefe / SysAdmin exclusive ────────────────────────

  _confirmRevertRejection(id, targetState) {
    const label = targetState === 'Pendiente'
      ? 'Revertir a Pendiente (Borrador para Correcciones)'
      : 'Revertir a En Revisión (Flujo de Aprobación)';

    // El recuadro de advertencia usa .form-alert.alert-warning, que el proyecto
    // ya tenía. Estaba dibujado a mano con tres amarillos fijos que eran de tema
    // claro: en los temas oscuros quedaba un cuadro casi blanco con texto marrón.
    //
    // La explicación va acá y no como comentario HTML dentro de la plantilla:
    // un <!-- --> en un innerHTML se inserta en el DOM y viaja al navegador.
    // Un comentario para quien lee el código no tiene por qué llegar al cliente.
    UI.openModal('Revertir rechazo / revaluar cotización', (body) => {
      body.innerHTML = `
        <div class="form-alert alert-warning show mb-2">
          <strong>Acción de alta autoridad</strong>
          <p class="text-sm mt-025">
            Esta acción revierte el estado de <strong>Rechazada</strong> a
            <strong>${escHtml(targetState)}</strong> y reinyecta la cotización en el flujo de trabajo.
            El historial de rechazo se preservará en la trazabilidad de estados.
          </p>
        </div>
        <div class="form-group">
          <label class="form-label" for="rev-obs">Justificación de la revaluación *</label>
          <textarea class="form-control" id="rev-obs" rows="3"
                    placeholder="Ej: Nueva información del proveedor cambia las condiciones comerciales."></textarea>
          <span class="field-error" id="rev-err"></span>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="rev-cancel">Cancelar</button>
          <button class="btn btn-warning btn-sm fw-600" id="rev-confirm">
            Confirmar revertir rechazo
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
            successMsg: `Cotización revertida a "${targetState}". Vuelve al flujo del ejecutivo.`,
            onSuccess:  () => { UI.closeModal(); this.refresh(); },
          }
        );
      });
    });
  }

  // ── Tab: User Management (CRUD) ───────────────────────────────────────────

  async _renderUsers(panel) {
    panel.innerHTML = tableSkeleton({ columnas: 8, etiqueta: 'Cargando datos' });
    try {
      const data  = await api.get('/api/usuarios');
      const users = data.data ?? [];

      panel.innerHTML = `
        <div class="card">
          <div class="card-header">
            <h3>Gestión de usuarios</h3>
            <button class="btn btn-primary btn-sm" id="btn-create-user">+ Nuevo usuario</button>
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
    this.#limpiarPanel = await mountAuditLogTab(panel);
  }
}
