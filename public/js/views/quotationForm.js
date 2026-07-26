// =============================================================================
// public/js/views/quotationForm.js
// Dynamic Quotation Form — FormMediator (coordinación) + punto de montaje.
//
// STRUCTURAL PATTERN: MEDIATOR
//   FormMediator es el único punto de coordinación del formulario. Los
//   componentes no se conocen entre sí: le avisan al Mediator y él decide
//   quién tiene que reaccionar. Este archivo se quedó SOLO con esa
//   coordinación — cada responsabilidad concreta vive en quotationForm/:
//
//     helpers.js            — fmt / escText / nextCorrelativoOf (puras)
//     observers.js          — LineItemsSubject + los Observers concretos
//     formTemplate.js       — buildFormHTML: el markup completo (pura)
//     lineItemsComponent.js — filas de detalle + regla de deduplicación
//     brandModal.js         — sub-modal de alta rápida de marca
//     clientSearch.js       — autocompletar de cliente + alta/edición express
//     fileUpload.js         — adjunto Excel (drag & drop + validación)
//     draftLock.js          — reserva del correlativo en tiempo real (socket)
//     submitPayload.js      — validación, armado del body y envío
//
// BEHAVIORAL PATTERN: OBSERVER
//   LineItemsSubject (observers.js) es el Sujeto observable dueño del array de
//   ítems. Cada mutación notifica a dos Observers: RowSubtotalObserver
//   (subtotal por fila) y TotalsObserver (subtotal / descuento / total).
//
// Cada módulo tiene su propio archivo de tests en tests/unit/quotationForm*.
// =============================================================================

import api          from '../services/apiClient.js';
import { showToast } from '../services/apiClient.js';

import { escText } from './quotationForm/helpers.js';
import {
  LineItemsSubject,
  RowSubtotalObserver,
  TotalsObserver,
} from './quotationForm/observers.js';
import { buildFormHTML } from './quotationForm/formTemplate.js';
import { appendRow } from './quotationForm/lineItemsComponent.js';
import { openBrandModal } from './quotationForm/brandModal.js';
import { wireClientSearch } from './quotationForm/clientSearch.js';
import { wireFileUpload } from './quotationForm/fileUpload.js';
import { DraftLockController } from './quotationForm/draftLock.js';
import { submitQuotation } from './quotationForm/submitPayload.js';

// NOTE: sumSubtotals / clampDiscount / computeTotal / validateDetalle viven en
// public/js/shared/quotationTotals.js — la ÚNICA fuente de verdad, compartida
// con las reglas de redondeo del backend. Los consumen observers.js y
// submitPayload.js. NO reintroducir una copia local: el total en pantalla debe
// coincidir siempre con el que el servidor calcula y guarda.

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
  #draftLock = null;      // DraftLockController — dueño del socket y del flag `destroyed`
  #dirty        = false;   // true once the user has entered/changed anything — gates the close-confirmation

  #prefill = null;  // Optional { id_cliente, cliente_nombre, id_licitacion, licitacion_label } for a pre-linked create

  constructor(container, quotation = null, prefill = null) {
    this.#container = container;
    this.#subject   = new LineItemsSubject();
    this.#editData  = quotation;
    this.#editId    = quotation?.id ?? null;
    this.#prefill   = prefill;
    this.#draftLock = new DraftLockController(container);
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

    // El host (el modal) puede haberse cerrado MIENTRAS esperábamos los
    // catálogos de arriba: mountQuotationForm devuelve el destroy de forma
    // síncrona, así que destroy() ya corrió y este render llega tarde.
    // Escribir igual pisaría #modal-body, que para este momento puede
    // pertenecer a OTRO modal (Gestión de Clientes, detalle de proforma…),
    // dejando un formulario muerto dentro de una ventana que no es la suya.
    if (this.#draftLock.isDestroyed()) return;

    this.#container.innerHTML = buildFormHTML({
      nextCorrelativo,
      isEdit: Boolean(this.#editId),
    });

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

    // Populate the "Licitación asociada" dropdown (non-fatal) and apply any
    // pre-linked selection (edit mode or delegated-executive prefill).
    this._populateLicitaciones();

    // Apply create-mode prefill (delegated executive creating a linked cotización)
    if (!this.#editId && this.#prefill) {
      const hid = this.#container.querySelector('#id_cliente');
      const search = this.#container.querySelector('#cliente-search');
      if (this.#prefill.id_cliente && hid)   hid.value = String(this.#prefill.id_cliente);
      if (this.#prefill.cliente_nombre && search) search.value = this.#prefill.cliente_nombre;
    }

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

  // ── Private: realtime draft-lock (global "next number" reservation) ───────
  // Todo el estado (socket, si esta pestana es la duena, si el form murio) vive
  // en quotationForm/draftLock.js (cubierto por
  // tests/unit/quotationFormDraftLock.test.js).

  async _initDraftLock() {
    if (this.#editId) return; // Editing never reserves a new correlativo
    await this.#draftLock.init();
  }

  /** Release this socket's reservation (if any) and tear down the connection. Idempotent. */
  _releaseDraftLock() {
    this.#draftLock.release();
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

  // ── Private: populate the "Licitación asociada" dropdown ────────────────────
  // Lists licitaciones currently in 'Cotizando' (the handoff state where the
  // commercial executive prices them). In edit mode (or via prefill) the already
  // linked licitación is guaranteed to be present and selected even if it has
  // since advanced past 'Cotizando'. Non-fatal: on any failure the dropdown just
  // stays at "Sin licitación" so normal quoting is never blocked.
  async _populateLicitaciones() {
    const sel = this.#container.querySelector('#id_licitacion');
    if (!sel) return;

    // The id to pre-select: edit mode uses the stored link; create mode uses prefill.
    const selectedId = this.#editData?.id_licitacion ?? this.#prefill?.id_licitacion ?? null;

    let options = [];
    try {
      const body = await api.get('/api/licitaciones?estado=Cotizando&limit=100&sort_by=creado_en&sort_order=DESC');
      options = body.data ?? [];
    } catch (_) { /* non-fatal — dropdown stays minimal */ }

    // Ensure the currently-linked licitación appears even if not in the Cotizando list.
    if (selectedId != null && !options.some((l) => String(l.id) === String(selectedId))) {
      try {
        const one = await api.get(`/api/licitaciones/${selectedId}`);
        if (one?.data) options.unshift(one.data);
      } catch (_) { /* fall back to a generic label below */ }
    }

    const opts = options.map((l) =>
      `<option value="${l.id}">${escText(`${l.codigo} — ${l.nombre}`)}</option>`).join('');
    sel.insertAdjacentHTML('beforeend', opts);

    // If the linked id still isn't an option (lookup failed), add a placeholder
    // so the value is preserved on save.
    if (selectedId != null && !sel.querySelector(`option[value="${selectedId}"]`)) {
      sel.insertAdjacentHTML('beforeend', `<option value="${selectedId}">Licitación #${escText(String(selectedId))}</option>`);
    }
    if (selectedId != null) sel.value = String(selectedId);
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

  // La lectura de forma_pago para el payload vive en
  // quotationForm/submitPayload.js (collectFormaPago).

  // ── Plantilla HTML ────────────────────────────────────────────────────────
  // El markup vive en quotationForm/formTemplate.js (funcion pura, cubierta
  // por tests/unit/quotationFormTemplate.test.js).

  // ── Private: append one table row ─────────────────────────────────────────
  // El markup, la regla de deduplicacion y el cableado de la fila viven en
  // quotationForm/lineItemsComponent.js (cubiertos por
  // tests/unit/quotationFormLineItems.test.js). Aca solo se inyectan las
  // dependencias del Mediator.

  /**
   * @param {number}      index   - Position in the Subject items array
   * @param {HTMLElement} tbody   - Target table body element
   * @param {Object|null} itemData - Pre-existing item data for re-render after deletion.
   *   When null (new row), inputs are rendered with blank / default values.
   */
  _appendRow(index, tbody, itemData = null) {
    appendRow(index, tbody, itemData, {
      brands:        this.#brands,
      getItems:      () => this.#subject.getItems(),
      onFieldChange: (idx, field, value) => this._onItemFieldChange(idx, field, value),
      onRemove:      (idx) => this._onRemoveItem(idx),
      onAddBrand:    (idx) => this._openNuevaMarcaModal(idx),
      onMerge:       ({ dupeIdx, merged, currentIdx, rawCodigo }) => {
        // Fusion: la cantidad de esta fila se suma a la fila ya existente.
        this.#subject.updateItem(dupeIdx, 'cantidad', merged);
        // Se elimina esta fila (la nueva) y se re-renderiza; la fila superviviente
        // muestra la cantidad fusionada.
        this._onRemoveItem(currentIdx);
        showToast(
          `Cód. Parte "${rawCodigo}" ya existe con la misma marca — cantidad fusionada: ${merged}.`,
          'info'
        );
      },
    });
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
  // El sub-modal vive en quotationForm/brandModal.js (cubierto por
  // tests/unit/quotationFormBrandModal.test.js).

  _openNuevaMarcaModal(rowIndex) {
    openBrandModal(rowIndex, {
      container:     this.#container,
      brands:        this.#brands,   // caché compartido: se muta in-place
      onFieldChange: (idx, field, value) => this._onItemFieldChange(idx, field, value),
    });
  }

  // ── Private: client autocomplete search ───────────────────────────────────
  // El buscador, el desplegable y el sub-modal de alta/edicion viven en
  // quotationForm/clientSearch.js (cubiertos por
  // tests/unit/quotationFormClientSearch.test.js).

  _wireClientSearch() {
    wireClientSearch({
      container: this.#container,
      onDirty:   () => { this.#dirty = true; },
    });
  }

  // ── Private: drag-and-drop file upload (Excel only) ──────────────────────
  // La validacion y el cableado viven en quotationForm/fileUpload.js
  // (cubiertos por tests/unit/quotationFormFileUpload.test.js).

  _wireFileUpload() {
    wireFileUpload({
      container: this.#container,
      onFile:    (file) => {
        this.#dirty = true;
        this.#uploadedExcel = file;
      },
    });
  }

  // ── Private: form submission ───────────────────────────────────────────────
  // La validacion, el armado del payload y el envio viven en
  // quotationForm/submitPayload.js (cubiertos por
  // tests/unit/quotationFormSubmit.test.js).

  async _handleSubmit(onSuccess) {
    await submitQuotation({
      container:     this.#container,
      editId:        this.#editId,
      items:         this.#subject.getItems(),
      uploadedExcel: this.#uploadedExcel,
      onSuccess,
      onSaved:       () => this._releaseDraftLock(),
    });
  }
}

// =============================================================================
// Public factory function
// Mounts the quotation form into the given container element.
// Returns a cleanup function that removes event listeners when the form closes.
// =============================================================================
export function mountQuotationForm(container, { onSuccess, onCancel, quotation = null, prefill = null } = {}) {
  const mediator = new FormMediator(container, quotation, prefill);
  mediator.render(onSuccess, onCancel);
  // Callable teardown, same as before — plus an `isDirty()` escape hatch so the
  // host (the modal) can confirm before discarding an in-progress draft.
  const destroy = () => mediator.destroy();
  destroy.isDirty = () => mediator.isDirty();
  return destroy;
}
