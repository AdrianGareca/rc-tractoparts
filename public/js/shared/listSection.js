// =============================================================================
// public/js/shared/listSection.js
// El ciclo de vida de un panel de listado: cargando → vacío / error / datos.
//
// QUÉ EXTRAE, Y QUÉ NO
// Los cuatro paneles (cotizaciones, auditoría, clientes, licitaciones) repiten
// la MISMA secuencia: pintar el esqueleto, pedir, mostrar vacío o error, montar
// la paginación, y desmontarla antes de volver a montarla. Eso es lo idéntico y
// es lo único que se mueve acá.
//
// Lo que NO se toca: las columnas, los filtros y las acciones de cada tabla.
// Son genuinamente distintos entre paneles, y meterlos en una fábrica
// configurable cambiaría cuatro archivos que se leen solos por un módulo con
// quince opciones donde el panel que no encaja se vuelve el problema. La
// duplicación tiene un costo; la abstracción equivocada, uno peor.
//
// LA EVIDENCIA DE QUE ESTO VALÍA LA PENA
// Al agregar la paginación hubo que tocar los cuatro paneles de forma idéntica
// — y el mismo error (el import faltante) se coló en los cuatro a la vez. Lo
// que cambia junto tiene que vivir junto.
// =============================================================================

import { tableSkeleton } from './skeleton.js';
import { mountPagination } from './pagination.js';
import { escapeHtml } from './escapeHtml.js';
import { stateIcon } from './icons.js';
// Ordena las llegadas: una respuesta vieja no pisa a una nueva.
import { crearTurnero } from './ultimaGana.js';

/**
 * El marcado de un panel sin nada que mostrar.
 *
 * Se exporta suelto además de estar en `empty()` porque hay dos colas —la de
 * revisión del Administrador y la de aprobación del Jefe— que no usan
 * `createListSection`: dibujan su panel entero de una vez y no tienen
 * paginación. Antes copiaban este marcado a mano, y las copias ya se habían
 * quedado sin `escapeHtml`.
 *
 * @param {Object}  o
 * @param {string} [o.icono]  — clave de EMPTY_ICONS (ver shared/icons.js)
 * @param {string} [o.titulo] — qué falta, en pocas palabras
 * @param {string} [o.texto]  — por qué falta, o qué hacer al respecto
 * @returns {string} HTML
 */
export function emptyState({ icono = 'cotizaciones', titulo = 'Sin resultados', texto = '' } = {}) {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">${stateIcon(icono)}</div>
      <h4>${escapeHtml(titulo)}</h4>
      ${texto ? `<p>${escapeHtml(texto)}</p>` : ''}
    </div>`;
}

/**
 * @param {Object}      opts
 * @param {HTMLElement} opts.resultsEl     — dónde va la tabla
 * @param {HTMLElement} opts.paginationEl  — dónde va el control de paginación
 * @param {number}      opts.columnas      — ancho del esqueleto (columnas de la tabla)
 * @param {string}      opts.etiqueta      — «Cargando clientes», para lectores de pantalla
 * @param {Object}     [opts.etiquetas]    — textos del menú de paginación
 * @param {Function}    opts.onPageChange  — ({ page, limit }) => void
 * @returns {Object} el controlador de la sección
 */
export function createListSection({
  resultsEl, paginationEl, columnas, etiqueta, etiquetas, onPageChange,
}) {
  let destroyPag = null;

  // Uno por seccion: que el listado de clientes pida algo no puede
  // invalidar lo que esta cargando el de auditoria.
  const turnero = crearTurnero();

  /** Desmonta la paginación y vacía su contenedor. */
  function clearPagination() {
    destroyPag?.();
    destroyPag = null;
    if (paginationEl) paginationEl.innerHTML = '';
  }

  return {
    /**
     * El contenedor de resultados. Los paneles lo necesitan para enganchar los
     * botones de las filas recien dibujadas (querySelectorAll sobre lo suyo).
     */
    el: resultsEl,

    /**
     * Esqueleto con la forma de la tabla, mientras llega la respuesta.
     *
     * `columnasAhora` existe para los paneles que cambian de vista sin
     * volver a montarse — el reporte de consumo alterna entre una tabla de 7
     * columnas y otra de 8. Sin el override, el esqueleto tendría el ancho de
     * la vista anterior y la página saltaría al llegar los datos, que es
     * justamente lo que el esqueleto viene a evitar.
     */
    loading(columnasAhora) {
      if (resultsEl) {
        resultsEl.innerHTML = tableSkeleton({ columnas: columnasAhora ?? columnas, etiqueta });
      }
    },

    /**
     * Corre la consulta del panel y dice si su respuesta todavía vale.
     *
     * POR QUÉ ESTÁ ACÁ Y NO EN CADA PANEL
     * Los cuatro paneles escribían el resultado apenas llegaba, sin nada que
     * ordenara las llegadas. Si el usuario cambiaba el filtro antes de que la
     * primera consulta terminara, la respuesta LENTA del pedido viejo pisaba a
     * la RÁPIDA del nuevo — y los datos en pantalla no correspondían al filtro
     * que decía el formulario. Sin error, sin parpadeo, sin nada que lo delate.
     *
     * Poniéndolo en la sección compartida, los cuatro lo heredan y el próximo
     * panel no tiene que acordarse.
     *
     * @param   {Function} tarea — devuelve la promesa de la consulta
     * @returns {Promise<{ vigente: boolean, valor: * }>}
     *
     * @example
     *   const { vigente, valor } = await seccion.pedir(() => api.get(url));
     *   if (!vigente) return;      // llegó tarde: no escribe
     */
    pedir(tarea) {
      return turnero.ejecutar(tarea);
    },

    /** La tabla ya armada por el panel. */
    content(html) {
      if (resultsEl) resultsEl.innerHTML = html;
    },

    /**
     * Estado vacío. Cada panel pone su ícono y su texto: «sin clientes» y
     * «sin licitaciones» no dicen lo mismo, y un mensaje genérico obliga al
     * usuario a deducir qué buscaba.
     */
    empty(opts) {
      if (resultsEl) resultsEl.innerHTML = emptyState(opts);
      clearPagination();
    },

    /**
     * Error de carga. Se muestra el mensaje del servidor cuando existe: dice
     * mucho más que un «error al cargar» genérico.
     */
    error(err) {
      const msg = err?.data?.message || err?.message || 'Error desconocido';
      if (resultsEl) {
        resultsEl.innerHTML =
          `<div class="empty-state"><p>Error: ${escapeHtml(msg)}</p></div>`;
      }
      clearPagination();
    },

    /** Monta el control de paginación, desmontando el anterior. */
    paginate(paginacion) {
      destroyPag?.();
      destroyPag = mountPagination(paginationEl, paginacion, {
        etiquetas,
        onChange: onPageChange,
      });
    },

    clearPagination,

    /** Para cuando el panel entero se desmonta (modal cerrado, pestaña cambiada). */
    destroy: clearPagination,
  };
}
