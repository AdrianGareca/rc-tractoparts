// =============================================================================
// public/js/views/quotationForm/clientSearch.js
// Autocompletar de cliente + alta/edición express desde el formulario.
//
// Lógica PURA separada del cableado:
//   buildDropdownHtml — markup del desplegable de resultados
//   wireClientSearch  — debounce, selección, blur y botones del sub-modal
//
// El alta/edición delega en dashboard/modules/clientModal.js (el mismo que usa
// la pestaña "Gestión de clientes"), así los campos, la validación y el manejo
// de NIT duplicado viven en un solo lugar.
//
// Extraído de FormMediator._wireClientSearch sin cambios de comportamiento.
// Cubierto por tests/unit/quotationFormClientSearch.test.js.
// =============================================================================

import api from '../../services/apiClient.js';
import { openClienteModal } from '../dashboard/modules/clientModal.js';
import { escText } from './helpers.js';

/** Milisegundos de espera antes de disparar la búsqueda mientras se tipea. */
export const SEARCH_DEBOUNCE_MS = 300;

/** Milisegundos de gracia al salir del campo, para que el mousedown de un
 *  ítem alcance a dispararse antes de que el desplegable se cierre. */
export const BLUR_CLOSE_DELAY_MS = 200;

/**
 * Markup del desplegable de resultados. Función pura.
 * @param {Array}  clients — resultados de GET /api/clientes
 * @param {string} query   — texto buscado (para el mensaje de "sin resultados")
 */
export function buildDropdownHtml(clients, query) {
  if (clients.length === 0) {
    return `
              <div class="client-dropdown-empty">
                Sin resultados para "<em>${escText(query)}</em>"
              </div>`;
  }

  return clients.map(c => `
            <div class="client-dropdown-item" data-id="${c.id}"
                 data-label="${escText(c.razon_social)}"
                 role="option" tabindex="-1">
              <span class="cdi-name">${escText(c.razon_social)}</span>
              ${c.nit ? `<span class="cdi-nit">NIT: ${escText(c.nit)}</span>` : ''}
              <button type="button" class="cdi-edit" data-edit-id="${c.id}"
                      title="Editar cliente" aria-label="Editar cliente"></button>
            </div>
          `).join('');
}

/** Abre el sub-modal de cliente (alta o edición) montado sobre el modal actual. */
function openModalCliente(container, { mode, client, onSaved }) {
  openClienteModal({
    mode,
    client,
    onSaved,
    mountTarget: container.closest('.modal-body, [id="modal-body"]') ?? document.body,
  });
}

/**
 * Cablea el buscador de clientes del formulario.
 *
 * @param {Object} deps
 *   container {HTMLElement} — raíz del formulario
 *   onDirty   {Function}    — se llama al elegir un cliente (marca el form sucio)
 */
export function wireClientSearch({ container, onDirty } = {}) {
  const searchInput = container.querySelector('#cliente-search');
  const dropdown    = container.querySelector('#client-dropdown');
  const hiddenInput = container.querySelector('#id_cliente');
  const errEl       = container.querySelector('#err-cliente');
  if (!searchInput || !dropdown || !hiddenInput) return;

  let debounceTimer = null;

  const closeDropdown = () => {
    dropdown.innerHTML = '';
    dropdown.classList.remove('open');
  };

  /** Called when the user picks a client from the list or after express creation */
  const selectClient = (id, label) => {
    // Cancel any pending debounced search so a stale query can't fire AFTER the
    // selection and repopulate/reopen the dropdown over the chosen client.
    clearTimeout(debounceTimer);
    onDirty?.();
    hiddenInput.value  = id;
    searchInput.value  = label;
    if (errEl) errEl.textContent = '';
    closeDropdown();
  };

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim();
    // Clear the stored ID whenever the user edits the text
    hiddenInput.value = '';
    clearTimeout(debounceTimer);
    if (q.length < 1) { closeDropdown(); return; }

    debounceTimer = setTimeout(async () => {
      try {
        const data    = await api.get(`/api/clientes?q=${encodeURIComponent(q)}`);
        const clients = data.data ?? [];

        dropdown.innerHTML = buildDropdownHtml(clients, q);
        dropdown.classList.add('open');
        if (clients.length === 0) return;

        dropdown.querySelectorAll('.client-dropdown-item').forEach(item => {
          item.addEventListener('mousedown', (e) => {
            // The edit button has its own handler below — don't also select
            // the client when the user is trying to edit it.
            if (e.target.closest('.cdi-edit')) return;
            // Use mousedown so blur fires before click is lost
            e.preventDefault();
            selectClient(item.dataset.id, item.dataset.label);
          });
        });

        // "Editar cliente" — opens the same sub-modal pre-filled, so an
        // executive can correct/add data (e.g. a missing NIT) on an existing
        // client instead of hitting the NIT-uniqueness error trying to
        // re-create it (there is no other way to edit a client record).
        dropdown.querySelectorAll('.cdi-edit').forEach(btn => {
          btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const client = clients.find(c => String(c.id) === String(btn.dataset.editId));
            if (client) openModalCliente(container, { mode: 'edit', client, onSaved: selectClient });
          });
        });
      } catch (_err) {
        dropdown.innerHTML = '<div class="client-dropdown-empty">Error buscando clientes.</div>';
        dropdown.classList.add('open');
      }
    }, SEARCH_DEBOUNCE_MS);
  });

  // Close dropdown when focus leaves the search field
  searchInput.addEventListener('blur', () => {
    // Cancel any pending debounced search so it can't reopen the dropdown after
    // the user has already moved on to another field.
    clearTimeout(debounceTimer);
    // Small delay so mousedown on an item can fire first
    setTimeout(closeDropdown, BLUR_CLOSE_DELAY_MS);
  });

  // Wire the "+ Nuevo cliente" express-registration button
  container.querySelector('#btn-nuevo-cliente')?.addEventListener('click', () => {
    openModalCliente(container, { mode: 'create', client: null, onSaved: selectClient });
  });
}
