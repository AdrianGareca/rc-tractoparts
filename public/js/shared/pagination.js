// =============================================================================
// public/js/shared/pagination.js
// El control de paginación, estilo Gmail: «1–50 de 6.058» con salto al
// principio y al final.
//
// QUÉ REEMPLAZA
// Cuatro paneles (cotizaciones, auditoría, clientes, licitaciones) tenían la
// MISMA función renderPagination copiada, idéntica salvo el prefijo de los id.
// Mostraba «Página 3 de 122» con Anterior y Siguiente, y nada más. Con 122
// páginas, llegar a la más vieja eran 119 clics — en la práctica, esos registros
// no existían para nadie.
//
// QUÉ APORTA
//   • Rango real: «101–150 de 6.058» dice cuántos hay y dónde estás parado.
//     «Página 3 de 122» obliga a multiplicar mentalmente para saber lo mismo.
//   • Salto al principio y al final en un clic.
//   • Cuántas filas por página (20 / 50 / 100). El tope de 100 no es un número
//     elegido acá: es MAX_LIMIT en src/controllers/quotation/quotationFilters.js,
//     y pedir más de eso el servidor lo recorta sin avisar.
//   • Se muestra SIEMPRE, incluso con una sola página. Antes desaparecía
//     (`if (totalPages <= 1) return`), así que con pocos registros la pantalla
//     no decía cuántos había, y al filtrar el pie saltaba de existir a no
//     existir moviendo la tabla.
//
// SOBRE LAS ETIQUETAS DEL MENÚ
// Gmail dice «Más nuevas / Más antiguas» porque su lista siempre está ordenada
// por fecha. Acá no: en clientes se ordena por razón social, y «más antiguas»
// sería mentira. Por eso las etiquetas son un parámetro — cada panel pasa las
// que corresponden a SU orden, y el valor por defecto es neutro.
// =============================================================================

const nf = new Intl.NumberFormat('es-BO');

const ETIQUETAS_POR_DEFECTO = { inicio: 'Ir al principio', fin: 'Ir al final' };
const TAMANOS_POR_DEFECTO   = [20, 50, 100];

/**
 * Dibuja el control y devuelve una función para desmontarlo.
 *
 * @param {HTMLElement} contenedor         dónde renderizar
 * @param {Object}      paginacion         lo que devuelve la API
 * @param {number}      paginacion.page
 * @param {number}      paginacion.limit
 * @param {number}      paginacion.totalRecords
 * @param {number}      paginacion.totalPages
 * @param {Object}      opciones
 * @param {Function}    opciones.onChange  ({ page, limit }) => void
 * @param {Object}     [opciones.etiquetas] { inicio, fin } textos del menú
 * @param {number[]}   [opciones.tamanos]   opciones de filas por página
 * @returns {Function} destroy
 */
export function mountPagination(contenedor, paginacion, opciones = {}) {
  if (!contenedor) return () => {};

  const {
    onChange = () => {},
    etiquetas = ETIQUETAS_POR_DEFECTO,
    tamanos   = TAMANOS_POR_DEFECTO,
  } = opciones;

  const page   = Math.max(1, Number(paginacion?.page)  || 1);
  const limit  = Math.max(1, Number(paginacion?.limit) || 20);
  const total  = Math.max(0, Number(paginacion?.totalRecords) || 0);
  const paginas = Math.max(1, Number(paginacion?.totalPages) || 1);

  const primera = page <= 1;
  const ultima  = page >= paginas;

  // Rango visible. Con 0 resultados no se inventa un «1–0 de 0».
  const desde = total === 0 ? 0 : (page - 1) * limit + 1;
  const hasta = Math.min(page * limit, total);
  const rango = total === 0
    ? 'Sin resultados'
    : `${nf.format(desde)}–${nf.format(hasta)} de ${nf.format(total)}`;

  const opcionesTamano = tamanos
    .map((n) => `<option value="${n}"${n === limit ? ' selected' : ''}>${n}</option>`)
    .join('');

  contenedor.innerHTML = `
    <div class="pagination">
      <label class="pagination-size">
        <span class="pagination-size-label">Filas</span>
        <select class="form-control pagination-size-select" data-pag="size"
                aria-label="Filas por página">${opcionesTamano}</select>
      </label>

      <div class="pagination-range">
        <button type="button" class="pagination-range-btn" data-pag="menu"
                aria-haspopup="menu" aria-expanded="false"
                ${total === 0 ? 'disabled' : ''}>
          <span class="pagination-range-text">${rango}</span>
          <span class="pagination-caret" aria-hidden="true">▾</span>
        </button>

        <div class="pagination-menu" data-pag="menu-panel" role="menu" hidden>
          <button type="button" role="menuitem" data-pag="first" ${primera ? 'disabled' : ''}>
            ${etiquetas.inicio}
          </button>
          <button type="button" role="menuitem" data-pag="last" ${ultima ? 'disabled' : ''}>
            ${etiquetas.fin}
          </button>
        </div>
      </div>

      <div class="pagination-arrows">
        <button type="button" class="btn btn-ghost btn-sm" data-pag="prev"
                aria-label="Página anterior" ${primera ? 'disabled' : ''}>‹</button>
        <button type="button" class="btn btn-ghost btn-sm" data-pag="next"
                aria-label="Página siguiente" ${ultima ? 'disabled' : ''}>›</button>
      </div>
    </div>`;

  const $ = (nombre) => contenedor.querySelector(`[data-pag="${nombre}"]`);
  const botonMenu = $('menu');
  const panelMenu = $('menu-panel');

  const cerrarMenu = () => {
    if (!panelMenu || panelMenu.hidden) return;
    panelMenu.hidden = true;
    botonMenu?.setAttribute('aria-expanded', 'false');
  };

  botonMenu?.addEventListener('click', (e) => {
    e.stopPropagation();      // sin esto, el listener de document lo cierra al instante
    const abierto = !panelMenu.hidden;
    panelMenu.hidden = abierto;
    botonMenu.setAttribute('aria-expanded', String(!abierto));
  });

  // Cerrar al hacer clic afuera o con Escape. Los dos listeners van en document
  // y se quitan en destroy(): si quedaran vivos, cada recarga de la tabla
  // apilaría un par más sobre un menú que ya no existe.
  const alClicFuera = () => cerrarMenu();
  const alTeclear = (e) => {
    if (e.key === 'Escape') { cerrarMenu(); botonMenu?.focus(); }
  };
  document.addEventListener('click', alClicFuera);
  document.addEventListener('keydown', alTeclear);

  const ir = (nuevaPagina, nuevoLimite = limit) => {
    cerrarMenu();
    onChange({ page: Math.min(Math.max(1, nuevaPagina), paginas), limit: nuevoLimite });
  };

  $('prev')?.addEventListener('click',  () => ir(page - 1));
  $('next')?.addEventListener('click',  () => ir(page + 1));
  $('first')?.addEventListener('click', () => ir(1));
  $('last')?.addEventListener('click',  () => ir(paginas));

  // Al cambiar el tamaño se vuelve a la página 1: quedarse en la 7 con 100 filas
  // por página deja al usuario en un lugar del listado que no tiene nada que ver
  // con el que estaba mirando.
  $('size')?.addEventListener('change', (e) => ir(1, Number(e.target.value) || limit));

  return function destroy() {
    document.removeEventListener('click', alClicFuera);
    document.removeEventListener('keydown', alTeclear);
  };
}

/**
 * Etiquetas listas para los listados ordenados por fecha (cotizaciones,
 * licitaciones, auditoría), que es donde la analogía con Gmail aplica tal cual.
 */
export const ETIQUETAS_FECHA = { inicio: 'Más nuevas', fin: 'Más antiguas' };

/** Para listados alfabéticos, donde hablar de «nuevas» y «antiguas» confundiría. */
export const ETIQUETAS_ALFABETICAS = { inicio: 'Primeras (A–Z)', fin: 'Últimas (Z–A)' };
