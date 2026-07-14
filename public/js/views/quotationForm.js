// =============================================================================
// public/js/views/quotationForm.js
// Dynamic Quotation Form
//
// STRUCTURAL PATTERN: MEDIATOR
//   FormMediator is the central hub connecting three independent components:
//     • LineItemsComponent — dynamic line-item rows (add / remove / edit)
//     • TotalsComponent    — live subtotal / discount / total panel (Observer target)
//     • FileUploadComponent— drag-and-drop Excel attachment area
//   Components communicate exclusively through the Mediator; they hold no
//   direct references to each other.
//
// BEHAVIORAL PATTERN: OBSERVER
//   LineItemsSubject is the observable Subject holding the items array.
//   When items change (add, remove, field update), it notifies two Observers:
//     • RowSubtotalObserver  — updates the per-row subtotal cell
//     • TotalsObserver       — recalculates subtotal, discount, and final total
//   Observers register on construction and are automatically decoupled when
//   the form is destroyed.
// =============================================================================

import api          from '../services/apiClient.js';
import { showToast } from '../services/apiClient.js';
import { connectSocket } from '../services/socketClient.js';
import { openClienteModal } from './dashboard/modules/clientModal.js';

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
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

  /**
   * Seed a pre-filled item (used in edit mode to hydrate existing line items).
   * Returns the new index. Missing fields fall back to sane defaults so the
   * row renders identically to a freshly-added one.
   */
  addItemData(item = {}) {
    this.#items.push({
      descripcion_item:   item.descripcion_item   ?? '',
      codigo:             item.codigo             ?? '',
      codigo_alternativo: item.codigo_alternativo ?? '',
      unidad:             item.unidad             ?? 'UND',
      cantidad:           item.cantidad           ?? 1,
      precio_unitario:    item.precio_unitario    ?? 0,
      marca_id:           item.marca_id           ?? null,
      tiempo_entrega:     item.tiempo_entrega     ?? '',
    });
    this._notify();
    return this.#items.length - 1;
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
 * TotalsObserver
 * Keeps the subtotal display and the final total (subtotal − descuento_manual) in sync.
 * Reads the optional #discountEl input for the live discount amount.
 */
class TotalsObserver extends Observer {
  #subtotalEl;
  #totalEl;
  #discountEl;   // <input> for the manual cash discount (may be null during init)

  constructor(subtotalEl, totalEl, discountEl) {
    super();
    this.#subtotalEl = subtotalEl;
    this.#totalEl    = totalEl;
    this.#discountEl = discountEl;
  }

  /** Update the discount element reference (wired after render) */
  setDiscountEl(el) { this.#discountEl = el; }

  update(items) {
    const subtotal  = sumSubtotals(items);
    const discount  = this.#discountEl ? (parseFloat(this.#discountEl.value) || 0) : 0;
    const total     = Math.max(0, subtotal - discount);
    this.#subtotalEl.textContent = fmt(subtotal);
    this.#totalEl.textContent    = fmt(total);
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
  #uploadedExcel = null;   // optional Excel spreadsheet attachment
  #brands = [];      // Cache of { id, nombre } loaded from GET /api/marcas
  #editData = null;  // Existing quotation when mounted in EDIT mode (else null)
  #editId   = null;  // Quotation id when editing (else null)
  #totalsObserver = null; // Kept for discount-input wiring
  #lockSocket   = null;    // Realtime draft-lock connection (creation mode only)
  #hasDraftLock = false;   // true once THIS socket owns the global next-number reservation
  #dirty        = false;   // true once the user has entered/changed anything — gates the close-confirmation

  constructor(container, quotation = null) {
    this.#container = container;
    this.#subject   = new LineItemsSubject();
    this.#editData  = quotation;
    this.#editId    = quotation?.id ?? null;
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

    // Peek at the next correlativo number for display (non-blocking, non-fatal)
    let nextCorrelativo = '';
    if (!this.#editId) {
      try {
        const r = await api.get('/api/cotizaciones/next-correlativo');
        nextCorrelativo = r.data?.numero_correlativo ?? '';
      } catch (_) { /* non-fatal */ }
    }

    this.#container.innerHTML = this._buildFormHTML(nextCorrelativo);

    // Mark the form dirty on ANY user edit (delegated — covers every current
    // and future input/select/textarea in the form, including line-item rows).
    // Backs the close-confirmation guard so an accidental click outside the
    // modal (or Escape) can no longer silently discard in-progress work.
    this.#container.addEventListener('input',  () => { this.#dirty = true; });
    this.#container.addEventListener('change', () => { this.#dirty = true; });

    // Grab observer target elements
    const elSubtotal = this.#container.querySelector('#totals-subtotal');
    const elTotal    = this.#container.querySelector('#totals-total');
    const elDiscount = this.#container.querySelector('#totals-discount');
    const itemsBody  = this.#container.querySelector('#items-body');

    // Register Observers with the Subject
    this.#subject.subscribe(new RowSubtotalObserver(this.#container));
    const totalsObs = new TotalsObserver(elSubtotal, elTotal, elDiscount);
    this.#totalsObserver = totalsObs;
    this.#subject.subscribe(totalsObs);

    // Seed rows: hydrate from the existing quotation when editing, otherwise
    // start with a single blank row.
    const editDetalles = this.#editData?.detalles ?? [];
    if (this.#editId && editDetalles.length > 0) {
      editDetalles.forEach((d) => {
        const mapped = {
          descripcion_item:   d.descripcion_item,
          codigo:             d.codigo_parte ?? d.producto_codigo ?? '',
          codigo_alternativo: d.codigo_alternativo ?? '',
          unidad:             d.unidad ?? 'UND',
          cantidad:           Number(d.cantidad),
          precio_unitario:    Number(d.precio_unitario),
          marca_id:           d.marca_id != null ? Number(d.marca_id) : null,
          tiempo_entrega:     d.tiempo_entrega ?? '',
        };
        this._appendRow(this.#subject.addItemData(mapped), itemsBody, mapped);
      });
    } else {
      this._appendRow(this.#subject.addItem(), itemsBody);
    }

    // Pre-fill header fields when editing
    if (this.#editId) this._populateHeaderForEdit();

    // Wire discount input — updates totals in real-time without touching items
    elDiscount?.addEventListener('input', () => {
      // Trigger a notify by re-broadcasting the current snapshot
      this.#subject._notify();
    });

    // Wire Forma de Pago dropdown — 'Otro (Personalizado)' reveals the free-text
    // input; picking any preset hides it again.
    const fpSelect = this.#container.querySelector('#forma_pago');
    fpSelect?.addEventListener('change', () => {
      const group  = this.#container.querySelector('#forma_pago_custom_group');
      const isOtro = fpSelect.value === '__otro__';
      if (group) group.style.display = isOtro ? '' : 'none';
      if (isOtro) this.#container.querySelector('#forma_pago_custom')?.focus();
    });

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
      this._releaseDraftLock();
      if (onCancel) onCancel();
    });

    // Block implicit submission on Enter — with dozens of fields, a user
    // hitting Enter expecting to move to the next field (or just finishing a
    // line-item value) would otherwise submit and save the whole quotation.
    // Textareas keep Enter as a newline; the actual submit button still
    // works via Enter/click since browsers dispatch a real 'click' there.
    const quotationForm = this.#container.querySelector('#quotation-form');
    quotationForm?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const tag = e.target.tagName;
      if (tag === 'TEXTAREA' || tag === 'BUTTON' || e.target.type === 'submit') return;
      e.preventDefault();
    });

    // Wire Submit
    quotationForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this._handleSubmit(onSuccess);
    });

    // Reserve the next correlativo + subscribe to live "someone else is
    // drafting" updates. Creation mode only — editing an existing quotation
    // never allocates a new serial. Fire-and-forget: the realtime layer is
    // a UX enhancement, never a hard dependency of the form.
    this._initDraftLock();
  }

  // ── Private: realtime draft-lock (global "next number" reservation) ────────

  async _initDraftLock() {
    if (this.#editId) return; // Editing never reserves a new correlativo

    try {
      this.#lockSocket = await connectSocket();
      this.#lockSocket.on('cotizacion:draft:update', (state) => this._renderLockState(state));

      // .timeout() guards against a hung ack (e.g. server restarted between
      // connect and join) — without it this await could wait forever since
      // Socket.IO acks have no default timeout.
      const ack = await new Promise((resolve) => {
        this.#lockSocket
          .timeout(5000)
          .emit('cotizacion:draft:join', null, (err, res) => resolve(err ? null : res));
      });

      if (!ack?.success) return;

      if (ack.mine) {
        this.#hasDraftLock = true;
        this._updateCorrelativoPreview(ack.numero_correlativo);
      } else {
        this._renderLockState({
          locked:             true,
          numero_correlativo: ack.numero_correlativo,
          ejecutivo:          ack.ejecutivo,
        });
      }
    } catch (err) {
      // Non-fatal: realtime layer unreachable — the form still works exactly
      // as before, just without the live collision warning.
      console.warn('[quotationForm] Draft-lock realtime layer unavailable:', err?.message || err);
    }
  }

  /** Render (or clear) the "someone else is drafting this number" banner. */
  _renderLockState(state) {
    const banner = this.#container.querySelector('#qf-lock-banner');
    if (!banner) return;

    if (state?.locked && !this.#hasDraftLock) {
      const nombre = escText(state.ejecutivo?.nombre ?? 'otro ejecutivo');
      const numero = escText(state.numero_correlativo ?? '');
      banner.innerHTML =
        `⚠️ Atención: El ejecutivo <strong>${nombre}</strong> ya está redactando la cotización ` +
        `<strong>${numero}</strong> en este momento. Espera a que termine o coordina con él para evitar duplicados.`;
      banner.classList.add('show');
    } else if (!state?.locked) {
      banner.classList.remove('show');
      banner.innerHTML = '';

      // The previous holder just released the number — try to claim it as
      // ours so this form's preview reflects the now-available serial.
      if (!this.#hasDraftLock && this.#lockSocket?.connected) {
        this.#lockSocket
          .timeout(5000)
          .emit('cotizacion:draft:join', null, (err, ack) => {
            if (!err && ack?.success && ack.mine) {
              this.#hasDraftLock = true;
              this._updateCorrelativoPreview(ack.numero_correlativo);
            }
          });
      }
    }
  }

  /** Update the read-only "Próximo Nº" badge once this socket owns the reservation. */
  _updateCorrelativoPreview(numeroCorrelativo) {
    const el = this.#container.querySelector('.correlativo-preview span:last-child');
    if (el) el.textContent = numeroCorrelativo;
  }

  /** Release this socket's reservation (if any) and tear down the connection. Idempotent. */
  _releaseDraftLock() {
    if (!this.#lockSocket) return;
    if (this.#hasDraftLock) {
      this.#lockSocket.emit('cotizacion:draft:leave');
      this.#hasDraftLock = false;
    }
    this.#lockSocket.disconnect();
    this.#lockSocket = null;
  }

  /** Public teardown — called when the host container (modal) closes by ANY path. */
  destroy() {
    this._releaseDraftLock();
  }

  /** True once the user has entered/changed anything — used to gate the close-confirmation. */
  isDirty() {
    return this.#dirty;
  }

  // ── Private: hydrate header fields from the existing quotation (edit mode) ──

  _populateHeaderForEdit() {
    const q   = this.#editData;
    const set = (sel, val) => {
      const el = this.#container.querySelector(sel);
      if (el != null && val != null) el.value = val;
    };
    // Normalize a DB date (Date object or ISO/datetime string) to YYYY-MM-DD for
    // a native <input type="date">.
    const toDateInput = (v) => {
      if (!v) return '';
      if (typeof v === 'string') return v.slice(0, 10);
      try { return new Date(v).toISOString().slice(0, 10); } catch { return ''; }
    };

    // Client selector: show the resolved name, store the numeric id in the hidden field.
    set('#cliente-search', q.cliente_nombre ?? '');
    set('#id_cliente',     q.id_cliente != null ? String(q.id_cliente) : '');

    set('#descripcion',   q.descripcion ?? '');
    set('#fecha_emision', toDateInput(q.fecha_emision));
    set('#fecha_validez', toDateInput(q.fecha_validez));
    set('#moneda',        q.moneda ?? 'BOB');
    // Gracefully map the legacy business name to its current legal name so the
    // dropdown resolves to a real <option> when editing a pre-rename record.
    const emisoraRaw = q.entidad_emisora ?? 'Empresa unipersonal de Ronald Roca Cartagena';
    set('#entidad_emisora',
      emisoraRaw === 'RC Tractoparts'
        ? 'Empresa unipersonal de Ronald Roca Cartagena'
        : emisoraRaw);
    set('#tipo_pedido',   q.tipo_pedido ?? '');
    set('#observaciones', q.observaciones ?? '');
    set('#tiempo_entrega', q.tiempo_entrega ?? '');

    // Solicitante block (findById aliases these column names)
    set('#solicitante_nombre',       q.nombre_sol    ?? q.solicitante_nombre ?? '');
    set('#solicitante_no_solicitud', q.nro_solicitud ?? q.solicitante_no_solicitud ?? '');
    set('#solicitante_area',         q.area_sol      ?? q.solicitante_area ?? '');
    set('#solicitante_celular',      q.celular_sol   ?? q.solicitante_celular ?? '');
    set('#solicitante_correo',       q.correo_sol    ?? q.solicitante_correo ?? '');

    // Equipo block
    set('#equipo_marca',  q.equipo_marca ?? '');
    set('#equipo_tipo',   q.equipo_tipo ?? '');
    set('#equipo_modelo', q.equipo_modelo ?? '');
    set('#equipo_serie',  q.equipo_serie ?? '');
    set('#equipo_motor',  q.equipo_motor ?? '');

    // Financial / PDF config fields
    set('#descuento_manual', q.descuento_manual != null ? String(q.descuento_manual) : '');
    // forma_pago: select the matching quick option, or 'Otro (Personalizado)'
    // with the custom text input revealed when the stored value is not a preset.
    this._setFormaPago(q.forma_pago ?? '');
    const mostrarCodigos = q.mostrar_codigos != null ? Boolean(Number(q.mostrar_codigos)) : true;
    const chkCodigos = this.#container.querySelector('#mostrar_codigos');
    if (chkCodigos) chkCodigos.checked = mostrarCodigos;
  }

  // ── Private: forma_pago select helpers ─────────────────────────────────────

  /**
   * _setFormaPago — hydrates the Forma de Pago <select> from a stored value.
   * A value matching one of the quick-select presets selects it directly;
   * empty/null keeps the default option; any other string selects
   * 'Otro (Personalizado)' and reveals + fills the custom text input.
   */
  _setFormaPago(value) {
    const sel   = this.#container.querySelector('#forma_pago');
    const group = this.#container.querySelector('#forma_pago_custom_group');
    const input = this.#container.querySelector('#forma_pago_custom');
    if (!sel) return;

    const isPreset = [...sel.options].some(
      (o) => o.value === value && o.value !== '__otro__'
    );

    if (!value || isPreset) {
      sel.value = value || '';
      if (group) group.style.display = 'none';
      if (input) input.value = '';
    } else {
      sel.value = '__otro__';
      if (group) group.style.display = '';
      if (input) input.value = value;
    }
  }

  /**
   * _collectFormaPago — returns the payload value for forma_pago:
   * the selected preset, the trimmed custom text when 'Otro' is chosen,
   * or null (→ backend/PDF default '60% ANTICIPO Y SALDO CONTRA ENTREGA').
   */
  _collectFormaPago() {
    const sel = this.#container.querySelector('#forma_pago')?.value ?? '';
    if (sel === '__otro__') {
      return this.#container.querySelector('#forma_pago_custom')?.value.trim() || null;
    }
    return sel || null;
  }

  // ── Private: build form HTML ───────────────────────────────────────────────

  _buildFormHTML(nextCorrelativo = '') {
    // Shared "(Opcional)" label marker — appended to every non-mandatory field
    // so users know at a glance which inputs can be left blank.
    const OPT = '<span style="color:#9ca3af;font-size:.8rem;font-weight:400;">(Opcional)</span>';

    const corrPreview = nextCorrelativo
      ? `<div class="correlativo-preview" style="display:inline-flex;align-items:center;gap:.5rem;
             padding:.25rem .75rem;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:6px;
             font-size:.85rem;color:#1D4ED8;font-weight:600;margin-bottom:.75rem;">
           <span style="color:#6B7280;font-weight:400;">Próximo Nº:</span>
           <span>${escText(nextCorrelativo)}</span>
         </div>`
      : '';

    return /* html */ `
      <form id="quotation-form" novalidate>
        <div class="form-alert alert-warning" id="qf-lock-banner" role="alert"></div>
        ${corrPreview}

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
            <label class="form-label" for="entidad_emisora">Entidad Emisora *</label>
            <select class="form-control" id="entidad_emisora">
              <option value="Empresa unipersonal de Ronald Roca Cartagena">Empresa unipersonal de Ronald Roca Cartagena</option>
              <option value="Roca Importaciones S.R.L.">Roca Importaciones S.R.L.</option>
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
              <label class="form-label" for="solicitante_nombre">Nombre del Solicitante ${OPT}</label>
              <input class="form-control" type="text" id="solicitante_nombre"
                     placeholder="Ej: Juan Pérez" maxlength="120" />
            </div>
            <div class="form-group">
              <label class="form-label" for="solicitante_no_solicitud">Nº Solicitud / OC ${OPT}</label>
              <input class="form-control" type="text" id="solicitante_no_solicitud"
                     placeholder="Ej: OC-2026-0045" maxlength="100" />
            </div>
            <div class="form-group">
              <label class="form-label" for="solicitante_area">Área / Departamento ${OPT}</label>
              <input class="form-control" type="text" id="solicitante_area"
                     placeholder="Ej: Mantenimiento" maxlength="100" />
            </div>
            <div class="form-group">
              <label class="form-label" for="solicitante_celular">Celular ${OPT}</label>
              <input class="form-control" type="tel" id="solicitante_celular"
                     placeholder="Ej: 77012345" maxlength="30" />
            </div>
            <div class="form-group">
              <label class="form-label" for="solicitante_correo">Correo ${OPT}</label>
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
              <label class="form-label" for="equipo_marca">Marca ${OPT}</label>
              <input class="form-control" type="text" id="equipo_marca"
                     placeholder="Ej: Caterpillar" maxlength="80" />
            </div>
            <div class="form-group">
              <label class="form-label" for="equipo_tipo">Tipo ${OPT}</label>
              <input class="form-control" type="text" id="equipo_tipo"
                     placeholder="Ej: Excavadora" maxlength="80" />
            </div>
            <div class="form-group">
              <label class="form-label" for="equipo_modelo">Modelo ${OPT}</label>
              <input class="form-control" type="text" id="equipo_modelo"
                     placeholder="Ej: 336" maxlength="80" />
            </div>
            <div class="form-group">
              <label class="form-label" for="equipo_serie">Nº Serie ${OPT}</label>
              <input class="form-control" type="text" id="equipo_serie"
                     placeholder="Ej: CAT0336XXXXX" maxlength="80" />
            </div>
            <div class="form-group">
              <label class="form-label" for="equipo_motor">Nº Motor ${OPT}</label>
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

        <!-- Totals panel — updated by TotalsObserver -->
        <div class="totals-panel">
          <div class="totals-row">
            <span>Subtotal</span>
            <span class="totals-value" id="totals-subtotal">0.00</span>
          </div>
          <div class="totals-row">
            <label for="totals-discount" style="font-size:.85rem;color:var(--text-secondary);">
              Descuento Manual (monto fijo)
            </label>
            <input
              type="number"
              id="totals-discount"
              min="0" step="any"
              placeholder="0.00"
              style="width:120px;text-align:right;padding:.25rem .5rem;border:1px solid var(--border);border-radius:4px;font-size:.9rem;"
              title="Ingrese un descuento en monto absoluto (no porcentaje). Se resta directamente del subtotal."
            />
          </div>
          <div class="totals-row total-final">
            <span>Total</span>
            <span class="totals-value" id="totals-total">0.00</span>
          </div>
        </div>

        <!-- Payment terms + PDF config -->
        <div class="form-row" style="margin-top:1rem;align-items:flex-end;gap:1rem;flex-wrap:wrap;">
          <div class="form-group" style="flex:2;min-width:220px;">
            <label class="form-label" for="forma_pago">Forma de Pago</label>
            <select class="form-control" id="forma_pago">
              <option value="">Por defecto (60% ANTICIPO Y SALDO CONTRA ENTREGA)</option>
              <option value="20% DE ANTICIPO">20% DE ANTICIPO</option>
              <option value="30% DE ANTICIPO">30% DE ANTICIPO</option>
              <option value="40% DE ANTICIPO">40% DE ANTICIPO</option>
              <option value="50% DE ANTICIPO">50% DE ANTICIPO</option>
              <option value="60% DE ANTICIPO">60% DE ANTICIPO</option>
              <option value="__otro__">Otro (Personalizado)</option>
            </select>
          </div>
          <div class="form-group" style="flex:2;min-width:220px;display:none;" id="forma_pago_custom_group">
            <label class="form-label" for="forma_pago_custom">Forma de Pago Personalizada</label>
            <input class="form-control" type="text" id="forma_pago_custom"
                   placeholder="Ej: 70% ANTICIPO Y SALDO A 30 DÍAS" maxlength="200" />
          </div>
          <div class="form-group" style="display:flex;align-items:center;gap:.5rem;padding-bottom:.25rem;">
            <input type="checkbox" id="mostrar_codigos" checked
                   style="width:16px;height:16px;cursor:pointer;" />
            <label for="mostrar_codigos" class="form-label" style="margin:0;cursor:pointer;">
              Mostrar columna CÓDIGO en el PDF
            </label>
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
            <span class="btn-label">${this.#editId ? 'Guardar Cambios' : 'Crear Cotización'}</span>
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
    this.#dirty = true;
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
      this.#dirty = true;
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
                Sin resultados para "<em>${escText(q)}</em>"
              </div>`;
            dropdown.classList.add('open');
            return;
          }

          dropdown.innerHTML = clients.map(c => `
            <div class="client-dropdown-item" data-id="${c.id}"
                 data-label="${escText(c.razon_social)}"
                 role="option" tabindex="-1">
              <span class="cdi-name">${escText(c.razon_social)}</span>
              ${c.nit ? `<span class="cdi-nit">NIT: ${escText(c.nit)}</span>` : ''}
              <button type="button" class="cdi-edit" data-edit-id="${c.id}"
                      title="Editar cliente" aria-label="Editar cliente">✏️</button>
            </div>
          `).join('');
          dropdown.classList.add('open');

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
              if (client) this._openEditarClienteModal(client, selectClient);
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

  // ── Private: express client registration / edit sub-modal ────────────────
  // Delegates to the shared clientModal module (also used by the "Gestión de
  // Clientes" management tab) so the fields/validation/duplicate-NIT
  // handling live in exactly one place.

  /** Opens the "+ Nuevo Cliente" express-registration sub-modal. */
  _openNuevoClienteModal(onCreated) {
    openClienteModal({
      mode:       'create',
      client:     null,
      onSaved:    onCreated,
      mountTarget: this.#container.closest('.modal-body, [id="modal-body"]') ?? document.body,
    });
  }

  /**
   * Opens the same sub-modal pre-filled for an EXISTING client, so its data
   * (e.g. a NIT left blank at express-registration time) can be corrected.
   * Without this there was no way to fix a client record short of re-creating
   * it, which the NIT-uniqueness constraint rejects with no path forward.
   */
  _openEditarClienteModal(client, onSaved) {
    openClienteModal({
      mode:   'edit',
      client,
      onSaved,
      mountTarget: this.#container.closest('.modal-body, [id="modal-body"]') ?? document.body,
    });
  }

  // ── Private: drag-and-drop file upload (Excel only) ──────────────────────

  _wireFileUpload() {
    // ── Excel drag-and-drop ──────────────────────────────────────────────────
    const excelZone      = this.#container.querySelector('#excel-drop-zone');
    const excelInput     = this.#container.querySelector('#excel-input');
    const excelFileName  = this.#container.querySelector('#excel-file-name');
    if (!excelZone || !excelInput) return;

    const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    const onExcelFile = (file) => {
      if (!file) return;
      const isXlsx = file.name.toLowerCase().endsWith('.xlsx') || file.type === XLSX_MIME;
      if (!isXlsx) {
        showToast('Solo se aceptan archivos .xlsx (Excel OpenXML).', 'error');
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        showToast('El archivo Excel excede el tamaño máximo de 10 MB.', 'error');
        return;
      }
      this.#dirty = true;
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
    const subtotal         = sumSubtotals(items);
    const discountRaw      = parseFloat(this.#container.querySelector('#totals-discount')?.value) || 0;
    const descuento_manual = discountRaw > 0 ? discountRaw : null;

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
      entidad_emisora:          this.#container.querySelector('#entidad_emisora')?.value          || 'Empresa unipersonal de Ronald Roca Cartagena',
      tipo_pedido:              this.#container.querySelector('#tipo_pedido')?.value.trim()       || null,
      fecha_validez:            fecha_validez || null,
      observaciones:            this.#container.querySelector('#observaciones')?.value.trim()    || null,
      tiempo_entrega:           this.#container.querySelector('#tiempo_entrega')?.value.trim()   || null,
      monto_total:              subtotal > 0 ? subtotal : null,
      descuento_manual,
      forma_pago:               this._collectFormaPago(),
      mostrar_codigos:          this.#container.querySelector('#mostrar_codigos')?.checked ?? true,
      // Solicitante block
      solicitante_nombre:       this.#container.querySelector('#solicitante_nombre')?.value.trim()       || null,
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
    const originalLabel = this.#editId ? 'Guardar Cambios' : 'Crear Cotización';
    if (label)  label.textContent = this.#editId ? 'Guardando...' : 'Creando...';
    if (spinner)spinner.classList.remove('hidden');
    alert.className = 'form-alert';

    try {
      // Step 1 — Create OR update the quotation record
      const response = this.#editId
        ? await api.put(`/api/cotizaciones/${this.#editId}`, body)
        : await api.post('/api/cotizaciones', body);
      const quotation = response.data;

      // Release our draft-lock reservation immediately on success — the
      // number is now officially registered, so the "in progress" warning
      // must clear for every other connected executive right away.
      this._releaseDraftLock();

      // Step 2 — Upload Excel if one was attached
      if (this.#uploadedExcel && quotation?.id) {
        const formData = new FormData();
        formData.append('excel', this.#uploadedExcel);
        try {
          await api.upload(`/api/cotizaciones/${quotation.id}/upload`, formData);
        } catch (fileErr) {
          // Non-fatal: quotation was created; just warn the user
          showToast(`Cotización creada, pero el Excel no pudo subirse: ${fileErr.message}`, 'warning');
        }
      }

      if (onSuccess) onSuccess(quotation);

    } catch (err) {
      btnSubmit.disabled = false;
      if (label)  label.textContent = originalLabel;
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
export function mountQuotationForm(container, { onSuccess, onCancel, quotation = null } = {}) {
  // Diagnostic banner — if you DON'T see this in the console when opening the
  // form, your browser is running an OLD cached copy of this file (do a hard
  // reload: Ctrl+Shift+R, or DevTools → Network → "Disable cache").
  console.log('%c[quotationForm] v3 — Enter no envía + click-fuera no cierra','color:#16a34a;font-weight:bold');
  const mediator = new FormMediator(container, quotation);
  mediator.render(onSuccess, onCancel);
  // Callable teardown, same as before — plus an `isDirty()` escape hatch so the
  // host (the modal) can confirm before discarding an in-progress draft.
  const destroy = () => mediator.destroy();
  destroy.isDirty = () => mediator.isDirty();
  return destroy;
}
