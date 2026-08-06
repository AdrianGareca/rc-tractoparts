// =============================================================================
// public/js/views/quotationForm/brandModal.js
// Sub-modal de alta rápida de marca ("+" en la columna Marca de cada fila).
//
// Lógica PURA separada del cableado:
//   upsertBrand       — inserta la marca en el caché y lo reordena por nombre
//   buildBrandOptions — markup de <option> del selector de marca
//   openBrandModal    — monta el sub-modal y maneja el alta contra la API
//
// Extraído de FormMediator._openNuevaMarcaModal sin cambios de comportamiento.
// Cubierto por tests/unit/quotationFormBrandModal.test.js.
// =============================================================================

import api, { showToast } from '../../services/apiClient.js';
import { escText } from './helpers.js';

/**
 * Inserta una marca en el caché compartido si todavía no está, y lo reordena
 * alfabéticamente. Muta el array recibido a propósito: es la MISMA referencia
 * que el Mediator le pasa a cada fila, así el alta se ve en todos los selectores.
 * @returns {boolean} true si la marca se agregó (false si ya estaba).
 */
export function upsertBrand(brands, brand) {
  if (brands.find(b => b.id === brand.id)) return false;
  brands.push({ id: brand.id, nombre: brand.nombre });
  brands.sort((a, b) => a.nombre.localeCompare(b.nombre));
  return true;
}

/** Markup completo de un <select> de marca, con `selectedId` preseleccionada. */
export function buildBrandOptions(brands, selectedId = null) {
  return '<option value="">— Sin marca —</option>' +
    brands.map(b =>
      `<option value="${b.id}"${b.id === selectedId ? ' selected' : ''}>${escText(b.nombre)}</option>`
    ).join('');
}

/**
 * Abre el sub-modal de registro de marca.
 *
 * @param {number} rowIndex — fila que disparó el alta (recibe la marca nueva)
 * @param {Object} deps
 *   container     {HTMLElement} — raíz del formulario (para buscar los selectores)
 *   brands        {Array}       — caché compartido de marcas (se muta in-place)
 *   onFieldChange {Function}    — (idx, field, value) del Mediator
 */
export function openBrandModal(rowIndex, { container, brands, onFieldChange } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'sub-modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'bm-title');

  overlay.innerHTML = /* html */ `
    <div class="sub-modal">
      <div class="sub-modal-header">
        <h4 id="bm-title">Registrar nueva marca</h4>
        <button type="button" class="btn-icon sub-modal-close" id="bm-close" aria-label="Cerrar">✕</button>
      </div>
      <div class="sub-modal-body">
        <div class="form-group">
          <label class="form-label" for="bm-nombre">Nombre de la marca *</label>
          <input class="form-control" type="text" id="bm-nombre"
                 placeholder="Ej: Hitachi" maxlength="100" />
          <span class="field-error" id="bm-err"></span>
        </div>
        <div class="form-alert" id="bm-alert" role="alert"></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="bm-cancel">Cancelar</button>
          <button type="button" class="btn btn-primary" id="bm-save">
            <span id="bm-label">Guardar Marca</span>
            <span class="spinner hidden" id="bm-spinner"></span>
          </button>
        </div>
      </div>
    </div>
  `;

  container.closest('.modal-body, [id="modal-body"]')?.appendChild(overlay)
    ?? document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('#bm-close')?.addEventListener('click', close);
  overlay.querySelector('#bm-cancel')?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.querySelector('#bm-nombre')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); overlay.querySelector('#bm-save')?.click(); }
  });

  overlay.querySelector('#bm-save')?.addEventListener('click', async () => {
    const nombre  = overlay.querySelector('#bm-nombre')?.value.trim();
    const errEl   = overlay.querySelector('#bm-err');
    const alertEl = overlay.querySelector('#bm-alert');
    const saveBtn = overlay.querySelector('#bm-save');
    const lbl     = overlay.querySelector('#bm-label');
    const spin    = overlay.querySelector('#bm-spinner');

    if (!nombre) { errEl.textContent = 'El nombre es requerido.'; return; }
    errEl.textContent  = '';
    alertEl.className  = 'form-alert';
    saveBtn.disabled   = true;
    lbl.textContent    = 'Guardando...';
    spin.classList.remove('hidden');

    try {
      const resp = await api.post('/api/marcas', { nombre });
      const brand = resp.data;

      // Update global brand cache
      upsertBrand(brands, brand);

      // Refresh ALL selectors across all rows with the new option
      container.querySelectorAll('.item-marca').forEach(sel => {
        const currentVal = sel.value;
        sel.innerHTML = buildBrandOptions(brands, brand.id);
        // Restore previous selection unless this is the target row
        const idx = parseInt(sel.dataset.idx, 10);
        if (idx === rowIndex) {
          sel.value = String(brand.id);
          onFieldChange?.(rowIndex, 'marca_id', brand.id);
        } else {
          sel.value = currentVal;
        }
      });

      showToast(`Marca "${brand.nombre}" registrada y seleccionada.`, 'success');
      close();
    } catch (err) {
      // If 409 — brand already exists: auto-select it
      if (err.status === 409 && err.data?.data) {
        const existing = err.data.data;
        upsertBrand(brands, existing);

        // Auto-select in target row
        const targetSel = container.querySelector(`.item-marca[data-idx="${rowIndex}"]`);
        if (targetSel) {
          if (!targetSel.querySelector(`option[value="${existing.id}"]`)) {
            const opt = document.createElement('option');
            opt.value = existing.id;
            opt.textContent = existing.nombre;
            targetSel.appendChild(opt);
          }
          targetSel.value = String(existing.id);
          onFieldChange?.(rowIndex, 'marca_id', existing.id);
        }
        showToast(`Marca "${existing.nombre}" ya existe. Seleccionada automáticamente.`, 'info');
        close();
        return;
      }

      const msg = err.data?.message || err.message || 'Error al crear la marca.';
      alertEl.textContent = msg;
      alertEl.className   = 'form-alert show alert-error';
      saveBtn.disabled    = false;
      lbl.textContent     = 'Guardar Marca';
      spin.classList.add('hidden');
    }
  });

  // Auto-focus brand name input
  setTimeout(() => overlay.querySelector('#bm-nombre')?.focus(), 50);

  return overlay;
}
