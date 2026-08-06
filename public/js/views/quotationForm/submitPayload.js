// =============================================================================
// public/js/views/quotationForm/submitPayload.js
// Validación previa, armado del payload y envío del formulario.
//
// Lógica PURA separada del cableado:
//   validateHeaderFields — reglas de la cabecera (cliente, descripción, fechas)
//   findInvalidDetalle   — primera fila con problemas (espeja la regla del backend)
//   buildDetalles        — filas → array `detalles` del request
//   collectFormaPago     — preset elegido, texto libre de "Otro", o null
//   buildRequestBody     — lee la cabecera del DOM y arma el body completo
//   submitQuotation      — POST/PUT, subida del Excel y manejo de errores
//
// Extraído de FormMediator._handleSubmit / _collectFormaPago sin cambios de
// comportamiento. Cubierto por tests/unit/quotationFormSubmit.test.js.
// =============================================================================

import api, { showToast } from '../../services/apiClient.js';
import { sumSubtotals, clampDiscount, validateDetalle } from '../../shared/quotationTotals.js';
import { mapFieldErrors } from '../../shared/quotationFieldErrors.js';

/** Entidad emisora por defecto — espeja el DEFAULT de cotizaciones.entidad_emisora. */
export const DEFAULT_ENTIDAD_EMISORA = 'Empresa unipersonal de Ronald Roca Cartagena';

/**
 * Valida la cabecera. Función pura.
 * @returns {{ errorId: string, message: string, focusId?: string }|null}
 */
export function validateHeaderFields({ id_cliente, descripcion, fecha_emision, fecha_validez }) {
  if (!id_cliente || id_cliente < 1) {
    return {
      errorId: 'err-cliente',
      message: 'Selecciona un cliente de la lista.',
      focusId: 'cliente-search',
    };
  }
  if (!descripcion) {
    return { errorId: 'err-descripcion', message: 'La descripción es requerida.' };
  }
  if (!fecha_emision) {
    return { errorId: 'err-fecha', message: 'La fecha de emisión es requerida.' };
  }
  if (fecha_validez && fecha_validez < fecha_emision) {
    return {
      errorId: 'err-validez',
      message: 'La fecha de validez debe ser igual o posterior a la fecha de emisión.',
    };
  }
  return null;
}

/**
 * Primera fila enviable con problemas. Función pura.
 *
 * Sólo se envían las filas que tienen descripción; cada una debe cumplir
 * cantidad > 0 y precio_unitario >= 0. Mostrarlo acá da feedback inmediato en
 * lugar de un 422 tardío del servidor.
 *
 * @returns {string|null} — mensaje listo para mostrar, o null si está todo bien.
 */
export function findInvalidDetalle(items) {
  const submittableRows = items.filter(i => i.descripcion_item?.trim());
  for (const row of submittableRows) {
    const problems = validateDetalle(row);
    if (problems.length > 0) {
      return `Revisá el ítem "${row.descripcion_item.trim()}": ` +
        problems.map(p => p.message).join(' ');
    }
  }
  return null;
}

/**
 * Filas → array `detalles` del request. Función pura.
 * Descarta las filas sin descripción y normaliza los vacíos a null.
 */
export function buildDetalles(items) {
  return items.filter(i => i.descripcion_item?.trim()).map(i => ({
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
}

/**
 * Valor de forma_pago para el payload: el preset elegido, el texto libre
 * recortado cuando se eligió 'Otro', o null (→ el PDF usa el default
 * '60% ANTICIPO Y SALDO CONTRA ENTREGA').
 */
export function collectFormaPago(container) {
  const sel = container.querySelector('#forma_pago')?.value ?? '';
  if (sel === '__otro__') {
    return container.querySelector('#forma_pago_custom')?.value.trim() || null;
  }
  return sel || null;
}

/** Lee la cabecera del DOM y arma el body completo del request. */
export function buildRequestBody(container, { id_cliente, descripcion, fecha_emision, fecha_validez, subtotal, descuento_manual, detalles }) {
  const val = (sel) => container.querySelector(sel)?.value.trim() || null;

  return {
    id_cliente,
    descripcion,
    fecha_emision,
    moneda:                   container.querySelector('#moneda')?.value          || 'BOB',
    entidad_emisora:          container.querySelector('#entidad_emisora')?.value || DEFAULT_ENTIDAD_EMISORA,
    tipo_pedido:              val('#tipo_pedido'),
    fecha_validez:            fecha_validez || null,
    observaciones:            val('#observaciones'),
    tiempo_entrega:           val('#tiempo_entrega'),
    monto_total:              subtotal > 0 ? subtotal : null,
    descuento_manual,
    forma_pago:               collectFormaPago(container),
    mostrar_codigos:          container.querySelector('#mostrar_codigos')?.checked ?? true,
    // Solicitante block
    solicitante_nombre:       val('#solicitante_nombre'),
    solicitante_no_solicitud: val('#solicitante_no_solicitud'),
    solicitante_area:         val('#solicitante_area'),
    solicitante_celular:      val('#solicitante_celular'),
    solicitante_correo:       val('#solicitante_correo'),
    // Equipo block
    equipo_marca:             val('#equipo_marca'),
    equipo_tipo:              val('#equipo_tipo'),
    equipo_modelo:            val('#equipo_modelo'),
    equipo_serie:             val('#equipo_serie'),
    equipo_motor:             val('#equipo_motor'),
    // Licitación paraguas asociada (opcional). '' → null (cotización suelta).
    id_licitacion:            (() => {
      const v = container.querySelector('#id_licitacion')?.value;
      return v ? parseInt(v, 10) : null;
    })(),
    detalles,
  };
}

/**
 * Valida, arma y envía la cotización.
 *
 * @param {Object} deps
 *   container      {HTMLElement}
 *   editId         {number|null} — id cuando se edita; null al crear
 *   items          {Array}       — snapshot del Subject
 *   uploadedExcel  {File|null}
 *   onSuccess      {Function}    — (quotation) tras guardar
 *   onSaved        {Function}    — se llama apenas el registro quedó guardado
 *                                  (libera la reserva del correlativo)
 */
export async function submitQuotation({ container, editId, items, uploadedExcel, onSuccess, onSaved } = {}) {
  const alert     = container.querySelector('#qf-alert');
  const btnSubmit = container.querySelector('#btn-submit');

  // --- Client-side validation ---
  const id_cliente    = parseInt(container.querySelector('#id_cliente')?.value, 10);
  const descripcion   = container.querySelector('#descripcion')?.value.trim();
  const fecha_emision = container.querySelector('#fecha_emision')?.value;
  const fecha_validez = container.querySelector('#fecha_validez')?.value || null;

  // Clear previous inline errors
  ['#err-cliente', '#err-descripcion', '#err-fecha', '#err-validez'].forEach(sel => {
    const el = container.querySelector(sel);
    if (el) el.textContent = '';
  });

  const headerError = validateHeaderFields({ id_cliente, descripcion, fecha_emision, fecha_validez });
  if (headerError) {
    const errEl = container.querySelector(`#${headerError.errorId}`);
    if (errEl) errEl.textContent = headerError.message;
    if (headerError.focusId) container.querySelector(`#${headerError.focusId}`)?.focus();
    return;
  }

  // Compute monto_total from items (round-per-line, shared with the backend)
  const subtotal         = sumSubtotals(items);
  const clampedDiscount  = clampDiscount(container.querySelector('#totals-discount')?.value);
  const descuento_manual = clampedDiscount > 0 ? clampedDiscount : null;

  const detalleError = findInvalidDetalle(items);
  if (detalleError) {
    alert.textContent = detalleError;
    alert.className   = 'form-alert show alert-error';
    return;
  }

  const detalles = buildDetalles(items);

  // Client-side guard: require at least one line item with a description
  if (detalles.length === 0) {
    alert.textContent = 'La cotización debe tener al menos un ítem con descripción.';
    alert.className   = 'form-alert show alert-error';
    container.querySelector('#items-body')?.querySelector('.item-input')?.focus();
    return;
  }

  const body = buildRequestBody(container, {
    id_cliente, descripcion, fecha_emision, fecha_validez,
    subtotal, descuento_manual, detalles,
  });

  // Disable button / show spinner
  btnSubmit.disabled = true;
  const label   = btnSubmit.querySelector('.btn-label');
  const spinner = btnSubmit.querySelector('.btn-spinner');
  const originalLabel = editId ? 'Guardar cambios' : 'Crear cotización';
  if (label)   label.textContent = editId ? 'Guardando...' : 'Creando...';
  if (spinner) spinner.classList.remove('hidden');
  alert.className = 'form-alert';

  try {
    // Step 1 — Create OR update the quotation record
    const response = editId
      ? await api.put(`/api/cotizaciones/${editId}`, body)
      : await api.post('/api/cotizaciones', body);
    const quotation = response.data;

    // Release our draft-lock reservation immediately on success — the number is
    // now officially registered, so the "in progress" warning must clear for
    // every other connected executive right away.
    onSaved?.();

    // Step 2 — Upload Excel if one was attached
    if (uploadedExcel && quotation?.id) {
      const formData = new FormData();
      formData.append('excel', uploadedExcel);
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
    if (label)   label.textContent = originalLabel;
    if (spinner) spinner.classList.add('hidden');

    // Surface server-side Zod field errors. mapFieldErrors routes header-field
    // errors to their inline span and everything else (line-item / nested paths
    // like `detalles.0.cantidad`) to `general` — so we never build an invalid
    // CSS selector (which used to throw here and swallow the message).
    const { perField, general } = mapFieldErrors(err.data?.errors);
    for (const { id, message } of perField) {
      const errEl = container.querySelector(`#${id}`);
      if (errEl) errEl.textContent = message;
    }

    const msg = general.length > 0
      ? general.join(' ')
      : (err.data?.message || err.message || 'Error al crear la cotización.');
    alert.textContent = msg;
    alert.className   = 'form-alert show alert-error';
  }
}
