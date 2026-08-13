// =============================================================================
// src/config/roles.js
// Los cinco roles del sistema, en un solo lugar.
//
// POR QUE EXISTE
// Los nombres estaban escritos a mano 168 veces en 37 archivos, y con esa
// cantidad de copias ya habian aparecido dos que no coincidian con ninguna:
// 'Administración' con tilde, y un mapa de ids que se quedo en el 4 y no conoce
// a Proyectos.
//
// Un nombre de rol mal escrito NO DA ERROR. La comparacion devuelve false, el
// permiso no se da —o se da de mas— y el sistema sigue andando sin sintoma. Es
// la peor forma de fallar que hay, y por eso vale la pena tener una lista.
//
// QUE ES AUTORITATIVO Y QUE NO
// Esta lista NO manda: manda el INSERT INTO roles de sql/init.sql, que es lo
// que crea la tabla. Este archivo es un espejo, y tests/unit/rolesUnaSolaLista
// exige que sea fiel — si alguien agrega un rol al .sql y no aca, el test lo
// dice con nombre y apellido.
//
// EL ID NUMERICO SOLO SIRVE PARA LEER LA BITACORA
// El JWT lleva el NOMBRE del rol, no el id (ver el payload en authController).
// Los ids aparecen en un unico lugar del producto: el detalle de la bitacora,
// que registra el id_rol viejo y el nuevo cuando alguien cambia un permiso. Para
// TODO lo demas —autorizacion, matrices de transicion, visibilidad— se compara
// por nombre.
// =============================================================================

'use strict';

/**
 * Los roles, con el id que tienen en la tabla `roles`.
 * El orden es el del INSERT de sql/init.sql, y el test lo exige asi: comparar
 * en orden hace que un rol agregado en el medio salte a la vista.
 */
const ROLES = [
  { id: 1, nombre: 'Ejecutivo' },       // Comercial: carga cotizaciones
  { id: 2, nombre: 'Administracion' },  // Administrativo: clientes y registros
  { id: 3, nombre: 'Jefe' },            // Aprueba cotizaciones y gestiona usuarios
  { id: 4, nombre: 'SysAdmin' },        // Autoridad absoluta sobre todo el sistema
  { id: 5, nombre: 'Proyectos' },       // Licitaciones; no crea cotizaciones
];

/** Solo los nombres, que es como se compara en el 99% del codigo. */
const NOMBRES_DE_ROL = ROLES.map((r) => r.nombre);

/** Los dos que pueden intervenir siempre, en cualquier entidad. */
const ROLES_CON_AUTORIDAD_TOTAL = ['Jefe', 'SysAdmin'];

/**
 * Traduce un id de rol a su nombre, para mostrar.
 *
 * @param {number|string|null} id — llega como texto desde el JSON de la bitacora
 * @returns {string} el nombre, el id tal cual si no se conoce, o '—' si no hay
 */
function nombreDeRol(id) {
  // Null y undefined son "no hay dato", no "rol desconocido": se muestran con el
  // mismo guion que el resto de los campos vacios de la bitacora.
  if (id === null || id === undefined || id === '') return '—';

  // Number() y no ===: las claves de un objeto JSON son cadenas, asi que el
  // detalle de la bitacora trae '5' y no 5. Comparar con === contra el numero
  // no coincide y el rol se mostraria como desconocido.
  const buscado = ROLES.find((r) => r.id === Number(id));

  // Un id que no esta en la lista se muestra tal cual. Devolver undefined
  // imprimiria «undefined» en la pantalla, que parece que el sistema se rompio;
  // el numero pelado al menos es un dato con el que alguien puede trabajar.
  return buscado ? buscado.nombre : String(id);
}

module.exports = { ROLES, NOMBRES_DE_ROL, ROLES_CON_AUTORIDAD_TOTAL, nombreDeRol };
