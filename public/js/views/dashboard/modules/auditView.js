// =============================================================================
// public/js/views/dashboard/modules/auditView.js
// "Registros de auditoría" tab — filterable, paginated security log viewer.
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
// Los roles salen de la lista compartida y no de un objeto escrito a mano: el
// que había se quedó en el id 4 y no conocía a Proyectos, así que la bitácora
// mostraba un «5» pelado justo en el registro de quién cambió un permiso.
import { nombreDeRol } from '../../../shared/roles.js';
import { tableSkeleton } from '../../../shared/skeleton.js';
import { ETIQUETAS_FECHA } from '../../../shared/pagination.js';
import { createListSection } from '../../../shared/listSection.js';

// ---------------------------------------------------------------------------
// Acción → { label, badgeClass } — human-friendly presentation for each
// AuditActions code (src/utils/auditLog.js). Kept in sync manually with the
// backend allowlist; getFilterOptions() is the source of truth for WHICH
// codes exist, this map only controls how a known code is displayed. Any
// future code not listed here still renders gracefully (falls back to the
// raw code + a neutral badge) instead of breaking.
//
// CADA ENTRADA TENÍA TAMBIÉN UN `icon` CON UN EMOJI, Y SE SACÓ
// La insignia ya lleva color propio por tipo de acción (alta en verde, rechazo
// en rojo, autenticación en azul) y el rótulo en palabras. El emoji repetía por
// tercera vez lo mismo, ensanchaba la insignia en una tabla que ya es densa, y
// en el <select> de filtros metía un dibujo dentro de una lista desplegable.
// Tres códigos distintos compartían el mismo 🖊️, así que como señal tampoco
// distinguía nada.
// ---------------------------------------------------------------------------
const ACCION_META = {
  LOGIN:               { label: 'Inicio de Sesión',          badge: 'badge-audit-auth' },
  LOGOUT:              { label: 'Cierre de Sesión',          badge: 'badge-audit-auth' },
  LOGIN_FAILED:        { label: 'Intento de Login Fallido',  badge: 'badge-audit-auth-fail' },
  CREAR_COTIZACION:    { label: 'Cotización Creada',         badge: 'badge-audit-create' },
  EDITAR_COTIZACION:   { label: 'Cotización Editada',        badge: 'badge-audit-edit' },
  CAMBIAR_ESTADO:      { label: 'Cambio de Estado',          badge: 'badge-audit-edit' },
  APROBAR:             { label: 'Aprobación',                badge: 'badge-audit-approve' },
  RECHAZAR:            { label: 'Rechazo',                   badge: 'badge-audit-reject' },
  SUBIR_PDF:           { label: 'PDF Subido',                badge: 'badge-audit-file' },
  DESCARGAR_PDF:       { label: 'PDF Descargado',            badge: 'badge-audit-file' },
  CREAR_USUARIO:       { label: 'Usuario Creado',            badge: 'badge-audit-create' },
  EDITAR_USUARIO:      { label: 'Usuario Editado',           badge: 'badge-audit-edit' },
  DESACTIVAR_USUARIO:  { label: 'Usuario Desactivado',       badge: 'badge-audit-reject' },
  CREAR_CLIENTE:       { label: 'Cliente Creado',            badge: 'badge-audit-create' },
  EDITAR_CLIENTE:      { label: 'Cliente Editado',           badge: 'badge-audit-edit' },
  DESACTIVAR_CLIENTE:  { label: 'Cliente Desactivado',       badge: 'badge-audit-reject' },

  // ── Las trece que faltaban ────────────────────────────────────────────────
  // Este mapa se quedó en las acciones que existían cuando se escribió el
  // panel. Todo lo que vino después —la reapertura de ventas, los catálogos,
  // los reportes y el módulo entero de licitaciones— se registraba igual, pero
  // se mostraba con el código crudo: «SUBIR_DOCUMENTO_LICITACION», en mayúsculas
  // y con guiones bajos, en una pantalla que lee el Jefe. No rompía nada
  // —accionMeta() cae con elegancia al código— pero es el código fuente
  // asomándose al producto.
  //
  // Mismo origen que el mapa de roles: una tabla escrita a mano que nadie
  // actualizó cuando el sistema creció. Ahora lo vigila
  // tests/unit/accionesDeBitacora.test.js, que exige un rótulo por cada acción.
  REABRIR_COTIZACION:  { label: 'Venta Reabierta',           badge: 'badge-audit-edit' },
  CREAR_MARCA:         { label: 'Marca Creada',              badge: 'badge-audit-create' },
  CREAR_ORIGEN_CLIENTE:{ label: 'Origen de Cliente Creado',  badge: 'badge-audit-create' },
  GENERAR_REPORTE_PDF: { label: 'Reporte Generado',          badge: 'badge-audit-file' },
  ACTUALIZAR_COMENTARIO_ADMIN: { label: 'Comentario Administrativo Editado', badge: 'badge-audit-edit' },
  ACTUALIZAR_SEGUIMIENTO_VENTA: { label: 'Seguimiento Comercial Actualizado', badge: 'badge-audit-edit' },

  CREAR_LICITACION:              { label: 'Licitación Creada',             badge: 'badge-audit-create' },
  EDITAR_LICITACION:             { label: 'Licitación Editada',            badge: 'badge-audit-edit' },
  CAMBIAR_ESTADO_LICITACION:     { label: 'Cambio de Estado (Licitación)', badge: 'badge-audit-edit' },
  SUBIR_DOCUMENTO_LICITACION:    { label: 'Documento Subido',              badge: 'badge-audit-file' },
  ELIMINAR_DOCUMENTO_LICITACION: { label: 'Documento Eliminado',           badge: 'badge-audit-reject' },
  AGREGAR_GASTO_LICITACION:      { label: 'Gasto Registrado',              badge: 'badge-audit-create' },
  ELIMINAR_GASTO_LICITACION:     { label: 'Gasto Eliminado',               badge: 'badge-audit-reject' },
  DESCARGAR_PDF_LICITACION:      { label: 'Expediente Descargado',         badge: 'badge-audit-file' },
};

const ENTIDAD_LABELS = {
  cotizaciones: 'Cotizaciones',
  usuarios:     'Usuarios',
  clientes:     'Clientes',
  marcas:       'Marcas',
};

function accionMeta(codigo) {
  return ACCION_META[codigo] || { label: codigo, badge: 'badge-borrador' };
}

function accionBadgeHtml(codigo) {
  const meta = accionMeta(codigo);
  return `<span class="badge ${meta.badge}">${escHtml(meta.label)}</span>`;
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
  nombre_usuario:    'Nombre de usuario',
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
  razon_social:      'Razón social',
  nit:               'NIT',
  error:             'Error',
  estado_anterior:   'Estado Anterior',
  nuevo_estado:      'Nuevo estado',
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
};

const BYTE_KEYS = new Set(['size_bytes', 'pdf_size', 'excel_size']);

function humanizeKey(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDetalleValue(key, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';

  // El id de rol se traduce con la lista compartida, que conoce los cinco.
  // Antes salía de un objeto local que llegaba hasta el 4: un cambio de permiso
  // hacia Proyectos se registraba y se mostraba como un «5» sin explicación.
  if (key === 'id_rol' || key === 'id_rol_anterior' || key === 'id_rol_nuevo') {
    return nombreDeRol(value);
  }

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
    <dl class="audit-dl">
      ${entries.map(([key, value]) => `
        <dt>
          ${escHtml(FIELD_LABELS[key] || humanizeKey(key))}
        </dt>
        <dd>
          ${escHtml(formatDetalleValue(key, value))}
        </dd>
      `).join('')}
    </dl>`;
}

/** Filtros + contenedor de resultados. Función PURA, sin datos del servidor. */
function buildShellHtml() {
  return `
    <div class="card">
      <div class="card-header flex-wrap gap-2">
        <h3>Registros de auditoría</h3>
        <span class="text-muted text-sm" id="audit-total"></span>
      </div>
      <div class="filter-bar">
        <div class="form-group">
          <label class="form-label">Acción</label>
          <select class="form-control fc-medium" id="audit-accion">
            <option value="">Todas</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Tabla</label>
          <select class="form-control fc-narrow" id="audit-entidad">
            <option value="">Todas</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Resultado</label>
          <select class="form-control fc-xnarrow" id="audit-resultado">
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
          <input class="form-control fc-medium" type="search" id="audit-usuario" placeholder="Nombre de usuario…" />
        </div>
        <button class="btn btn-primary btn-sm filter-action" id="audit-apply">Aplicar filtros</button>
        <button class="btn btn-ghost btn-sm filter-action"   id="audit-clear">Limpiar</button>
      </div>
      <div class="card-toolbar" id="audit-pagination"></div>
      <div id="audit-results">${tableSkeleton({ columnas: 7, etiqueta: 'Cargando registros de auditoría' })}</div>
    </div>`;
}

/** Una fila de la tabla + su fila de detalle plegable (si tiene detalle). Pura. */
function buildRowHtml(r) {
  const detalleHtml = buildDetalleHtml(r.detalle);
  return `
                <tr>
                  <td class="text-sm">${fmtDateTime(r.creado_en)}</td>
                  <td>${escHtml(r.nombre_usuario ?? '—')}</td>
                  <td>${accionBadgeHtml(r.accion)}</td>
                  <td class="text-sm">${escHtml(ENTIDAD_LABELS[r.entidad] ?? r.entidad ?? '—')}</td>
                  <td class="text-sm">${r.id_entidad ?? '—'}</td>
                  <td>${resultadoBadgeHtml(r.resultado)}</td>
                  <td class="text-muted text-xs mono">${escHtml(r.ip_origen ?? '—')}</td>
                  <td>${detalleHtml
                    ? `<button class="btn btn-ghost btn-sm" data-audit-detail="${r.id}">Detalle</button>`
                    : ''}</td>
                </tr>
                ${detalleHtml ? `
                <tr class="audit-detail-row hidden" id="audit-detail-${r.id}">
                  <td colspan="8" class="audit-detail-cell">
                    ${detalleHtml}
                  </td>
                </tr>` : ''}`;
}

// ---------------------------------------------------------------------------
// mountAuditLogTab
// @param {HTMLElement} panel — tab panel to render into
// ---------------------------------------------------------------------------
export async function mountAuditLogTab(panel) {
  const state = { page: 1, limit: 25 };

  // ── 1. Paint the static shell (filter bar + results container) ONCE ─────────
  panel.innerHTML = buildShellHtml();

  const $ = (sel) => panel.querySelector(sel);

  // El ciclo cargando/vacio/error/paginar es identico en los cuatro paneles
  // y vive en shared/listSection.js. Lo propio de cada uno (columnas,
  // filtros, acciones) se queda aca, que es donde se lee mejor.
  const seccion = createListSection({
    resultsEl:    $('#audit-results'),
    paginationEl: $('#audit-pagination'),
    columnas:     7,
    etiqueta:     'Cargando registros de auditoría',
    etiquetas:    ETIQUETAS_FECHA,
    onPageChange: ({ page, limit }) => { state.page = page; state.limit = limit; load(); },
  });

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
      opt.textContent = meta.label;
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
    seccion.loading();

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
      const { vigente, valor: data } = await seccion.pedir(() =>
        api.get(`/api/auditoria?${params.toString()}`));
      if (!vigente) return;

      const rows = data.data ?? [];
      $('#audit-total').textContent = `${data.pagination?.totalRecords ?? rows.length} evento(s)`;

      if (rows.length === 0) {
        seccion.empty({
          icono:  'busqueda',
          titulo: 'Sin resultados',
          texto:  'No hay eventos de auditoría que coincidan con los filtros aplicados.',
        });
        seccion.clearPagination();
        return;
      }

      seccion.content(`
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>Fecha y hora</th><th>Usuario</th><th>Acción</th>
                <th>Tabla</th><th>Registro</th><th>Resultado</th><th>IP</th><th></th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(buildRowHtml).join('')}
            </tbody>
          </table>
        </div>`);

      seccion.el.querySelectorAll('[data-audit-detail]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const row = $(`#audit-detail-${btn.dataset.auditDetail}`);
          if (!row) return;
          // Con la clase .hidden y NO con style.display.
          //
          // La fila nace con class="audit-detail-row hidden", y .hidden lleva
          // `display: none !important`. Un style inline NUNCA le gana a un
          // !important de clase, así que el toggle por style.display no abría
          // nada: primer clic sin efecto, segundo clic cambiando el rótulo a
          // «Ocultar» con la fila todavía invisible.
          const abriendo = row.classList.contains('hidden');
          row.classList.toggle('hidden', !abriendo);
          btn.textContent = abriendo ? 'Ocultar' : 'Detalle';
        });
      });

      seccion.paginate(data.pagination);
    } catch (err) {
      seccion.error(err);
    }
  }

  // El control lo dibuja el módulo compartido (public/js/shared/pagination.js):
  // los cuatro paneles tenían esta función copiada, idéntica salvo el prefijo.
  // destroyPagination quita los listeners de document del menú anterior antes
  // de montar el nuevo; sin eso cada recarga apilaría un par más.

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

  // Devuelve la limpieza del panel. Sin esto, cada visita a la pestana
  // dejaba DOS escuchas huerfanas en document (las del menu de paginacion),
  // cada una reteniendo por closure una tabla que ya no esta en el DOM. A
  // las treinta idas y vueltas hay sesenta manejadores corriendo en cada
  // clic de la pagina y treinta subarboles que el recolector no puede
  // liberar: la pestana se va poniendo lenta y no se recupera hasta
  // recargar. Es acumulativo en sesiones largas, que es el uso real.
  return () => seccion.destroy();
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
