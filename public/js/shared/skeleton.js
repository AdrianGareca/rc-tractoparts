// =============================================================================
// public/js/shared/skeleton.js
// Esqueletos de carga: el contorno del contenido que está por llegar.
//
// POR QUÉ REEMPLAZAN AL SPINNER
// Cada panel mostraba un círculo girando centrado en un bloque vacío. Eso tiene
// dos problemas concretos acá:
//
//   • El servidor está en Nueva York y quienes lo usan están en Santa Cruz. La
//     espera es real, no simbólica. Un spinner no dice nada sobre qué está por
//     aparecer, así que la pantalla se siente detenida.
//   • Cuando llega la respuesta, el spinner desaparece y la tabla se planta de
//     golpe: la página salta. Con un esqueleto del mismo alto, el contenido
//     ocupa el lugar que ya estaba reservado y no se mueve nada.
//
// Es la misma espera medida con cronómetro, pero se percibe más corta porque
// hay algo que leer mientras tanto — y sobre todo, no se mueve el piso.
//
// ACCESIBILIDAD
// Las barras son decorativas: van con aria-hidden. El contenedor lleva
// aria-busy y un texto sólo-para-lectores que anuncia la carga, así que un
// lector de pantalla dice "Cargando…" en vez de leer una docena de divs vacíos.
// La animación se apaga sola con prefers-reduced-motion (ver components.css).
// =============================================================================

/**
 * Esqueleto con forma de tabla, para los paneles que listan filas.
 *
 * @param {Object}  [opciones]
 * @param {number}  [opciones.filas=6]      cuántas filas simular
 * @param {number}  [opciones.columnas=6]   cuántas celdas por fila
 * @param {string}  [opciones.etiqueta]     qué se está cargando (para lectores)
 * @returns {string} HTML
 */
export function tableSkeleton({ filas = 6, columnas = 6, etiqueta = 'Cargando datos' } = {}) {
  // Anchos variados: una grilla de barras todas iguales parece una tabla de
  // carga; con anchos desparejos se lee como texto y engaña mejor al ojo.
  const ANCHOS = ['85%', '60%', '72%', '45%', '90%', '55%', '68%', '78%'];

  const celdas = (fila) => Array.from({ length: columnas }, (_, c) =>
    `<div class="skeleton-cell"><span class="skeleton-bar" style="width:${ANCHOS[(fila * columnas + c) % ANCHOS.length]};"></span></div>`
  ).join('');

  const cuerpo = Array.from({ length: filas }, (_, f) =>
    `<div class="skeleton-row">${celdas(f)}</div>`
  ).join('');

  return `
    <div class="skeleton" role="status" aria-busy="true" aria-live="polite">
      <span class="sr-only">${etiqueta}…</span>
      <div class="skeleton-table" aria-hidden="true">
        <div class="skeleton-row skeleton-row-head">
          ${Array.from({ length: columnas }, () =>
            '<div class="skeleton-cell"><span class="skeleton-bar"></span></div>').join('')}
        </div>
        ${cuerpo}
      </div>
    </div>`;
}

/**
 * Esqueleto con forma de tarjetas, para las grillas de métricas del dashboard.
 *
 * @param {Object} [opciones]
 * @param {number} [opciones.tarjetas=4]
 * @param {string} [opciones.etiqueta]
 * @returns {string} HTML
 */
export function cardsSkeleton({ tarjetas = 4, etiqueta = 'Cargando indicadores' } = {}) {
  const items = Array.from({ length: tarjetas }, () => `
    <div class="skeleton-card">
      <span class="skeleton-bar skeleton-bar-titulo"></span>
      <span class="skeleton-bar skeleton-bar-cifra"></span>
    </div>`).join('');

  return `
    <div class="skeleton" role="status" aria-busy="true" aria-live="polite">
      <span class="sr-only">${etiqueta}…</span>
      <div class="skeleton-cards" aria-hidden="true">${items}</div>
    </div>`;
}
