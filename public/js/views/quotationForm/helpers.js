// =============================================================================
// public/js/views/quotationForm/helpers.js
// Utilidades puras del formulario de cotización.
//
// Extraído de quotationForm.js sin cambios de comportamiento: son las tres
// funciones sin estado ni DOM que usaban el Mediator y sus componentes.
// =============================================================================

/** Formatea un número como monto (2 decimales, sin símbolo de moneda). */
export function fmt(n) {
  return isNaN(n) ? '0.00' : Number(n).toFixed(2);
}

/** Escapa entidades HTML antes de interpolar un valor como texto en innerHTML.
 *  Previene XSS almacenado al renderizar strings controlados por el usuario
 *  (OWASP A03). */
export function escText(v) {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// nextCorrelativoOf — "SC-2026/000123" → "SC-2026/000124".
//
// Sirve sólo para mostrarle a un segundo ejecutivo una vista previa APROXIMADA
// mientras otro tiene reservado el borrador. Deliberadamente no es autoritativo:
// el serial real lo asigna generateCorrelativo con SELECT…FOR UPDATE al guardar,
// así que este valor es informativo.
//
// Devuelve null cuando el serial no termina en dígitos, para que quien llama
// pueda mostrar un fallback en vez de un número corrupto.
// ---------------------------------------------------------------------------
export function nextCorrelativoOf(numero) {
  const m = /^(.*?)(\d+)$/.exec(String(numero ?? '').trim());
  if (!m) return null;
  const [, prefix, digits] = m;
  return prefix + String(Number(digits) + 1).padStart(digits.length, '0');
}
