// =============================================================================
// public/js/shared/quotationFieldErrors.js
// Maps backend/Zod validation errors to the quotation form's inline error spans.
//
// Only header fields have a dedicated `#err-*` span. A nested line-item path
// like `detalles.0.cantidad` has none — and, critically, it is NOT a valid CSS
// id selector, so doing `querySelector('#err-' + field)` on it THREW and aborted
// the whole submit error handler (bug 3.1). These helpers resolve only known
// header fields to a selector-safe id and route everything else to the general
// alert, so an invalid selector can never be built.
// =============================================================================

// Backend field name → the form's inline error-span element id.
const HEADER_FIELD_TO_SPAN = {
  id_cliente:    'err-cliente',
  cliente:       'err-cliente',
  descripcion:   'err-descripcion',
  fecha_emision: 'err-fecha',
  fecha_validez: 'err-validez',
};

/**
 * Resolve a backend error `field` to the id of its inline error span, or null
 * when there is no dedicated span (line-item / nested / unknown paths). The
 * returned id is always a valid CSS id selector.
 * @param {*} field
 * @returns {string|null}
 */
export function headerErrorElementId(field) {
  if (field == null) return null;
  return HEADER_FIELD_TO_SPAN[String(field)] ?? null;
}

/**
 * Partition a backend errors array into:
 *   • perField — { id, message } for errors that map to a header span
 *   • general  — messages with no dedicated span (line-item / unknown), which
 *                the caller shows in the general form alert so they are never
 *                silently swallowed.
 * Tolerant of non-array / malformed input; never throws.
 * @param {Array<{field?:string, message?:string}>} fieldErrors
 * @returns {{ perField: Array<{id:string, message:string}>, general: string[] }}
 */
export function mapFieldErrors(fieldErrors) {
  const perField = [];
  const general  = [];
  const list = Array.isArray(fieldErrors) ? fieldErrors : [];

  for (const fe of list) {
    const id = headerErrorElementId(fe?.field);
    if (id && fe?.message) {
      perField.push({ id, message: fe.message });
    } else if (fe?.message) {
      general.push(fe.message);
    }
  }

  return { perField, general };
}
