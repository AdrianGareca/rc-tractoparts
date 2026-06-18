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
// wirePdfButton
// Attaches an authenticated PDF fetch handler to the #btn-ver-pdf button
// rendered inside a modal body. Uses apiClient (which injects the Bearer
// token) instead of a plain anchor navigation that would strip the header.
//
// @param {HTMLElement}    body  — Modal body containing #btn-ver-pdf
// @param {number|string}  id   — Quotation ID for the endpoint URL
// ---------------------------------------------------------------------------
export function wirePdfButton(body, id) {
  const btn = body.querySelector('#btn-ver-pdf');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = '…';
    try {
      const response = await api.get(`/api/cotizaciones/${id}/pdf`);
      const blob     = await response.blob();
      const url      = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      // Revoke the object URL after a short delay to free memory while
      // still giving the new tab enough time to load the PDF.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
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
// The response is streamed as a Blob and triggered as a file download rather
// than opened inline, since browsers cannot natively render .xlsx files.
//
// @param {HTMLElement}    body  — Modal body containing #btn-ver-excel
// @param {number|string}  id   — Quotation ID for the endpoint URL
// @param {string}         correlativo — Used as the suggested download filename
// ---------------------------------------------------------------------------
export function wireExcelButton(body, id, correlativo) {
  const btn = body.querySelector('#btn-ver-excel');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = '…';
    try {
      const response = await api.get(`/api/cotizaciones/${id}/excel`);
      const blob     = await response.blob();
      const url      = URL.createObjectURL(blob);
      // Trigger browser download with the correlativo filename
      const anchor   = document.createElement('a');
      anchor.href    = url;
      anchor.download = `${correlativo ?? id}.xlsx`;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
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
