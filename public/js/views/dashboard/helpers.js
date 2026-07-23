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
  'Pendiente':             '#F59E0B',
  'En revision':           '#F97316',
  'En espera':             '#6366F1',
  'Aprobada internamente': '#10B981',
  'Enviada al cliente':    '#3B82F6',
  'Confirmada':            '#8B5CF6',
  'Aceptada':              '#8B5CF6',
  'Rechazada':             '#EF4444',
};

export function badgeHtml(estado) {
  const cls = STATE_BADGE[estado] ?? 'badge-borrador';
  return `<span class="badge ${cls}">${estado}</span>`;
}

export function roleBadgeHtml(rol) {
  const cls = ROLE_BADGE[rol] ?? '';
  return `<span class="badge ${cls}">${rol}</span>`;
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
export function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fmtAmount(n, currency = 'USD') {
  if (n == null) return '—';
  return `${currency} ${Number(n).toFixed(2)}`;
}
