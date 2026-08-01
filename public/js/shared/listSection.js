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

    /** La tabla ya armada por el panel. */
    content(html) {
      if (resultsEl) resultsEl.innerHTML = html;
    },

    /**
     * Estado vacío. Cada panel pone su ícono y su texto: «sin clientes» y
     * «sin licitaciones» no dicen lo mismo, y un mensaje genérico obliga al
     * usuario a deducir qué buscaba.
     */
    empty({ icono = '📋', titulo = 'Sin resultados', texto = '' } = {}) {
      if (resultsEl) {
        resultsEl.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">${icono}</div>
            <h4>${escapeHtml(titulo)}</h4>
            <p>${escapeHtml(texto)}</p>
          </div>`;
      }
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
