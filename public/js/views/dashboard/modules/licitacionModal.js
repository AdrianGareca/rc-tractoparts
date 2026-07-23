// =============================================================================
// public/js/views/dashboard/modules/licitacionModal.js
// "Nueva / Editar Licitación" sub-modal — also doubles as the "Adjuntar
// Documentos" modal via mode: 'attach' (see below).
//
// Mirrors the clientModal.js pattern: renders its own .sub-modal-overlay,
// resolves via callback (onSaved). The client (entidad convocante) is chosen
// through an inline autocomplete on GET /api/clientes, with a "+ Nuevo" shortcut
// that reuses openClienteModal so Proyectos never leaves the flow to register a
// convocante.
//
// Document upload lives in this same file (not in licitacionesView.js's detail
// modal) so a file is picked once and uploaded right after the licitación is
// created/updated — same pattern as the Excel attach in quotationForm.js.
//
// Exports:
//   openLicitacionModal({ mode, licitacion, onSaved, mountTarget })
//     mode        'create' | 'edit' | 'attach'
//       'create'  — full header form + optional documents. licitacion ignored.
//       'edit'    — full header form + optional documents. Requires `licitacion`.
//                   Only reachable while the licitación is in an editable state
//                   (En preparacion/Cotizando — enforced by the caller, which
//                   only wires the "Editar" button then).
//       'attach'  — documents ONLY, no header fields, no state restriction.
//                   Requires `licitacion`. Lets Proyectos/Jefe/SysAdmin attach
//                   files at any lifecycle stage (e.g. after "Adjudicada"),
//                   which 'edit' mode alone cannot reach once the header
//                   becomes read-only.
//     licitacion  the row to edit/attach to; ignored on create
//     onSaved     callback run after a successful save/upload
//     mountTarget where to append the overlay (default document.body)
// =============================================================================

import api, { showToast } from '../../../services/apiClient.js';
import { escHtml, docIcon } from '../helpers.js';
import { openClienteModal } from './clientModal.js';

const ALLOWED_DOC_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png'];
const CURRENCIES = ['BOB', 'USD'];

export function openLicitacionModal({ mode = 'create', licitacion = null, onSaved, mountTarget = document.body }) {
  const isAttach = mode === 'attach' && licitacion;
  const isEdit   = mode === 'edit' && licitacion;
  const showHeaderFields = !isAttach;

  // Selected client state (prefilled on edit; irrelevant in attach mode).
  let selectedClientId   = isEdit ? licitacion.id_cliente : null;
  let selectedClientName = isEdit ? (licitacion.cliente_nombre ?? '') : '';

  const title = isAttach ? '📎 Adjuntar Documentos' : (isEdit ? '✏️ Editar Licitación' : '➕ Nueva Licitación');
  const submitLabel = isAttach ? 'Subir documentos' : (isEdit ? 'Guardar cambios' : 'Crear licitación');

  const headerFieldsHtml = `
    <div class="form-group">
      <label class="form-label" for="lic-nombre">Nombre de la licitación *</label>
      <input class="form-control" id="lic-nombre" type="text" maxlength="200" required
             value="${isEdit ? escHtml(licitacion.nombre) : ''}"
             placeholder="Ej. Provisión de repuestos flota municipal 2026" />
    </div>

    <div class="form-group">
      <label class="form-label" for="lic-cliente-search">Entidad convocante *</label>
      <div class="client-select-wrapper">
        <div class="client-search-group">
          <input class="form-control" id="lic-cliente-search" type="text" autocomplete="off"
                 aria-haspopup="listbox" aria-autocomplete="list"
                 placeholder="Buscar por razón social o NIT…"
                 value="${isEdit ? escHtml(selectedClientName) : ''}" />
          <button type="button" class="btn btn-outline-green btn-sm btn-nuevo-cliente" id="lic-cliente-new"
                  title="Registrar nueva entidad convocante">+ Nuevo</button>
        </div>
        <input type="hidden" id="lic-id-cliente" value="${isEdit ? escHtml(String(selectedClientId)) : ''}" />
        <div class="client-dropdown" id="lic-cliente-results" role="listbox" aria-label="Convocantes sugeridos"></div>
      </div>
      <small class="text-muted" id="lic-cliente-hint">${isEdit ? 'Convocante actual: ' + escHtml(selectedClientName) : 'Selecciona la entidad que convoca la licitación.'}</small>
    </div>

    <div class="form-group">
      <label class="form-label" for="lic-descripcion">Descripción</label>
      <textarea class="form-control" id="lic-descripcion" rows="3" maxlength="5000"
                placeholder="Objeto de la licitación, alcance, notas…">${isEdit && licitacion.descripcion ? escHtml(licitacion.descripcion) : ''}</textarea>
    </div>

    <div style="display:flex;gap:.75rem;flex-wrap:wrap;">
      <div class="form-group" style="flex:1;min-width:150px;">
        <label class="form-label" for="lic-presupuesto">Presupuesto referencial</label>
        <input class="form-control" id="lic-presupuesto" type="number" min="0" step="0.01"
               value="${isEdit && licitacion.presupuesto_referencial != null ? escHtml(String(licitacion.presupuesto_referencial)) : ''}"
               placeholder="0.00" />
      </div>
      <div class="form-group" style="width:120px;">
        <label class="form-label" for="lic-moneda">Moneda</label>
        <select class="form-control" id="lic-moneda">
          ${CURRENCIES.map((c) => `<option value="${c}" ${isEdit && licitacion.moneda === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="flex:1;min-width:150px;">
        <label class="form-label" for="lic-fecha-limite">Fecha límite</label>
        <input class="form-control" id="lic-fecha-limite" type="date"
               value="${isEdit && licitacion.fecha_limite ? escHtml(String(licitacion.fecha_limite).slice(0, 10)) : ''}" />
      </div>
    </div>`;

  const overlay = document.createElement('div');
  overlay.className = 'sub-modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div class="sub-modal" style="max-width:560px;">
      <div class="sub-modal-header">
        <h4>${title}${isAttach ? ` — ${escHtml(licitacion.codigo)}` : ''}</h4>
        <button type="button" class="btn-icon sub-modal-close" id="lic-close" aria-label="Cerrar">✕</button>
      </div>
      <div class="sub-modal-body">
        <form id="lic-form" novalidate>
          ${showHeaderFields ? headerFieldsHtml : ''}

          <div class="form-group">
            <label class="form-label">Documentos ${showHeaderFields ? '<span class="text-muted">(opcional)</span>' : ''}</label>
            <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;">
              <input type="file" id="lic-doc-input" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png" style="display:none;" />
              <button type="button" class="btn btn-ghost btn-sm" id="lic-doc-pick">📎 Elegir archivos</button>
              <span class="text-muted text-sm">PDF, Word, Excel o imágenes · varios a la vez</span>
            </div>
            <div id="lic-doc-filelist" style="margin-top:.35rem;"></div>
          </div>

          <div class="form-error" id="lic-form-err" style="color:var(--clr-red);min-height:1.2em;"></div>

          <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:.5rem;">
            <button type="button" class="btn btn-ghost" id="lic-cancel">Cancelar</button>
            <button type="submit" class="btn btn-primary" id="lic-submit">${submitLabel}</button>
          </div>
        </form>
      </div>
    </div>`;

  mountTarget.appendChild(overlay);

  const $ = (sel) => overlay.querySelector(sel);
  const close = () => overlay.remove();

  $('#lic-close').addEventListener('click', close);
  $('#lic-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // ── Client autocomplete (only rendered outside 'attach' mode) ────────────────
  if (showHeaderFields) {
    const searchInput = $('#lic-cliente-search');
    const resultsPanel = $('#lic-cliente-results');
    let debounce;

    const closeDropdown = () => { resultsPanel.innerHTML = ''; resultsPanel.classList.remove('open'); };

    function pickClient(clientId, name) {
      selectedClientId = clientId;
      selectedClientName = name;
      $('#lic-id-cliente').value = String(clientId);
      searchInput.value = name;
      $('#lic-cliente-hint').textContent = 'Convocante seleccionado: ' + name;
      closeDropdown();
    }

    searchInput.addEventListener('input', () => {
      // Typing invalidates a prior selection until a new one is confirmed.
      selectedClientId = null;
      $('#lic-id-cliente').value = '';
      const term = searchInput.value.trim();
      clearTimeout(debounce);
      if (term.length < 1) { closeDropdown(); return; }
      debounce = setTimeout(async () => {
        try {
          const body = await api.get(`/api/clientes?q=${encodeURIComponent(term)}`);
          const rows = body.data ?? [];
          if (rows.length === 0) {
            resultsPanel.innerHTML = `<div class="client-dropdown-empty">Sin resultados para "<em>${escHtml(term)}</em>"</div>`;
          } else {
            resultsPanel.innerHTML = rows.map((c) =>
              `<div class="client-dropdown-item" data-cid="${c.id}" data-cname="${escHtml(c.razon_social)}" role="option" tabindex="-1">
                 <span class="cdi-name">${escHtml(c.razon_social)}</span>
                 ${c.nit ? `<span class="cdi-nit">NIT: ${escHtml(c.nit)}</span>` : ''}
               </div>`).join('');
            resultsPanel.querySelectorAll('[data-cid]').forEach((el) => {
              el.addEventListener('mousedown', (e) => {
                e.preventDefault();
                pickClient(parseInt(el.dataset.cid, 10), el.dataset.cname);
              });
            });
          }
          resultsPanel.classList.add('open');
        } catch (err) {
          resultsPanel.innerHTML = `<div class="client-dropdown-empty">Error: ${escHtml(err.message)}</div>`;
          resultsPanel.classList.add('open');
        }
      }, 250);
    });

    // Hide the dropdown when clicking elsewhere inside the modal.
    overlay.addEventListener('click', (e) => {
      if (!e.target.closest('#lic-cliente-search') && !e.target.closest('#lic-cliente-results')) {
        closeDropdown();
      }
    });

    // "+ Nuevo" convocante — reuse the shared client modal, then auto-select it.
    // openClienteModal invokes onSaved(id, label) — matching that signature.
    $('#lic-cliente-new').addEventListener('click', () => {
      openClienteModal({
        mode: 'create',
        client: null,
        mountTarget: document.body,
        onSaved: (clientId, label) => { if (clientId) pickClient(parseInt(clientId, 10), label); },
      });
    });
  }

  // ── Documentos: seleccionar (se suben recién después de guardar el header —
  // o de inmediato en modo 'attach', donde no hay header que guardar. Mismo
  // patrón que el adjunto de Excel en quotationForm.js: elegir primero, subir
  // después de que el registro ya tiene id) ────────────────────────────────────
  const docPickBtn = $('#lic-doc-pick');
  const docInput   = $('#lic-doc-input');
  let selectedFiles = [];

  function renderSelectedFiles() {
    const listEl = $('#lic-doc-filelist');
    if (!listEl) return;
    listEl.innerHTML = selectedFiles.map((f, i) => `
      <div style="display:flex;align-items:center;gap:.4rem;padding:.15rem 0;font-size:.82rem;">
        <span>${docIcon(f.name)}</span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(f.name)}</span>
        <button type="button" class="btn-icon" data-remove-file="${i}" aria-label="Quitar">✕</button>
      </div>`).join('');
    listEl.querySelectorAll('[data-remove-file]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedFiles.splice(parseInt(btn.dataset.removeFile, 10), 1);
        renderSelectedFiles();
      });
    });
  }

  function addFiles(fileList) {
    const errEl = $('#lic-form-err');
    if (errEl) errEl.textContent = '';
    Array.from(fileList).forEach((f) => {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      if (!ALLOWED_DOC_EXTENSIONS.includes(ext)) {
        if (errEl) errEl.textContent = `Tipo no permitido: "${f.name}". Solo PDF, Word, Excel o imágenes.`;
        return;
      }
      selectedFiles.push(f);
    });
    renderSelectedFiles();
  }

  if (docPickBtn && docInput) {
    docPickBtn.addEventListener('click', () => docInput.click());
    docInput.addEventListener('change', (e) => {
      if (e.target.files.length) addFiles(e.target.files);
      e.target.value = ''; // permite volver a elegir el mismo archivo si se quitó
    });
  }

  // ── Submit ──────────────────────────────────────────────────────────────────
  $('#lic-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('#lic-form-err');
    errEl.textContent = '';

    const submitBtn = $('#lic-submit');

    // ── Modo 'attach': solo sube archivos a una licitación ya existente ────────
    if (isAttach) {
      if (selectedFiles.length === 0) {
        errEl.textContent = 'Selecciona al menos un archivo.';
        return;
      }
      const formData = new FormData();
      selectedFiles.forEach((f) => formData.append('documentos', f));

      submitBtn.disabled = true;
      const original = submitBtn.textContent;
      submitBtn.textContent = 'Subiendo…';
      try {
        await api.upload(`/api/licitaciones/${licitacion.id}/documentos`, formData);
        showToast('Documento(s) subido(s) correctamente.', 'success');
        close();
        if (typeof onSaved === 'function') onSaved(licitacion);
      } catch (err) {
        errEl.textContent = err.data?.message || err.message || 'No se pudo subir el archivo.';
        submitBtn.disabled = false;
        submitBtn.textContent = original;
      }
      return;
    }

    // ── Modo 'create'/'edit': guarda el header y luego sube documentos ─────────
    const nombre = $('#lic-nombre').value.trim();
    const idCliente = parseInt($('#lic-id-cliente').value, 10);
    const presupuestoRaw = $('#lic-presupuesto').value.trim();
    const fechaLimite = $('#lic-fecha-limite').value;

    if (!nombre) { errEl.textContent = 'El nombre es obligatorio.'; return; }
    if (!idCliente || isNaN(idCliente)) {
      errEl.textContent = 'Selecciona una entidad convocante de la lista (o crea una nueva).';
      return;
    }

    const payload = {
      nombre,
      id_cliente: idCliente,
      descripcion: $('#lic-descripcion').value.trim() || null,
      presupuesto_referencial: presupuestoRaw === '' ? null : parseFloat(presupuestoRaw),
      moneda: $('#lic-moneda').value,
      fecha_limite: fechaLimite || null,
    };

    submitBtn.disabled = true;
    const original = submitBtn.textContent;
    submitBtn.textContent = isEdit ? 'Guardando…' : 'Creando…';

    try {
      let saved;
      if (isEdit) {
        const res = await api.put(`/api/licitaciones/${licitacion.id}`, payload);
        saved = res.data;
        showToast('Licitación actualizada.', 'success');
      } else {
        const res = await api.post('/api/licitaciones', payload);
        saved = res.data;
        showToast(`Licitación ${saved?.codigo ?? ''} creada.`, 'success');
      }

      // Subir los documentos elegidos (si hay) ahora que la licitación tiene id.
      // No fatal: si falla, la licitación ya quedó creada/guardada — se avisa
      // con un toast aparte en vez de perder el guardado principal.
      if (selectedFiles.length > 0 && saved?.id) {
        const formData = new FormData();
        selectedFiles.forEach((f) => formData.append('documentos', f));
        try {
          await api.upload(`/api/licitaciones/${saved.id}/documentos`, formData);
        } catch (docErr) {
          showToast(
            `Licitación guardada, pero uno o más documentos no pudieron subirse: ${docErr.data?.message || docErr.message}`,
            'warning'
          );
        }
      }

      close();
      if (typeof onSaved === 'function') onSaved(saved);
    } catch (err) {
      errEl.textContent = err.data?.message || err.message || 'No se pudo guardar la licitación.';
      submitBtn.disabled = false;
      submitBtn.textContent = original;
    }
  });

  // Focus the name field (or the file input in attach mode) for quick entry.
  setTimeout(() => (showHeaderFields ? $('#lic-nombre') : $('#lic-doc-input'))?.focus(), 50);
}
