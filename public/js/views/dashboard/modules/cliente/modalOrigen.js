// =============================================================================
// public/js/views/dashboard/modules/cliente/modalOrigen.js
// El selector de "Origen del cliente" y su alta en linea.
//
// QUE RESUELVE
// El origen es un catalogo chico (Feria comercial, Recomendacion, Visita en
// frio...) que alimenta el reporte "Clientes por origen". Se carga por red al
// abrir el modal, y se puede agregar uno nuevo sin salir del formulario: apretar
// el mas revela una fila, se escribe el nombre y se guarda.
//
// LAS DOS CARRERAS QUE TIENE ADENTRO
// 1. El catalogo llega TARDE. Si alguien alcanza a crear un origen nuevo antes
//    de que resuelva el GET inicial —red lenta—, el innerHTML de la respuesta
//    tardia pisaria esa seleccion recien hecha. La bandera origenTocado corta
//    ese pisotón.
// 2. El origen YA EXISTE. El POST contesta 409 con la fila existente adentro.
//    No es un error para quien lo escribio: quiso clasificar al cliente y ese
//    origen es exactamente el que buscaba. Se lo selecciona y se avisa, en lugar
//    de dejarlo con un rechazo y sin saber que hacer.
//
// Extraido de clientModal.js sin cambios de comportamiento.
// =============================================================================

import api, { showToast } from '../../../../services/apiClient.js';
import { escHtml } from '../../helpers.js';

/**
 * Cablea el selector de origen dentro de un modal ya montado.
 *
 * @param {{ overlay: HTMLElement, client: object|null }} opciones
 */
export function montarSelectorDeOrigen({ overlay, client }) {
  const select   = overlay.querySelector('#nc-origen');
  const fila     = overlay.querySelector('#nc-origen-new');
  const campo    = overlay.querySelector('#nc-origen-new-input');

  if (!select) return;

  // Ver la carrera 1 en la cabecera: se pone en true en cuanto el usuario elige
  // algo por su cuenta, y a partir de ahi la respuesta del GET no pisa nada.
  let origenTocado = false;

  // ── Carga del catalogo ────────────────────────────────────────────────────
  (async () => {
    try {
      const resp = await api.get('/api/origenes-cliente');
      if (origenTocado) return;

      const origenes = resp.data ?? [];
      const actual   = client?.id_origen_cliente ?? '';

      select.innerHTML =
        '<option value="">— Sin clasificar —</option>' +
        origenes.map((o) =>
          `<option value="${o.id}"${String(o.id) === String(actual) ? ' selected' : ''}>${escHtml(o.nombre)}</option>`
        ).join('');
    } catch {
      // No es fatal: el desplegable se queda en "Sin clasificar". Clasificar al
      // cliente es opcional, y bloquear el alta entera porque no cargo un
      // catalogo opcional seria peor que no tenerlo.
    }
  })();

  /** Agrega la opcion al desplegable, la deja elegida y cierra la fila. */
  function adoptar(origen, mensaje, tipo) {
    if (!select.querySelector(`option[value="${origen.id}"]`)) {
      const opt = document.createElement('option');
      opt.value       = origen.id;
      opt.textContent = origen.nombre;
      select.appendChild(opt);
    }
    select.value  = String(origen.id);
    origenTocado  = true;
    fila.classList.add('hidden');
    campo.value   = '';
    showToast(mensaje, tipo);
  }

  // ── Mostrar y ocultar la fila de alta ─────────────────────────────────────
  overlay.querySelector('#nc-add-origen')?.addEventListener('click', () => {
    // Con classList y NO con style.display: .hidden es display:none !important
    // y un estilo en linea no le gana. Con style.display el bloque no aparecia
    // nunca —y el focus() sobre un elemento oculto tampoco hace nada, asi que el
    // cursor tampoco se movia—. Consecuencia de negocio: el catalogo no crecia y
    // el reporte "Clientes por origen" quedaba siempre en "Sin clasificar".
    fila.classList.remove('hidden');
    campo.focus();
  });

  overlay.querySelector('#nc-origen-new-cancel')?.addEventListener('click', () => {
    fila.classList.add('hidden');
    campo.value = '';
  });

  // ── Guardar el origen nuevo ───────────────────────────────────────────────
  overlay.querySelector('#nc-origen-new-save')?.addEventListener('click', async () => {
    const nombre = campo.value.trim();
    if (!nombre) return;

    try {
      const resp = await api.post('/api/origenes-cliente', { nombre });
      adoptar(resp.data, `Origen "${resp.data.nombre}" registrado y seleccionado.`, 'success');
    } catch (err) {
      // Ver la carrera 2: 409 significa que ya existia, y el servidor manda cual.
      const existente = err.status === 409 ? err.data?.data : null;
      if (existente) {
        adoptar(existente, `Origen "${existente.nombre}" ya existe. Seleccionado automáticamente.`, 'info');
        return;
      }
      showToast(err.data?.message || err.message || 'Error al crear el origen.', 'error');
    }
  });
}
