// =============================================================================
// public/js/views/dashboard/modules/auditView.js
// "Registros de Auditoría" tab — filterable, paginated security log viewer.
//
// Reads from GET /api/auditoria (bitacora_auditoria), populated live across
// the whole app by src/utils/auditLog.js#logEvent(). Shared by ManagerStrategy
// (Jefe) and AdminStrategy (Administracion) — both render an identical panel,
// so the entire flow lives here once instead of being duplicated per strategy.
//
// Exports:
//   mountAuditLogTab(panel) — renders the filter bar + table + pagination and
//                              wires all interactions. Self-contained.
// =============================================================================

import api                      from '../../../services/apiClient.js';
import { escHtml, fmtDateTime } from '../helpers.js';

// ---------------------------------------------------------------------------
// Acción → { icon, label, badgeClass } — human-friendly presentation for each
// AuditActions code (src/utils/auditLog.js). Kept in sync manually with the
// backend allowlist; getFilterOptions() is the source of truth for WHICH
// codes exist, this map only controls how a known code is displayed. Any
// future code not listed here still renders gracefully (falls back to the
// raw code + a neutral badge) instead of breaking.
// ---------------------------------------------------------------------------
const ACCION_META = {
  LOGIN:               { icon: '🔓', label: 'Inicio de Sesión',      badge: 'badge-audit-auth' },
  LOGOUT:              { icon: '🔒', label: 'Cierre de Sesión',      badge: 'badge-audit-auth' },
  LOGIN_FAILED:        { icon: '⚠️', label: 'Intento de Login Fallido', badge: 'badge-audit-auth-fail' },
  CREAR_COTIZACION:    { icon: '📄', label: 'Cotización Creada',     badge: 'badge-audit-create' },
  EDITAR_COTIZACION:   { icon: '✏️', label: 'Cotización Editada',    badge: 'badge-audit-edit' },
  CAMBIAR_ESTADO:      { icon: '🔄', label: 'Cambio de Estado',      badge: 'badge-audit-edit' },
  APROBAR:             { icon: '✅', label: 'Aprobación',            badge: 'badge-audit-approve' },
  RECHAZAR:            { icon: '❌', label: 'Rechazo',                badge: 'badge-audit-reject' },
  SUBIR_PDF:           { icon: '📤', label: 'PDF Subido',            badge: 'badge-audit-file' },
  DESCARGAR_PDF:       { icon: '📥', label: 'PDF Descargado',        badge: 'badge-audit-file' },
  CREAR_USUARIO:       { icon: '👤', label: 'Usuario Creado',        badge: 'badge-audit-create' },
  EDITAR_USUARIO:      { icon: '🖊️', label: 'Usuario Editado',       badge: 'badge-audit-edit' },
  DESACTIVAR_USUARIO:  { icon: '🚫', label: 'Usuario Desactivado',   badge: 'badge-audit-reject' },
  CREAR_CLIENTE:       { icon: '🏢', label: 'Cliente Creado',        badge: 'badge-audit-create' },
  EDITAR_CLIENTE:      { icon: '🖊️', label: 'Cliente Editado',       badge: 'badge-audit-edit' },
  DESACTIVAR_CLIENTE:  { icon: '🚫', label: 'Cliente Desactivado',   badge: 'badge-audit-reject' },
};

const ENTIDAD_LABELS = {
  cotizaciones: 'Cotizaciones',
  usuarios:     'Usuarios',
  clientes:     'Clientes',
  marcas:       'Marcas',
};

function accionMeta(codigo) {
  return ACCION_META[codigo] || { icon: '📌', label: codigo, badge: 'badge-borrador' };
}

function accionBadgeHtml(codigo) {
  const meta = accionMeta(codigo);
  return `<span class="badge ${meta.badge}">${meta.icon} ${escHtml(meta.label)}</span>`;
}

function resultadoBadgeHtml(resultado) {
  const cls = resultado === 'fallo' ? 'badge-resultado-fallo' : 'badge-resultado-exito';
  const label = resultado === 'fallo' ? '✗ Fallo' : '✓ Éxito';
  return `<span class="badge ${cls}">${label}</span>`;
}

// ---------------------------------------------------------------------------
// Human-readable translation for the "detalle" JSON blob attached to some
// audit events (src/utils/auditLog.js callers — see the detalle: {...} shapes
// across every controller). The Jefe/Administración viewing this panel are
// not developers, so raw JSON is a dead end for them — this renders it as a
// plain Spanish label: value list instead.
//
// Any key NOT in FIELD_LABELS still renders fine — humanizeKey() turns an
// unmapped "algun_campo_nuevo" into "Algun Campo Nuevo" instead of breaking
// or silently hiding it, so future detalle fields added to the backend never
// require a synchronized frontend change to remain readable.
// ---------------------------------------------------------------------------
const FIELD_LABELS = {
  nombre_usuario:    'Nombre de Usuario',
  id_rol:            'Rol Asignado',
  updated_fields:    'Campos Modificados',
  reason:            'Motivo',
  bloqueado_hasta:   'Bloqueado Hasta',
  attempts:          'Intentos Fallidos',
  numero_correlativo:'Cotización',
  id_cliente:        'Cliente (ID)',
  monto_total:       'Monto Total',
  item_count:        'Cantidad de Ítems',
  comentario_admin:  'Comentario del Administrador',
  razon_social:      'Razón Social',
  nit:               'NIT',
  error:             'Error',
  estado_anterior:   'Estado Anterior',
  nuevo_estado:      'Nuevo Estado',
  observacion:       'Observación',
  observaciones:     'Observación',
  aprobado:          'Aprobado',
  archivo:           'Archivo',
  size_bytes:        'Tamaño',
  pdf_size:          'Tamaño del PDF',
  excel_size:        'Tamaño del Excel',
  pdf_ruta:          'Ruta del PDF',
  excel_ruta:        'Ruta del Excel',
  source:            'Origen',
  pdf_filename:      'Nombre del PDF',
  excel_filename:    'Nombre del Excel',
  nombre:            'Nombre',
};

// Field-specific value translators — applied when both the key AND the raw
// value match a known entry; anything else falls through to generic formatting.
const VALUE_LABELS = {
  reason: {
    account_inactive: 'Cuenta inactiva',
    account_locked:   'Cuenta bloqueada temporalmente',
    wrong_password:   'Contraseña incorrecta',
  },
  source: {
    uploaded:  'Subido manualmente',
    generated: 'Generado automáticamente',
  },
  id_rol: { 1: 'Ejecutivo', 2: 'Administración', 3: 'Jefe', 4: 'SysAdmin' },
};

const BYTE_KEYS = new Set(['size_bytes', 'pdf_size', 'excel_size']);

function humanizeKey(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDetalleValue(key, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';

  if (VALUE_LABELS[key] && Object.prototype.hasOwnProperty.call(VALUE_LABELS[key], value)) {
    return VALUE_LABELS[key][value];
  }

  if (key === 'bloqueado_hasta') return fmtDateTime(value);

  if (BYTE_KEYS.has(key) && typeof value === 'number') {
    return value >= 1024 ? `${(value / 1024).toFixed(1)} KB` : `${value} bytes`;
  }

  if (Array.isArray(value)) {
    return value.map((v) => FIELD_LABELS[v] || humanizeKey(String(v))).join(', ') || '—';
  }

  if (typeof value === 'object') return JSON.stringify(value);

  return String(value);
}

// ---------------------------------------------------------------------------
// buildDetalleHtml — renders the parsed detalle object as a clean label:value
// list (NOT raw JSON). Returns '' (nothing to show) for null/empty objects so
// the caller can skip the "Ver Detalle" button entirely in that case.
// ---------------------------------------------------------------------------
function buildDetalleHtml(detalle) {
  const obj = safeParseDetalle(detalle);
  if (!obj || typeof obj !== 'object') return '';
  const entries = Object.entries(obj);
  if (entries.length === 0) return '';

  return `
    <dl style="margin:0;display:grid;grid-template-columns:max-content 1fr;gap:.4rem 1rem;">
      ${entries.map(([key, value]) => `
        <dt style="color:var(--text-secondary);font-size:.78rem;font-weight:600;white-space:nowrap;">
          ${escHtml(FIELD_LABELS[key] || humanizeKey(key))}
        </dt>
        <dd style="margin:0;font-size:.82rem;word-break:break-word;">
          ${escHtml(formatDetalleValue(key, value))}
        </dd>
      `).join('')}
    </dl>`;
}

// ---------------------------------------------------------------------------
// mountAuditLogTab
// @param {HTMLElement} panel — tab panel to render into
// ---------------------------------------------------------------------------
export async function mountAuditLogTab(panel) {
  const state = { page: 1, limit: 25 };

  // ── 1. Paint the static shell (filter bar + results container) ONCE ─────────
  panel.innerHTML = `
    <div class="card">
      <div class="card-header" style="flex-wrap:wrap;gap:.75rem;">
        <h3>🔍 Registros de Auditoría</h3>
        <span class="text-muted text-sm" id="audit-total"></span>
      </div>
      <div class="filter-bar">
        <div class="form-group">
          <label class="form-label">Acción</label>
          <select class="form-control" id="audit-accion" style="min-width:170px;">
            <option value="">Todas</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Tabla</label>
          <select class="form-control" id="audit-entidad" style="min-width:140px;">
            <option value="">Todas</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Resultado</label>
          <select class="form-control" id="audit-resultado" style="min-width:120px;">
            <option value="">Todos</option>
            <option value="exito">✓ Éxito</option>
            <option value="fallo">✗ Fallo</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Desde</label>
          <input class="form-control" type="date" id="audit-desde" />
        </div>
        <div class="form-group">
          <label class="form-label">Hasta</label>
          <input class="form-control" type="date" id="audit-hasta" />
        </div>
        <div class="form-group">
          <label class="form-label">Usuario</label>
          <input class="form-control" type="search" id="audit-usuario" placeholder="Nombre de usuario…" style="min-width:170px;" />
        </div>
        <button class="btn btn-primary btn-sm" id="audit-apply" style="align-self:flex-end;">Aplicar Filtros</button>
        <button class="btn btn-ghost btn-sm"   id="audit-clear" style="align-self:flex-end;">Limpiar</button>
      </div>
      <div id="audit-results"><div class="page-loading"><div class="spinner"></div></div></div>
      <div class="card-footer" id="audit-pagination"></div>
    </div>`;

  const $ = (sel) => panel.querySelector(sel);

  // ── 2. Populate Acción / Tabla dropdowns from GET /api/auditoria/opciones ────
  // Non-fatal: if it fails, the dropdowns just stay at "Todas" — filtering by
  // text/date/resultado still works.
  try {
    const opts = await api.get('/api/auditoria/opciones');
    const { acciones = [], entidades = [] } = opts.data ?? {};

    const accionSel = $('#audit-accion');
    for (const codigo of acciones) {
      const meta = accionMeta(codigo);
      const opt  = document.createElement('option');
      opt.value       = codigo;
      opt.textContent = `${meta.icon} ${meta.label}`;
      accionSel.appendChild(opt);
    }

    const entidadSel = $('#audit-entidad');
    for (const ent of entidades) {
      const opt  = document.createElement('option');
      opt.value       = ent;
      opt.textContent = ENTIDAD_LABELS[ent] || ent;
      entidadSel.appendChild(opt);
    }
  } catch { /* dropdowns degrade gracefully to "Todas" only */ }

  // ── 3. Fetch + render, reading the current filter state ─────────────────────
  async function load() {
    const results = $('#audit-results');
    results.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

    const params = new URLSearchParams({
      page:  String(state.page),
      limit: String(state.limit),
    });
    const accion    = $('#audit-accion').value;
    const entidad   = $('#audit-entidad').value;
    const resultado = $('#audit-resultado').value;
    const desde     = $('#audit-desde').value;
    const hasta     = $('#audit-hasta').value;
    const usuario   = $('#audit-usuario').value.trim();
    if (accion)    params.set('accion', accion);
    if (entidad)   params.set('entidad', entidad);
    if (resultado) params.set('resultado', resultado);
    if (desde)     params.set('fecha_desde', desde);
    if (hasta)     params.set('fecha_hasta', hasta);
    if (usuario)   params.set('usuario', usuario);

    try {
      const data = await api.get(`/api/auditoria?${params.toString()}`);
      const rows = data.data ?? [];
      $('#audit-total').textContent = `${data.pagination?.totalRecords ?? rows.length} evento(s)`;

      if (rows.length === 0) {
        results.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">🔍</div>
            <h4>Sin resultados</h4>
            <p>No hay eventos de auditoría que coincidan con los filtros aplicados.</p>
          </div>`;
        $('#audit-pagination').innerHTML = '';
        return;
      }

      results.innerHTML = `
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>Fecha y Hora</th><th>Usuario</th><th>Acción</th>
                <th>Tabla</th><th>Registro</th><th>Resultado</th><th>IP</th><th></th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((r) => {
                const detalleHtml = buildDetalleHtml(r.detalle);
                return `
                <tr>
                  <td class="text-sm">${fmtDateTime(r.creado_en)}</td>
                  <td>${escHtml(r.nombre_usuario ?? '—')}</td>
                  <td>${accionBadgeHtml(r.accion)}</td>
                  <td class="text-sm">${escHtml(ENTIDAD_LABELS[r.entidad] ?? r.entidad ?? '—')}</td>
                  <td class="text-sm">${r.id_entidad ?? '—'}</td>
                  <td>${resultadoBadgeHtml(r.resultado)}</td>
                  <td class="text-muted text-xs" style="font-family:monospace;">${escHtml(r.ip_origen ?? '—')}</td>
                  <td>${detalleHtml
                    ? `<button class="btn btn-ghost btn-sm" data-audit-detail="${r.id}">🔎 Detalle</button>`
                    : ''}</td>
                </tr>
                ${detalleHtml ? `
                <tr class="audit-detail-row" id="audit-detail-${r.id}" style="display:none;">
                  <td colspan="8" style="background:var(--bg-raised);padding:.85rem 1rem;">
                    ${detalleHtml}
                  </td>
                </tr>` : ''}`;
              }).join('')}
            </tbody>
          </table>
        </div>`;

      results.querySelectorAll('[data-audit-detail]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const row = $(`#audit-detail-${btn.dataset.auditDetail}`);
          if (!row) return;
          const opening = row.style.display === 'none';
          row.style.display = opening ? '' : 'none';
          btn.textContent = opening ? '🔼 Ocultar' : '🔎 Detalle';
        });
      });

      renderPagination(data.pagination?.totalPages ?? 1);
    } catch (err) {
      results.innerHTML = `<div class="empty-state"><p>Error: ${escHtml(err.data?.message || err.message)}</p></div>`;
      $('#audit-pagination').innerHTML = '';
    }
  }

  function renderPagination(totalPages) {
    const foot = $('#audit-pagination');
    if (totalPages <= 1) { foot.innerHTML = ''; return; }
    foot.innerHTML = `
      <button class="btn btn-ghost btn-sm" id="audit-prev" ${state.page <= 1 ? 'disabled' : ''}>‹ Anterior</button>
      <span class="text-sm" style="margin:0 .75rem;">Página ${state.page} de ${totalPages}</span>
      <button class="btn btn-ghost btn-sm" id="audit-next" ${state.page >= totalPages ? 'disabled' : ''}>Siguiente ›</button>`;
    $('#audit-prev')?.addEventListener('click', () => { if (state.page > 1)          { state.page--; load(); } });
    $('#audit-next')?.addEventListener('click', () => { if (state.page < totalPages) { state.page++; load(); } });
  }

  // ── 4. Wire filters ─────────────────────────────────────────────────────────
  // Dropdowns fire on 'change'; text + dates apply via button or Enter.
  // Every entry point resets to page 1 so the user never lands on a now-empty page.
  $('#audit-accion').addEventListener('change',    () => { state.page = 1; load(); });
  $('#audit-entidad').addEventListener('change',   () => { state.page = 1; load(); });
  $('#audit-resultado').addEventListener('change', () => { state.page = 1; load(); });
  $('#audit-apply').addEventListener('click',      () => { state.page = 1; load(); });
  $('#audit-usuario').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { state.page = 1; load(); }
  });
  $('#audit-clear').addEventListener('click', () => {
    $('#audit-accion').value    = '';
    $('#audit-entidad').value   = '';
    $('#audit-resultado').value = '';
    $('#audit-desde').value     = '';
    $('#audit-hasta').value     = '';
    $('#audit-usuario').value   = '';
    state.page = 1;
    load();
  });

  // ── 5. Initial load ─────────────────────────────────────────────────────────
  await load();
}

// ---------------------------------------------------------------------------
// safeParseDetalle — mysql2 returns JSON columns already parsed as objects,
// but this guards against a stringified value slipping through (e.g. a
// legacy row or a driver config change) so the detail panel never crashes.
// ---------------------------------------------------------------------------
function safeParseDetalle(detalle) {
  if (typeof detalle !== 'string') return detalle;
  try { return JSON.parse(detalle); } catch { return detalle; }
}
