// =============================================================================
// public/js/views/dashboard/modules/licitacion/detailModal.js
// Sub-modal de detalle de una licitacion.
//
// Muestra: cabecera + presupuesto vs cotizado, cotizaciones vinculadas,
// documentos adjuntos, linea de tiempo de estados, botones de transicion
// segun el rol, y (post-adjudicacion) el analisis de gastos y resultado.
//
// Extraido de licitacionesView.js sin cambios de comportamiento: las dos
// closures que usaba del listado (load y onCreateCotizacion) ahora entran
// como parametros.
// =============================================================================

import api, { showToast } from '../../../../services/apiClient.js';
import { escHtml, fmtDate, fmtDateTime, licitacionBadgeHtml, docIcon, fmtFileSize } from '../../helpers.js';
import { buildTimelineHtml, saveBlobAs } from '../timelineView.js';
import { openLicitacionModal } from '../licitacionModal.js';
import {
  EDITABLE_STATES,
  GASTO_STATES,
  currentUser,
  resolveActorType,
  allowedTransitions,
  canManageGastos,
} from './permissions.js';

function fmtMoney(n, moneda = 'BOB') {
  if (n == null) return '—';
  const s = Number(n).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'USD' ? `$ ${s}` : `Bs. ${s}`;
}

// ── Cableado de eventos del sub-modal, agrupado por bloque de funcionalidad ──
// Cada uno recibe el overlay y lo que necesita de openLicitacionDetail (id,
// lic, close, load, openDetail) — nada de estado propio, así que reabrir el
// detalle simplemente vuelve a llamarlos con datos frescos.

/** Descargar / eliminar documentos adjuntos. */
function wireDocumentActions(overlay, { id, close, openDetail }) {
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
}

/** Expediente PDF de la licitación + proforma PDF de cada cotización vinculada. */
function wirePdfActions(overlay, { id, lic }) {
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
}

/** Agregar / eliminar gastos (post-adjudicación). */
function wireGastoActions(overlay, { id, lic, close, openDetail }) {
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
}

/** Botones de transición de estado. */
function wireTransitionButtons(overlay, { id, close, load }) {
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

// ── Detail sub-modal ───────────────────────────────────────────────────────
/**
 * Abre el sub-modal de detalle de una licitacion.
 *
 * @param {number|string} id
 * @param {Object} deps
 *   onChanged          {Function} — recargar el listado tras un cambio
 *   onCreateCotizacion {Function|null} — muestra "Crear cotizacion vinculada"
 */
export async function openLicitacionDetail(id, { onChanged, onCreateCotizacion = null } = {}) {
  // `load` era una closure del listado; ahora entra como callback explicito.
  const load = () => onChanged?.();
  // Varias acciones (editar, transicionar, cargar/borrar un gasto) reabren el
  // detalle para mostrar el estado recalculado. Antes era una llamada recursiva
  // a la closure `openDetail`; ahora reinyecta las mismas dependencias.
  const openDetail = (nextId) => openLicitacionDetail(nextId, { onChanged, onCreateCotizacion });
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
  overlay.innerHTML = renderDetailHtml(lic, history, documentos, { onCreateCotizacion });
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

  // La subida de documentos se hace desde "Nueva/Editar Licitación"
  // (licitacionModal.js) — aquí solo se listan, descargan y eliminan.
  wireDocumentActions(overlay, { id, close, openDetail });
  wirePdfActions(overlay, { id, lic });
  wireGastoActions(overlay, { id, lic, close, openDetail });
  wireTransitionButtons(overlay, { id, close, load });
}

/** Comparación presupuesto vs. comprometido. Pura. */
function buildBudgetHtml(lic) {
  const comprometido = Number(lic.total_comprometido ?? 0);
  if (lic.presupuesto_referencial == null) {
    return `<div class="text-muted text-sm mt-1">Sin presupuesto referencial definido.</div>`;
  }
  const presupuesto = Number(lic.presupuesto_referencial);
  const dentro = comprometido <= presupuesto;
  return `
      <div style="margin-top:.5rem;padding:.6rem .8rem;border-radius:8px;
           background:${dentro ? 'rgba(16,185,129,.12)' : 'rgba(239,68,68,.12)'};">
        <strong>${dentro ? 'Dentro de presupuesto' : 'Fuera de presupuesto'}</strong><br>
        <span class="text-sm">Comprometido (cotizaciones aprobadas/confirmadas):
          ${fmtMoney(comprometido, lic.moneda)} de ${fmtMoney(presupuesto, lic.moneda)}</span>
        ${lic.tiene_cotizaciones_otra_moneda
          ? `<br><span class="text-sm text-amber">Hay cotizaciones vinculadas en otra moneda que no se incluyen en esta comparación (el presupuesto está en ${escHtml(lic.moneda || 'BOB')}).</span>`
          : ''}
      </div>`;
}

/**
 * Tabla de cotizaciones vinculadas. El vínculo NO se crea desde acá: lo arma
 * el ejecutivo comercial delegado (can_approve_quotations) desde su propio
 * panel — por eso, si todavía no hay ninguna, se explica cómo se genera en
 * vez de dejar el estado vacío sin contexto. Pura.
 */
function buildCotizacionesVinculadasHtml(lic) {
  const cots = lic.cotizaciones ?? [];
  if (cots.length > 0) {
    return `<div class="table-wrapper"><table class="data-table">
         <thead><tr><th>Correlativo</th><th>Estado</th><th>Monto</th><th>Ejecutivo</th><th>Proforma</th></tr></thead>
         <tbody>${cots.map((c) => `
           <tr>
             <td class="fw-600">${escHtml(c.numero_correlativo)}</td>
             <td>${escHtml(c.estado)}</td>
             <td>${fmtMoney(c.monto_total, c.moneda)}</td>
             <td>${escHtml(c.ejecutivo_nombre ?? '—')}</td>
             <td><button class="btn btn-ghost btn-sm" data-cot-pdf="${c.id}" data-cot-name="${escHtml(c.numero_correlativo)}">Ver</button></td>
           </tr>`).join('')}
         </tbody></table></div>`;
  }
  let noCotsHint = 'No se vinculó ninguna cotización a esta licitación.';
  if (lic.estado === 'En preparacion') {
    noCotsHint = 'Pasá esta licitación a "Cotizando" para que el ejecutivo comercial delegado ' +
      '(el que tiene el poder de aprobar cotizaciones) la vea en su panel de Licitaciones y pueda crear la cotización vinculada.';
  } else if (['Cotizando', 'En evaluacion'].includes(lic.estado)) {
    noCotsHint = 'El ejecutivo comercial delegado la crea desde su propio panel de Licitaciones ' +
      '("Crear cotización vinculada"), o cualquier ejecutivo puede vincularla eligiendo esta licitación ' +
      'en el campo "Licitación asociada" al crear o editar una cotización normal.';
  }
  return `<p class="text-muted text-sm">${escHtml(noCotsHint)}</p>`;
}

/**
 * Resultado (ganancia/pérdida) + sección de gastos — solo post-adjudicación.
 * Devuelve las dos piezas por separado porque van en lugares distintos del
 * layout (el resultado junto al presupuesto, los gastos más abajo). Pura.
 */
function buildResultadoYGastosHtml(lic, canGastos) {
  if (!GASTO_STATES.includes(lic.estado)) return { resultadoHtml: '', gastosSectionHtml: '' };

  const ingreso   = Number(lic.total_comprometido ?? 0);
  const gastosT   = Number(lic.total_gastos ?? 0);
  const resultado = Number(lic.resultado ?? (ingreso - gastosT));
  const ganancia  = resultado >= 0;
  const resultadoHtml = `
      <div style="margin-top:.5rem;padding:.6rem .8rem;border-radius:8px;
           background:${ganancia ? 'rgba(16,185,129,.14)' : 'rgba(239,68,68,.14)'};">
        <strong class="resultado-cifra">${ganancia ? 'Ganancia' : 'Pérdida'}: ${fmtMoney(Math.abs(resultado), lic.moneda)}</strong><br>
        <span class="text-sm">Ingreso (cotizado aprobado/confirmado): ${fmtMoney(ingreso, lic.moneda)}
          &nbsp;−&nbsp; Gastos: ${fmtMoney(gastosT, lic.moneda)}</span>
        ${lic.tiene_gastos_otra_moneda
          ? `<br><span class="text-sm text-amber">Hay gastos registrados en otra moneda que no se incluyen en este cálculo (el resultado está en ${escHtml(lic.moneda || 'BOB')}).</span>`
          : ''}
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
               <td>${fmtDateTime(g.creado_en)}</td>
               ${canGastos ? `<td><button class="btn btn-ghost btn-sm" data-gasto-delete="${g.id}" data-gasto-concepto="${escHtml(g.concepto)}">Eliminar</button></td>` : ''}
             </tr>`).join('')}
           </tbody></table></div>`;

  const addForm = canGastos ? `
      <div class="acciones-fila items-end">
        <div class="form-group fg-doble-min160">
          <label class="form-label text-sm" for="licd-gasto-concepto">Concepto</label>
          <input class="form-control" id="licd-gasto-concepto" type="text" maxlength="200" placeholder="Ej. Transporte a obra" />
        </div>
        <div class="form-group fg-130">
          <label class="form-label text-sm" for="licd-gasto-monto">Monto (${escHtml(lic.moneda || 'BOB')})</label>
          <input class="form-control" id="licd-gasto-monto" type="number" min="0" step="0.01" placeholder="0.00" />
        </div>
        <button class="btn btn-primary btn-sm" id="licd-gasto-add">Agregar gasto</button>
      </div>
      <div class="form-error" id="licd-gasto-err"></div>` : '';

  const gastosSectionHtml = `
      <h5 class="sub-seccion-title">Gastos (${gastos.length})</h5>
      ${gastosList}
      ${addForm}`;

  return { resultadoHtml, gastosSectionHtml };
}

/**
 * Documentos adjuntos: cualquiera con acceso al detalle puede ver/descargar;
 * solo el responsable (o Jefe/SysAdmin) puede eliminarlos. La subida se hace
 * desde "Nueva/Editar Licitación" (licitacionModal.js), no desde aquí. Pura.
 */
function buildDocumentosHtml(documentos, canManageDocs) {
  if (documentos.length === 0) {
    return `<p class="text-muted text-sm">Aún no hay documentos adjuntos.${canManageDocs ? ' Usá "Adjuntar" para subir el primero.' : ''}</p>`;
  }
  return `<ul class="lista-limpia">
         ${documentos.map((d) => `
           <li class="lista-item">
             <span>${docIcon(d.nombre_original)}</span>
             <span class="lista-item-nombre" title="${escHtml(d.nombre_original)}">${escHtml(d.nombre_original)}</span>
             <span class="text-muted text-sm">${fmtFileSize(d.tamano_bytes)}</span>
             <span class="text-muted text-sm">${escHtml(d.nombre_usuario ?? '—')} · ${fmtDateTime(d.creado_en)}</span>
             <!-- Estos tres botones se renderizaban VACIOS: el barrido de
                  emojis les quito el rotulo y no dejo nada en su lugar. Quedaban
                  dos cuadraditos identicos de ~10px, y el segundo borra el
                  adjunto sin vuelta atras. El de eliminar ademas lleva
                  btn-danger: una accion destructiva no puede verse igual que la
                  de al lado. -->
             <button class="btn btn-ghost btn-sm" data-doc-download="${d.id}" data-doc-name="${escHtml(d.nombre_original)}">Descargar</button>
             ${canManageDocs ? `<button class="btn btn-danger btn-sm" data-doc-delete="${d.id}" data-doc-name="${escHtml(d.nombre_original)}">Eliminar</button>` : ''}
           </li>`).join('')}
       </ul>`;
}

/** Botones de transición + observación (obligatoria solo para "No adjudicada"). Pura. */
function buildTransButtonsHtml(trans) {
  if (trans.length === 0) {
    return '<p class="text-muted text-sm mt-1">No tienes transiciones disponibles para esta licitación en su estado actual.</p>';
  }
  return `<div class="acciones-fila">
         ${trans.map((t) => `<button class="btn btn-sm ${t === 'No adjudicada' || t === 'Archivada' ? 'btn-ghost' : 'btn-primary'}" data-lic-transition="${escHtml(t)}">→ ${escHtml(t)}</button>`).join('')}
       </div>
       <div class="form-group mt-1">
         <label class="form-label text-sm" for="licd-observacion">Observación (obligatoria para "No adjudicada")</label>
         <textarea class="form-control" id="licd-observacion" rows="2" maxlength="2000" placeholder="Nota de la transición…"></textarea>
       </div>
       <div class="form-error" id="licd-trans-err"></div>`;
}

// `onCreateCotizacion` entra por parámetro: era una closure de mountLicitacionesTab
// y sólo la pasa el panel del ejecutivo delegado.
function renderDetailHtml(lic, history, documentos = [], { onCreateCotizacion = null } = {}) {
  // Snapshot de la sesión leído una vez: las funciones de permissions.js son
  // puras y reciben el usuario en vez de consultar AuthSession por dentro.
  const user = currentUser();
  const trans = allowedTransitions(lic, user);
  const actorType = resolveActorType(lic, user);
  const canEdit = EDITABLE_STATES.includes(lic.estado) && (actorType === 'responsable' || actorType === 'jefe');
  // A diferencia de canEdit, la gestión de documentos NO se restringe por
  // estado — Proyectos/Jefe/SysAdmin pueden adjuntar en cualquier momento.
  const canManageDocs = actorType === 'responsable' || actorType === 'jefe';

  const budgetHtml = buildBudgetHtml(lic);
  const cots = lic.cotizaciones ?? [];
  const cotsHtml = buildCotizacionesVinculadasHtml(lic);
  const canGastos = canManageGastos(lic, user);
  const { resultadoHtml, gastosSectionHtml } = buildResultadoYGastosHtml(lic, canGastos);
  const docsListHtml = buildDocumentosHtml(documentos, canManageDocs);
  const transButtons = buildTransButtonsHtml(trans);

  return `
    <div class="sub-modal sub-modal-wide">
      <div class="sub-modal-header">
        <h4>${escHtml(lic.codigo)} — ${escHtml(lic.nombre)}</h4>
        <button type="button" class="btn-icon sub-modal-close" id="licd-close" aria-label="Cerrar">✕</button>
      </div>
      <div class="sub-modal-body">
        <div class="flex flex-wrap gap-3 items-center justify-between">
          <div>${licitacionBadgeHtml(lic.estado)}
            ${canEdit ? '<button class="btn btn-ghost btn-sm ml-1" id="licd-edit">Editar</button>' : ''}
            ${canManageDocs ? '<button class="btn btn-ghost btn-sm ml-1" id="licd-attach">Adjuntar</button>' : ''}
            <button class="btn btn-ghost btn-sm ml-1" id="licd-pdf">Expediente PDF</button>
            ${onCreateCotizacion && ['Cotizando', 'En evaluacion'].includes(lic.estado)
              ? '<button class="btn btn-primary btn-sm ml-1" id="licd-crear-cot">Crear cotización vinculada</button>' : ''}
          </div>
          <div class="text-sm text-muted">Responsable: ${escHtml(lic.responsable_nombre ?? '—')}</div>
        </div>

        <dl class="datos-dl">
          <dt class="text-muted text-sm">Convocante</dt><dd>${escHtml(lic.cliente_nombre ?? '—')}</dd>
          <dt class="text-muted text-sm">Fecha límite</dt><dd>${fmtDate(lic.fecha_limite)}</dd>
          ${lic.descripcion ? `<dt class="text-muted text-sm">Descripción</dt><dd>${escHtml(lic.descripcion)}</dd>` : ''}
          ${lic.observaciones_resultado ? `<dt class="text-muted text-sm">Resultado</dt><dd>${escHtml(lic.observaciones_resultado)}</dd>` : ''}
        </dl>

        ${budgetHtml}
        ${resultadoHtml}

        <h5 class="sub-seccion-title">Cotizaciones vinculadas (${cots.length})</h5>
        ${cotsHtml}

        ${gastosSectionHtml}

        <h5 class="sub-seccion-title">Documentos (${documentos.length})</h5>
        ${docsListHtml}

        <h5 class="sub-seccion-title">Cambiar estado</h5>
        ${transButtons}

        ${history.length > 0
          ? buildTimelineHtml(history)
          : '<h5 class="sub-seccion-title">Historial</h5><p class="text-muted text-sm">Sin eventos de historial todavía.</p>'}
      </div>
    </div>`;
}
