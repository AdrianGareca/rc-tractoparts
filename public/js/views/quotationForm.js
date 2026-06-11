// =============================================================================
// public/js/views/quotationForm.js
// Dynamic Quotation Form
//
// STRUCTURAL PATTERN: MEDIATOR
//   FormMediator is the central hub connecting three independent components:
//     • LineItemsComponent — dynamic line-item rows (add / remove / edit)
//     • TotalsComponent    — live subtotal / IVA / total panel (Observer target)
//     • FileUploadComponent— drag-and-drop PDF attachment area
//   Components communicate exclusively through the Mediator; they hold no
//   direct references to each other.
//
// BEHAVIORAL PATTERN: OBSERVER
//   LineItemsSubject is the observable Subject holding the items array.
//   When items change (add, remove, field update), it notifies three Observers:
//     • RowSubtotalObserver  — updates the per-row subtotal cell
//     • IvaObserver          — recalculates and displays 13% Bolivia IVA
//     • GrandTotalObserver   — recalculates and displays the overall total
//   Observers register on construction and are automatically decoupled when
//   the form is destroyed.
// =============================================================================

import api          from '../services/apiClient.js';
import { showToast } from '../services/apiClient.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Format a number as a currency string (2 decimal places, no locale-specific symbol) */
function fmt(n) {
  return isNaN(n) ? '0.00' : Number(n).toFixed(2);
}

/** Sum all item subtotals from the items array */
function sumSubtotals(items) {
  return items.reduce((acc, it) => {
    const qty   = parseFloat(it.cantidad)       || 0;
    const price = parseFloat(it.precio_unitario) || 0;
    return acc + qty * price;
  }, 0);
}

// =============================================================================
// OBSERVER PATTERN — Subject (Observable)
// =============================================================================

/**
 * LineItemsSubject
 * Holds the authoritative array of line items and notifies all registered
 * Observer instances whenever the array mutates.
 */
class LineItemsSubject {
  #items     = [];   // Array<{ descripcion_item, cantidad, precio_unitario }>
  #observers = [];

  subscribe(observer) {
    this.#observers.push(observer);
  }

  unsubscribe(observer) {
    this.#observers = this.#observers.filter(o => o !== observer);
  }

  getItems() { return this.#items; }

  addItem() {
    this.#items.push({ descripcion_item: '', cantidad: 1, precio_unitario: 0 });
    this._notify();
    return this.#items.length - 1; // new index
  }

  removeItem(index) {
    this.#items.splice(index, 1);
    this._notify();
  }

  updateItem(index, field, value) {
    if (!this.#items[index]) return;
    this.#items[index][field] = value;
    this._notify();
  }

  _notify() {
    // Provide a shallow copy so observers can't mutate the internal array
    const snapshot = this.#items.map(i => ({ ...i }));
    this.#observers.forEach(o => o.update(snapshot));
  }
}

// =============================================================================
// OBSERVER PATTERN — Concrete Observers
// =============================================================================

/** Observer base class */
class Observer {
  /** @param {Array} items — snapshot of the items array */
  // eslint-disable-next-line no-unused-vars
  update(items) {}
}

/**
 * RowSubtotalObserver
 * Updates each row's subtotal cell when quantities or prices change.
 * Reads DOM nodes by data-item-subtotal="<index>" attributes.
 */
class RowSubtotalObserver extends Observer {
  #container;
  constructor(container) { super(); this.#container = container; }

  update(items) {
    items.forEach((item, idx) => {
      const cell = this.#container.querySelector(`[data-item-subtotal="${idx}"]`);
      if (!cell) return;
      const sub = (parseFloat(item.cantidad) || 0) * (parseFloat(item.precio_unitario) || 0);
      cell.textContent = fmt(sub);
    });
  }
}

/**
 * IvaObserver
 * Computes and displays the 13% Bolivia IVA on the running subtotal.
 */
class IvaObserver extends Observer {
  #el;
  constructor(el) { super(); this.#el = el; }

  update(items) {
    const subtotal = sumSubtotals(items);
    this.#el.textContent = fmt(subtotal * 0.13);
  }
}

/**
 * GrandTotalObserver
 * Keeps the subtotal display and the final total (subtotal + IVA) in sync.
 */
class GrandTotalObserver extends Observer {
  #subtotalEl;
  #totalEl;
  constructor(subtotalEl, totalEl) {
    super();
    this.#subtotalEl = subtotalEl;
    this.#totalEl    = totalEl;
  }

  update(items) {
    const subtotal = sumSubtotals(items);
    this.#subtotalEl.textContent = fmt(subtotal);
    this.#totalEl.textContent    = fmt(subtotal * 1.13);
  }
}

// =============================================================================
// MEDIATOR PATTERN — Form Mediator
// =============================================================================

/**
 * FormMediator
 * Acts as the single coordination point for all form sub-components.
 * Components notify the Mediator of events; the Mediator decides what
 * other components (if any) need to react — components are fully decoupled.
 */
class FormMediator {
  #subject;          // LineItemsSubject (Observable)
  #container;        // Root DOM element of the form
  #uploadedFile = null;

  constructor(container) {
    this.#container = container;
    this.#subject   = new LineItemsSubject();
  }

  // ── Public mount entry point ───────────────────────────────────────────────

  /** Render the complete form into the container and wire all interactions. */
  render(onSuccess, onCancel) {
    this.#container.innerHTML = this._buildFormHTML();

    // Grab observer target elements
    const elIva      = this.#container.querySelector('#totals-iva');
    const elSubtotal = this.#container.querySelector('#totals-subtotal');
    const elTotal    = this.#container.querySelector('#totals-total');
    const itemsBody  = this.#container.querySelector('#items-body');

    // Register Observers with the Subject
    this.#subject.subscribe(new RowSubtotalObserver(this.#container));
    this.#subject.subscribe(new IvaObserver(elIva));
    this.#subject.subscribe(new GrandTotalObserver(elSubtotal, elTotal));

    // Seed one empty row
    this._appendRow(this.#subject.addItem(), itemsBody);

    // Wire "+ Add item" button
    this.#container.querySelector('#btn-add-item')?.addEventListener('click', () => {
      const newIdx = this.#subject.addItem();
      this._appendRow(newIdx, itemsBody);
      // Focus the description field of the new row
      const newRow = itemsBody.querySelector(`[data-row-index="${newIdx}"]`);
      newRow?.querySelector('.item-input')?.focus();
    });

    // Wire drag-and-drop / file input
    this._wireFileUpload();

    // Wire client search autocomplete + express client registration
    this._wireClientSearch();

    // Wire Cancel
    this.#container.querySelector('#btn-cancel')?.addEventListener('click', () => {
      if (onCancel) onCancel();
    });

    // Wire Submit
    this.#container.querySelector('#quotation-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this._handleSubmit(onSuccess);
    });
  }

  // ── Private: build form HTML ───────────────────────────────────────────────

  _buildFormHTML() {
    return /* html */ `
      <form id="quotation-form" novalidate>

        <!-- Header fields -->
        <div class="form-row">
          <!-- CLIENT SELECTOR: replaces the old number input -->
          <div class="form-group" style="flex:2;">
            <label class="form-label" for="cliente-search">Cliente *</label>
            <div class="client-select-wrapper">
              <div class="client-search-group">
                <input
                  class="form-control"
                  type="text"
                  id="cliente-search"
                  placeholder="Buscar por nombre o NIT…"
                  autocomplete="off"
                  aria-haspopup="listbox"
                  aria-autocomplete="list"
                />
                <button type="button" id="btn-nuevo-cliente" class="btn btn-outline-green btn-sm btn-nuevo-cliente"
                        title="Registrar nuevo cliente en el sistema">
                  + Nuevo Cliente
                </button>
              </div>
              <!-- Hidden field stores the resolved numeric client ID -->
              <input type="hidden" id="id_cliente" />
              <!-- Autocomplete dropdown -->
              <div class="client-dropdown" id="client-dropdown" role="listbox" aria-label="Clientes sugeridos"></div>
            </div>
            <span class="field-error" id="err-cliente"></span>
          </div>

          <div class="form-group">
            <label class="form-label" for="fecha_emision">Fecha de Emisión *</label>
            <input class="form-control" type="date" id="fecha_emision" required />
            <span class="field-error" id="err-fecha"></span>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="descripcion">Descripción *</label>
          <textarea class="form-control" id="descripcion" rows="2" placeholder="Descripción de la cotización" required></textarea>
          <span class="field-error" id="err-descripcion"></span>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="moneda">Moneda</label>
            <select class="form-control" id="moneda">
              <option value="USD">USD — Dólar</option>
              <option value="BOB">BOB — Boliviano</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="fecha_validez">
              Fecha de Validez
              <span
                class="info-icon"
                tabindex="0"
                role="tooltip"
                aria-label="Fecha límite de precios y disponibilidad"
                data-tooltip="En Bolivia, los precios de repuestos pesados fluctuan con el tipo de cambio y disponibilidad de importación. Esta fecha garantiza al cliente los precios y el stock cotizados. Pasada esta fecha, los valores pueden variar."
              >ⓘ</span>
            </label>
            <input class="form-control" type="date" id="fecha_validez" />
            <span class="field-error" id="err-validez"></span>
          </div>
          <div class="form-group">
            <label class="form-label" for="observaciones">Observaciones</label>
            <input class="form-control" type="text" id="observaciones" placeholder="Opcional" />
          </div>
        </div>

        <!-- Line items — OBSERVER Subject changes trigger all three Observers -->
        <div class="line-items-section">
          <h4>Ítems de Detalle</h4>
          <div class="table-wrapper" style="border-radius:6px;">
            <table class="line-items-table">
              <thead>
                <tr>
                  <th style="width:40%">Descripción</th>
                  <th style="width:12%">Cantidad</th>
                  <th style="width:17%">Precio Unit.</th>
                  <th style="width:17%">Subtotal</th>
                  <th style="width:7%"></th>
                </tr>
              </thead>
              <tbody id="items-body"></tbody>
            </table>
          </div>
          <button type="button" id="btn-add-item" class="btn btn-ghost btn-sm btn-add-item">
            + Agregar ítem
          </button>
        </div>

        <!-- Totals panel — updated by GrandTotalObserver & IvaObserver -->
        <div class="totals-panel">
          <div class="totals-row">
            <span>Subtotal</span>
            <span class="totals-value" id="totals-subtotal">0.00</span>
          </div>
          <div class="totals-row">
            <span>IVA Bolivia (13%)</span>
            <span class="totals-value" id="totals-iva">0.00</span>
          </div>
          <div class="totals-row total-final">
            <span>Total con IVA</span>
            <span class="totals-value" id="totals-total">0.00</span>
          </div>
        </div>

        <!-- PDF drag-and-drop upload — optional attachment -->
        <div class="form-group" style="margin-top:1.25rem;">
          <label class="form-label">PDF Adjunto (opcional)</label>
          <div class="drop-zone" id="drop-zone">
            <input type="file" id="pdf-input" accept="application/pdf" />
            <div class="drop-zone-icon">📄</div>
            <p class="drop-zone-text">Arrastra un PDF aquí o haz clic para seleccionar</p>
            <p class="drop-zone-hint">Máximo 10 MB · Solo archivos PDF</p>
            <p class="drop-zone-file hidden" id="file-name"></p>
          </div>
        </div>

        <!-- General form alert -->
        <div class="form-alert" id="qf-alert" role="alert"></div>

        <!-- Footer buttons -->
        <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:1.25rem;">
          <button type="button" id="btn-cancel" class="btn btn-ghost">Cancelar</button>
          <button type="submit" id="btn-submit" class="btn btn-primary">
            <span class="btn-label">Crear Cotización</span>
            <span class="spinner hidden btn-spinner"></span>
          </button>
        </div>

      </form>
    `;
  }

  // ── Private: append one table row ─────────────────────────────────────────

  _appendRow(index, tbody) {
    const tr = document.createElement('tr');
    tr.dataset.rowIndex = index;

    tr.innerHTML = /* html */ `
      <td>
        <input class="item-input" type="text" data-field="descripcion_item" data-idx="${index}"
               placeholder="Descripción del ítem" />
      </td>
      <td>
        <input class="item-input" type="number" data-field="cantidad" data-idx="${index}"
               value="1" min="0.0001" step="any" style="width:80px;" />
      </td>
      <td>
        <input class="item-input" type="number" data-field="precio_unitario" data-idx="${index}"
               value="0" min="0" step="any" style="width:110px;" />
      </td>
      <td class="item-subtotal" data-item-subtotal="${index}">0.00</td>
      <td>
        <button type="button" class="btn-remove-item" data-remove="${index}" title="Eliminar ítem">✕</button>
      </td>
    `;

    // Wire field → Subject update (Mediator receives input events)
    tr.querySelectorAll('.item-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const field = e.target.dataset.field;
        const idx   = parseInt(e.target.dataset.idx, 10);
        this._onItemFieldChange(idx, field, e.target.value);
      });
    });

    // Wire remove button
    tr.querySelector('.btn-remove-item')?.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.remove, 10);
      this._onRemoveItem(idx);
    });

    tbody.appendChild(tr);
  }

  // ── Mediator notification handlers ────────────────────────────────────────

  /** Called when a line item field changes — Mediator notifies the Subject */
  _onItemFieldChange(index, field, value) {
    this.#subject.updateItem(index, field, value);
  }

  /** Called when a row is removed — Mediator re-renders the tbody */
  _onRemoveItem(index) {
    const tbody = this.#container.querySelector('#items-body');
    if (!tbody) return;

    this.#subject.removeItem(index);

    // Re-render all rows (index positions shifted)
    tbody.innerHTML = '';
    this.#subject.getItems().forEach((_, idx) => this._appendRow(idx, tbody));

    // If all rows removed, add one blank row
    if (this.#subject.getItems().length === 0) {
      this._appendRow(this.#subject.addItem(), tbody);
    }
  }

  // ── Private: client autocomplete search ───────────────────────────────────

  _wireClientSearch() {
    const searchInput = this.#container.querySelector('#cliente-search');
    const dropdown    = this.#container.querySelector('#client-dropdown');
    const hiddenInput = this.#container.querySelector('#id_cliente');
    const errEl       = this.#container.querySelector('#err-cliente');
    if (!searchInput || !dropdown || !hiddenInput) return;

    let debounceTimer = null;

    const closeDropdown = () => {
      dropdown.innerHTML = '';
      dropdown.classList.remove('open');
    };

    /** Called when the user picks a client from the list or after express creation */
    const selectClient = (id, label) => {
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

          if (clients.length === 0) {
            dropdown.innerHTML = `
              <div class="client-dropdown-empty">
                Sin resultados para "<em>${q}</em>"
              </div>`;
            dropdown.classList.add('open');
            return;
          }

          dropdown.innerHTML = clients.map(c => `
            <div class="client-dropdown-item" data-id="${c.id}"
                 data-label="${c.razon_social.replace(/"/g, '&quot;')}"
                 role="option" tabindex="-1">
              <span class="cdi-name">${c.razon_social}</span>
              ${c.nit ? `<span class="cdi-nit">NIT: ${c.nit}</span>` : ''}
            </div>
          `).join('');
          dropdown.classList.add('open');

          dropdown.querySelectorAll('.client-dropdown-item').forEach(item => {
            item.addEventListener('mousedown', (e) => {
              // Use mousedown so blur fires before click is lost
              e.preventDefault();
              selectClient(item.dataset.id, item.dataset.label);
            });
          });
        } catch (_err) {
          dropdown.innerHTML = '<div class="client-dropdown-empty">Error buscando clientes.</div>';
          dropdown.classList.add('open');
        }
      }, 300);
    });

    // Close dropdown when focus leaves the search field
    searchInput.addEventListener('blur', () => {
      // Small delay so mousedown on an item can fire first
      setTimeout(closeDropdown, 200);
    });

    // Wire the "+ Nuevo Cliente" express-registration button
    this.#container.querySelector('#btn-nuevo-cliente')?.addEventListener('click', () => {
      this._openNuevoClienteModal(selectClient);
    });
  }

  // ── Private: express client registration sub-modal ────────────────────────

  _openNuevoClienteModal(onCreated) {
    // Render a fixed-position overlay inside the quotation form's container
    const overlay = document.createElement('div');
    overlay.className = 'sub-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'subm-title');

    overlay.innerHTML = /* html */ `
      <div class="sub-modal">
        <div class="sub-modal-header">
          <h4 id="subm-title">Registrar Nuevo Cliente</h4>
          <button type="button" class="btn-icon sub-modal-close" id="subm-close" aria-label="Cerrar">✕</button>
        </div>
        <div class="sub-modal-body">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="nc-razon-social">Razón Social *</label>
              <input class="form-control" type="text" id="nc-razon-social"
                     placeholder="Nombre comercial o legal" maxlength="150" />
              <span class="field-error" id="nc-err-razon"></span>
            </div>
            <div class="form-group">
              <label class="form-label" for="nc-nit">NIT</label>
              <input class="form-control" type="text" id="nc-nit"
                     placeholder="Ej: 1234567890" maxlength="20" />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="nc-contacto">Contacto</label>
              <input class="form-control" type="text" id="nc-contacto"
                     placeholder="Nombre del responsable" />
            </div>
            <div class="form-group">
              <label class="form-label" for="nc-telefono">Teléfono</label>
              <input class="form-control" type="tel" id="nc-telefono"
                     placeholder="Ej: 77012345" />
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="nc-email">Email</label>
            <input class="form-control" type="email" id="nc-email"
                   placeholder="contacto@empresa.com" />
          </div>
          <div class="form-alert" id="nc-alert" role="alert"></div>
          <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:1.25rem;">
            <button type="button" class="btn btn-ghost" id="subm-cancel">Cancelar</button>
            <button type="button" class="btn btn-primary" id="subm-save">
              <span id="subm-label">Guardar Cliente</span>
              <span class="spinner hidden" id="subm-spinner"></span>
            </button>
          </div>
        </div>
      </div>
    `;

    // Append as child of the main modal body (inherits stacking context)
    this.#container.closest('.modal-body, [id="modal-body"]')?.appendChild(overlay)
      ?? document.body.appendChild(overlay);

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

      const saveBtn    = overlay.querySelector('#subm-save');
      const labelEl    = overlay.querySelector('#subm-label');
      const spinnerEl  = overlay.querySelector('#subm-spinner');

      saveBtn.disabled = true;
      if (labelEl)   labelEl.textContent = 'Guardando...';
      if (spinnerEl) spinnerEl.classList.remove('hidden');

      try {
        const resp   = await api.post('/api/clientes', { razon_social, nit, contacto, email, telefono });
        const client = resp.data;
        showToast(`Cliente "${client.razon_social}" registrado exitosamente.`, 'success');
        onCreated(String(client.id), client.razon_social);
        close();
      } catch (err) {
        const msg = err.data?.message || err.message || 'Error al registrar el cliente.';
        alertEl.textContent = msg;
        alertEl.className   = 'form-alert show alert-error';
        saveBtn.disabled    = false;
        if (labelEl)   labelEl.textContent = 'Guardar Cliente';
        if (spinnerEl) spinnerEl.classList.add('hidden');
      }
    });

    // Auto-focus first field
    overlay.querySelector('#nc-razon-social')?.focus();
  }

  // ── Private: drag-and-drop file upload ────────────────────────────────────

  _wireFileUpload() {    const zone      = this.#container.querySelector('#drop-zone');
    const fileInput = this.#container.querySelector('#pdf-input');
    const fileName  = this.#container.querySelector('#file-name');
    if (!zone || !fileInput) return;

    const onFile = (file) => {
      if (!file || file.type !== 'application/pdf') {
        showToast('Solo se aceptan archivos PDF.', 'error');
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        showToast('El archivo excede el tamaño máximo de 10 MB.', 'error');
        return;
      }
      // Mediator stores the file reference
      this.#uploadedFile = file;
      fileName.textContent = `✓ ${file.name}`;
      fileName.classList.remove('hidden');
    };

    fileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) onFile(e.target.files[0]);
    });

    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('dragover');
    });

    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));

    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      onFile(e.dataTransfer.files[0]);
    });
  }

  // ── Private: form submission ───────────────────────────────────────────────

  async _handleSubmit(onSuccess) {
    const alert    = this.#container.querySelector('#qf-alert');
    const btnSubmit= this.#container.querySelector('#btn-submit');
    const items    = this.#subject.getItems();

    // --- Client-side validation ---
    const id_cliente    = parseInt(this.#container.querySelector('#id_cliente')?.value, 10);
    const descripcion   = this.#container.querySelector('#descripcion')?.value.trim();
    const fecha_emision = this.#container.querySelector('#fecha_emision')?.value;
    const fecha_validez = this.#container.querySelector('#fecha_validez')?.value || null;

    // Clear previous inline errors
    ['#err-cliente','#err-descripcion','#err-fecha','#err-validez'].forEach(sel => {
      const el = this.#container.querySelector(sel);
      if (el) el.textContent = '';
    });

    if (!id_cliente || id_cliente < 1) {
      this.#container.querySelector('#err-cliente').textContent = 'Selecciona un cliente de la lista.';
      this.#container.querySelector('#cliente-search')?.focus();
      return;
    }
    if (!descripcion) {
      this.#container.querySelector('#err-descripcion').textContent = 'La descripción es requerida.';
      return;
    }
    if (!fecha_emision) {
      this.#container.querySelector('#err-fecha').textContent = 'La fecha de emisión es requerida.';
      return;
    }
    if (fecha_validez && fecha_validez < fecha_emision) {
      this.#container.querySelector('#err-validez').textContent =
        'La fecha de validez debe ser igual o posterior a la fecha de emisión.';
      return;
    }

    // Compute monto_total from items
    const subtotal = sumSubtotals(items);

    // Build request body
    const body = {
      id_cliente,
      descripcion,
      fecha_emision,
      moneda:        this.#container.querySelector('#moneda')?.value      || 'USD',
      fecha_validez: fecha_validez || null,
      observaciones: this.#container.querySelector('#observaciones')?.value.trim() || null,
      monto_total:   subtotal > 0 ? subtotal : null,
      detalles:     items.filter(i => i.descripcion_item.trim()).map(i => ({
        descripcion_item: i.descripcion_item.trim(),
        cantidad:         parseFloat(i.cantidad)        || 0,
        precio_unitario:  parseFloat(i.precio_unitario) || 0,
      })),
    };

    // Disable button / show spinner
    btnSubmit.disabled = true;
    const label  = btnSubmit.querySelector('.btn-label');
    const spinner= btnSubmit.querySelector('.btn-spinner');
    if (label)  label.textContent = 'Creando...';
    if (spinner)spinner.classList.remove('hidden');
    alert.className = 'form-alert';

    try {
      // Step 1 — Create the quotation record
      const response = await api.post('/api/cotizaciones', body);
      const quotation = response.data;

      // Step 2 — Upload PDF if one was attached
      if (this.#uploadedFile && quotation?.id) {
        const formData = new FormData();
        formData.append('archivo', this.#uploadedFile);
        try {
          await api.upload(`/api/cotizaciones/${quotation.id}/pdf`, formData);
        } catch (pdfErr) {
          // Non-fatal: quotation was created; just warn the user
          showToast(`Cotización creada, pero el PDF no pudo subirse: ${pdfErr.message}`, 'warning');
        }
      }

      if (onSuccess) onSuccess(quotation);

    } catch (err) {
      btnSubmit.disabled = false;
      if (label)  label.textContent = 'Crear Cotización';
      if (spinner)spinner.classList.add('hidden');

      // Surface server-side Zod field errors
      const fieldErrors = err.data?.errors ?? [];
      for (const { field, message } of fieldErrors) {
        const errEl = this.#container.querySelector(`#err-${field}`);
        if (errEl) errEl.textContent = message;
      }

      const msg = err.data?.message || err.message || 'Error al crear la cotización.';
      alert.textContent = msg;
      alert.className   = 'form-alert show alert-error';
    }
  }
}

// =============================================================================
// Public factory function
// Mounts the quotation form into the given container element.
// Returns a cleanup function that removes event listeners when the form closes.
// =============================================================================
export function mountQuotationForm(container, { onSuccess, onCancel } = {}) {
  const mediator = new FormMediator(container);
  mediator.render(onSuccess, onCancel);
}
