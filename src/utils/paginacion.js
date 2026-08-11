// =============================================================================
// src/utils/paginacion.js
// El bloque `pagination` que acompaña a toda respuesta paginada.
//
// LO QUE SE ENCONTRÓ AL MEDIR
// Cuatro controladores lo armaban a mano, y los cuatro habían quedado distintos:
//
//   auditoriaController        { page, limit, totalRecords, totalPages, hasNext, hasPrev }
//   quotationQueryController   igual
//   reportesController         igual, pero hasNext calculado con OTRA fórmula
//   clientController           SIN hasNext ni hasPrev
//
// Hoy no rompe nada porque el control de paginación del navegador
// (shared/pagination.js) sólo lee `totalPages`. Pero el contrato de la API sí
// está roto: tres endpoints prometen dos campos y el cuarto no los manda, y eso
// no se descubre leyendo la documentación —que los describe igual para todos—
// sino consumiendo el endpoint.
//
// SOBRE LAS DOS FÓRMULAS DE hasNext
// `page < totalPages` y `page * limit < totalRecords` dan el mismo resultado
// para toda entrada válida; se puede comprobar con los casos borde (última
// página exacta, última página parcial, cero registros). No era un bug: era
// dos personas resolviendo lo mismo sin saber que el otro ya lo había hecho.
// Que sean equivalentes es suerte, no diseño — y la próxima puede no serlo.
// =============================================================================

'use strict';

/**
 * Arma el bloque `pagination` de una respuesta.
 *
 * @param   {Object} o
 * @param   {number} o.page          — página pedida, 1-indexada
 * @param   {number} o.limit         — tamaño de página
 * @param   {number} o.totalRecords  — total de filas SIN paginar (el COUNT)
 * @returns {{page:number, limit:number, totalRecords:number,
 *            totalPages:number, hasNext:boolean, hasPrev:boolean}}
 *
 * @example
 *   const [rows, total] = await Promise.all([Model.find(...), Model.count(...)]);
 *   return res.json({ success: true, data: rows,
 *                     pagination: construirPaginacion({ page, limit, totalRecords: total }) });
 */
function construirPaginacion({ page, limit, totalRecords }) {
  // Se normalizan las entradas antes de calcular. Los controladores ya validan
  // sus parámetros, pero esta función también la usan rutas nuevas y un limit
  // en cero produciría Infinity en la división.
  const pagina = Math.max(1, Number(page) || 1);
  const tamano = Math.max(1, Number(limit) || 1);
  const total  = Math.max(0, Number(totalRecords) || 0);

  // `Math.max(1, …)` y no `|| 1`: con cero registros el techo da 0, y una lista
  // vacía sigue siendo «página 1 de 1». Decir «página 1 de 0» confunde, y el
  // control del navegador dibujaría un rango imposible.
  const totalPages = Math.max(1, Math.ceil(total / tamano));

  return {
    page:  pagina,
    limit: tamano,
    totalRecords: total,
    totalPages,
    // Una sola fórmula para los cuatro endpoints. Se elige `page < totalPages`
    // porque se lee como lo que significa —quedan páginas después de ésta— sin
    // tener que multiplicar mentalmente.
    hasNext: pagina < totalPages,
    hasPrev: pagina > 1,
  };
}

module.exports = { construirPaginacion };
