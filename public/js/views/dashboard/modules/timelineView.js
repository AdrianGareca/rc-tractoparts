// =============================================================================
// public/js/views/dashboard/modules/timelineView.js
// Chronological Follow-up Timeline renderer + authenticated PDF/Excel viewer wiring.
//
// Extracted from dashboardView.js to keep single-responsibility per module.
//
// Exports:
//   wirePdfButton(body, id)      — binds the PDF download button in a modal
//   buildTimelineHtml(history)   — builds the state-history timeline HTML string
// =============================================================================

// saveBlobAs vivia ACA dentro y lo importaban otros tres modulos que no
// tienen que ver con la linea de tiempo. Se mudo a shared/ junto con el
// aviso, que estaba copiado en los seis sitios que guardan archivos.
import { guardarArchivo, TIPO_PDF, TIPO_EXCEL } from '../../../shared/guardarArchivo.js';
import api, { showToast } from '../../../services/apiClient.js';
import { escHtml, fmtDate } from '../helpers.js';
import { CommandInvoker, SetSeguimientoVentaCommand } from '../commands.js';
import { openCalendarPicker } from '../../../shared/calendarPicker.js';

// ---------------------------------------------------------------------------
// buildDownloadBaseName — canonical filename (without extension) for quotation
// document downloads: "CORRELATIVO_CLIENTE", e.g.
// "SC-2026_000692_IMPORTADORA_SAN_JOSE".
//
// The correlativo comes FIRST (unique business reference — files sort
// chronologically in a folder); the client name follows so executives can
// still identify the file at a glance when attaching it in WhatsApp/email.
// Two quotes for the same client can never collide into the same filename.
//
// Sanitization: accents are stripped via Unicode NFD decomposition (José →
// Jose) BEFORE the non-word filter, so client names don't degrade into
// underscores; runs of '_' are collapsed. Client part capped at 60 chars to
// keep Windows path lengths comfortable.
//
// @param   {string} [correlativo]   — e.g. "SC-2026/000692"
// @param   {string} [clienteNombre] — e.g. "Importadora San José"
// @param   {number|string} id       — Quotation ID (last-resort fallback)
// @returns {string}
// ---------------------------------------------------------------------------
function buildDownloadBaseName(correlativo, clienteNombre, id) {
  const sanitize = (s) => String(s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // strip accents, keep letters
    .replace(/[^\w\-]/g, '_')                          // block path/injection chars
    .replace(/_+/g, '_')                               // collapse runs of _
    .replace(/^_|_$/g, '');                            // trim edge underscores
  const parts = [];
  if (correlativo)   parts.push(sanitize(correlativo));
  if (clienteNombre) parts.push(sanitize(clienteNombre).slice(0, 60));
  return parts.length > 0 ? parts.join('_') : `Cotizacion_${id}`;
}

// ---------------------------------------------------------------------------
// wirePdfButton
// Attaches an authenticated PDF fetch handler to the #btn-ver-pdf button
// rendered inside a modal body. Uses apiClient (which injects the Bearer
// token) instead of a plain anchor navigation that would strip the header.
//
// The Blob is persisted via saveBlobAs(): a native "Guardar como…" dialog
// where supported (user picks the folder), anchor-download fallback elsewhere.
// The suggested filename is "CLIENTE_CORRELATIVO.pdf" (see
// buildDownloadBaseName) — never a raw blob UUID — so executives can identify
// the file instantly in the "download & send to client via WhatsApp" workflow.
//
// @param {HTMLElement}    body        — Modal body containing #btn-ver-pdf
// @param {number|string}  id          — Quotation ID for the endpoint URL
// @param {string}         [correlativo]   — Quotation number used in the filename
// @param {string}         [clienteNombre] — Client razón social used in the filename
// ---------------------------------------------------------------------------
export function wirePdfButton(body, id, correlativo, clienteNombre) {
  const btn = body.querySelector('#btn-ver-pdf');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = '…';
    try {
      const response = await api.get(`/api/cotizaciones/${id}/pdf`);
      const blob     = await response.blob();
      const fileName = `${buildDownloadBaseName(correlativo, clienteNombre, id)}.pdf`;
      const { aviso } = await guardarArchivo(blob, fileName, { sustantivo: 'PDF', tipo: TIPO_PDF });
      if (aviso) showToast(aviso.texto, aviso.tipo, aviso.ms);
    } catch (err) {
      showToast(err.data?.message || err.message || 'No se pudo cargar el PDF.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Ver PDF adjunto';
    }
  });
}

// ---------------------------------------------------------------------------
// wireExcelButton
// Attaches an authenticated Excel fetch handler to the #btn-ver-excel button
// rendered inside a modal body.  The Bearer token ensures the spreadsheet
// (company financial blueprints) is never served to unauthenticated sessions.
//
// The response is streamed as a Blob and persisted via saveBlobAs(): a native
// "Guardar como…" dialog where supported (user picks the folder), anchor-
// download fallback elsewhere. Excel files are never opened inline since
// browsers cannot natively render .xlsx.
//
// @param {HTMLElement}    body  — Modal body containing #btn-ver-excel
// @param {number|string}  id   — Quotation ID for the endpoint URL
// @param {string}         [correlativo]   — Quotation number used in the filename
// @param {string}         [clienteNombre] — Client razón social used in the filename
// ---------------------------------------------------------------------------
export function wireExcelButton(body, id, correlativo, clienteNombre) {
  const btn = body.querySelector('#btn-ver-excel');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = '…';
    try {
      const response = await api.get(`/api/cotizaciones/${id}/excel`);
      const blob     = await response.blob();
      const fileName = `${buildDownloadBaseName(correlativo, clienteNombre, id)}.xlsx`;
      const { aviso } = await guardarArchivo(blob, fileName,
        { sustantivo: 'Planilla Excel', genero: 'f', tipo: TIPO_EXCEL });
      if (aviso) showToast(aviso.texto, aviso.tipo, aviso.ms);
    } catch (err) {
      showToast(err.data?.message || err.message || 'No se pudo descargar la planilla Excel.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Descargar Excel';
    }
  });
}

// ---------------------------------------------------------------------------
// wireSeguimientoVenta
// Attaches the "Guardar seguimiento" handler, the estado→"Otro" text-field
// toggle, and the calendar date-picker to the commercial follow-up panel
// rendered by proformaActions.seguimientoVentaBlockHtml. No-op when the save
// button is absent (read-only render, or a role the backend wouldn't accept
// the PATCH from — see canEdit in seguimientoVentaBlockHtml).
//
// @param {HTMLElement}   body        — Modal body containing the panel
// @param {number|string} id          — Quotation ID for the endpoint URL
// @param {number}        idEjecutivo — Owner of the quotation (whose calendar
//                                      of already-scheduled follow-ups to show
//                                      — NOT necessarily the viewing user: a
//                                      Jefe/Administracion editing someone
//                                      else's quotation sees THEIR calendar)
// @param {Function}      [onSaved]   — Called after a successful save (e.g. to refresh a list)
// ---------------------------------------------------------------------------
export function wireSeguimientoVenta(body, id, idEjecutivo, onSaved) {
  const btn = body.querySelector('#btn-save-seguimiento');
  if (!btn) return;

  const estadoSel    = body.querySelector('#seguimiento-estado-input');
  const detalleGrp   = body.querySelector('#seguimiento-detalle-group');
  const detalleInput = body.querySelector('#seguimiento-detalle-input');
  const fechaInput   = body.querySelector('#seguimiento-fecha-input');
  const fechaBtn     = body.querySelector('#seguimiento-fecha-btn');
  const errEl        = body.querySelector('#seguimiento-venta-err');

  // Muestra/oculta "Especificar" según si el select está en 'Otro'.
  // classList, no .style.display: la clase .hidden usa !important en el CSS
  // y .style.display nunca la puede pisar (ver tests/unit/visibilidadPorClase.test.js).
  estadoSel?.addEventListener('change', () => {
    detalleGrp?.classList.toggle('hidden', estadoSel.value !== 'Otro');
  });

  // El calendario propio: se piden los días ocupados recién al abrir (no al
  // montar el panel), así una cotización que nunca se toca no gasta un pedido.
  fechaBtn?.addEventListener('click', async () => {
    let ocupadas = [];
    try {
      const resp = await api.get(`/api/cotizaciones/seguimientos-ocupados?id_ejecutivo=${idEjecutivo}`);
      ocupadas = resp.data ?? [];
    } catch { /* sin calendario de fondo, el selector igual funciona */ }

    openCalendarPicker({
      titulo:        'Fecha de próximo seguimiento',
      valorActual:   fechaInput?.value || null,
      fechasOcupadas: ocupadas,
      onSelect: (fechaStr) => {
        if (fechaInput) fechaInput.value = fechaStr;
        if (fechaBtn)   fechaBtn.textContent = fmtDate(fechaStr);
      },
      onClear: () => {
        if (fechaInput) fechaInput.value = '';
        if (fechaBtn)   fechaBtn.textContent = 'Sin fecha — elegir';
      },
    });
  });

  btn.addEventListener('click', () => {
    const estado_venta = estadoSel?.value || null;
    const estado_venta_detalle = detalleInput?.value.trim() || null;
    const fecha_proximo_seguimiento = fechaInput?.value || null;

    if (errEl) errEl.textContent = '';
    if (estado_venta === 'Otro' && !estado_venta_detalle) {
      if (errEl) errEl.textContent = "Especifica el estado cuando eliges 'Otro'.";
      return;
    }

    CommandInvoker.run(
      new SetSeguimientoVentaCommand(id, { estado_venta, estado_venta_detalle, fecha_proximo_seguimiento }),
      {
        btn,
        successMsg: 'Seguimiento comercial guardado.',
        onSuccess:  () => onSaved?.(),
        onError:    (err) => { if (errEl) errEl.textContent = err.data?.message || err.message; },
      }
    );
  });
}

// ---------------------------------------------------------------------------
// buildTimelineHtml
// Converts a state-history array (from GET /:id/historial) into a rendered
// HTML string for the chronological "Historial de Seguimiento" timeline.
// Returns an empty string when history is empty so callers can safely call
// insertAdjacentHTML without a conditional guard.
//
// @param   {Array}   history  — State history records from the API
// @returns {string}           — HTML string ready for insertAdjacentHTML
// ---------------------------------------------------------------------------
export function buildTimelineHtml(history) {
  if (!history || history.length === 0) return '';

  const items = history.map((h, i) => {
    const isFirst = i === 0;
    const label   = h.tipo_evento === 'creacion'
      ? 'Cotización creada'
      : `${escHtml(h.estado_anterior ?? '—')} → ${escHtml(h.estado_nuevo)}`;
    const fecha   = h.creado_en
      ? new Date(h.creado_en).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })
      : '—';
    const obs     = h.observacion
      ? ` <em class="text-secondary">Obs: ${escHtml(h.observacion)}</em>`
      : '';
    return `
      <li class="timeline-item">
        <span style="flex-shrink:0;width:10px;height:10px;border-radius:50%;
                     margin-top:4px;background:${isFirst ? 'var(--clr-blue)' : 'var(--clr-indigo)'};"></span>
        <div class="timeline-texto">
          <strong>${fecha}</strong> — ${label}<br>
          <span class="text-secondary">
            Usuario: ${escHtml(h.nombre_usuario ?? '—')}
            ${h.rol_usuario ? ` · Rol: ${escHtml(h.rol_usuario)}` : ''}
          </span>
          ${obs}
        </div>
      </li>`;
  }).join('');

  return `
    <div class="timeline-seccion">
      <h4>Historial de Seguimiento
      </h4>
      <ol class="timeline">
        ${items}
      </ol>
    </div>`;
}

// ---------------------------------------------------------------------------
// buildQuotationDetailButtons
// Renders the action-button row for a quotation detail modal.
// Always includes the PDF button; conditionally adds the Excel button when
// excel_ruta is present on the quotation object.
//
// @param   {Object}  quotation — Full quotation object from GET /:id
// @returns {string}            — HTML string for the button row
// ---------------------------------------------------------------------------
export function buildQuotationDetailButtons(quotation) {
  const pdfBtn = `
    <button
      type="button"
      id="btn-ver-pdf"
      class="btn btn-primary btn-sm inline-flex-gap"
     
    >
      Ver PDF Adjunto
    </button>`;

  const excelBtn = quotation.excel_ruta
    ? `<button
        type="button"
        id="btn-ver-excel"
        class="btn btn-sm btn-excel"
      >
        Descargar Excel
      </button>`
    : '';

  return `
    <div class="acciones-fila mt-2">
      ${pdfBtn}
      ${excelBtn}
    </div>`;
}
