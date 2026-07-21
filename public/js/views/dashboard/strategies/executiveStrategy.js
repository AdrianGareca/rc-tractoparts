// =============================================================================
// public/js/views/dashboard/strategies/executiveStrategy.js
// STRATEGY: ExecutiveStrategy (Ejecutivo role)
//   • Summary stats, own quotation table, "Nueva Cotización" action
//   • Delegación de Funciones ampliada — executives holding
//     can_approve_quotations get the full operational action grid too.
//
// Extracted verbatim from dashboardView.js as part of the file-size cleanup
// — no behavioral change.
// =============================================================================

import AuthSession             from '../../../services/authSession.js';
import api, { showToast }      from '../../../services/apiClient.js';
import { mountQuotationForm }  from '../../quotationForm.js';
import { STAT_COLOR, badgeHtml, fmtDate, escHtml, fmtAmount } from '../helpers.js';
import { wirePdfButton, wireExcelButton, buildTimelineHtml }  from '../modules/timelineView.js';
import { renderExecutiveMetrics } from '../modules/reportesView.js';
import { mountClientsTab }        from '../modules/clientsView.js';
import { UI }                     from '../modalUI.js';
import { CommandInvoker, ChangeStatusCommand } from '../commands.js';
import { buildProformaHTML }      from '../modules/proformaTemplate.js';
import { DISCARD_QUOTATION_MSG }  from '../constants.js';
import { DashboardStrategy }      from './dashboardStrategy.js';

export class ExecutiveStrategy extends DashboardStrategy {
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
          <div style="display:flex;gap:.5rem;">
            <button class="btn btn-ghost btn-sm" id="btn-manage-clients">🏢 Clientes</button>
            <button class="btn btn-primary btn-sm" id="btn-new-quotation">+ Nueva Cotización</button>
          </div>
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
              <option>Enviada al cliente</option><option>Confirmada</option>
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
        const destroy = mountQuotationForm(body, {
          onSuccess: (q) => {
            UI.closeModal();
            showToast(`Cotización ${q?.numero_correlativo ?? ''} creada exitosamente.`, 'success');
            this.refresh();
          },
          onCancel: () => UI.closeModal(),
        });
        UI.registerCleanup(destroy);
        UI.registerCloseGuard(() => !destroy.isDirty() || confirm(DISCARD_QUOTATION_MSG));
      }, { wide: true, dismissOnBackdrop: false });
    });

    document.getElementById('btn-manage-clients')?.addEventListener('click', () => {
      UI.openModal('Gestión de Clientes', (body) => { mountClientsTab(body); }, { wide: true });
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
    await renderExecutiveMetrics(section);
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

      const highlighted = ['Pendiente', 'En revision', 'Aprobada internamente', 'Confirmada'];
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
                <td class="fw-600">${escHtml(r.numero_correlativo)}</td>
                <td>${r.cliente_nombre ? escHtml(r.cliente_nombre) : r.id_cliente}</td>
                ${isTeam ? `<td>${escHtml(r.ejecutivo_nombre ?? '—')}</td>` : ''}
                <td>${fmtDate(r.fecha_emision)}</td>
                <td>${fmtAmount(r.monto_total, r.moneda)}</td>
                <td>${badgeHtml(r.estado)}</td>
                <td>
                  <div class="table-actions">
                    <button class="btn btn-ghost btn-sm" data-action="view" data-id="${r.id}">Ver</button>
                    ${showStatusBtn
                      ? `<button class="btn btn-ghost btn-sm" data-action="status" data-id="${r.id}" data-estado="${escHtml(r.estado)}">Estado</button>`
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
      // buildProformaHTML('delegate') adds the single approve button.
      const delegated  = AuthSession.canApproveQuotations();
      // Editable only while the quotation is still a 'Pendiente' draft owned by
      // this executive (matches the backend PUT /:id ownership + state guard).
      const isOwner    = q.id_ejecutivo === this.#user.id;
      const editable   = isOwner && q.estado === 'Pendiente';

      UI.openModal(`Cotización ${q.numero_correlativo}`, (body) => {
        body.innerHTML = buildProformaHTML(q, id, delegated ? 'delegate' : false);

        if (editable) {
          body.insertAdjacentHTML('afterbegin', `
            <div style="display:flex;justify-content:flex-end;margin-bottom:1rem;">
              <button class="btn btn-primary btn-sm" id="btn-editar-cotizacion">✏️ Editar Cotización</button>
            </div>`);
          body.querySelector('#btn-editar-cotizacion')?.addEventListener('click', () =>
            this._editQuotation(q));
        }

        if (delegated) {
          // Delegación de Funciones AMPLIADA — full operational wiring. Every
          // action flows through PUT /:id/estado (ChangeStatusCommand); the
          // backend re-reads the flag fresh from the DB on each transition.
          // The jefeOnly POST /:id/aprobar route is never used here.
          body.querySelector('#btn-aprobar')?.addEventListener('click', () =>
            this._confirmDelegatedApproval(id));

          body.querySelector('#btn-solicitar-cambios')?.addEventListener('click', () =>
            this._confirmDelegatedStateChange(id, 'Pendiente',
              'Solicitar Cambios',
              'La cotización volverá a estado Pendiente para correcciones.',
              'Observaciones para el propietario *',
              true,
              'Cambios solicitados — cotización regresada a Pendiente.'));

          body.querySelector('#btn-en-espera')?.addEventListener('click', () =>
            this._confirmDelegatedStateChange(id, 'En espera',
              'Poner en Espera',
              'La decisión queda suspendida mientras se verifica disponibilidad con el proveedor.',
              'Motivo de la espera (opcional)',
              false,
              'Cotización puesta en espera.'));

          body.querySelector('#btn-enviar-cliente')?.addEventListener('click', () =>
            this._confirmDelegatedStateChange(id, 'Enviada al cliente',
              'Aprobar y Enviar al Cliente',
              'La cotización pasará directamente al estado "Enviada al cliente". Esta acción queda registrada en el historial.',
              'Nota para el historial (opcional)',
              false,
              '🟢 Cotización enviada al cliente exitosamente.'));

          body.querySelector('#btn-rechazar')?.addEventListener('click', () =>
            this._confirmDelegatedStateChange(id, 'Rechazada',
              'Rechazar Cotización',
              'La cotización quedará rechazada. La justificación es obligatoria.',
              'Justificación del rechazo *',
              true,
              'Cotización rechazada.'));

          body.querySelector('#btn-aceptar')?.addEventListener('click', () =>
            this._confirmDelegatedStateChange(id, 'Confirmada',
              'Confirmar Cotización — Cierre de Venta',
              'El cliente ha confirmado los términos. Esta acción registra el cierre de venta y congela cualquier modificación adicional.',
              'Observaciones de cierre (opcional)',
              false,
              '🏆 ¡Cierre de venta registrado! La cotización ha sido confirmada.'));
        }

        wirePdfButton(body, id, q.numero_correlativo, q.cliente_nombre);
        wireExcelButton(body, id, q.numero_correlativo, q.cliente_nombre);
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

  // ── Generic delegated state-transition confirmation (Delegación ampliada) ────
  // Mirrors ManagerStrategy._confirmStateChange: shows a confirm dialog with an
  // optional/required observation textarea, then transitions via the standard
  // PUT /:id/estado endpoint. The backend authorizes each transition only
  // because the executive carries the can_approve_quotations flag (re-read
  // fresh from the DB server-side on every call).
  _confirmDelegatedStateChange(id, newState, title, description, obsLabel, obsRequired, successMsg) {
    UI.openModal(title, (body) => {
      body.innerHTML = `
        <p class="text-sm" style="color:var(--text-secondary);margin-bottom:1rem;">
          ${description}
        </p>
        <div class="form-group">
          <label class="form-label" for="dsc-obs">${obsLabel}</label>
          <textarea class="form-control" id="dsc-obs" rows="3"></textarea>
          <span class="field-error" id="dsc-err"></span>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:1rem;">
          <button class="btn btn-ghost" id="dsc-cancel">Cancelar</button>
          <button class="btn btn-primary" id="dsc-confirm">${title}</button>
        </div>`;

      body.querySelector('#dsc-cancel')?.addEventListener('click', UI.closeModal);
      body.querySelector('#dsc-confirm')?.addEventListener('click', () => {
        const obs   = body.querySelector('#dsc-obs')?.value.trim() ?? '';
        const errEl = body.querySelector('#dsc-err');
        if (obsRequired && !obs) {
          errEl.textContent = 'Este campo es requerido.';
          return;
        }
        const btn = body.querySelector('#dsc-confirm');
        CommandInvoker.run(new ChangeStatusCommand(id, newState, obs), {
          btn,
          successMsg,
          onSuccess: () => { UI.closeModal(); this.refresh(); },
        });
      });
    });
  }

  // ── Edit an existing 'Pendiente' quotation (Solicitar Cambios workflow) ──────
  // Mounts the shared quotation form in edit mode, pre-populated with the current
  // header + line items, and PUTs the changes to PUT /api/cotizaciones/:id.
  _editQuotation(q) {
    UI.openModal(`Editar Cotización ${q.numero_correlativo}`, (body) => {
      const destroy = mountQuotationForm(body, {
        quotation: q,
        onSuccess: (updated) => {
          UI.closeModal();
          showToast(`Cotización ${updated?.numero_correlativo ?? q.numero_correlativo} actualizada.`, 'success');
          this.refresh();
        },
        onCancel: () => UI.closeModal(),
      });
      UI.registerCleanup(destroy);
      UI.registerCloseGuard(() => !destroy.isDirty() || confirm(DISCARD_QUOTATION_MSG));
    }, { wide: true, dismissOnBackdrop: false });
  }

  _changeStatus(id, currentStatus, triggerBtn) {
    // Mirrors QuotationModel.VALID_STATES exactly. 'Borrador' is a display-only
    // badge, NOT a valid ENUM/transition target — sending it returns 422.
    const VALID_STATES = [
      'Pendiente','En revision','En espera',
      'Aprobada internamente','Enviada al cliente',
      'Confirmada','Rechazada','Archivada',
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
