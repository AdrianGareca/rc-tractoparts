// =============================================================================
// public/js/shared/quotationTransitions.js
// Espejo navegable de la máquina de estados del servidor.
//
// POR QUÉ EXISTE
// El selector "Cambiar Estado" del dashboard ofrecía los 8 estados sin filtrar
// por rol ni por estado de origen. Elegir uno inválido no producía nada visible:
// el servidor devolvía 403 con un mensaje técnico y el usuario quedaba mirando
// un error que no tenía forma de anticipar. Peor con la llave del jefe, donde la
// diferencia entre lo permitido y lo prohibido es sutil y depende del rol.
//
// EL RIESGO QUE ESTO INTRODUCE, Y CÓMO SE CONTIENE
// Duplicar una regla de negocio en el front es pedir que las dos copias se
// separen con el tiempo. La contención es tests/unit/quotationTransitionsFront.test.js:
// recorre TODAS las combinaciones rol × estado origen × estado destino y exige
// que lo que este archivo OFRECE sea exactamente lo que el backend ACEPTA. Si
// alguien toca src/models/quotation/constants.js y no toca esto, el test falla
// nombrando la transición desincronizada.
//
// Mismo criterio que quotationTotals.js con la matemática del dinero.
//
// ESTO NO ES UN CONTROL DE SEGURIDAD. Es ayuda visual. La autorización real
// vive en el servidor (stateMachine.validateTransitionByRole) y se revalida en
// cada request sin confiar en nada de lo que venga del navegador.
// =============================================================================

// Copia literal de ROLE_TRANSITIONS en src/models/quotation/constants.js.
// Cualquier cambio allá tiene que reflejarse acá (el test lo verifica).
export const ROLE_TRANSITIONS = {

  Ejecutivo: {
    Pendiente:               ['En revision', 'Archivada'],
    'En revision':           [],
    'En espera':             [],
    'Aprobada internamente': ['Enviada al cliente'],
    'Enviada al cliente':    ['Confirmada', 'Rechazada', 'Archivada'],
    Rechazada:               ['Pendiente', 'Archivada'],
    Confirmada:              ['Archivada'],
    Aceptada:                ['Archivada'],
    Archivada:               [],
  },

  Administracion: {
    Pendiente:               ['En revision', 'En espera', 'Archivada'],
    'En revision':           ['En espera', 'Pendiente', 'Archivada'],
    'En espera':             ['En revision', 'Pendiente', 'Archivada'],
    'Aprobada internamente': ['Enviada al cliente', 'Pendiente', 'Archivada'],
    'Enviada al cliente':    ['Confirmada', 'Rechazada', 'Archivada'],
    Rechazada:               ['Pendiente', 'Archivada'],
    Confirmada:              ['Archivada'],
    Aceptada:                ['Archivada'],
    Archivada:               [],
  },

  Jefe: {
    Pendiente:               ['En revision', 'En espera', 'Aprobada internamente', 'Enviada al cliente', 'Rechazada', 'Archivada'],
    'En revision':           ['Aprobada internamente', 'Enviada al cliente', 'Rechazada', 'Pendiente', 'En espera', 'Archivada'],
    'En espera':             ['Aprobada internamente', 'Enviada al cliente', 'Rechazada', 'Pendiente', 'En revision', 'Archivada'],
    'Aprobada internamente': ['Confirmada', 'Enviada al cliente', 'Rechazada', 'En espera', 'Pendiente', 'Archivada'],
    'Enviada al cliente':    ['Confirmada', 'Rechazada', 'Pendiente', 'En espera', 'Archivada'],
    Rechazada:               ['Pendiente', 'En revision', 'Aprobada internamente', 'Archivada'],
    Confirmada:              ['Archivada', 'Pendiente'],   // 'Pendiente' = llave del jefe
    Aceptada:                ['Archivada', 'Pendiente'],
    Archivada:               [],
  },

  SysAdmin: {
    Pendiente:               ['En revision', 'En espera', 'Aprobada internamente', 'Enviada al cliente', 'Rechazada', 'Archivada'],
    'En revision':           ['Aprobada internamente', 'Enviada al cliente', 'Rechazada', 'Pendiente', 'En espera', 'Archivada'],
    'En espera':             ['Aprobada internamente', 'Enviada al cliente', 'Rechazada', 'Pendiente', 'En revision', 'Archivada'],
    'Aprobada internamente': ['Confirmada', 'Enviada al cliente', 'Rechazada', 'Pendiente', 'Archivada'],
    'Enviada al cliente':    ['Confirmada', 'Rechazada', 'Pendiente', 'Archivada'],
    Rechazada:               ['Pendiente', 'En revision', 'Aprobada internamente', 'Archivada'],
    Confirmada:              ['Archivada', 'Pendiente'],
    Aceptada:                ['Archivada', 'Pendiente'],
    Archivada:               [],
  },
};

// ── La llave del jefe ────────────────────────────────────────────────────────
// Reapertura de una venta cerrada. Sólo Jefe y SysAdmin, y sólo hacia
// 'Pendiente' (el único estado donde el ejecutivo dueño puede volver a editar).
export const REOPEN_SOURCE_STATES = ['Confirmada', 'Aceptada'];
export const REOPEN_TARGET_STATE  = 'Pendiente';
export const REOPEN_ROLES         = ['Jefe', 'SysAdmin'];

// Estados desde los que la delegación de aprobación habilita el destino
// 'Aprobada internamente' aunque la matriz base del rol no lo incluya.
export const APPROVAL_SOURCE_STATES = ['Pendiente', 'En revision', 'En espera'];

/**
 * ¿Esta transición es una reapertura de venta cerrada?
 * @param   {string} estadoActual
 * @param   {string} nuevoEstado
 * @returns {boolean}
 */
export function isReopening(estadoActual, nuevoEstado) {
  return REOPEN_SOURCE_STATES.includes(estadoActual) && nuevoEstado === REOPEN_TARGET_STATE;
}

/**
 * Estados a los que este usuario puede llevar la cotización desde donde está.
 *
 * Reproduce paso a paso lo que hace validateTransitionByRole en el servidor:
 *   1. la delegación convierte al Ejecutivo en Jefe para el ciclo comercial;
 *   2. la llave se recorta según el rol BASE (un delegado no reabre ventas);
 *   3. la delegación agrega 'Aprobada internamente' desde los estados previos.
 *
 * @param   {string}  rol                   — rol base del usuario (el del JWT)
 * @param   {string}  estadoActual
 * @param   {boolean} [canApproveQuotations] — flag de delegación
 * @returns {string[]} lista (posiblemente vacía) de destinos válidos
 */
export function allowedTransitions(rol, estadoActual, canApproveQuotations = false) {
  const effectiveRol = (rol === 'Ejecutivo' && canApproveQuotations === true) ? 'Jefe' : rol;
  const roleMatrix   = ROLE_TRANSITIONS[effectiveRol];

  // Rol desconocido: no se ofrece nada en vez de romper la pantalla.
  if (!roleMatrix) return [];

  let permitidos = [...(roleMatrix[estadoActual] || [])];

  // La llave se decide por el rol BASE, no por el efectivo.
  if (REOPEN_SOURCE_STATES.includes(estadoActual) && !REOPEN_ROLES.includes(rol)) {
    permitidos = permitidos.filter((s) => s !== REOPEN_TARGET_STATE);
  }

  // Delegación de funciones: 'Aprobada internamente' siempre disponible desde
  // los estados previos a la aprobación.
  const puedeAprobar = REOPEN_ROLES.includes(rol) || canApproveQuotations === true;
  if (APPROVAL_SOURCE_STATES.includes(estadoActual) &&
      puedeAprobar &&
      !permitidos.includes('Aprobada internamente')) {
    permitidos.push('Aprobada internamente');
  }

  return permitidos;
}
