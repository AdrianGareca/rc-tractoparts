// =============================================================================
// public/js/views/dashboard/modules/licitacionesView.js
// "Licitaciones" tab — paginated, filterable list of licitaciones + a detail
// sub-modal (linked cotizaciones, budget comparison, state timeline, and
// role-aware transition buttons).
//
// Shared by every strategy that surfaces licitaciones:
//   • ProyectosStrategy   — canManage (create/edit own), transitions per matrix
//   • ManagerStrategy/Admin — read + full override transitions
//   • Delegated Ejecutivo — read + limited transitions, defaultEstado=Cotizando
//
// mountLicitacionesTab(panel, opts)
//   opts.canCreate     {boolean} show "+ Nueva Licitación" (Proyectos/Jefe/SysAdmin)
//   opts.defaultEstado {string}  preselect an estado filter (e.g. 'Cotizando')
//   opts.onCreateCotizacion {function(licitacion)} optional — when provided, the
//                              detail shows a "Crear cotización vinculada" button
//                              (used by the delegated Ejecutivo path).
//
// Role/ownership/transition rules are read from AuthSession and mirror
// LicitacionModel.LICITACION_ROLE_TRANSITIONS (kept in sync deliberately — the
// browser cannot call the server-side matrix; the backend re-validates anyway).
// =============================================================================

import api, { showToast } from '../../../services/apiClient.js';
import AuthSession from '../../../services/authSession.js';
import { escHtml, fmtDate, fmtAmount, licitacionBadgeHtml, docIcon, fmtFileSize } from '../helpers.js';
import { buildTimelineHtml, saveBlobAs } from './timelineView.js';
import { openLicitacionModal } from './licitacionModal.js';

const ESTADOS = [
  'En preparacion', 'Cotizando', 'En evaluacion',
  'Presentada', 'Adjudicada', 'No adjudicada', 'Archivada',
];

// Client-side mirror of LicitacionModel.LICITACION_ROLE_TRANSITIONS. Purely for
// UX (which buttons to show); the server re-validates every transition.
const TRANSITIONS = {
  responsable: {
    'En preparacion': ['Cotizando', 'Archivada'],
    'Cotizando':      ['En evaluacion', 'En preparacion'],
    'En evaluacion':  ['Presentada', 'Cotizando'],
    'Presentada':     ['Adjudicada', 'No adjudicada'],
    'Adjudicada':     ['Archivada'],
    'No adjudicada':  ['Archivada'],
    'Archivada':      [],
  },
  delegado: {
    'En preparacion': [],
    'Cotizando':      ['En evaluacion'],
    'En evaluacion':  ['Presentada', 'Cotizando'],
    'Presentada':     [],
    'Adjudicada':     [],
    'No adjudicada':  [],
    'Archivada':      [],
  },
  jefe: {
    'En preparacion': ['Cotizando', 'En evaluacion', 'Presentada', 'Adjudicada', 'No adjudicada', 'Archivada'],
    'Cotizando':      ['En preparacion', 'En evaluacion', 'Presentada', 'Adjudicada', 'No adjudicada', 'Archivada'],
    'En evaluacion':  ['En preparacion', 'Cotizando', 'Presentada', 'Adjudicada', 'No adjudicada', 'Archivada'],
    'Presentada':     ['En evaluacion', 'Cotizando', 'Adjudicada', 'No adjudicada', 'Archivada'],
    'Adjudicada':     ['No adjudicada', 'Archivada'],
    'No adjudicada':  ['Adjudicada', 'Archivada'],
    'Archivada':      [],
  },
};

const EDITABLE_STATES = ['En preparacion', 'Cotizando'];

// Resolve the acting user's "actor type" for a given licitación.
function resolveActorType(licitacion) {
  const role = AuthSession.getRole();
  if (role === 'Jefe' || role === 'SysAdmin') return 'jefe';
  if (role === 'Proyectos' && AuthSession.getUserId() === licitacion.id_responsable) return 'responsable';
  if (role === 'Ejecutivo' && AuthSession.canApproveQuotations()) return 'delegado';
  return null; // read-only
}

function allowedTransitions(licitacion) {
  const actor = resolveActorType(licitacion);
  if (!actor) return [];
  return TRANSITIONS[actor][licitacion.estado] || [];
}

// Los gastos (análisis de resultado) sólo aplican una vez adjudicada.
const GASTO_STATES = ['Adjudicada', 'Archivada'];

// Quién puede cargar/eliminar gastos: Administración + responsable Proyectos +
// Jefe/SysAdmin (distinto de resolveActorType, que deja a Administración en solo
// lectura para el resto de la licitación).
function canManageGastos(licitacion) {
  const role = AuthSession.getRole();
  if (role === 'Jefe' || role === 'SysAdmin' || role === 'Administracion') return true;
  return role === 'Proyectos' && AuthSession.getUserId() === licitacion.id_responsable;
}

function fmtMoney(n, moneda = 'BOB') {
  if (n == null) return '—';
  const s = Number(n).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'USD' ? `$ ${s}` : `Bs. ${s}`;
}

// ---------------------------------------------------------------------------
// mountLicitacionesTab
// ---------------------------------------------------------------------------
export async function mountLicitacionesTab(panel, opts = {}) {
  const { canCreate = false, defaultEstado = '', onCreateCotizacion = null } = opts;
  const state = { page: 1, limit: 20, q: '', estado: defaultEstado };

  panel.innerHTML = `
    <div class="card">
      <div class="card-header" style="flex-wrap:wrap;gap:.75rem;">
        <h3>📑 Licitaciones</h3>
        <div style="display:flex;gap:.5rem;align-items:center;">
          <span class="text-muted text-sm" id="lic-total"></span>
          ${canCreate ? '<button class="btn btn-primary btn-sm" id="lic-new">+ Nueva Licitación</button>' : ''}
        </div>
      </div>
      <div class="filter-bar" style="display:flex;gap:.75rem;flex-wrap:wrap;align-items:flex-end;">
        <div class="form-group" style="margin:0;">
          <label class="form-label">Buscar</label>
          <input class="form-control" type="search" id="lic-search" placeholder="Código, nombre o convocante…" style="min-width:220px;" />
        </div>
        <div class="form-group" style="margin:0;">
          <label class="form-label">Estado</label>
          <select class="form-control" id="lic-estado">
            <option value="">Todos</option>
            ${ESTADOS.map((e) => `<option value="${e}" ${e === defaultEstado ? 'selected' : ''}>${e}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn-ghost btn-sm" id="lic-search-btn">Filtrar</button>
      </div>
      <div id="lic-results"><div class="page-loading"><div class="spinner"></div></div></div>
      <div class="card-footer" id="lic-pagination"></div>
    </div>`;

  const $ = (sel) => panel.querySelector(sel);

  async function load() {
    const results = $('#lic-results');
    results.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

    const params = new URLSearchParams({ page: String(state.page), limit: String(state.limit) });
    if (state.q)      params.set('q', state.q);
    if (state.estado) params.set('estado', state.estado);

    try {
      const body = await api.get(`/api/licitaciones?${params.toString()}`);
      const rows = body.data ?? [];
      $('#lic-total').textContent = `${body.total ?? rows.length} licitación(es)`;

      if (rows.length === 0) {
        results.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">📑</div>
            <h4>Sin licitaciones</h4>
            <p>No hay licitaciones que coincidan con el filtro.</p>
          </div>`;
        $('#lic-pagination').innerHTML = '';
        return;
      }

      results.innerHTML = `
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>Código</th><th>Nombre</th><th>Convocante</th>
                <th>Estado</th><th>Cotiz.</th><th>Límite</th><th>Responsable</th><th></th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((l) => `
                <tr>
                  <td class="fw-600">${escHtml(l.codigo)}</td>
                  <td>${escHtml(l.nombre)}</td>
                  <td>${escHtml(l.cliente_nombre ?? '—')}</td>
                  <td>${licitacionBadgeHtml(l.estado)}</td>
                  <td style="text-align:center;">${l.total_cotizaciones ?? 0}</td>
                  <td>${fmtDate(l.fecha_limite)}</td>
                  <td>${escHtml(l.responsable_nombre ?? '—')}</td>
                  <td><button class="btn btn-ghost btn-sm" data-lic-view="${l.id}">Ver</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;

      results.querySelectorAll('[data-lic-view]').forEach((btn) => {
        btn.addEventListener('click', () => openDetail(btn.dataset.licView));
      });

      renderPagination(body.totalPages ?? 1);
    } catch (err) {
      results.innerHTML = `<div class="empty-state"><p>Error: ${escHtml(err.data?.message || err.message)}</p></div>`;
      $('#lic-pagination').innerHTML = '';
    }
  }

  function renderPagination(totalPages) {
    const foot = $('#lic-pagination');
    if (totalPages <= 1) { foot.innerHTML = ''; return; }
    foot.innerHTML = `
      <button class="btn btn-ghost btn-sm" id="lic-prev" ${state.page <= 1 ? 'disabled' : ''}>‹ Anterior</button>
      <span class="text-sm" style="margin:0 .75rem;">Página ${state.page} de ${totalPages}</span>
      <button class="btn btn-ghost btn-sm" id="lic-next" ${state.page >= totalPages ? 'disabled' : ''}>Siguiente ›</button>`;
    $('#lic-prev')?.addEventListener('click', () => { if (state.page > 1)          { state.page--; load(); } });
    $('#lic-next')?.addEventListener('click', () => { if (state.page < totalPages) { state.page++; load(); } });
  }

  // ── Detail sub-modal ───────────────────────────────────────────────────────
  async function openDetail(id) {
    let lic;
    try {
      const body = await api.get(`/api/licitaciones/${id}`);
      lic = body.data;
    } catch (err) {
      showToast(`No se pudo cargar la licitación: ${err.data?.message || err.message}`, 'error');
      return;
    }

    let history = [];
    try {
      const h = await api.get(`/api/licitaciones/${id}/historial`);
      history = h.data ?? [];
    } catch (_) { /* timeline is best-effort */ }

    let documentos = [];
    try {
      const d = await api.get(`/api/licitaciones/${id}/documentos`);
      documentos = d.data ?? [];
    } catch (_) { /* document list is best-effort */ }

    const overlay = document.createElement('div');
    overlay.className = 'sub-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = renderDetailHtml(lic, history, documentos);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#licd-close')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    // Edit (only responsable/Jefe/SysAdmin and only in editable states)
    overlay.querySelector('#licd-edit')?.addEventListener('click', () => {
      openLicitacionModal({
        mode: 'edit',
        licitacion: lic,
        mountTarget: document.body,
        onSaved: () => { close(); load(); },
      });
    });

    // Adjuntar documentos (responsable/Jefe/SysAdmin, SIN restricción de estado
    // — a diferencia de "Editar", disponible incluso en Presentada/Adjudicada/…)
    overlay.querySelector('#licd-attach')?.addEventListener('click', () => {
      openLicitacionModal({
        mode: 'attach',
        licitacion: lic,
        mountTarget: document.body,
        onSaved: () => { close(); openDetail(id); },
      });
    });

    // Create linked cotización (delegated Ejecutivo path)
    overlay.querySelector('#licd-crear-cot')?.addEventListener('click', () => {
      if (typeof onCreateCotizacion === 'function') { close(); onCreateCotizacion(lic); }
    });

    // ── Documentos: descargar (todos los roles con acceso al detalle) ────────
    // La subida de documentos se hace desde "Nueva/Editar Licitación"
    // (licitacionModal.js) — aquí solo se listan, descargan y eliminan.
    overlay.querySelectorAll('[data-doc-download]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const docId   = btn.dataset.docDownload;
        const docName = btn.dataset.docName;
        const original = btn.textContent;
        btn.disabled = true;
        btn.textContent = '…';
        try {
          const response = await api.get(`/api/licitaciones/${id}/documentos/${docId}`);
          const blob = await response.blob();
          const outcome = await saveBlobAs(blob, docName, { description: 'Documento', accept: {} });
          if (outcome === 'saved')      showToast('Documento guardado en la ubicación elegida.', 'success', 2500);
          else if (outcome === 'downloaded') showToast('Documento descargado a tu carpeta de Descargas.', 'info', 3500);
        } catch (err) {
          showToast(err.data?.message || err.message || 'No se pudo descargar el documento.', 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = original;
        }
      });
    });

    // ── Documentos: eliminar (responsable/Jefe/SysAdmin) ──────────────────────
    overlay.querySelectorAll('[data-doc-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const docId   = btn.dataset.docDelete;
        const docName = btn.dataset.docName;
        if (!confirm(`¿Eliminar el documento "${docName}"? Esta acción no se puede deshacer.`)) return;
        try {
          await api.delete(`/api/licitaciones/${id}/documentos/${docId}`);
          showToast('Documento eliminado.', 'success');
          close();
          openDetail(id);
        } catch (err) {
          showToast(err.data?.message || err.message || 'No se pudo eliminar el documento.', 'error');
        }
      });
    });

    // ── Expediente PDF de la licitación ──────────────────────────────────────
    overlay.querySelector('#licd-pdf')?.addEventListener('click', async () => {
      const btn = overlay.querySelector('#licd-pdf');
      const original = btn.textContent;
      btn.disabled = true; btn.textContent = 'Generando…';
      try {
        const response = await api.get(`/api/licitaciones/${id}/pdf`);
        const blob = await response.blob();
        const outcome = await saveBlobAs(blob, `Expediente_${lic.codigo}.pdf`, {
          description: 'Documento PDF', accept: { 'application/pdf': ['.pdf'] },
        });
        if (outcome === 'saved')      showToast('Expediente guardado.', 'success', 2500);
        else if (outcome === 'downloaded') showToast('Expediente descargado a tu carpeta de Descargas.', 'info', 3500);
      } catch (err) {
        showToast(err.data?.message || err.message || 'No se pudo generar el PDF.', 'error');
      } finally {
        btn.disabled = false; btn.textContent = original;
      }
    });

    // ── Ver proforma (PDF) de una cotización vinculada ───────────────────────
    overlay.querySelectorAll('[data-cot-pdf]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const cotId = btn.dataset.cotPdf;
        const cotName = btn.dataset.cotName || `cotizacion-${cotId}`;
        const original = btn.textContent;
        btn.disabled = true; btn.textContent = '…';
        try {
          const response = await api.get(`/api/cotizaciones/${cotId}/pdf`);
          const blob = await response.blob();
          const safe = String(cotName).replace(/[^\w\-]/g, '_');
          const outcome = await saveBlobAs(blob, `${safe}.pdf`, {
            description: 'Documento PDF', accept: { 'application/pdf': ['.pdf'] },
          });
          if (outcome === 'saved')      showToast('Proforma guardada.', 'success', 2500);
          else if (outcome === 'downloaded') showToast('Proforma descargada a tu carpeta de Descargas.', 'info', 3500);
        } catch (err) {
          showToast(err.data?.message || err.message || 'No se pudo abrir la proforma.', 'error');
        } finally {
          btn.disabled = false; btn.textContent = original;
        }
      });
    });

    // ── Gastos: agregar (Admin / responsable Proyectos / Jefe / SysAdmin) ────
    overlay.querySelector('#licd-gasto-add')?.addEventListener('click', async () => {
      const errEl = overlay.querySelector('#licd-gasto-err');
      if (errEl) errEl.textContent = '';
      const concepto = overlay.querySelector('#licd-gasto-concepto')?.value.trim();
      const montoRaw = overlay.querySelector('#licd-gasto-monto')?.value;
      const monto = parseFloat(montoRaw);

      if (!concepto) { if (errEl) errEl.textContent = 'Indicá el concepto del gasto.'; return; }
      if (isNaN(monto) || monto <= 0) { if (errEl) errEl.textContent = 'El monto debe ser mayor a 0.'; return; }

      const btn = overlay.querySelector('#licd-gasto-add');
      btn.disabled = true;
      try {
        await api.post(`/api/licitaciones/${id}/gastos`, { concepto, monto, moneda: lic.moneda || 'BOB' });
        showToast('Gasto registrado.', 'success');
        close();
        openDetail(id); // reabre el detalle con el gasto y el resultado recalculado
      } catch (err) {
        if (errEl) errEl.textContent = err.data?.message || err.message || 'No se pudo registrar el gasto.';
        btn.disabled = false;
      }
    });

    // ── Gastos: eliminar ──────────────────────────────────────────────────────
    overlay.querySelectorAll('[data-gasto-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const gastoId = btn.dataset.gastoDelete;
        const concepto = btn.dataset.gastoConcepto || 'este gasto';
        if (!confirm(`¿Eliminar el gasto "${concepto}"?`)) return;
        try {
          await api.delete(`/api/licitaciones/${id}/gastos/${gastoId}`);
          showToast('Gasto eliminado.', 'success');
          close();
          openDetail(id);
        } catch (err) {
          showToast(err.data?.message || err.message || 'No se pudo eliminar el gasto.', 'error');
        }
      });
    });

    // Transition buttons
    overlay.querySelectorAll('[data-lic-transition]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const nuevoEstado = btn.dataset.licTransition;
        const obsInput = overlay.querySelector('#licd-observacion');
        let observacion = obsInput ? obsInput.value.trim() : '';

        if (nuevoEstado === 'No adjudicada' && !observacion) {
          const errEl = overlay.querySelector('#licd-trans-err');
          if (errEl) errEl.textContent = 'Debe indicar el motivo para marcar "No adjudicada".';
          obsInput?.focus();
          return;
        }

        btn.disabled = true;
        try {
          await api.put(`/api/licitaciones/${id}/estado`, { nuevo_estado: nuevoEstado, observacion: observacion || null });
          showToast(`Licitación → "${nuevoEstado}".`, 'success');
          close();
          load();
        } catch (err) {
          const errEl = overlay.querySelector('#licd-trans-err');
          if (errEl) errEl.textContent = err.data?.message || err.message || 'No se pudo cambiar el estado.';
          btn.disabled = false;
        }
      });
    });
  }

  function renderDetailHtml(lic, history, documentos = []) {
    const trans = allowedTransitions(lic);
    const actorType = resolveActorType(lic);
    const canEdit = EDITABLE_STATES.includes(lic.estado) && (actorType === 'responsable' || actorType === 'jefe');
    // A diferencia de canEdit, la gestión de documentos NO se restringe por
    // estado — Proyectos/Jefe/SysAdmin pueden adjuntar en cualquier momento.
    const canManageDocs = actorType === 'responsable' || actorType === 'jefe';

    // Budget comparison
    const comprometido = Number(lic.total_comprometido ?? 0);
    let budgetHtml = '';
    if (lic.presupuesto_referencial != null) {
      const presupuesto = Number(lic.presupuesto_referencial);
      const dentro = comprometido <= presupuesto;
      budgetHtml = `
        <div style="margin-top:.5rem;padding:.6rem .8rem;border-radius:8px;
             background:${dentro ? 'rgba(16,185,129,.12)' : 'rgba(239,68,68,.12)'};">
          <strong>${dentro ? '✅ Dentro de presupuesto' : '⚠️ Fuera de presupuesto'}</strong><br>
          <span class="text-sm">Comprometido (cotizaciones aprobadas/confirmadas):
            ${fmtAmount(comprometido, lic.moneda)} de ${fmtAmount(presupuesto, lic.moneda)}</span>
        </div>`;
    } else {
      budgetHtml = `<div class="text-muted text-sm" style="margin-top:.5rem;">Sin presupuesto referencial definido.</div>`;
    }

    // Linked cotizaciones table. El vínculo NO se crea desde acá: lo arma el
    // ejecutivo comercial delegado (can_approve_quotations) desde su propio
    // panel — por eso, si todavía no hay ninguna, se explica cómo se genera
    // en vez de dejar el estado vacío sin contexto.
    const cots = lic.cotizaciones ?? [];
    let noCotsHint = 'No se vinculó ninguna cotización a esta licitación.';
    if (cots.length === 0 && lic.estado === 'En preparacion') {
      noCotsHint = 'Pasá esta licitación a "Cotizando" para que el ejecutivo comercial delegado ' +
        '(el que tiene el poder de aprobar cotizaciones) la vea en su panel de Licitaciones y pueda crear la cotización vinculada.';
    } else if (cots.length === 0 && ['Cotizando', 'En evaluacion'].includes(lic.estado)) {
      noCotsHint = 'El ejecutivo comercial delegado la crea desde su propio panel de Licitaciones ' +
        '("➕ Crear cotización vinculada"), o cualquier ejecutivo puede vincularla eligiendo esta licitación ' +
        'en el campo "Licitación asociada" al crear o editar una cotización normal.';
    }
    const cotsHtml = cots.length === 0
      ? `<p class="text-muted text-sm">${escHtml(noCotsHint)}</p>`
      : `<div class="table-wrapper"><table class="data-table">
           <thead><tr><th>Correlativo</th><th>Estado</th><th>Monto</th><th>Ejecutivo</th><th>Proforma</th></tr></thead>
           <tbody>${cots.map((c) => `
             <tr>
               <td class="fw-600">${escHtml(c.numero_correlativo)}</td>
               <td>${escHtml(c.estado)}</td>
               <td>${fmtAmount(c.monto_total, c.moneda)}</td>
               <td>${escHtml(c.ejecutivo_nombre ?? '—')}</td>
               <td><button class="btn btn-ghost btn-sm" data-cot-pdf="${c.id}" data-cot-name="${escHtml(c.numero_correlativo)}">📄 Ver</button></td>
             </tr>`).join('')}
           </tbody></table></div>`;

    // ── Resultado (ganancia/pérdida) y gastos — solo post-adjudicación ─────────
    const isAdjudicada = GASTO_STATES.includes(lic.estado);
    const canGastos    = canManageGastos(lic);

    let resultadoHtml = '';
    let gastosSectionHtml = '';
    if (isAdjudicada) {
      const ingreso   = Number(lic.total_comprometido ?? 0);
      const gastosT   = Number(lic.total_gastos ?? 0);
      const resultado = Number(lic.resultado ?? (ingreso - gastosT));
      const ganancia  = resultado >= 0;
      resultadoHtml = `
        <div style="margin-top:.5rem;padding:.6rem .8rem;border-radius:8px;
             background:${ganancia ? 'rgba(16,185,129,.14)' : 'rgba(239,68,68,.14)'};">
          <strong style="font-size:1.02rem;">${ganancia ? '📈 Ganancia' : '📉 Pérdida'}: ${fmtMoney(Math.abs(resultado), lic.moneda)}</strong><br>
          <span class="text-sm">Ingreso (cotizado aprobado/confirmado): ${fmtMoney(ingreso, lic.moneda)}
            &nbsp;−&nbsp; Gastos: ${fmtMoney(gastosT, lic.moneda)}</span>
        </div>`;

      const gastos = lic.gastos ?? [];
      const gastosList = gastos.length === 0
        ? `<p class="text-muted text-sm">Aún no hay gastos registrados.${canGastos ? ' Agregá el primero abajo.' : ''}</p>`
        : `<div class="table-wrapper"><table class="data-table">
             <thead><tr><th>Concepto</th><th>Monto</th><th>Registró</th><th>Fecha</th>${canGastos ? '<th></th>' : ''}</tr></thead>
             <tbody>${gastos.map((g) => `
               <tr>
                 <td>${escHtml(g.concepto)}</td>
                 <td>${fmtMoney(g.monto, g.moneda)}</td>
                 <td>${escHtml(g.nombre_usuario ?? '—')}</td>
                 <td>${fmtDate(g.creado_en)}</td>
                 ${canGastos ? `<td><button class="btn btn-ghost btn-sm" data-gasto-delete="${g.id}" data-gasto-concepto="${escHtml(g.concepto)}">🗑️</button></td>` : ''}
               </tr>`).join('')}
             </tbody></table></div>`;

      const addForm = canGastos ? `
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:flex-end;margin-top:.5rem;">
          <div class="form-group" style="flex:2;min-width:160px;margin:0;">
            <label class="form-label text-sm" for="licd-gasto-concepto">Concepto</label>
            <input class="form-control" id="licd-gasto-concepto" type="text" maxlength="200" placeholder="Ej. Transporte a obra" />
          </div>
          <div class="form-group" style="width:130px;margin:0;">
            <label class="form-label text-sm" for="licd-gasto-monto">Monto (${escHtml(lic.moneda || 'BOB')})</label>
            <input class="form-control" id="licd-gasto-monto" type="number" min="0" step="0.01" placeholder="0.00" />
          </div>
          <button class="btn btn-primary btn-sm" id="licd-gasto-add">Agregar gasto</button>
        </div>
        <div class="form-error" id="licd-gasto-err" style="color:var(--clr-red);min-height:1.2em;"></div>` : '';

      gastosSectionHtml = `
        <h5 style="margin:1rem 0 .35rem;">Gastos (${gastos.length})</h5>
        ${gastosList}
        ${addForm}`;
    }

    // Documentos adjuntos: cualquiera con acceso al detalle puede ver/descargar;
    // solo el responsable (o Jefe/SysAdmin) puede eliminarlos. La subida se hace
    // desde "Nueva/Editar Licitación" (licitacionModal.js), no desde aquí.
    const docsListHtml = documentos.length === 0
      ? `<p class="text-muted text-sm">Aún no hay documentos adjuntos.${canManageDocs ? ' Usá "📎 Adjuntar" para subir el primero.' : ''}</p>`
      : `<ul style="list-style:none;padding:0;margin:0;">
           ${documentos.map((d) => `
             <li style="display:flex;align-items:center;gap:.5rem;padding:.4rem 0;border-bottom:1px solid var(--border);">
               <span>${docIcon(d.nombre_original)}</span>
               <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(d.nombre_original)}">${escHtml(d.nombre_original)}</span>
               <span class="text-muted text-sm">${fmtFileSize(d.tamano_bytes)}</span>
               <span class="text-muted text-sm">${escHtml(d.nombre_usuario ?? '—')} · ${fmtDate(d.creado_en)}</span>
               <button class="btn btn-ghost btn-sm" data-doc-download="${d.id}" data-doc-name="${escHtml(d.nombre_original)}">⬇️</button>
               ${canManageDocs ? `<button class="btn btn-ghost btn-sm" data-doc-delete="${d.id}" data-doc-name="${escHtml(d.nombre_original)}">🗑️</button>` : ''}
             </li>`).join('')}
         </ul>`;

    const transButtons = trans.length > 0
      ? `<div style="display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.5rem;">
           ${trans.map((t) => `<button class="btn btn-sm ${t === 'No adjudicada' || t === 'Archivada' ? 'btn-ghost' : 'btn-primary'}" data-lic-transition="${escHtml(t)}">→ ${escHtml(t)}</button>`).join('')}
         </div>
         <div class="form-group" style="margin-top:.5rem;">
           <label class="form-label text-sm" for="licd-observacion">Observación (obligatoria para "No adjudicada")</label>
           <textarea class="form-control" id="licd-observacion" rows="2" maxlength="2000" placeholder="Nota de la transición…"></textarea>
         </div>
         <div class="form-error" id="licd-trans-err" style="color:var(--clr-red);min-height:1.2em;"></div>`
      : '<p class="text-muted text-sm" style="margin-top:.5rem;">No tienes transiciones disponibles para esta licitación en su estado actual.</p>';

    return `
      <div class="sub-modal" style="max-width:720px;">
        <div class="sub-modal-header">
          <h4>${escHtml(lic.codigo)} — ${escHtml(lic.nombre)}</h4>
          <button type="button" class="btn-icon sub-modal-close" id="licd-close" aria-label="Cerrar">✕</button>
        </div>
        <div class="sub-modal-body">
          <div style="display:flex;flex-wrap:wrap;gap:1rem;align-items:center;justify-content:space-between;">
            <div>${licitacionBadgeHtml(lic.estado)}
              ${canEdit ? '<button class="btn btn-ghost btn-sm" id="licd-edit" style="margin-left:.5rem;">✏️ Editar</button>' : ''}
              ${canManageDocs ? '<button class="btn btn-ghost btn-sm" id="licd-attach" style="margin-left:.5rem;">📎 Adjuntar</button>' : ''}
              <button class="btn btn-ghost btn-sm" id="licd-pdf" style="margin-left:.5rem;">📄 Expediente PDF</button>
              ${onCreateCotizacion && ['Cotizando', 'En evaluacion'].includes(lic.estado)
                ? '<button class="btn btn-primary btn-sm" id="licd-crear-cot" style="margin-left:.5rem;">➕ Crear cotización vinculada</button>' : ''}
            </div>
            <div class="text-sm text-muted">Responsable: ${escHtml(lic.responsable_nombre ?? '—')}</div>
          </div>

          <dl style="display:grid;grid-template-columns:auto 1fr;gap:.25rem .75rem;margin:.75rem 0;">
            <dt class="text-muted text-sm">Convocante</dt><dd>${escHtml(lic.cliente_nombre ?? '—')}</dd>
            <dt class="text-muted text-sm">Fecha límite</dt><dd>${fmtDate(lic.fecha_limite)}</dd>
            ${lic.descripcion ? `<dt class="text-muted text-sm">Descripción</dt><dd>${escHtml(lic.descripcion)}</dd>` : ''}
            ${lic.observaciones_resultado ? `<dt class="text-muted text-sm">Resultado</dt><dd>${escHtml(lic.observaciones_resultado)}</dd>` : ''}
          </dl>

          ${budgetHtml}
          ${resultadoHtml}

          <h5 style="margin:1rem 0 .35rem;">Cotizaciones vinculadas (${cots.length})</h5>
          ${cotsHtml}

          ${gastosSectionHtml}

          <h5 style="margin:1rem 0 .35rem;">Documentos (${documentos.length})</h5>
          ${docsListHtml}

          <h5 style="margin:1rem 0 .35rem;">Cambiar estado</h5>
          ${transButtons}

          ${history.length > 0
            ? buildTimelineHtml(history)
            : '<h5 style="margin:1rem 0 .35rem;">Historial</h5><p class="text-muted text-sm">Sin eventos de historial todavía.</p>'}
        </div>
      </div>`;
  }

  // ── Wire static controls ────────────────────────────────────────────────────
  if (canCreate) {
    $('#lic-new')?.addEventListener('click', () => {
      openLicitacionModal({ mode: 'create', licitacion: null, mountTarget: document.body, onSaved: () => load() });
    });
  }
  $('#lic-search-btn').addEventListener('click', () => {
    state.q = $('#lic-search').value.trim();
    state.estado = $('#lic-estado').value;
    state.page = 1;
    load();
  });
  $('#lic-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { state.q = e.target.value.trim(); state.estado = $('#lic-estado').value; state.page = 1; load(); }
  });
  $('#lic-estado').addEventListener('change', () => { state.estado = $('#lic-estado').value; state.page = 1; load(); });

  await load();
}
