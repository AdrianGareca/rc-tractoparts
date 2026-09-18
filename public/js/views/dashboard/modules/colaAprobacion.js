// =============================================================================
// public/js/views/dashboard/modules/colaAprobacion.js
// La cola de cotizaciones que esperan una decisión: la «Cola de aprobación» del
// Jefe y la «Cola de revisión» del Administrador.
//
// POR QUÉ UN MÓDULO
// Las dos colas estaban escritas dos veces, casi idénticas, dentro de
// managerStrategy.js y adminStrategy.js, y ninguna paginaba: pedían la cola
// entera de una vez. En la ronda de estrés del 2026-09-15, con 40.000
// cotizaciones, eso eran 11.630 filas y 3,7 MB en cada carga. Adrian decidió
// paginarlas como los demás listados, y como había que cambiar las dos de la
// misma forma pasan a vivir juntas: lo que cambia junto vive junto (ver
// shared/listSection.js, que cuenta el mismo motivo).
//
// Lo que difiere entre las dos se pasa por parámetro: el título, la columna
// Estado (sólo la ve el Jefe), el texto del botón y qué abre al revisar.
// =============================================================================

import api from '../../../services/apiClient.js';
import { escHtml, badgeHtml, fmtAmount, fmtDate } from '../helpers.js';
import { tableSkeleton } from '../../../shared/skeleton.js';
import { createListSection } from '../../../shared/listSection.js';

// La cola va de la más antigua a la más nueva, al revés que los otros
// listados: con las etiquetas de fecha de siempre, «Más nuevas» llevaría justo
// a la primera página, que es la de las más viejas.
const ETIQUETAS = { inicio: 'Más antiguas', fin: 'Más recientes' };

/** Una fila de la cola. Pura. */
function filaHtml(r, { conEstado, textoBoton }) {
  return `
    <tr>
      <td class="fw-600">${escHtml(r.numero_correlativo)}</td>
      ${conEstado ? `<td>${badgeHtml(r.estado)}</td>` : ''}
      <td>${escHtml(r.ejecutivo_nombre ?? '—')}</td>
      <td>${escHtml(r.cliente_nombre ?? String(r.id_cliente))}</td>
      <td>${fmtAmount(r.monto_total, r.moneda)}</td>
      <td>${fmtDate(r.fecha_emision)}</td>
      <td>${fmtDate(r.fecha_validez)}</td>
      <td>
        <button class="btn btn-primary btn-sm nowrap" data-review="${r.id}">${escHtml(textoBoton)}</button>
      </td>
    </tr>`;
}

/**
 * @param {HTMLElement} panel
 * @param {Object}   o
 * @param {string}   o.titulo      — «Cola de aprobación» / «Cola de revisión»
 * @param {string}   o.ayuda       — la línea gris junto al título
 * @param {boolean}  o.conEstado   — muestra la columna Estado (la del Jefe)
 * @param {string}   o.textoBoton  — «Revisar y Decidir» / «Revisar»
 * @param {string}   o.textoVacio  — qué decir cuando la cola está vacía
 * @param {Function} o.onRevisar   — (id) => void
 * @returns {Promise<Function>} la limpieza del panel
 */
export async function mountColaAprobacion(panel, { titulo, ayuda, conEstado, textoBoton, textoVacio, onRevisar }) {
  const state = { page: 1, limit: 50 };
  // La columna Estado cambia el ancho, y el esqueleto tiene que reservar el
  // lugar exacto de la tabla que lo va a reemplazar (ver skeleton.test.js).
  const anchoTabla = conEstado ? 8 : 7;

  panel.innerHTML = `
    <div class="card">
      <div class="card-header flex-wrap gap-2">
        <h3 id="cola-titulo">${escHtml(titulo)}</h3>
        <span class="text-muted text-sm">${escHtml(ayuda)}</span>
      </div>
      <div class="card-toolbar" id="cola-paginacion"></div>
      <div id="cola-resultados">${tableSkeleton({ columnas: anchoTabla, etiqueta: 'Cargando la cola' })}</div>
    </div>`;

  // Atajo: busca un elemento dentro de este panel.
  const $ = (sel) => panel.querySelector(sel);

  const seccion = createListSection({
    resultsEl:    $('#cola-resultados'),
    paginationEl: $('#cola-paginacion'),
    columnas:     anchoTabla,
    etiqueta:     'Cargando la cola',
    etiquetas:    ETIQUETAS,
    onPageChange: ({ page, limit }) => { state.page = page; state.limit = limit; load(); },
  });

  // Pide la página actual de la cola y la dibuja. Si la página quedó vacía porque
  // se decidió la última cotización de ella, retrocede una.
  async function load() {
    seccion.loading();
    const params = new URLSearchParams({ page: String(state.page), limit: String(state.limit) });

    try {
      const { vigente, valor: data } = await seccion.pedir(() =>
        api.get(`/api/cotizaciones/pendientes-aprobacion?${params}`));
      if (!vigente) return;

      const filas = data.data ?? [];
      const total = data.pagination?.totalRecords ?? filas.length;
      $('#cola-titulo').textContent = `${titulo} (${total})`;

      // Al decidir sobre la última cotización de la última página, esa página
      // queda vacía aunque la cola no lo esté: se vuelve a la anterior en vez
      // de mostrar «Cola vacía» con cotizaciones esperando.
      if (filas.length === 0 && state.page > 1) {
        state.page -= 1;
        return load();
      }

      if (filas.length === 0) {
        seccion.empty({ icono: 'alDia', titulo: 'Cola vacía', texto: textoVacio });
        return;
      }

      seccion.content(`
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>Correlativo</th>${conEstado ? '<th>Estado</th>' : ''}<th>Ejecutivo</th>
                <th>Cliente</th><th>Monto</th><th>Fecha</th>
                <th>Vence</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>${filas.map((r) => filaHtml(r, { conEstado, textoBoton })).join('')}</tbody>
          </table>
        </div>`);

      seccion.el.querySelectorAll('[data-review]').forEach((btn) => {
        btn.addEventListener('click', () => onRevisar(btn.dataset.review));
      });

      seccion.paginate(data.pagination);
    } catch (err) {
      seccion.error(err);
    }
  }

  await load();

  return () => seccion.destroy();
}
