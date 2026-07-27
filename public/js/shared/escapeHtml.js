// =============================================================================
// public/js/shared/escapeHtml.js
// Escapado de HTML — ÚNICA implementación del frontend.
//
// Existían dos copias byte-a-byte idénticas (dashboard/helpers.js → escHtml y
// quotationForm/helpers.js → escText). Duplicar código de seguridad es peor que
// duplicar cualquier otro: el día que alguien refuerce una de las dos, la otra
// queda vulnerable y nadie se entera hasta que aparece el agujero.
//
// Ambos nombres siguen existiendo como re-export en sus módulos, así que ningún
// call site cambió.
//
// Cubierto por tests/unit/escapeHtml.test.js.
// =============================================================================

/**
 * Convierte a entidades los cinco caracteres que pueden romper el contexto HTML.
 * Sirve tanto para texto entre etiquetas como para valores dentro de un
 * atributo entre comillas (por eso escapa " y ').
 *
 * @param   {*} value — cualquier cosa; null/undefined dan string vacío
 * @returns {string}
 */
export function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')   // SIEMPRE primero: si no, se re-escapan los & que
    .replace(/</g, '&lt;')    // introducen los reemplazos siguientes.
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
