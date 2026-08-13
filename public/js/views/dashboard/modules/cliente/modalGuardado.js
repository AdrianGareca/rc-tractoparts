// =============================================================================
// public/js/views/dashboard/modules/cliente/modalGuardado.js
// Que pasa cuando se aprieta "Guardar Cliente".
//
// LO QUE TIENE DE PARTICULAR: EL NIT REPETIDO
// El NIT identifica a una empresa ante Impuestos, asi que es unico. Cuando el
// que se escribio ya pertenece a OTRO cliente, el servidor no contesta un
// rechazo a secas: manda cual es ese cliente. El modal ofrece usarlo.
//
// Eso importa porque el caso real no es un error de tipeo, es que la misma
// empresa ya estaba cargada por otra persona —con otra razon social, "Ferretera
// del Este" contra "FERRETERA DEL ESTE SRL"— y quien esta cotizando no tenia
// como saberlo. Sin la salida, la cotizacion se frena y el vendedor termina
// inventando un NIT para poder seguir.
//
// leerFormulario es pura y sale aparte: es la unica parte con reglas de negocio
// y ahora se puede probar sin montar el modal.
// =============================================================================

import api, { showToast } from '../../../../services/apiClient.js';
import { escHtml } from '../../helpers.js';

/** Los campos del formulario, en el orden en que se ven. */
const CAMPOS = [
  ['razon_social', '#nc-razon-social'],
  ['nit',          '#nc-nit'],
  ['contacto',     '#nc-contacto'],
  ['email',        '#nc-email'],
  ['telefono',     '#nc-telefono'],
  ['direccion',    '#nc-direccion'],
  ['ciudad',       '#nc-ciudad'],
];

/**
 * Lee y valida el formulario. Funcion pura respecto del DOM: recibe el buscador.
 *
 * @param {(sel: string) => ({value: string}|null)} $
 * @returns {{ payload: object|null, error: string|null }}
 */
export function leerFormulario($) {
  const valores = {};
  for (const [clave, selector] of CAMPOS) {
    const bruto = $(selector)?.value.trim();
    // Vacio es null y no cadena vacia: la base tiene estos campos como NULL-ables
    // y guardar '' hace que "sin telefono" y "telefono en blanco" se vean
    // distinto en los reportes siendo la misma cosa.
    valores[clave] = bruto || null;
  }

  if (!valores.razon_social) {
    return { payload: null, error: 'La razón social es requerida.' };
  }

  return {
    error: null,
    payload: { ...valores, id_origen_cliente: $('#nc-origen')?.value || null },
  };
}

/**
 * Guarda el cliente y avisa a quien abrio el modal.
 *
 * @param {object} ctx
 * @param {HTMLElement} ctx.overlay
 * @param {object|null} ctx.client   la fila que se edita, o null
 * @param {boolean} ctx.isEdit
 * @param {Function} ctx.onSaved     (id, rotulo) => void
 * @param {Function} ctx.close
 */
export async function guardarCliente({ overlay, client, isEdit, onSaved, close }) {
  const $ = (sel) => overlay.querySelector(sel);

  const alerta   = $('#nc-alert');
  const errRazon = $('#nc-err-razon');

  const { payload, error } = leerFormulario($);
  if (error) { errRazon.textContent = error; return; }

  errRazon.textContent = '';
  alerta.className     = 'form-alert';
  alerta.textContent   = '';

  const boton   = $('#subm-save');
  const rotulo  = $('#subm-label');
  const spinner = $('#subm-spinner');

  boton.disabled = true;
  if (rotulo)  rotulo.textContent = 'Guardando...';
  if (spinner) spinner.classList.remove('hidden');

  /** Devuelve el boton a su estado. Solo en el camino de error: en el exito el
   *  modal se cierra y el boton se va con el, y restaurarlo antes de cerrar
   *  reabre por un instante la ventana del doble clic. */
  const liberarBoton = () => {
    boton.disabled = false;
    if (rotulo)  rotulo.textContent = isEdit ? 'Guardar cambios' : 'Guardar Cliente';
    if (spinner) spinner.classList.add('hidden');
  };

  try {
    const resp = isEdit
      ? await api.put(`/api/clientes/${client.id}`, payload)
      : await api.post('/api/clientes', payload);

    const guardado = resp.data;
    showToast(
      isEdit
        ? `Cliente "${guardado.razon_social}" actualizado.`
        : `Cliente "${guardado.razon_social}" registrado.`,
      'success'
    );
    onSaved(String(guardado.id), guardado.razon_social);
    close();

  } catch (err) {
    const enConflicto = err.data?.data?.conflictingClient;

    if (enConflicto) {
      mostrarSalidaPorNit({ alerta, overlay, err, enConflicto, onSaved, close });
    } else {
      alerta.textContent = err.data?.message || err.message || 'Error al guardar el cliente.';
      alerta.className   = 'form-alert show alert-error';
    }

    liberarBoton();
  }
}

/**
 * El NIT ya pertenece a otro cliente: se lo nombra y se ofrece usarlo.
 * Dejar solo el rechazo obliga a quien esta cotizando a abandonar el flujo para
 * ir a buscar de quien es ese NIT — o a inventarse uno para poder seguir.
 */
function mostrarSalidaPorNit({ alerta, overlay, err, enConflicto, onSaved, close }) {
  alerta.innerHTML = `
    ${escHtml(err.data?.message || 'Ese NIT ya está en uso.')}
    Pertenece a <strong>${escHtml(enConflicto.razon_social)}</strong>.
    <button type="button" class="btn btn-ghost btn-sm mt-1" id="nc-use-existing">
      Usar este cliente
    </button>
  `;
  alerta.className = 'form-alert show alert-error';

  overlay.querySelector('#nc-use-existing')?.addEventListener('click', () => {
    onSaved(String(enConflicto.id), enConflicto.razon_social);
    close();
  });
}
