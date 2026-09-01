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

// ---------------------------------------------------------------------------
// Las unidades de medida que ofrece el desplegable de cada ítem.
//
// Lista pedida por la empresa el 2026-09-01. Antes eran cuatro (PZA, GGO, KIT,
// UND) y dos de ellas CAMBIARON de código: los juegos pasaron de `GGO` a
// `JGOS`, y la unidad de `UND` a `UNI`.
//
// POR QUÉ EL CÓDIGO VIEJO NO DESAPARECE DEL TODO — ver unidadesParaFila()
// Las cotizaciones ya guardadas tienen `GGO` y `UND` escritos en la base (la
// columna es VARCHAR libre, no un ENUM, así que siguen ahí tal cual). Si el
// desplegable dejara de ofrecer esos valores, al abrir una cotización vieja
// para editarla el navegador no encontraría cuál marcar, mostraría la primera
// opción de la lista, y al guardar le cambiaría la unidad SIN que nadie lo
// pida. Es el mismo patrón del bug recurrente de este proyecto: una edición
// parcial que pisa un campo que nadie tocó.
// ---------------------------------------------------------------------------
export const UNIDADES_DE_MEDIDA = [
  ['JGOS', 'JUEGOS'],
  ['PZA',  'PIEZAS'],
  ['KIT',  'KITS'],
  ['LTS',  'LITRO'],
  ['KG',   'KILO'],
  ['UNI',  'UNIDAD'],
  ['MTS',  'METROS'],
];

/** La unidad por defecto de una fila nueva. */
export const UNIDAD_POR_DEFECTO = 'UNI';

/**
 * Las opciones del desplegable para UNA fila, contemplando su valor guardado.
 *
 * Si la fila trae una unidad que ya no está en la lista (una cotización vieja
 * con `GGO` o `UND`, o algo cargado desde Excel), se agrega al final como
 * opción propia y marcada. Así el valor se conserva al editar, y la persona ve
 * que ese ítem tiene una unidad de las de antes — en vez de que se le cambie
 * sola por la primera de la lista.
 *
 * @param {string} valorActual — la unidad guardada de esa fila
 * @returns {string} el HTML de los <option>
 */
export function unidadesParaFila(valorActual) {
  const opciones = UNIDADES_DE_MEDIDA.map(([codigo, nombre]) =>
    `<option value="${codigo}"${valorActual === codigo ? ' selected' : ''}>${codigo} (${nombre})</option>`
  );

  const esConocida = UNIDADES_DE_MEDIDA.some(([codigo]) => codigo === valorActual);
  if (valorActual && !esConocida) {
    opciones.push(
      `<option value="${safeAttr(valorActual)}" selected>${escText(valorActual)} (unidad anterior)</option>`
    );
  }

  return opciones.join('\n      ');
}

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
  const safeUnidadVal = itemData?.unidad ?? UNIDAD_POR_DEFECTO;
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
    <input class="item-input item-codigo item-full" type="text" data-field="codigo" data-idx="${index}"
           value="${safeCod}" placeholder="Ej: 7E-6116" maxlength="50"
          
           title="Código de Parte del fabricante. Si ya existe en otra fila, las cantidades se suman automáticamente." />
  </td>
  <td>
    <input class="item-input item-full" type="text" data-field="codigo_alternativo" data-idx="${index}"
           value="${safeCodAlt}" placeholder="Ej: P553191" maxlength="100"
          
           title="Código alternativo o código cruzado del fabricante." />
  </td>
  <td class="item-marca-cell">
    <div class="item-marca-grupo">
      <select class="form-control item-marca" data-field="marca_id" data-idx="${index}"
             >
        <option value="">— Sin marca —</option>
        ${brandOptions}
      </select>
      <button type="button" class="btn-add-brand btn-add-inline btn-add-inline-sm" data-idx="${index}"
              title="Registrar nueva marca">
        +
      </button>
    </div>
  </td>
  <td>
    <select class="form-control unit-select item-unidad" name="detalles[][unidad]" data-field="unidad" data-idx="${index}"
           >
      ${unidadesParaFila(safeUnidadVal)}
    </select>
  </td>
  <td>
    <input class="item-input item-cant" type="number" data-field="cantidad" data-idx="${index}"
           value="${safeCant}" min="0.0001" step="any" />
  </td>
  <td>
    <input class="item-input item-precio" type="number" data-field="precio_unitario" data-idx="${index}"
           value="${safePrice}" min="0" step="any" />
  </td>
  <td class="item-subtotal" data-item-subtotal="${index}">0.00</td>
  <td>
    <input class="item-input item-full" type="text" data-field="tiempo_entrega" data-idx="${index}"
           value="${safeTEnt}" placeholder="Ej: 15 días" maxlength="100"
           />
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
/**
 * La marca de una fila, o null cuando todavía no se eligió.
 *
 * El `<select>` sin elegir devuelve la cadena vacía, no null, y una fila recién
 * creada puede no tener la propiedad. Los tres casos significan lo mismo —
 * «marca desconocida»— y tienen que compararse igual.
 */
const marcaDe = (item) => {
  const v = item?.marca_id;
  return (v === '' || v === undefined || v === null) ? null : v;
};

export function findDuplicateRow(items, currentIdx, rawCodigo) {
  const normalised = String(rawCodigo ?? '').trim().toUpperCase();
  if (!normalised) return null;              // en blanco — nada que fusionar

  const currentMarca = marcaDe(items[currentIdx]);

  // ── SIN MARCA NO SE FUSIONA. NUNCA. ─────────────────────────────────────
  // Antes se fusionaba: `null === null` se tomaba como «las dos sin marca, así
  // que son la misma pieza». Eso borraba filas.
  //
  // El motivo es de MOMENTO, no de comparación. Esta función se dispara al
  // SALIR del campo Código, y el orden natural de carga es descripción →
  // código → marca. Cuando el usuario sale del código de la segunda fila
  // todavía no bajó a elegir su marca: las dos valen null, la clave compuesta
  // las ve idénticas, y la fila desaparece junto con la marca que estaba por
  // elegir. El aviso decía «ya existe con la misma marca», que era falso —
  // ninguna de las dos tenía marca.
  //
  // Y en repuestos de maquinaria pesada el MISMO número de parte pertenece a
  // marcas distintas: CAT y CUMMINS comparten numeración. Fusionarlas no es un
  // detalle de pantalla, es cotizar una pieza que el cliente no pidió.
  //
  // La asimetría del costo decide:
  //   • no fusionar dos filas que sí eran duplicadas → se ven dos renglones y
  //     se juntan a mano; molesta y se nota.
  //   • fusionar dos que iban a tener marcas distintas → se BORRA una fila y
  //     el dato se pierde, casi siempre sin que nadie lo note.
  //
  // Una marca vacía no es «sin marca»: es «todavía no la eligió». Adivinar
  // sobre una clave incompleta destruye datos.
  if (currentMarca === null) return null;

  const dupeIdx = items.findIndex((item, i) =>
    i !== currentIdx &&
    String(item.codigo || '').trim().toUpperCase() === normalised &&
    // La otra fila también tiene que tener marca conocida, y ser la misma.
    marcaDe(item) !== null &&
    marcaDe(item) === currentMarca
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
