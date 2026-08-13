// =============================================================================
// public/js/views/dashboard/modules/clientModal.js
// "Nuevo cliente" / "Editar Cliente" - el sub-modal compartido.
//
// Lo usan las dos puntas del sistema: la busqueda de cliente del formulario de
// cotizacion (quotationForm.js), la pantalla de Gestion de Clientes
// (clientsView.js) y el "+ Nuevo" del modal de licitaciones. Por eso los campos,
// la validacion y el manejo del NIT repetido viven en un solo lugar.
//
// QUE QUEDO ACA Y QUE SE FUE
// Esta funcion tenia 231 lineas de codigo: la plantilla, la carga del catalogo
// de origenes con su alta en linea, y el guardado con su rama de NIT en
// conflicto, todo en un cuerpo. Hoy es lo que su nombre dice, y cada pieza vive
// en su archivo:
//
//   cliente/modalPlantilla.js   el HTML del formulario
//   cliente/modalOrigen.js      el catalogo de origen y su alta en linea
//   cliente/modalGuardado.js    que pasa al apretar guardar
//
// Es la misma reparticion que licitacionModal.js, a proposito: son dos modales
// con la misma forma, y que se lean igual le quita trabajo a quien toque el
// segundo despues de haber entendido el primero.
//
// Exporta: openClienteModal({ mode, client, onSaved, mountTarget })
// =============================================================================

import { construirModalCliente }   from './cliente/modalPlantilla.js';
import { montarSelectorDeOrigen }  from './cliente/modalOrigen.js';
import { guardarCliente }          from './cliente/modalGuardado.js';

/**
 * @param {Object}   opts
 * @param {'create'|'edit'} opts.mode
 * @param {Object|null} opts.client      la fila existente (solo en 'edit')
 * @param {Function} opts.onSaved        (id, rotulo) => void. Se llama al
 *   guardar bien, y tambien cuando se elige el cliente que ya era dueno de un
 *   NIT en conflicto.
 * @param {HTMLElement} [opts.mountTarget] donde colgar el overlay
 */
export function openClienteModal({ mode, client, onSaved, mountTarget }) {
  const isEdit = mode === 'edit';

  const overlay = document.createElement('div');
  overlay.className = 'sub-modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'subm-title');
  overlay.innerHTML = construirModalCliente(client, isEdit);

  (mountTarget || document.body).appendChild(overlay);

  const close = () => overlay.remove();

  overlay.querySelector('#subm-close')?.addEventListener('click', close);
  overlay.querySelector('#subm-cancel')?.addEventListener('click', close);
  // Clic en el fondo = cerrar. Se compara con el overlay mismo: un clic adentro
  // del modal burbujea hasta aca y cerraria la ventana a mitad de la carga.
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  montarSelectorDeOrigen({ overlay, client });

  overlay.querySelector('#subm-save')?.addEventListener('click', () =>
    guardarCliente({ overlay, client, isEdit, onSaved, close })
  );

  // El cursor al primer campo, que es el unico obligatorio.
  overlay.querySelector('#nc-razon-social')?.focus();
}
