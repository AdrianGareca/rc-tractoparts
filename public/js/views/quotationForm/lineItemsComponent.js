// =============================================================================
// public/js/views/quotationForm/lineItemsComponent.js
// Componente de filas de ítems del formulario de cotización.
//
// Se divide en lógica PURA (testeable sin DOM) y cableado de eventos:
//   safeAttr         — escapa un valor para el contexto value="…"
//   buildRowHtml     — markup de una fila (puro)
//   findDuplicateRow — regla de fusión por clave compuesta (codigo, marca_id)
//   appendRow        — crea el <tr>, engancha los listeners y lo inserta
//
// Extraído de FormMediator._appendRow sin cambios de comportamiento.
// Cubierto por tests/unit/quotationFormLineItems.test.js.
// =============================================================================

import { escText } from './helpers.js';

/** Escaper mínimo para valores preinsertados en atributos (evita XSS por
 *  inyección de comilla doble en el contexto value="…"). */
export function safeAttr(v) {
  return v != null ? String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;') : '';
}

/**
 * Markup de una fila de detalle. Función pura.
 * @param {number}      index    — posición en el array del Subject
 * @param {Object|null} itemData — datos previos; null = fila nueva en blanco
 * @param {Array}       brands   — catálogo [{ id, nombre }] cacheado
 */
export function buildRowHtml(index, itemData = null, brands = []) {
  const safeCod   = safeAttr(itemData?.codigo           ?? '');
  const safeCodAlt= safeAttr(itemData?.codigo_alternativo ?? '');
  const safeDesc  = safeAttr(itemData?.descripcion_item  ?? '');
  const safeCant  = itemData?.cantidad        ?? 1;
  const safePrice = itemData?.precio_unitario ?? 0;
  const safeMarca = itemData?.marca_id        ?? '';
  const safeUnidadVal = itemData?.unidad ?? 'UND';
  const safeTEnt  = safeAttr(itemData?.tiempo_entrega ?? '');

  // Build brand options HTML from cached brand list
  const brandOptions = brands
    .map(b => `<option value="${b.id}"${b.id === Number(safeMarca) ? ' selected' : ''}>${escText(b.nombre)}</option>`)
    .join('');

  return /* html */ `
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
}

// ---------------------------------------------------------------------------
// findDuplicateRow — regla de deduplicación por Código de Parte.
//
// Clave COMPUESTA: sólo se fusiona cuando coinciden código Y marca_id. En
// catálogos de maquinaria pesada, CAT y CUMMINS pueden compartir número de
// parte; esas filas deben quedar separadas en la cotización.
//
// marca_id es null cuando no hay marca elegida; null === null es intencional
// (dos filas sin marca con el mismo código sí se fusionan).
//
// @returns {{ dupeIdx: number, merged: number }|null} — null si no hay fusión.
// ---------------------------------------------------------------------------
export function findDuplicateRow(items, currentIdx, rawCodigo) {
  const normalised = String(rawCodigo ?? '').trim().toUpperCase();
  if (!normalised) return null;              // en blanco — nada que fusionar

  const currentMarca = items[currentIdx]?.marca_id ?? null;

  const dupeIdx = items.findIndex((item, i) =>
    i !== currentIdx &&
    String(item.codigo || '').trim().toUpperCase() === normalised &&
    (item.marca_id ?? null) === currentMarca
  );
  if (dupeIdx === -1) return null;           // clave compuesta única

  const thisQty = parseFloat(items[currentIdx]?.cantidad) || 1;
  const dupeQty = parseFloat(items[dupeIdx]?.cantidad)    || 1;
  const merged  = parseFloat((thisQty + dupeQty).toFixed(4));

  return { dupeIdx, merged };
}

/**
 * Crea la fila, engancha sus listeners y la inserta en el tbody.
 *
 * @param {Object} handlers
 *   brands        {Array}    — catálogo de marcas
 *   onFieldChange {Function} — (idx, field, value)
 *   onRemove      {Function} — (idx)
 *   onAddBrand    {Function} — (idx)
 *   getItems      {Function} — () => snapshot del Subject
 *   onMerge       {Function} — ({ dupeIdx, merged, currentIdx, rawCodigo })
 */
export function appendRow(index, tbody, itemData = null, handlers = {}) {
  const {
    brands = [], onFieldChange, onRemove, onAddBrand, getItems, onMerge,
  } = handlers;

  const tr = document.createElement('tr');
  tr.dataset.rowIndex = index;
  tr.innerHTML = buildRowHtml(index, itemData, brands);

  // Inputs de texto/número → actualización del Subject vía Mediator
  tr.querySelectorAll('.item-input').forEach(input => {
    input.addEventListener('input', (e) => {
      const field = e.target.dataset.field;
      const idx   = parseInt(e.target.dataset.idx, 10);
      onFieldChange?.(idx, field, e.target.value);
    });
  });

  // ── Deduplicación por Código de Parte al salir del campo ──────────────────
  tr.querySelector('.item-codigo')?.addEventListener('blur', (e) => {
    const rawCodigo = e.target.value.trim();
    if (!rawCodigo) return;
    const currentIdx = parseInt(e.target.dataset.idx, 10);

    // Snapshot estrictamente del Subject de ESTA instancia del formulario:
    // getItems() devuelve una copia defensiva, así que no puede colarse
    // información de otra cotización, array global ni payload cacheado.
    const items = getItems?.() ?? [];
    const dupe  = findDuplicateRow(items, currentIdx, rawCodigo);
    if (!dupe) return;

    onMerge?.({ ...dupe, currentIdx, rawCodigo });
  });

  // Unidad de medida
  tr.querySelector('.unit-select')?.addEventListener('change', (e) => {
    const idx = parseInt(e.target.dataset.idx, 10);
    onFieldChange?.(idx, 'unidad', e.target.value);
  });

  // Selector de marca
  tr.querySelector('.item-marca')?.addEventListener('change', (e) => {
    const idx = parseInt(e.target.dataset.idx, 10);
    const val = e.target.value ? parseInt(e.target.value, 10) : null;
    onFieldChange?.(idx, 'marca_id', val);
  });

  // Botón '+' de alta de marca
  tr.querySelector('.btn-add-brand')?.addEventListener('click', (e) => {
    const idx = parseInt(e.target.dataset.idx, 10);
    onAddBrand?.(idx);
  });

  // Botón de eliminar fila
  tr.querySelector('.btn-remove-item')?.addEventListener('click', (e) => {
    const idx = parseInt(e.target.dataset.remove, 10);
    onRemove?.(idx);
  });

  tbody.appendChild(tr);
  return tr;
}
