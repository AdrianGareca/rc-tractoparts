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

import api, { showToast } from '../../../services/apiClient.js';
import { escHtml }        from '../helpers.js';

// ---------------------------------------------------------------------------
// saveBlobAs — user-controlled file save with graceful degradation.
//
// Modern path (Chrome/Edge over HTTPS/localhost): window.showSaveFilePicker
// opens the OS-native "Guardar como…" dialog so the user CHOOSES the
// destination folder (and may rename), with the quotation correlativo
// pre-filled as the suggested filename. Nothing touches disk until they
// confirm; cancelling the dialog saves nothing at all.
//
// Fallback path (Firefox/Safari, or contexts where the picker API is
// unavailable): the classic anchor-download trick with the forced filename.
// Where THAT file lands is governed by the browser's own settings — users
// who want a location prompt there must enable "Preguntar dónde guardar
// cada archivo antes de descargarlo" in the browser preferences.
//
// @param   {Blob}   blob      — File content to persist
// @param   {string} fileName  — Suggested filename (e.g. "SC-2026_000692.pdf")
// @param   {Object} fileType  — showSaveFilePicker "types" entry, e.g.
//                               { description: 'Documento PDF',
//                                 accept: { 'application/pdf': ['.pdf'] } }
// @returns {Promise<'saved'|'cancelled'|'downloaded'>}
//   'saved'      → user picked a location via the native dialog.
//   'cancelled'  → user dismissed the dialog; nothing written.
//   'downloaded' → picker unavailable/failed; file went to the browser's
//                  default Downloads folder via the legacy anchor fallback.
//                  Callers use this to tell the user WHERE the file landed,
//                  since in that path they never got to choose.
// ---------------------------------------------------------------------------
async function saveBlobAs(blob, fileName, fileType) {
  // The picker is ONLY exposed in a secure context (HTTPS or http://localhost)
  // on Chromium browsers. Over plain HTTP on a LAN IP, or in Firefox/Safari, it
  // is undefined — so this branch is skipped and we fall back to a download.
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle   = await window.showSaveFilePicker({
        suggestedName: fileName,
        types:         [fileType],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'saved';
    } catch (err) {
      // User dismissed the dialog — a deliberate choice, not an error.
      if (err?.name === 'AbortError') return 'cancelled';
      // Any other picker failure (rare: permission policy, transient FS error)
      // falls through to the legacy anchor download so the file is never lost.
      console.warn('[saveBlobAs] Save picker failed — falling back to direct download:', err.message);
    }
  }

  // Legacy fallback: direct anchor download (browser decides the folder).
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href  = url;
  link.setAttribute('download', fileName);
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Short delay before releasing the URL guarantees the download has been
  // handed off to the browser's download manager.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

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
      const outcome = await saveBlobAs(blob, fileName, {
        description: 'Documento PDF',
        accept:      { 'application/pdf': ['.pdf'] },
      });
      if (outcome === 'saved') {
        showToast('PDF guardado en la ubicación elegida.', 'success', 2500);
      } else if (outcome === 'downloaded') {
        showToast('PDF descargado a tu carpeta de Descargas.', 'info', 3500);
      }
    } catch (err) {
      showToast(err.data?.message || err.message || 'No se pudo cargar el PDF.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '📄 Ver PDF Adjunto';
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
      const outcome = await saveBlobAs(blob, fileName, {
        description: 'Planilla de Excel',
        accept:      { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] },
      });
      if (outcome === 'saved') {
        showToast('Planilla Excel guardada en la ubicación elegida.', 'success', 2500);
      } else if (outcome === 'downloaded') {
        showToast('Planilla Excel descargada a tu carpeta de Descargas.', 'info', 3500);
      }
    } catch (err) {
      showToast(err.data?.message || err.message || 'No se pudo descargar la planilla Excel.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '📊 Descargar Excel';
    }
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
      ? ` <em style="color:var(--text-secondary);">Obs: ${escHtml(h.observacion)}</em>`
      : '';
    return `
      <li style="display:flex;gap:.75rem;margin-bottom:.75rem;align-items:flex-start;">
        <span style="flex-shrink:0;width:10px;height:10px;border-radius:50%;
                     margin-top:4px;background:${isFirst ? '#3B82F6' : '#6366F1'};"></span>
        <div style="font-size:.85rem;line-height:1.4;">
          <strong>${fecha}</strong> — ${label}<br>
          <span style="color:var(--text-secondary);">
            Usuario: ${escHtml(h.nombre_usuario ?? '—')}
            ${h.rol_usuario ? ` · Rol: ${escHtml(h.rol_usuario)}` : ''}
          </span>
          ${obs}
        </div>
      </li>`;
  }).join('');

  return `
    <div style="margin-top:1.5rem;border-top:1px solid var(--border);padding-top:1rem;">
      <h4 style="margin-bottom:.75rem;font-size:.95rem;color:var(--text-secondary);">
        🕐 Historial de Seguimiento
      </h4>
      <ol style="list-style:none;padding:0;margin:0;position:relative;">
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
      class="btn btn-primary btn-sm"
      style="display:inline-flex;align-items:center;gap:.35rem;"
    >
      📄 Ver PDF Adjunto
    </button>`;

  const excelBtn = quotation.excel_ruta
    ? `<button
        type="button"
        id="btn-ver-excel"
        class="btn btn-sm"
        style="display:inline-flex;align-items:center;gap:.35rem;
               background:#16a34a;color:#fff;border:1px solid #15803d;"
      >
        📊 Descargar Excel
      </button>`
    : '';

  return `
    <div style="display:flex;flex-wrap:wrap;gap:.5rem;margin-top:1rem;">
      ${pdfBtn}
      ${excelBtn}
    </div>`;
}
