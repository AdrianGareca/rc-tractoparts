// =============================================================================
// public/js/views/dashboard/modules/clientModal.js
// "Nuevo Cliente" / "Editar Cliente" sub-modal — shared between the quotation
// form's inline client search (quotationForm.js) and the "Gestión de
// Clientes" management tab (clientsView.js), so the fields, validation, and
// duplicate-NIT handling live in exactly one place.
//
// Exports:
//   openClienteModal({ mode, client, onSaved, mountTarget }) — renders the
//     overlay into mountTarget (or document.body) and wires create/update.
// =============================================================================

import api, { showToast } from '../../../services/apiClient.js';
import { escHtml }        from '../helpers.js';

/**
 * @param {Object}   opts
 * @param {'create'|'edit'} opts.mode
 * @param {Object|null} opts.client      - existing client data (edit mode only)
 * @param {Function} opts.onSaved        - (id, label) => void, called after a
 *   successful create/update, or when the user picks the client that already
 *   owns a conflicting NIT.
 * @param {HTMLElement} [opts.mountTarget] - where to append the overlay;
 *   defaults to document.body.
 */
export function openClienteModal({ mode, client, onSaved, mountTarget }) {
  const isEdit = mode === 'edit';

  const overlay = document.createElement('div');
  overlay.className = 'sub-modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'subm-title');

  overlay.innerHTML = /* html */ `
    <div class="sub-modal">
      <div class="sub-modal-header">
        <h4 id="subm-title">${isEdit ? 'Editar Cliente' : 'Registrar Nuevo Cliente'}</h4>
        <button type="button" class="btn-icon sub-modal-close" id="subm-close" aria-label="Cerrar">✕</button>
      </div>
      <div class="sub-modal-body">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="nc-razon-social">Razón Social *</label>
            <input class="form-control" type="text" id="nc-razon-social"
                   placeholder="Nombre comercial o legal" maxlength="150"
                   value="${escHtml(client?.razon_social ?? '')}" />
            <span class="field-error" id="nc-err-razon"></span>
          </div>
          <div class="form-group">
            <label class="form-label" for="nc-nit">NIT</label>
            <input class="form-control" type="text" id="nc-nit"
                   placeholder="Ej: 1234567890" maxlength="20"
                   value="${escHtml(client?.nit ?? '')}" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="nc-contacto">Contacto</label>
            <input class="form-control" type="text" id="nc-contacto"
                   placeholder="Nombre del responsable"
                   value="${escHtml(client?.contacto ?? '')}" />
          </div>
          <div class="form-group">
            <label class="form-label" for="nc-telefono">Teléfono</label>
            <input class="form-control" type="tel" id="nc-telefono"
                   placeholder="Ej: 77012345"
                   value="${escHtml(client?.telefono ?? '')}" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="nc-email">Email</label>
          <input class="form-control" type="email" id="nc-email"
                 placeholder="contacto@empresa.com"
                 value="${escHtml(client?.email ?? '')}" />
        </div>
        <div class="form-alert" id="nc-alert" role="alert"></div>
        <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:1.25rem;">
          <button type="button" class="btn btn-ghost" id="subm-cancel">Cancelar</button>
          <button type="button" class="btn btn-primary" id="subm-save">
            <span id="subm-label">${isEdit ? 'Guardar Cambios' : 'Guardar Cliente'}</span>
            <span class="spinner hidden" id="subm-spinner"></span>
          </button>
        </div>
      </div>
    </div>
  `;

  (mountTarget || document.body).appendChild(overlay);

  const close = () => overlay.remove();

  overlay.querySelector('#subm-close')?.addEventListener('click', close);
  overlay.querySelector('#subm-cancel')?.addEventListener('click', close);

  // Close on backdrop click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  overlay.querySelector('#subm-save')?.addEventListener('click', async () => {
    const razon_social = overlay.querySelector('#nc-razon-social')?.value.trim();
    const nit          = overlay.querySelector('#nc-nit')?.value.trim()      || null;
    const contacto     = overlay.querySelector('#nc-contacto')?.value.trim() || null;
    const email        = overlay.querySelector('#nc-email')?.value.trim()    || null;
    const telefono     = overlay.querySelector('#nc-telefono')?.value.trim() || null;

    const alertEl  = overlay.querySelector('#nc-alert');
    const errRazon = overlay.querySelector('#nc-err-razon');

    // Client-side guard
    if (!razon_social) {
      errRazon.textContent = 'La razón social es requerida.';
      return;
    }
    errRazon.textContent = '';
    alertEl.className    = 'form-alert';
    alertEl.textContent  = '';

    const saveBtn    = overlay.querySelector('#subm-save');
    const labelEl    = overlay.querySelector('#subm-label');
    const spinnerEl  = overlay.querySelector('#subm-spinner');

    saveBtn.disabled = true;
    if (labelEl)   labelEl.textContent = 'Guardando...';
    if (spinnerEl) spinnerEl.classList.remove('hidden');

    try {
      const payload = { razon_social, nit, contacto, email, telefono };
      const resp    = isEdit
        ? await api.put(`/api/clientes/${client.id}`, payload)
        : await api.post('/api/clientes', payload);
      const saved   = resp.data;
      showToast(
        isEdit
          ? `Cliente "${saved.razon_social}" actualizado exitosamente.`
          : `Cliente "${saved.razon_social}" registrado exitosamente.`,
        'success'
      );
      onSaved(String(saved.id), saved.razon_social);
      close();
    } catch (err) {
      // The NIT already belongs to a DIFFERENT client — offer to just pick
      // that one instead of leaving the user stuck with a bare rejection.
      const conflicting = err.data?.data?.conflictingClient;

      if (conflicting) {
        alertEl.innerHTML = `
          ${escHtml(err.data?.message || 'Ese NIT ya está en uso.')}
          Pertenece a <strong>${escHtml(conflicting.razon_social)}</strong>.
          <button type="button" class="btn btn-ghost btn-sm" id="nc-use-existing" style="margin-top:.5rem;">
            Usar este cliente
          </button>
        `;
        alertEl.className = 'form-alert show alert-error';
        overlay.querySelector('#nc-use-existing')?.addEventListener('click', () => {
          onSaved(String(conflicting.id), conflicting.razon_social);
          close();
        });
      } else {
        const msg = err.data?.message || err.message || 'Error al guardar el cliente.';
        alertEl.textContent = msg;
        alertEl.className   = 'form-alert show alert-error';
      }

      saveBtn.disabled = false;
      if (labelEl)   labelEl.textContent = isEdit ? 'Guardar Cambios' : 'Guardar Cliente';
      if (spinnerEl) spinnerEl.classList.add('hidden');
    }
  });

  // Auto-focus first field
  overlay.querySelector('#nc-razon-social')?.focus();
}
