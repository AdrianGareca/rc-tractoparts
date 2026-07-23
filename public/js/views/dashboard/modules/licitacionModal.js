// =============================================================================
// public/js/views/dashboard/modules/licitacionModal.js
// "Nueva / Editar Licitación" sub-modal.
//
// Mirrors the clientModal.js pattern: renders its own .sub-modal-overlay,
// resolves via callback (onSaved). The client (entidad convocante) is chosen
// through an inline autocomplete on GET /api/clientes, with a "+ Nuevo" shortcut
// that reuses openClienteModal so Proyectos never leaves the flow to register a
// convocante.
//
// Exports:
//   openLicitacionModal({ mode, licitacion, onSaved, mountTarget })
//     mode        'create' | 'edit'
//     licitacion  the row to edit (mode='edit'); ignored on create
//     onSaved     callback run after a successful POST/PUT
//     mountTarget where to append the overlay (default document.body)
// =============================================================================

import api, { showToast } from '../../../services/apiClient.js';
import { escHtml } from '../helpers.js';
import { openClienteModal } from './clientModal.js';

const CURRENCIES = ['BOB', 'USD'];

export function openLicitacionModal({ mode = 'create', licitacion = null, onSaved, mountTarget = document.body }) {
  const isEdit = mode === 'edit' && licitacion;

  // Selected client state (prefilled on edit).
  let selectedClientId   = isEdit ? licitacion.id_cliente : null;
  let selectedClientName = isEdit ? (licitacion.cliente_nombre ?? '') : '';

  const overlay = document.createElement('div');
  overlay.className = 'sub-modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div class="sub-modal" style="max-width:560px;">
      <div class="sub-modal-header">
        <h4>${isEdit ? '✏️ Editar Licitación' : '➕ Nueva Licitación'}</h4>
        <button type="button" class="btn-icon sub-modal-close" id="lic-close" aria-label="Cerrar">✕</button>
      </div>
      <div class="sub-modal-body">
        <form id="lic-form" novalidate>
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
          </div>

          <div class="form-error" id="lic-form-err" style="color:var(--clr-red);min-height:1.2em;"></div>

          <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:.5rem;">
            <button type="button" class="btn btn-ghost" id="lic-cancel">Cancelar</button>
            <button type="submit" class="btn btn-primary" id="lic-submit">${isEdit ? 'Guardar cambios' : 'Crear licitación'}</button>
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

  // ── Client autocomplete ────────────────────────────────────────────────────
  const searchInput = $('#lic-cliente-search');
  const resultsPanel = $('#lic-cliente-results');
  let debounce;

  const closeDropdown = () => { resultsPanel.innerHTML = ''; resultsPanel.classList.remove('open'); };

  function pickClient(id, name) {
    selectedClientId = id;
    selectedClientName = name;
    $('#lic-id-cliente').value = String(id);
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
      onSaved: (id, label) => { if (id) pickClient(parseInt(id, 10), label); },
    });
  });

  // ── Submit ──────────────────────────────────────────────────────────────────
  $('#lic-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('#lic-form-err');
    errEl.textContent = '';

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

    const submitBtn = $('#lic-submit');
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
      close();
      if (typeof onSaved === 'function') onSaved(saved);
    } catch (err) {
      errEl.textContent = err.data?.message || err.message || 'No se pudo guardar la licitación.';
      submitBtn.disabled = false;
      submitBtn.textContent = original;
    }
  });

  // Focus the name field for quick entry.
  setTimeout(() => $('#lic-nombre')?.focus(), 50);
}
