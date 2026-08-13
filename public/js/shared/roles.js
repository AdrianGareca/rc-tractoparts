// =============================================================================
// public/js/shared/roles.js
// Los cinco roles del sistema — la copia del navegador.
//
// ES UNA COPIA DELIBERADA de src/config/roles.js. El servidor es CommonJS y el
// navegador usa modulos nativos, y este proyecto no tiene paso de compilacion
// que pueda compartir un archivo entre los dos. Lo que si se puede es exigir que
// no se separen: tests/unit/rolesUnaSolaLista.test.js compara las dos listas
// —y las dos contra el INSERT INTO roles de sql/init.sql, que es el que manda—.
//
// Mismo criterio que quotationTransitions.js con la matriz de estados y que
// quotationTotals.js con la matematica del dinero.
//
// POR QUE HACIA FALTA
// El detalle de la bitacora traducia el id de rol con un objeto escrito a mano
// que se habia quedado en el 4:
//
//     { 1: 'Ejecutivo', 2: 'Administración', 3: 'Jefe', 4: 'SysAdmin' }
//
// Le faltaba Proyectos —el id 5, agregado despues— asi que el registro de quien
// habilito el modulo de licitaciones mostraba un «5» pelado. Y escribia
// 'Administración' con tilde, contra el 'Administracion' sin tilde de la base.
// =============================================================================

/**
 * Los roles con su id en la tabla `roles`. Mismo orden que el servidor.
 * @type {ReadonlyArray<{id: number, nombre: string}>}
 */
export const ROLES = [
  { id: 1, nombre: 'Ejecutivo' },
  { id: 2, nombre: 'Administracion' },
  { id: 3, nombre: 'Jefe' },
  { id: 4, nombre: 'SysAdmin' },
  { id: 5, nombre: 'Proyectos' },
];

/** Solo los nombres, que es como se compara en casi todo el codigo. */
export const NOMBRES_DE_ROL = ROLES.map((r) => r.nombre);

/** Los dos que pueden intervenir siempre, en cualquier entidad. */
export const ROLES_CON_AUTORIDAD_TOTAL = ['Jefe', 'SysAdmin'];

/**
 * Traduce un id de rol a su nombre, para mostrar.
 *
 * @param {number|string|null} id
 * @returns {string} el nombre, el id tal cual si no se conoce, o '—' si no hay
 */
export function nombreDeRol(id) {
  // Null y undefined son "no hay dato", no "rol desconocido": mismo guion que el
  // resto de los campos vacios de la bitacora.
  if (id === null || id === undefined || id === '') return '—';

  // Number() y no ===: las claves de un objeto JSON son cadenas, asi que el
  // detalle de la bitacora trae '5' y no 5.
  const buscado = ROLES.find((r) => r.id === Number(id));

  // Un id desconocido se muestra tal cual: «undefined» en la pantalla parece que
  // el sistema se rompio, el numero al menos es un dato utilizable.
  return buscado ? buscado.nombre : String(id);
}
