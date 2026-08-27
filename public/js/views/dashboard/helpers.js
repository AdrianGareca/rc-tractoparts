// =============================================================================
// public/js/views/dashboard/helpers.js
// Shared constants and pure utility functions used across all dashboard modules.
//
// Centralised here so every sub-module (reportesView, notificationsView,
// timelineView) and the root dashboardView.js import from a single source
// of truth, eliminating copy-paste drift.
// =============================================================================

export const STATE_BADGE = {
  'Borrador':              'badge-borrador',
  'Pendiente':             'badge-pendiente',
  'En revision':           'badge-en-revision',
  'En espera':             'badge-en-espera',
  'Aprobada internamente': 'badge-aprobada',
  'Enviada al cliente':    'badge-enviada',
  'Confirmada':            'badge-confirmada',
  'Aceptada':              'badge-confirmada',
  'Rechazada':             'badge-rechazada',
  'Archivada':             'badge-archivada',
};

export const ROLE_BADGE = {
  'Jefe':           'badge-role-jefe',
  'Ejecutivo':      'badge-role-ejecutivo',
  'Administracion': 'badge-role-admin',
  'SysAdmin':       'badge-role-sysadmin',
  'Proyectos':      'badge-role-proyectos',
};

// Licitación lifecycle states → CSS badge class (see styles.css .badge-lic-*).
export const LICITACION_STATE_BADGE = {
  'En preparacion': 'badge-lic-preparacion',
  'Cotizando':      'badge-lic-cotizando',
  'En evaluacion':  'badge-lic-evaluacion',
  'Presentada':     'badge-lic-presentada',
  'Adjudicada':     'badge-lic-adjudicada',
  'No adjudicada':  'badge-lic-noadjudicada',
  'Archivada':      'badge-lic-archivada',
};

export function licitacionBadgeHtml(estado) {
  const cls = LICITACION_STATE_BADGE[estado] ?? 'badge-lic-preparacion';
  return `<span class="badge ${cls}">${escHtml(estado)}</span>`;
}

export const STAT_COLOR = {
  'Pendiente':             'var(--clr-amber)',
  'En revision':           'var(--clr-orange)',
  'En espera':             'var(--clr-indigo)',
  'Aprobada internamente': 'var(--clr-green)',
  'Enviada al cliente':    'var(--clr-blue)',
  'Confirmada':            'var(--clr-violet)',
  'Aceptada':              'var(--clr-violet)',
  'Rechazada':             'var(--clr-red)',
};

export function badgeHtml(estado) {
  const cls = STATE_BADGE[estado] ?? 'badge-borrador';
  return `<span class="badge ${cls}">${escHtml(estado)}</span>`;
}

// Seguimiento comercial (estado_venta) — pipeline de venta con el cliente,
// independiente del estado de aprobación de arriba. Debe reflejar EXACTAMENTE
// SALES_FOLLOWUP_STATES en proformaActions.js / src/validators/quotationValidator.js
// (mismo criterio que rolesUnaSolaLista.test.js: un desvío entre listas se
// nota recién cuando alguien elige la opción que falta).
export const SEGUIMIENTO_VENTA_BADGE = {
  'Interesado':       'badge-seg-interesado',
  'En negociacion':   'badge-seg-negociacion',
  'Confirmado':       'badge-seg-confirmado',
  'No le interesa':   'badge-seg-no-interesa',
  'Venta concretada': 'badge-seg-concretada',
  'Otro':             'badge-seg-otro',
};

/**
 * Badge del seguimiento comercial para una fila de cotización, o '—' si nunca
 * se registró uno. Antes esta columna (en "Todas las cotizaciones") usaba
 * badgeHtml() a secas — la función pensada para el estado de APROBACIÓN
 * ('Pendiente', 'Confirmada'...), que no reconoce ninguno de estos valores y
 * los pintaba a todos con el gris genérico de "badge-borrador", sin importar
 * el estado real.
 *
 * @param   {{estado_venta:string|null, estado_venta_detalle:string|null}} q
 * @returns {string}
 */
export function seguimientoVentaBadgeHtml(q) {
  if (!q.estado_venta) return '<span class="text-muted">—</span>';
  const cls      = SEGUIMIENTO_VENTA_BADGE[q.estado_venta] ?? 'badge-seg-otro';
  const etiqueta = q.estado_venta === 'Otro' ? (q.estado_venta_detalle || 'Otro') : q.estado_venta;
  // badge-truncado (components.css): el detalle libre de "Otro" lo escribe
  // el vendedor a mano y no tiene límite real de largo — sin recortarlo,
  // una frase larga ensanchaba TODA la columna "Seguim." de la tabla (no
  // sólo esa fila: una celda ancha estira la columna entera), y las demás
  // filas quedaban con un hueco enorme para no perder la alineación. El
  // texto completo sigue disponible en title= al pasar el mouse por
  // encima. Encontrado por Adrián el 2026-08-27 mirando la pantalla real.
  return `<span class="badge ${cls} badge-truncado" title="${escHtml(etiqueta)}">${escHtml(etiqueta)}</span>`;
}

export function roleBadgeHtml(rol) {
  const cls = ROLE_BADGE[rol] ?? '';
  return `<span class="badge ${cls}">${escHtml(rol)}</span>`;
}

export function fmtDate(iso) {
  if (!iso) return '—';
  return iso.slice(0, 10);
}

/**
 * fmtDateTime — "DD/MM/YYYY HH:mm" in the viewer's local timezone.
 * Unlike fmtDate (date-only, string-sliced), this parses the value as a real
 * Date so the displayed time reflects the browser's local timezone rather
 * than the raw UTC string the API returns — important for audit trails where
 * the exact minute of an event matters (e.g. LOGIN/LOGOUT timestamps).
 */
export function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()} ${hh}:${mi}`;
}

/**
 * escHtml — HTML-entity-encode a value before interpolating into innerHTML.
 * Prevents stored-XSS when rendering user-controlled strings (OWASP A03).
 * @param   {any} str  - Value to encode (null/undefined become empty string)
 * @returns {string}
 */
// escHtml es el nombre histórico del escapador en el dashboard. La
// implementación vive en shared/escapeHtml.js: había una copia idéntica en
// quotationForm/helpers.js (escText) y duplicar código de seguridad significa
// que un refuerzo futuro sólo llegaría a una de las dos.
// Se importa con alias (y no un re-export directo) porque este mismo archivo lo
// usa en badgeHtml / roleBadgeHtml.
import { escapeHtml as escHtml } from '../../shared/escapeHtml.js';
export { escHtml };

export function fmtAmount(n, currency = 'USD') {
  if (n == null) return '—';
  return `${currency} ${Number(n).toFixed(2)}`;
}

// El dibujo por tipo de archivo vive en shared/icons.js, junto al resto del
// lenguaje visual: era un mapa de emoji acá y quedaba fuera de la paleta.
// Se reexporta con el nombre que ya usaban licitacionModal.js (selector de
// subida) y detailModal.js (lista de adjuntos), para no tocar sus importaciones.
export { fileIcon as docIcon } from '../../shared/icons.js';

export function fmtFileSize(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
