// =============================================================================
// public/js/views/dashboard/modules/licitacion/permissions.js
// Matriz de transiciones y permisos de licitaciones (lado cliente).
//
// Espejo de LicitacionModel.LICITACION_ROLE_TRANSITIONS. Es SOLO para UX —
// decide qué botones se muestran; el servidor revalida cada transición. Aun así
// una divergencia acá se siente como un bug: el usuario ve un botón, lo aprieta
// y recibe un 403.
//
// Todas las funciones son PURAS: reciben el usuario en vez de leer AuthSession,
// así se pueden testear sin sesión ni DOM. La vista arma el objeto una sola vez
// con currentUser().
//
// Extraído de licitacionesView.js sin cambios de comportamiento.
// Cubierto por tests/unit/licitacionPermissions.test.js.
// =============================================================================

import AuthSession from '../../../../services/authSession.js';

export const ESTADOS = [
  'En preparacion', 'Cotizando', 'En evaluacion',
  'Presentada', 'Adjudicada', 'No adjudicada', 'Archivada',
];

// Client-side mirror of LicitacionModel.LICITACION_ROLE_TRANSITIONS. Purely for
// UX (which buttons to show); the server re-validates every transition.
export const TRANSITIONS = {
  responsable: {
    'En preparacion': ['Cotizando', 'Archivada'],
    'Cotizando':      ['En evaluacion', 'En preparacion'],
    'En evaluacion':  ['Presentada', 'Cotizando'],
    'Presentada':     ['Adjudicada', 'No adjudicada'],
    'Adjudicada':     ['Archivada'],
    'No adjudicada':  ['Archivada'],
    'Archivada':      [],
  },
  delegado: {
    'En preparacion': [],
    'Cotizando':      ['En evaluacion'],
    'En evaluacion':  ['Presentada', 'Cotizando'],
    'Presentada':     [],
    'Adjudicada':     [],
    'No adjudicada':  [],
    'Archivada':      [],
  },
  jefe: {
    'En preparacion': ['Cotizando', 'En evaluacion', 'Presentada', 'Adjudicada', 'No adjudicada', 'Archivada'],
    'Cotizando':      ['En preparacion', 'En evaluacion', 'Presentada', 'Adjudicada', 'No adjudicada', 'Archivada'],
    'En evaluacion':  ['En preparacion', 'Cotizando', 'Presentada', 'Adjudicada', 'No adjudicada', 'Archivada'],
    'Presentada':     ['En evaluacion', 'Cotizando', 'Adjudicada', 'No adjudicada', 'Archivada'],
    'Adjudicada':     ['No adjudicada', 'Archivada'],
    'No adjudicada':  ['Adjudicada', 'Archivada'],
    'Archivada':      [],
  },
};

/** Estados en los que la cabecera todavía se puede editar. */
export const EDITABLE_STATES = ['En preparacion', 'Cotizando'];

/** Los gastos (análisis de resultado) sólo aplican una vez adjudicada. */
export const GASTO_STATES = ['Adjudicada', 'Archivada'];

/**
 * Snapshot del usuario actual, leído una sola vez desde la sesión.
 * @returns {{ role: string, userId: number, canApprove: boolean }}
 */
export function currentUser() {
  return {
    role:       AuthSession.getRole(),
    userId:     AuthSession.getUserId(),
    canApprove: AuthSession.canApproveQuotations(),
  };
}

/**
 * Tipo de actor del usuario para ESTA licitación. Función pura.
 * @returns {'jefe'|'responsable'|'delegado'|null} — null = solo lectura.
 */
export function resolveActorType(licitacion, user) {
  const { role, userId, canApprove } = user ?? {};
  if (role === 'Jefe' || role === 'SysAdmin') return 'jefe';
  if (role === 'Proyectos' && userId === licitacion?.id_responsable) return 'responsable';
  if (role === 'Ejecutivo' && canApprove) return 'delegado';
  return null; // read-only
}

/** Estados a los que este usuario puede mover la licitación. Función pura. */
export function allowedTransitions(licitacion, user) {
  const actor = resolveActorType(licitacion, user);
  if (!actor) return [];
  return TRANSITIONS[actor][licitacion?.estado] || [];
}

/**
 * Quién puede cargar/eliminar gastos: Administración + responsable Proyectos +
 * Jefe/SysAdmin. Distinto de resolveActorType, que deja a Administración en solo
 * lectura para el resto de la licitación. Función pura.
 */
export function canManageGastos(licitacion, user) {
  const { role, userId } = user ?? {};
  if (role === 'Jefe' || role === 'SysAdmin' || role === 'Administracion') return true;
  return role === 'Proyectos' && userId === licitacion?.id_responsable;
}

/** ¿La cabecera de esta licitación todavía se puede editar? */
export function isEditable(licitacion) {
  return EDITABLE_STATES.includes(licitacion?.estado);
}

/** ¿Corresponde mostrar el bloque de gastos/resultado? */
export function showsGastos(licitacion) {
  return GASTO_STATES.includes(licitacion?.estado);
}
