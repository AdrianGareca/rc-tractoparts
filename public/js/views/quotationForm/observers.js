// =============================================================================
// public/js/views/quotationForm/observers.js
// PATRÓN OBSERVER del formulario de cotización.
//
//   LineItemsSubject   — Sujeto observable: dueño autoritativo del array de ítems.
//   Observer           — interfaz base.
//   RowSubtotalObserver— actualiza la celda de subtotal de cada fila.
//   TotalsObserver     — recalcula subtotal / descuento / total del panel.
//
// Extraído de quotationForm.js sin cambios de comportamiento.
// Cubierto por tests/unit/quotationFormObservers.test.js.
// =============================================================================

import { sumSubtotals, computeTotal } from '../../shared/quotationTotals.js';
import { fmt } from './helpers.js';

// =============================================================================
// OBSERVER PATTERN — Subject (Observable)
// =============================================================================

/**
 * LineItemsSubject
 * Holds the authoritative array of line items and notifies all registered
 * Observer instances whenever the array mutates.
 */
export class LineItemsSubject {
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
export class Observer {
  /** @param {Array} items — snapshot of the items array */
  // eslint-disable-next-line no-unused-vars
  update(items) {}
}

/**
 * RowSubtotalObserver
 * Updates each row's subtotal cell when quantities or prices change.
 * Reads DOM nodes by data-item-subtotal="<index>" attributes.
 */
export class RowSubtotalObserver extends Observer {
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
export class TotalsObserver extends Observer {
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
    const subtotal = sumSubtotals(items);
    // computeTotal clamps the discount to >= 0, so a negative entry can never
    // inflate the preview above the subtotal (it maps to no discount at all).
    const total    = computeTotal(subtotal, this.#discountEl ? this.#discountEl.value : 0);
    this.#subtotalEl.textContent = fmt(subtotal);
    this.#totalEl.textContent    = fmt(total);
  }
}
