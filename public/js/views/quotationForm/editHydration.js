// =============================================================================
// public/js/views/quotationForm/editHydration.js
// Hidratacion del formulario cuando se abre sobre una cotizacion existente.
//
//   populateHeaderForEdit — vuelca la cabecera guardada en los inputs
//   populateLicitaciones  — llena el desplegable "Licitacion asociada"
//   setFormaPago          — resuelve preset vs texto libre en Forma de Pago
//
// Extraido de FormMediator sin cambios de comportamiento: eran metodos que
// solo tocaban #container / #editData / #prefill, asi que ahora los reciben.
// Cubierto por tests/unit/quotationFormEditHydration.test.js.
// =============================================================================

import api from '../../services/apiClient.js';
import { escText } from './helpers.js';

// ── Private: hydrate header fields from the existing quotation (edit mode) ──

export function populateHeaderForEdit(container, editData) {
  const q   = editData;
  const set = (sel, val) => {
    const el = container.querySelector(sel);
    if (el != null && val != null) el.value = val;
  };
  // Normalize a DB date (Date object or ISO/datetime string) to YYYY-MM-DD for
  // a native <input type="date">.
  const toDateInput = (v) => {
    if (!v) return '';
    if (typeof v === 'string') return v.slice(0, 10);
    try { return new Date(v).toISOString().slice(0, 10); } catch { return ''; }
  };

  // Client selector: show the resolved name, store the numeric id in the hidden field.
  set('#cliente-search', q.cliente_nombre ?? '');
  set('#id_cliente',     q.id_cliente != null ? String(q.id_cliente) : '');

  set('#descripcion',   q.descripcion ?? '');
  set('#fecha_emision', toDateInput(q.fecha_emision));
  set('#fecha_validez', toDateInput(q.fecha_validez));
  set('#moneda',        q.moneda ?? 'BOB');
  // Gracefully map the legacy business name to its current legal name so the
  // dropdown resolves to a real <option> when editing a pre-rename record.
  const emisoraRaw = q.entidad_emisora ?? 'Empresa unipersonal de Ronald Roca Cartagena';
  set('#entidad_emisora',
    emisoraRaw === 'RC Tractoparts'
      ? 'Empresa unipersonal de Ronald Roca Cartagena'
      : emisoraRaw);
  set('#tipo_pedido',   q.tipo_pedido ?? '');
  set('#observaciones', q.observaciones ?? '');
  set('#tiempo_entrega', q.tiempo_entrega ?? '');

  // Solicitante block (findById aliases these column names)
  set('#solicitante_nombre',       q.nombre_sol    ?? q.solicitante_nombre ?? '');
  set('#solicitante_no_solicitud', q.nro_solicitud ?? q.solicitante_no_solicitud ?? '');
  set('#solicitante_area',         q.area_sol      ?? q.solicitante_area ?? '');
  set('#solicitante_celular',      q.celular_sol   ?? q.solicitante_celular ?? '');
  set('#solicitante_correo',       q.correo_sol    ?? q.solicitante_correo ?? '');

  // Equipo block
  set('#equipo_marca',  q.equipo_marca ?? '');
  set('#equipo_tipo',   q.equipo_tipo ?? '');
  set('#equipo_modelo', q.equipo_modelo ?? '');
  set('#equipo_serie',  q.equipo_serie ?? '');
  set('#equipo_motor',  q.equipo_motor ?? '');

  // Financial / PDF config fields
  set('#descuento_manual', q.descuento_manual != null ? String(q.descuento_manual) : '');
  // forma_pago: select the matching quick option, or 'Otro (Personalizado)'
  // with the custom text input revealed when the stored value is not a preset.
  setFormaPago(container, q.forma_pago ?? '');
  const mostrarCodigos = q.mostrar_codigos != null ? Boolean(Number(q.mostrar_codigos)) : true;
  const chkCodigos = container.querySelector('#mostrar_codigos');
  if (chkCodigos) chkCodigos.checked = mostrarCodigos;
}

// ── Private: populate the "Licitación asociada" dropdown ────────────────────
// Lists licitaciones currently in 'Cotizando' (the handoff state where the
// commercial executive prices them). In edit mode (or via prefill) the already
// linked licitación is guaranteed to be present and selected even if it has
// since advanced past 'Cotizando'. Non-fatal: on any failure the dropdown just
// stays at "Sin licitación" so normal quoting is never blocked.
export async function populateLicitaciones(container, { editData = null, prefill = null } = {}) {
  const sel = container.querySelector('#id_licitacion');
  if (!sel) return;

  // The id to pre-select: edit mode uses the stored link; create mode uses prefill.
  const selectedId = editData?.id_licitacion ?? prefill?.id_licitacion ?? null;

  let options = [];
  try {
    const body = await api.get('/api/licitaciones?estado=Cotizando&limit=100&sort_by=creado_en&sort_order=DESC');
    options = body.data ?? [];
  } catch (_) { /* non-fatal — dropdown stays minimal */ }

  // Ensure the currently-linked licitación appears even if not in the Cotizando list.
  if (selectedId != null && !options.some((l) => String(l.id) === String(selectedId))) {
    try {
      const one = await api.get(`/api/licitaciones/${selectedId}`);
      if (one?.data) options.unshift(one.data);
    } catch (_) { /* fall back to a generic label below */ }
  }

  const opts = options.map((l) =>
    `<option value="${l.id}">${escText(`${l.codigo} — ${l.nombre}`)}</option>`).join('');
  sel.insertAdjacentHTML('beforeend', opts);

  // If the linked id still isn't an option (lookup failed), add a placeholder
  // so the value is preserved on save.
  if (selectedId != null && !sel.querySelector(`option[value="${selectedId}"]`)) {
    sel.insertAdjacentHTML('beforeend', `<option value="${selectedId}">Licitación #${escText(String(selectedId))}</option>`);
  }
  if (selectedId != null) sel.value = String(selectedId);
}

// ── Private: forma_pago select helpers ─────────────────────────────────────

/**
 * _setFormaPago — hydrates the Forma de Pago <select> from a stored value.
 * A value matching one of the quick-select presets selects it directly;
 * empty/null keeps the default option; any other string selects
 * 'Otro (Personalizado)' and reveals + fills the custom text input.
 */
export function setFormaPago(container, value) {
  const sel   = container.querySelector('#forma_pago');
  const group = container.querySelector('#forma_pago_custom_group');
  const input = container.querySelector('#forma_pago_custom');
  if (!sel) return;

  const isPreset = [...sel.options].some(
    (o) => o.value === value && o.value !== '__otro__'
  );

  // Se oculta con la clase .hidden y no con style.display. Vaciar un estilo
  // inline no muestra nada: sólo deja que gane la hoja de estilos, así que en
  // cuanto una regla del CSS tocara el display de este <div> el campo libre
  // dejaría de aparecer — y el ejecutivo no podría escribir una forma de pago
  // fuera de las predefinidas. .hidden es lo que usa el resto del proyecto.
  if (!value || isPreset) {
    sel.value = value || '';
    group?.classList.add('hidden');
    if (input) input.value = '';
  } else {
    sel.value = '__otro__';
    group?.classList.remove('hidden');
    if (input) input.value = value;
  }
}

// La lectura de forma_pago para el payload vive en
// quotationForm/submitPayload.js (collectFormaPago).
