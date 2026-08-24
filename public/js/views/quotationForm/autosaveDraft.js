// =============================================================================
// public/js/views/quotationForm/autosaveDraft.js
// Autoguardado del formulario de "Nueva Cotización" en localStorage.
//
// POR QUÉ EXISTE
// Una cotización con 50+ ítems tarda en cargarse a mano. Antes de esto, un
// corte de luz, de internet, o cerrar sin querer el navegador a mitad de
// carga perdía TODO — el formulario no guardaba nada hasta el submit final.
//
// SOLO en modo creación: editar una cotización existente ya vive en el
// servidor (y tiene su propio candado de edición); no hay nada que
// "recuperar" ahí, y mezclar un borrador local con una cotización real
// sería peligroso.
//
// UN solo borrador por usuario, no una pila — abrir "Nueva Cotización" con un
// borrador pendiente siempre pregunta primero qué hacer con ÉL antes de dejar
// empezar uno en blanco (ver quotationForm.js).
// =============================================================================

// Campos de cabecera que se guardan tal cual (por id). La tabla de ítems se
// guarda aparte, ya en el formato que espera LineItemsSubject.addItemData.
const HEADER_FIELD_IDS = [
  'id_cliente', 'cliente-search', 'fecha_emision', 'id_licitacion',
  'descripcion', 'moneda', 'entidad_emisora', 'tipo_pedido', 'fecha_validez',
  'observaciones', 'solicitante_nombre', 'solicitante_no_solicitud',
  'solicitante_area', 'solicitante_celular', 'solicitante_correo',
  'equipo_marca', 'equipo_tipo', 'equipo_modelo', 'equipo_serie', 'equipo_motor',
  'tiempo_entrega', 'totals-discount', 'forma_pago', 'forma_pago_custom',
];

function draftKey(userId) {
  return `rc_draft_cotizacion_${userId}`;
}

function readHeaderFields(container) {
  const values = {};
  for (const id of HEADER_FIELD_IDS) {
    const el = container.querySelector(`#${id}`);
    if (el) values[id] = el.value;
  }
  const mostrarCodigos = container.querySelector('#mostrar_codigos');
  if (mostrarCodigos) values.mostrar_codigos = mostrarCodigos.checked;
  return values;
}

/** Reescribe cada campo de cabecera con el valor guardado. */
function writeHeaderFields(container, values = {}) {
  for (const [id, value] of Object.entries(values)) {
    if (id === 'mostrar_codigos') continue; // se aplica aparte, es checkbox
    const el = container.querySelector(`#${id}`);
    if (el) el.value = value ?? '';
  }
  const mostrarCodigos = container.querySelector('#mostrar_codigos');
  if (mostrarCodigos && 'mostrar_codigos' in values) {
    mostrarCodigos.checked = Boolean(values.mostrar_codigos);
  }
  // "Otro (personalizado)" de forma de pago nace oculto — si el borrador
  // tenía ese valor, hay que destapar el campo de texto libre.
  if (values.forma_pago === '__otro__') {
    container.querySelector('#forma_pago_custom_group')?.classList.remove('hidden');
  }
}

/**
 * Guarda el estado actual del formulario. Nunca lanza: un fallo de
 * localStorage (modo privado, cuota llena) no debe interrumpir a alguien
 * mientras escribe — es preferible perder EL autoguardado que la sesión.
 */
export function saveDraft(userId, container, items) {
  try {
    const payload = {
      guardado_en: new Date().toISOString(),
      header: readHeaderFields(container),
      items,
    };
    localStorage.setItem(draftKey(userId), JSON.stringify(payload));
  } catch { /* no fatal */ }
}

/** Lee el borrador guardado para este usuario, o null si no hay uno (o está corrupto). */
export function loadDraft(userId) {
  try {
    const raw = localStorage.getItem(draftKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : null;
  } catch {
    return null;
  }
}

export function clearDraft(userId) {
  try { localStorage.removeItem(draftKey(userId)); } catch { /* no fatal */ }
}

/** Reescribe la cabecera del formulario ya montado con los datos del borrador. */
export function restoreHeaderFields(container, draft) {
  writeHeaderFields(container, draft?.header ?? {});
}
