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
import { mountLicitacionesTab }   from '../modules/licitacionesView.js';
import { UI }                     from '../modalUI.js';
import { CommandInvoker, ChangeStatusCommand } from '../commands.js';
import { allowedTransitions }   from '../../../shared/quotationTransitions.js';
import { buildProformaHTML }      from '../modules/proformaTemplate.js';
import { DISCARD_QUOTATION_MSG }  from '../constants.js';
import { DashboardStrategy }      from './dashboardStrategy.js';
import { ETIQUETAS_FECHA } from '../../../shared/pagination.js';
import { mountClienteItemReport } from '../modules/clienteItemReport.js';
import { createListSection } from '../../../shared/listSection.js';

export class ExecutiveStrategy extends DashboardStrategy {
  #container;
  #user;
  #sortBy  = 'creado_en';
  #sortOrd = 'DESC';
  // Dashboard partitioning: 'mias' = quotations owned by the logged-in user,
  // 'equipo' = the rest of the team's. #allRows caches the last server fetch so
  // switching tabs re-partitions IN MEMORY without a new DB query.
  #scope          = 'mias';
  #allRows        = [];
  // Paginacion del servidor, INDEPENDIENTE por solapa: cambiar de solapa no
  // debe llevarte a la pagina 7 de una lista que recien empezas a mirar.
  #pagPorScope    = { mias: { page: 1, limit: 20 }, equipo: { page: 1, limit: 20 } };
  #pagInfo        = null;   // lo que devolvio la API para la solapa activa
  #otrosTotal     = 0;      // total de la OTRA solapa, para su badge
  // La seccion de listado compartida (shared/listSection.js): el mismo ciclo
  // cargando/vacio/error/paginar que usan los cuatro paneles. Se crea despues
  // del innerHTML de render(), cuando los contenedores ya existen.
  #seccion        = null;
  #loadAbortCtrl  = null;
  // Monotonic refresh token: each refresh() bumps it, and the summary/proformas/
  // metrics loaders capture it and bail before writing if a newer refresh has
  // started — so a slow earlier response can't overwrite fresher data (the
  // stat/proformas widgets lacked the AbortController guard _loadQuotations has).
  #refreshGen     = 0;

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
            <button class="btn btn-ghost btn-sm" id="btn-consumo">📦 Consumo por Cliente</button>
            <button class="btn btn-primary btn-sm" id="btn-new-quotation">+ Nueva Cotización</button>
          </div>
        </div>

        <!-- Scope segmented control: personal workspace vs. team activity.
             Cada solapa se pagina por separado contra el servidor
             (id_ejecutivo / excluir_ejecutivo). -->
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

        <div class="card-toolbar" id="pagination-footer"></div>

        <div id="quotations-section"></div>
      </div>

      <!-- Licitaciones (only for delegated executives — mounted after render) -->
      <div id="exec-licitaciones-section" style="margin-top:1.25rem;"></div>
    `;

    this.#seccion = createListSection({
      resultsEl:    document.getElementById('quotations-section'),
      paginationEl: document.getElementById('pagination-footer'),
      columnas:     6,
      etiqueta:     'Cargando cotizaciones',
      etiquetas:    ETIQUETAS_FECHA,
      onPageChange: ({ page, limit }) => {
        this.#pagPorScope[this.#scope] = { page, limit };
        this._loadQuotations();
      },
    });

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

    // Mismo patron que "Clientes": el reporte es una tabla ancha que no entra
    // comoda en el tablero, y abrirla en un modal evita alargar una pagina que
    // ya trae estadisticas, proformas del dia y el listado.
    document.getElementById('btn-consumo')?.addEventListener('click', () => {
      UI.openModal('📦 Consumo por Cliente', (body) => {
        mountClienteItemReport(body).then((destroy) => UI.registerCleanup(destroy));
      }, { wide: true });
    });

    // Al filtrar se vuelve a la pagina 1 de LAS DOS solapas: el conjunto de
    // resultados cambia para ambas, y quedarse en la pagina 5 de una lista que
    // acaba de encogerse deja al usuario mirando el vacio.
    const filtrar = () => {
      this.#pagPorScope.mias.page   = 1;
      this.#pagPorScope.equipo.page = 1;
      this._loadQuotations();
    };

    document.getElementById('btn-filter-apply')?.addEventListener('click', filtrar);
    document.getElementById('filter-estado')?.addEventListener('change', filtrar);
    document.getElementById('filter-q')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') filtrar();
    });

    // Scope tabs — pure in-memory re-partition, NO server round-trip.
    this.#container.querySelectorAll('#exec-scope-tabs .tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (this.#scope === btn.dataset.scope) return;
        this.#scope = btn.dataset.scope;
        this.#container.querySelectorAll('#exec-scope-tabs .tab-btn')
          .forEach((b) => b.classList.toggle('active', b === btn));
        // Antes esto repartia un array cacheado en memoria. Ahora el filtrado
        // por solapa lo hace el servidor, asi que hay que volver a consultar.
        this._loadQuotations();
      });
    });

    await Promise.all([
      this._loadSummary(),
      this._loadQuotations(),
      this._loadProformasHoy(),
      this._loadMetrics(),
    ]);

    // Delegated executives (can_approve_quotations) get a Licitaciones panel:
    // they see what Proyectos handed over ('Cotizando') and can create the
    // linked cotización straight from a licitación's detail.
    this._mountLicitacionesSection();
  }

  async _mountLicitacionesSection() {
    const section = document.getElementById('exec-licitaciones-section');
    if (!section) return;
    if (!AuthSession.canApproveQuotations()) { section.innerHTML = ''; return; }

    await mountLicitacionesTab(section, {
      canCreate: false,           // delegated exec manages, but does not own/create licitaciones
      defaultEstado: 'Cotizando', // the handoff state they act on first
      onCreateCotizacion: (lic) => this._openLinkedQuotationForm(lic),
    });
  }

  // Opens the quotation form prefilled with the licitación's client + link, so
  // the delegated executive prices it and sends it back into the licitación flow.
  _openLinkedQuotationForm(lic) {
    UI.openModal(`Cotización vinculada — ${lic.codigo}`, (body) => {
      const destroy = mountQuotationForm(body, {
        prefill: {
          id_cliente:      lic.id_cliente,
          cliente_nombre:  lic.cliente_nombre,
          id_licitacion:   lic.id,
          licitacion_label: `${lic.codigo} — ${lic.nombre}`,
        },
        onSuccess: (q) => {
          UI.closeModal();
          showToast(`Cotización ${q?.numero_correlativo ?? ''} creada y vinculada a ${lic.codigo}.`, 'success');
          this.refresh();
        },
        onCancel: () => UI.closeModal(),
      });
      UI.registerCleanup(destroy);
      UI.registerCloseGuard(() => !destroy.isDirty() || confirm(DISCARD_QUOTATION_MSG));
    }, { wide: true, dismissOnBackdrop: false });
  }

  async refresh() {
    if (!this.#container) return;
    const gen = ++this.#refreshGen;
    await Promise.all([
      this._loadSummary(gen),
      this._loadQuotations(),   // has its own AbortController race guard
      this._loadProformasHoy(gen),
      this._loadMetrics(gen),
    ]);
  }

  async _loadMetrics(gen) {
    const section = document.getElementById('metrics-section');
    if (!section) return;
    if (gen != null && gen !== this.#refreshGen) return; // superseded by a newer refresh
    await renderExecutiveMetrics(section);
  }

  async _loadProformasHoy(gen) {
    const section = document.getElementById('proformas-hoy-section');
    if (!section) return;
    try {
      const data = await api.get('/api/cotizaciones?hoy=true&limit=50&sort_by=creado_en&sort_order=DESC');
      // Bail if a newer refresh started while this request was in flight.
      if (gen != null && gen !== this.#refreshGen) return;
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

  async _loadSummary(gen) {
    try {
      const data = await api.get('/api/cotizaciones/resumen');
      // Bail if a newer refresh started while this request was in flight.
      if (gen != null && gen !== this.#refreshGen) return;
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

    this.#seccion?.loading();

    const estado = document.getElementById('filter-estado')?.value ?? '';
    const q      = document.getElementById('filter-q')?.value.trim() ?? '';

    // ANTES: una sola consulta con limit=200 y un comentario que decia
    // «espeja el tope de la API». El tope real es 100 (MAX_LIMIT en
    // quotationFilters.js), asi que el servidor recortaba EN SILENCIO: a partir
    // de la cotizacion 101 el ejecutivo no veia nada, y el contador «N en total»
    // mostraba 100 pasara lo que pasara. Con 105 cotizaciones ya faltaban.
    //
    // AHORA: el servidor separa las dos solapas (id_ejecutivo / excluir_ejecutivo)
    // y devuelve una pagina de cada una. No hay techo.
    const yo    = Number(this.#user.id);
    const pag   = this.#pagPorScope[this.#scope];
    const comun = {
      sort_by: this.#sortBy, sort_order: this.#sortOrd,
      ...(estado && { estado }),
      ...(q && { q }),
    };

    const activa = new URLSearchParams({
      ...comun,
      page:  String(pag.page),
      limit: String(pag.limit),
      ...(this.#scope === 'equipo' ? { excluir_ejecutivo: yo } : { id_ejecutivo: yo }),
    });

    // La OTRA solapa se pide con limit=1: no interesan sus filas, solo su
    // total para el badge. Es una consulta de conteo con indice, practicamente
    // gratis, y evita que el badge mienta.
    const otra = new URLSearchParams({
      ...comun,
      page: '1', limit: '1',
      ...(this.#scope === 'equipo' ? { id_ejecutivo: yo } : { excluir_ejecutivo: yo }),
    });

    try {
      const [dataActiva, dataOtra] = await Promise.all([
        api.get(`/api/cotizaciones?${activa}`, { signal }),
        api.get(`/api/cotizaciones?${otra}`,   { signal }),
      ]);

      this.#allRows    = dataActiva.data ?? [];
      this.#pagInfo    = dataActiva.pagination ?? null;
      this.#otrosTotal = dataOtra.pagination?.totalRecords ?? 0;
      this._renderQuotationsTable();
    } catch (err) {
      if (err.name === 'AbortError') return;
      this.#seccion?.error(err);
    }
  }

  // Renders the table for the active scope from the cached array. No DB query.
  _renderQuotationsTable() {
    const section = document.getElementById('quotations-section');
    if (!section) return;

    // Las filas YA vienen filtradas por el servidor segun la solapa activa: no
    // se parte nada en memoria. Los badges usan los totales reales de cada
    // solapa (totalRecords), no la cantidad de filas de la pagina que se ve.
    const isTeam = this.#scope === 'equipo';
    const rows   = this.#allRows;

    const totalActiva = this.#pagInfo?.totalRecords ?? rows.length;
    const setCount = (scope, n) => {
      const el = this.#container.querySelector(`[data-scope-count="${scope}"]`);
      if (el) el.textContent = n;
    };
    setCount(this.#scope,                        totalActiva);
    setCount(isTeam ? 'mias' : 'equipo',         this.#otrosTotal);
    // 'Estado' row action is hidden for standard/delegated Ejecutivos — their
    // status changes flow through the "Ver" modal (proper UX). Management roles
    // inside this strategy (e.g. Administracion) retain the quick action.
    const showStatusBtn = this.#user.rol !== 'Ejecutivo';


    if (rows.length === 0) {
      this.#seccion?.empty({
        icono:  '📋',
        titulo: isTeam ? 'Sin cotizaciones del equipo' : 'Sin cotizaciones propias',
        texto:  isTeam
            ? 'No hay cotizaciones de otros miembros del equipo con los filtros aplicados.'
            : 'Aún no has registrado cotizaciones con los filtros aplicados.',
      });
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

    // El control compartido, el mismo de los demas listados. Antes aca solo
    // habia un texto «Mostrando N ... M en total», sin forma de pasar de pagina
    // porque no habia paginas: se traia todo de una (y se recortaba solo).
    this.#seccion?.paginate(this.#pagInfo ?? {
      page: 1, limit: this.#pagPorScope[this.#scope].limit,
      totalRecords: rows.length, totalPages: 1,
    });
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

          // Archivar SÍ entra en la delegación (a diferencia de reabrir una
          // venta cerrada, que la plantilla ni siquiera dibuja en este modo).
          body.querySelector('#btn-archivar')?.addEventListener('click', () =>
            this._confirmDelegatedStateChange(id, 'Archivada',
              'Archivar Cotización',
              'La cotización pasa a Archivada y sale de los listados activos. Es un estado final: no se puede volver atrás desde ahí.',
              'Nota para el historial (opcional)',
              false,
              '📦 Cotización archivada.'));
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
  // Mismo dialogo que usa el Jefe (modules/stateChangeDialog.js). Compartir el
  // dialogo NO comparte privilegios: las dos rutas van por PUT /:id/estado y el
  // backend revalida el permiso en cada llamada.
  _confirmDelegatedStateChange(id, newState, title, description, obsLabel, obsRequired, successMsg) {
    confirmStateChange({
      id, newState, title, description, obsLabel, obsRequired, successMsg,
      onSuccess: () => this.refresh(),
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
    // El selector ofrecía los 8 estados sin filtrar. Elegir uno que el rol no
    // podía hacer devolvía un 403 del servidor con un mensaje técnico: el
    // usuario recibía un error por una opción que la propia pantalla le había
    // ofrecido. Ahora sólo se listan las transiciones que el backend va a
    // aceptar — la lista sale del módulo compartido, que un test mantiene
    // sincronizado con la máquina de estados del servidor.
    //
    // Esto NO reemplaza la autorización: el servidor revalida siempre.
    const opciones = allowedTransitions(
      AuthSession.getRole(),
      currentStatus,
      AuthSession.canApproveQuotations()
    );

    UI.openModal('Cambiar Estado', (body) => {
      // Sin transiciones posibles, un <select> vacío no explica nada. Se dice
      // por qué y se ofrece cerrar, en vez de dejar un formulario inerte.
      if (opciones.length === 0) {
        body.innerHTML = `
          <p style="color:var(--text-secondary);margin-bottom:1rem;">
            Estado actual: ${badgeHtml(currentStatus)}
          </p>
          <p class="text-sm" style="color:var(--text-secondary);">
            Desde este estado no hay cambios disponibles para tu rol.
            Si hace falta moverla, pedíselo al Jefe.
          </p>
          <div style="display:flex;justify-content:flex-end;margin-top:1rem;">
            <button class="btn btn-ghost" id="cancel-status">Cerrar</button>
          </div>`;
        body.querySelector('#cancel-status')?.addEventListener('click', UI.closeModal);
        return;
      }

      body.innerHTML = `
        <p style="color:var(--text-secondary);margin-bottom:1rem;">
          Estado actual: ${badgeHtml(currentStatus)}
        </p>
        <div class="form-group">
          <label class="form-label" for="new-status">Nuevo Estado</label>
          <select class="form-control" id="new-status">
            ${opciones.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('')}
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
