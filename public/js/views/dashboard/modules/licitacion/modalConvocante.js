// =============================================================================
// public/js/views/dashboard/modules/licitacion/modalConvocante.js
// El buscador de entidad convocante del modal de licitación.
//
// POR QUÉ ESTÁ SEPARADO
// Son unas setenta líneas que resuelven UNA cosa —elegir un cliente— y que no
// se tocan con el resto del modal: no saben si se está creando o editando, ni
// qué pasa al guardar. Estaban en el medio de openLicitacionModal, entre la
// plantilla y el submit, y había que saltearlas cada vez que uno buscaba otra
// cosa en ese archivo.
//
// CÓMO SE COMUNICA CON EL GUARDADO: por el campo oculto #lic-id-cliente, no por
// una variable compartida. Eso no es un rodeo, es la regla: el campo de texto
// muestra lo que la persona escribió, el oculto guarda lo que efectivamente
// eligió de la lista. Escribir «Municipio de…» y guardar sin elegir NO manda un
// id — el oculto quedó vacío y el formulario lo rechaza.
// =============================================================================

import api from '../../../../services/apiClient.js';
import { escHtml } from '../../helpers.js';
import { openClienteModal } from '../clientModal.js';

/** Cuánto se espera después de la última tecla antes de consultar al servidor. */
const ESPERA_TECLEO_MS = 250;

/**
 * Cablea el autocompletado dentro de un modal ya montado.
 *
 * @param {{ overlay: HTMLElement }} opciones
 * @returns {{ elegir: (id: number, nombre: string) => void }}
 */
export function montarBuscadorDeConvocante({ overlay }) {
  const $ = (sel) => overlay.querySelector(sel);

  const campoBusqueda = $('#lic-cliente-search');
  const panel         = $('#lic-cliente-results');
  const campoOculto   = $('#lic-id-cliente');
  const ayuda         = $('#lic-cliente-hint');

  // En modo 'attach' la cabecera no se renderiza y estos elementos no existen.
  // Salir en silencio es correcto: no hay convocante que elegir.
  if (!campoBusqueda || !panel) return { elegir: () => {} };

  let temporizador;

  const cerrarPanel = () => {
    panel.innerHTML = '';
    panel.classList.remove('open');
  };

  /** Confirma una entidad: es lo único que llena el campo oculto. */
  function elegir(clientId, nombre) {
    campoOculto.value = String(clientId);
    campoBusqueda.value = nombre;
    ayuda.textContent = 'Convocante seleccionado: ' + nombre;
    cerrarPanel();
  }

  /** Una fila del desplegable. */
  const filaResultado = (c) => `
    <div class="client-dropdown-item" data-cid="${c.id}" data-cname="${escHtml(c.razon_social)}"
         role="option" tabindex="-1">
      <span class="cdi-name">${escHtml(c.razon_social)}</span>
      ${c.nit ? `<span class="cdi-nit">NIT: ${escHtml(c.nit)}</span>` : ''}
    </div>`;

  /** Pinta el desplegable y deja cada fila lista para ser elegida. */
  function mostrarResultados(filas, termino) {
    if (filas.length === 0) {
      panel.innerHTML = `<div class="client-dropdown-empty">Sin resultados para "<em>${escHtml(termino)}</em>"</div>`;
    } else {
      panel.innerHTML = filas.map(filaResultado).join('');
      panel.querySelectorAll('[data-cid]').forEach((el) => {
        // 'mousedown' y no 'click', con preventDefault: el click llega DESPUÉS
        // de que el campo pierde el foco, y para entonces el desplegable ya se
        // cerró y la fila que se estaba apretando ya no existe.
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          elegir(parseInt(el.dataset.cid, 10), el.dataset.cname);
        });
      });
    }
    panel.classList.add('open');
  }

  campoBusqueda.addEventListener('input', () => {
    // Escribir invalida la selección anterior hasta que se confirme otra. Sin
    // esto, elegir una entidad y después corregir el texto guardaría el id
    // viejo con un nombre que ya no le corresponde.
    campoOculto.value = '';

    const termino = campoBusqueda.value.trim();
    clearTimeout(temporizador);
    if (termino.length < 1) { cerrarPanel(); return; }

    temporizador = setTimeout(async () => {
      try {
        const body = await api.get(`/api/clientes?q=${encodeURIComponent(termino)}`);
        mostrarResultados(body.data ?? [], termino);
      } catch (err) {
        panel.innerHTML = `<div class="client-dropdown-empty">Error: ${escHtml(err.message)}</div>`;
        panel.classList.add('open');
      }
    }, ESPERA_TECLEO_MS);
  });

  // Cerrar el desplegable al hacer clic en cualquier otra parte del modal.
  overlay.addEventListener('click', (e) => {
    if (!e.target.closest('#lic-cliente-search') && !e.target.closest('#lic-cliente-results')) {
      cerrarPanel();
    }
  });

  // "+ Nuevo" — reusa el modal de clientes y deja la entidad recién creada ya
  // elegida. Es lo que evita que Proyectos tenga que salir del flujo, ir a
  // Clientes, registrar, volver y empezar la licitación de nuevo.
  $('#lic-cliente-new')?.addEventListener('click', () => {
    openClienteModal({
      mode: 'create',
      client: null,
      mountTarget: document.body,
      // openClienteModal llama onSaved(id, rótulo) — esta firma la acompaña.
      onSaved: (clientId, rotulo) => { if (clientId) elegir(parseInt(clientId, 10), rotulo); },
    });
  });

  return { elegir };
}
