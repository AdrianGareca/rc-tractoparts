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

/** HTML-entity-encode a value before interpolating as text content in innerHTML.
 *  Prevents stored-XSS when rendering user-controlled strings (OWASP A03). */
function escText(v) {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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

  /**
   * Returns a shallow-copy snapshot of the items array.
   * Callers receive independent array instances so that no external reference
   * can mutate the internal #items state — the Subject is the single source of
   * truth and must only be modified through addItem / removeItem / updateItem.
   */
  getItems() { return this.#items.map(i => ({ ...i })); }

  addItem() {
    this.#items.push({
      descripcion_item:   '',
      codigo:             '',
      codigo_alternativo: '',
      unidad:             'UND',
      cantidad:           1,
      precio_unitario:    0,
      marca_id:           null,
      tiempo_entrega:     '',
    });
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
  #uploadedExcel = null;   // optional Excel spreadsheet attachment
  #brands = [];      // Cache of { id, nombre } loaded from GET /api/marcas

  constructor(container) {
    this.#container = container;
    this.#subject   = new LineItemsSubject();
  }

  // ── Public mount entry point ───────────────────────────────────────────────

  /** Render the complete form into the container and wire all interactions. */
  async render(onSuccess, onCancel) {
    // Pre-load brand catalog before rendering — failures are non-fatal
    try {
      const resp   = await api.get('/api/marcas');
      this.#brands = resp.data ?? [];
    } catch (_) {
      this.#brands = [];
    }

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
              <option value="BOB">BOB — Boliviano</option>
              <option value="USD">USD — Dólar</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="tipo_pedido">Tipo / Canal de Pedido</label>
            <input class="form-control" type="text" id="tipo_pedido" placeholder="Ej: EMAIL, PRESENCIAL, TELÉFONO" maxlength="50" />
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

        <!-- DATOS DEL SOLICITANTE -->
        <details class="form-section-details" open>
          <summary class="form-section-summary">Datos del Solicitante</summary>
          <div class="form-row" style="margin-top:.75rem;">
            <div class="form-group">
              <label class="form-label" for="solicitante_no_solicitud">Nº Solicitud / OC</label>
              <input class="form-control" type="text" id="solicitante_no_solicitud"
                     placeholder="Ej: OC-2026-0045" maxlength="100" />
            </div>
            <div class="form-group">
              <label class="form-label" for="solicitante_area">Área / Departamento</label>
              <input class="form-control" type="text" id="solicitante_area"
                     placeholder="Ej: Mantenimiento" maxlength="100" />
            </div>
            <div class="form-group">
              <label class="form-label" for="solicitante_celular">Celular</label>
              <input class="form-control" type="tel" id="solicitante_celular"
                     placeholder="Ej: 77012345" maxlength="30" />
            </div>
            <div class="form-group">
              <label class="form-label" for="solicitante_correo">Correo</label>
              <input class="form-control" type="email" id="solicitante_correo"
                     placeholder="solicitante@empresa.com" maxlength="120" />
            </div>
          </div>
        </details>

        <!-- DATOS DEL EQUIPO -->
        <details class="form-section-details" open>
          <summary class="form-section-summary">Datos del Equipo</summary>
          <div class="form-row" style="margin-top:.75rem;">
            <div class="form-group">
              <label class="form-label" for="equipo_marca">Marca</label>
              <input class="form-control" type="text" id="equipo_marca"
                     placeholder="Ej: Caterpillar" maxlength="80" />
            </div>
            <div class="form-group">
              <label class="form-label" for="equipo_tipo">Tipo</label>
              <input class="form-control" type="text" id="equipo_tipo"
                     placeholder="Ej: Excavadora" maxlength="80" />
            </div>
            <div class="form-group">
              <label class="form-label" for="equipo_modelo">Modelo</label>
              <input class="form-control" type="text" id="equipo_modelo"
                     placeholder="Ej: 336" maxlength="80" />
            </div>
            <div class="form-group">
              <label class="form-label" for="equipo_serie">Nº Serie <span style="color:#9ca3af;font-size:.8rem;font-weight:400;">(Opcional)</span></label>
              <input class="form-control" type="text" id="equipo_serie"
                     placeholder="Ej: CAT0336XXXXX" maxlength="80" />
            </div>
            <div class="form-group">
              <label class="form-label" for="equipo_motor">Nº Motor <span style="color:#9ca3af;font-size:.8rem;font-weight:400;">(Opcional)</span></label>
              <input class="form-control" type="text" id="equipo_motor"
                     placeholder="Ej: C9.3" maxlength="80" />
            </div>
          </div>
        </details>

        <!-- CONDICIONES LOGÍSTICAS -->
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="tiempo_entrega">Tiempo de Entrega (general)</label>
            <input class="form-control" type="text" id="tiempo_entrega"
                   placeholder="Ej: 25 DÍAS CALENDARIO" maxlength="100" />
          </div>
        </div>

        <!-- Line items — OBSERVER Subject changes trigger all three Observers -->
        <div class="line-items-section">
          <h4>Ítems de Detalle</h4>
          <div class="table-wrapper" style="border-radius:6px;">
            <table class="line-items-table">
              <thead>
              <tr>
                <th style="width:22%">Descripción</th>
                <th style="width:10%">Cód. Parte</th>
                <th style="width:10%">Cód. Alt.</th>
                <th style="width:11%">Marca</th>
                <th style="width:7%">UM</th>
                <th style="width:7%">Cantidad</th>
                <th style="width:11%">Precio Unit.</th>
                <th style="width:10%">Subtotal</th>
                <th style="width:10%">T. Entrega</th>
                <th style="width:2%"></th>
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

        <!-- Excel optional attachment -->
        <div class="form-group" style="margin-top:1rem;">
          <label class="form-label">📊 Planilla Excel de Auditoría (opcional)</label>
          <div class="drop-zone" id="excel-drop-zone" style="border-color:#16a34a;">
            <input type="file" id="excel-input" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
            <div class="drop-zone-icon">📊</div>
            <p class="drop-zone-text">Arrastra un archivo .xlsx aquí o haz clic para seleccionar</p>
            <p class="drop-zone-hint">Máximo 10 MB · Solo archivos .xlsx</p>
            <p class="drop-zone-file hidden" id="excel-file-name"></p>
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

  /**
   * @param {number}      index   - Position in the Subject items array
   * @param {HTMLElement} tbody   - Target table body element
   * @param {Object|null} itemData - Pre-existing item data for re-render after deletion.
   *   When null (new row), inputs are rendered with blank / default values.
   */
  _appendRow(index, tbody, itemData = null) {
    const tr = document.createElement('tr');
    tr.dataset.rowIndex = index;

    // Minimal HTML-attribute escaper for pre-populated values (prevents XSS via
    // double-quote injection into the value="…" attribute context).
    const safeAttr  = (v) => v != null ? String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;') : '';
    const safeCod   = safeAttr(itemData?.codigo           ?? '');
    const safeCodAlt= safeAttr(itemData?.codigo_alternativo ?? '');
    const safeDesc  = safeAttr(itemData?.descripcion_item  ?? '');
    const safeCant  = itemData?.cantidad        ?? 1;
    const safePrice = itemData?.precio_unitario ?? 0;
    const safeMarca = itemData?.marca_id        ?? '';
    const safeUnidadVal = itemData?.unidad ?? 'UND';
    const safeTEnt  = safeAttr(itemData?.tiempo_entrega ?? '');

    // Build brand options HTML from cached brand list
    const brandOptions = this.#brands
      .map(b => `<option value="${b.id}"${b.id === Number(safeMarca) ? ' selected' : ''}>${escText(b.nombre)}</option>`)
      .join('');

    tr.innerHTML = /* html */ `
      <td>
        <input class="item-input" type="text" data-field="descripcion_item" data-idx="${index}"
               value="${safeDesc}" placeholder="Descripción del ítem" />
      </td>
      <td>
        <input class="item-input item-codigo" type="text" data-field="codigo" data-idx="${index}"
               value="${safeCod}" placeholder="Ej: 7E-6116" maxlength="50"
               style="width:100%;font-size:.8rem;"
               title="Código de Parte del fabricante. Si ya existe en otra fila, las cantidades se suman automáticamente." />
      </td>
      <td>
        <input class="item-input" type="text" data-field="codigo_alternativo" data-idx="${index}"
               value="${safeCodAlt}" placeholder="Ej: P553191" maxlength="100"
               style="width:100%;font-size:.8rem;"
               title="Código alternativo o código cruzado del fabricante." />
      </td>
      <td class="item-marca-cell">
        <div style="display:flex;gap:4px;align-items:center;">
          <select class="form-control item-marca" data-field="marca_id" data-idx="${index}"
                  style="flex:1;min-width:0;font-size:.8rem;padding:2px 4px;">
            <option value="">— Sin marca —</option>
            ${brandOptions}
          </select>
          <button type="button" class="btn-add-brand" data-idx="${index}"
                  title="Registrar nueva marca"
                  style="flex-shrink:0;width:22px;height:22px;padding:0;border-radius:50%;background:#16a34a;color:#fff;border:none;cursor:pointer;font-size:1rem;line-height:1;">
            +
          </button>
        </div>
      </td>
      <td>
        <select class="form-control unit-select" name="detalles[][unidad]" data-field="unidad" data-idx="${index}"
                style="width:80px;font-size:.8rem;padding:2px 4px;">
          <option value="PZA"${safeUnidadVal === 'PZA' ? ' selected' : ''}>PZA (Piezas)</option>
          <option value="GGO"${safeUnidadVal === 'GGO' ? ' selected' : ''}>GGO (Juegos)</option>
          <option value="KIT"${safeUnidadVal === 'KIT' ? ' selected' : ''}>KIT (Kits)</option>
          <option value="UND"${safeUnidadVal === 'UND' ? ' selected' : ''}>UND (Unidades)</option>
        </select>
      </td>
      <td>
        <input class="item-input" type="number" data-field="cantidad" data-idx="${index}"
               value="${safeCant}" min="0.0001" step="any" style="width:72px;" />
      </td>
      <td>
        <input class="item-input" type="number" data-field="precio_unitario" data-idx="${index}"
               value="${safePrice}" min="0" step="any" style="width:100px;" />
      </td>
      <td class="item-subtotal" data-item-subtotal="${index}">0.00</td>
      <td>
        <input class="item-input" type="text" data-field="tiempo_entrega" data-idx="${index}"
               value="${safeTEnt}" placeholder="Ej: 15 días" maxlength="100"
               style="width:100%;font-size:.8rem;" />
      </td>
      <td>
        <button type="button" class="btn-remove-item" data-remove="${index}" title="Eliminar ítem">✕</button>
      </td>
    `;

    // Wire all text/number inputs → Subject update via Mediator
    tr.querySelectorAll('.item-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const field = e.target.dataset.field;
        const idx   = parseInt(e.target.dataset.idx, 10);
        this._onItemFieldChange(idx, field, e.target.value);
      });
    });

    // ── Part Number (Código de Parte) deduplication ─────────────────────────
    // Composite-key rule: merge only when BOTH (codigo, marca_id) match.
    // In heavy-machinery catalogues, CAT and CUMMINS can share part numbers;
    // those must remain as separate line items on the quotation.
    tr.querySelector('.item-codigo')?.addEventListener('blur', (e) => {
      const rawCodigo = e.target.value.trim();
      if (!rawCodigo) return;                     // blank — nothing to merge
      const normalised = rawCodigo.toUpperCase();
      const currentIdx = parseInt(e.target.dataset.idx, 10);

      // Retrieve a snapshot strictly from THIS form instance's Subject.
      // getItems() returns a defensive copy — no data from any other quotation
      // record, global array, or cached payload can ever bleed in here.
      const items = this.#subject.getItems();

      // Composite key: normalised code AND marca_id must both match.
      // marca_id is null when no brand is selected; null === null is intentional
      // (two unbranded rows with the same code still merge).
      const currentMarca = items[currentIdx]?.marca_id ?? null;

      const dupeIdx = items.findIndex((item, i) =>
        i !== currentIdx &&
        String(item.codigo || '').trim().toUpperCase() === normalised &&
        (item.marca_id ?? null) === currentMarca
      );
      if (dupeIdx === -1) return;                 // unique composite key — no merge needed

      // Merge: add this row's quantity to the existing row in the Subject
      const thisQty = parseFloat(items[currentIdx]?.cantidad) || 1;
      const dupeQty = parseFloat(items[dupeIdx]?.cantidad)    || 1;
      const merged  = parseFloat((thisQty + dupeQty).toFixed(4));
      this.#subject.updateItem(dupeIdx, 'cantidad', merged);

      // Remove this (new) row and re-render; the dupe row will show merged qty
      this._onRemoveItem(currentIdx);
      showToast(
        `Cód. Parte "${rawCodigo}" ya existe con la misma marca — cantidad fusionada: ${merged}.`,
        'info'
      );
    });

    // Wire unit-of-measure select → Subject update
    tr.querySelector('.unit-select')?.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      this._onItemFieldChange(idx, 'unidad', e.target.value);
    });

    // Wire brand selector → Subject update
    tr.querySelector('.item-marca')?.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      const val = e.target.value ? parseInt(e.target.value, 10) : null;
      this._onItemFieldChange(idx, 'marca_id', val);
    });

    // Wire '+' brand creation button
    tr.querySelector('.btn-add-brand')?.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      this._openNuevaMarcaModal(idx);
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

    // Re-render all rows, passing the current item data so input values are
    // preserved correctly after the index shift (fixes the default-value bug).
    tbody.innerHTML = '';
    const currentItems = this.#subject.getItems();
    currentItems.forEach((item, idx) => this._appendRow(idx, tbody, item));

    // If all rows removed, seed one blank row
    if (currentItems.length === 0) {
      this._appendRow(this.#subject.addItem(), tbody);
    }
  }

  // ── Private: inline brand creation sub-modal ─────────────────────────────

  _openNuevaMarcaModal(rowIndex) {
    const overlay = document.createElement('div');
    overlay.className = 'sub-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'bm-title');

    overlay.innerHTML = /* html */ `
      <div class="sub-modal">
        <div class="sub-modal-header">
          <h4 id="bm-title">Registrar Nueva Marca</h4>
          <button type="button" class="btn-icon sub-modal-close" id="bm-close" aria-label="Cerrar">✕</button>
        </div>
        <div class="sub-modal-body">
          <div class="form-group">
            <label class="form-label" for="bm-nombre">Nombre de la Marca *</label>
            <input class="form-control" type="text" id="bm-nombre"
                   placeholder="Ej: Hitachi" maxlength="100" />
            <span class="field-error" id="bm-err"></span>
          </div>
          <div class="form-alert" id="bm-alert" role="alert"></div>
          <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:1.25rem;">
            <button type="button" class="btn btn-ghost" id="bm-cancel">Cancelar</button>
            <button type="button" class="btn btn-primary" id="bm-save">
              <span id="bm-label">Guardar Marca</span>
              <span class="spinner hidden" id="bm-spinner"></span>
            </button>
          </div>
        </div>
      </div>
    `;

    this.#container.closest('.modal-body, [id="modal-body"]')?.appendChild(overlay)
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
        if (!this.#brands.find(b => b.id === brand.id)) {
          this.#brands.push({ id: brand.id, nombre: brand.nombre });
          this.#brands.sort((a, b) => a.nombre.localeCompare(b.nombre));
        }

        // Refresh ALL selectors across all rows with the new option
        this.#container.querySelectorAll('.item-marca').forEach(sel => {
          const currentVal = sel.value;
          // Rebuild options
          sel.innerHTML =
            '<option value="">— Sin marca —</option>' +
            this.#brands.map(b => `<option value="${b.id}"${b.id === brand.id ? ' selected' : ''}>${escText(b.nombre)}</option>`).join('');
          // Restore previous selection unless this is the target row
          const idx = parseInt(sel.dataset.idx, 10);
          if (idx === rowIndex) {
            sel.value = String(brand.id);
            this._onItemFieldChange(rowIndex, 'marca_id', brand.id);
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
          if (!this.#brands.find(b => b.id === existing.id)) {
            this.#brands.push({ id: existing.id, nombre: existing.nombre });
            this.#brands.sort((a, b) => a.nombre.localeCompare(b.nombre));
          }
          // Auto-select in target row
          const targetSel = this.#container.querySelector(`.item-marca[data-idx="${rowIndex}"]`);
          if (targetSel) {
            if (!targetSel.querySelector(`option[value="${existing.id}"]`)) {
              const opt = document.createElement('option');
              opt.value = existing.id;
              opt.textContent = existing.nombre;
              targetSel.appendChild(opt);
            }
            targetSel.value = String(existing.id);
            this._onItemFieldChange(rowIndex, 'marca_id', existing.id);
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

  _wireFileUpload() {
    const zone      = this.#container.querySelector('#drop-zone');
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

    // ── Excel drag-and-drop ──────────────────────────────────────────────────
    const excelZone      = this.#container.querySelector('#excel-drop-zone');
    const excelInput     = this.#container.querySelector('#excel-input');
    const excelFileName  = this.#container.querySelector('#excel-file-name');
    if (!excelZone || !excelInput) return;

    const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    const onExcelFile = (file) => {
      if (!file) return;
      // Accept by extension (.xlsx) or declared MIME — the server re-validates via magic numbers
      const isXlsx = file.name.toLowerCase().endsWith('.xlsx') || file.type === XLSX_MIME;
      if (!isXlsx) {
        showToast('Solo se aceptan archivos .xlsx (Excel OpenXML).', 'error');
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        showToast('El archivo Excel excede el tamaño máximo de 10 MB.', 'error');
        return;
      }
      this.#uploadedExcel = file;
      excelFileName.textContent = `✓ ${file.name}`;
      excelFileName.classList.remove('hidden');
    };

    excelInput.addEventListener('change', (e) => {
      if (e.target.files[0]) onExcelFile(e.target.files[0]);
    });

    excelZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      excelZone.classList.add('dragover');
    });

    excelZone.addEventListener('dragleave', () => excelZone.classList.remove('dragover'));

    excelZone.addEventListener('drop', (e) => {
      e.preventDefault();
      excelZone.classList.remove('dragover');
      onExcelFile(e.dataTransfer.files[0]);
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

    // Build the filtered detalles array — drop rows with no description
    const filteredDetalles = items.filter(i => i.descripcion_item?.trim()).map(i => ({
      descripcion_item:   i.descripcion_item.trim(),
      codigo:             i.codigo             ? String(i.codigo).trim()             || null : null,
      codigo_alternativo: i.codigo_alternativo  ? String(i.codigo_alternativo).trim() || null : null,
      unidad:             i.unidad             ? String(i.unidad).trim()             || null : null,
      // Pass the raw parsed value — do NOT fall back to 1 here.
      // A quantity of 0 is invalid (Zod rejects it as "must be greater than 0")
      // and the backend will return a descriptive 422 error.  Coercing 0 → 1
      // silently masks the input mistake and confuses the user.
      cantidad:           parseFloat(i.cantidad),
      precio_unitario:    parseFloat(i.precio_unitario) || 0,
      marca_id:           i.marca_id                    || null,
      tiempo_entrega:     i.tiempo_entrega ? String(i.tiempo_entrega).trim() || null : null,
    }));

    // Client-side guard: require at least one line item with a description
    if (filteredDetalles.length === 0) {
      alert.textContent = 'La cotización debe tener al menos un ítem con descripción.';
      alert.className   = 'form-alert show alert-error';
      this.#container.querySelector('#items-body')
        ?.querySelector('.item-input')?.focus();
      return;
    }

    // Build request body
    const body = {
      id_cliente,
      descripcion,
      fecha_emision,
      moneda:                   this.#container.querySelector('#moneda')?.value                  || 'BOB',
      tipo_pedido:              this.#container.querySelector('#tipo_pedido')?.value.trim()       || null,
      fecha_validez:            fecha_validez || null,
      observaciones:            this.#container.querySelector('#observaciones')?.value.trim()    || null,
      tiempo_entrega:           this.#container.querySelector('#tiempo_entrega')?.value.trim()   || null,
      monto_total:              subtotal > 0 ? subtotal : null,
      // Solicitante block
      solicitante_no_solicitud: this.#container.querySelector('#solicitante_no_solicitud')?.value.trim() || null,
      solicitante_area:         this.#container.querySelector('#solicitante_area')?.value.trim()         || null,
      solicitante_celular:      this.#container.querySelector('#solicitante_celular')?.value.trim()      || null,
      solicitante_correo:       this.#container.querySelector('#solicitante_correo')?.value.trim()       || null,
      // Equipo block
      equipo_marca:             this.#container.querySelector('#equipo_marca')?.value.trim()   || null,
      equipo_tipo:              this.#container.querySelector('#equipo_tipo')?.value.trim()    || null,
      equipo_modelo:            this.#container.querySelector('#equipo_modelo')?.value.trim()  || null,
      equipo_serie:             this.#container.querySelector('#equipo_serie')?.value.trim()   || null,
      equipo_motor:             this.#container.querySelector('#equipo_motor')?.value.trim()   || null,
      detalles:                 filteredDetalles,
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

      // Step 2 — Upload PDF and/or Excel if either was attached
      if ((this.#uploadedFile || this.#uploadedExcel) && quotation?.id) {
        const formData = new FormData();
        if (this.#uploadedFile)  formData.append('pdf',   this.#uploadedFile);
        if (this.#uploadedExcel) formData.append('excel', this.#uploadedExcel);
        try {
          await api.upload(`/api/cotizaciones/${quotation.id}/upload`, formData);
        } catch (fileErr) {
          // Non-fatal: quotation was created; just warn the user
          showToast(`Cotización creada, pero los archivos no pudieron subirse: ${fileErr.message}`, 'warning');
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
