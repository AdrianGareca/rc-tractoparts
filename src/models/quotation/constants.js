// =============================================================================
// src/models/quotation/constants.js
// State-machine constants and shared SQL fragments for QuotationModel.
//
// Extracted verbatim from src/models/QuotationModel.js — this module holds the
// authoritative access-control matrix and the whitelists that every other
// quotation module (and the controllers) consult.
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// All valid state values for the cotizaciones.estado ENUM column.
// Must mirror the ENUM definition in sql/init.sql exactly.
// 'Pendiente' is the canonical initial state and the DB column default.
// ---------------------------------------------------------------------------
const VALID_STATES = [
  'Pendiente',              // Initial state; quotation is being assembled by the Ejecutivo
  'En revision',            // Submitted; awaiting Jefe's internal approval decision
  'En espera',              // Decision suspended pending external supplier stock checks
  'Aprobada internamente',  // Approved by Jefe; ready to be sent to the client
  'Enviada al cliente',     // Formally delivered to the client
  'Confirmada',             // Client confirmed the terms (formerly 'Aceptada')
  'Aceptada',               // LEGACY alias of 'Confirmada' — tolerated so pre-migration
                            // records and their transitions never crash the state machine.
  'Rechazada',              // Rejected — either internally or by the client
  'Archivada',              // Terminal state; no further transitions allowed
];

// ---------------------------------------------------------------------------
// ROLE_TRANSITIONS — the authoritative access-control matrix for state changes.
//
// Structure: role → estadoActual → allowedNextStates[]
//
// Business rules encoded here (Section 3.7.4 / HU08):
//   • Only 'Jefe' can transition from 'En revision' to approval/rejection states.
//   • 'Ejecutivo' cannot act on a quotation once it has been submitted ('En revision'
//     becomes read-only for them — they must wait for the Jefe's decision).
//   • 'Administracion' may pull back a submitted quotation ('En revision' → 'Pendiente')
//     but cannot approve or reject it.
//   • 'Pendiente' is the canonical initial state per the DB ENUM definition.
// ---------------------------------------------------------------------------
const ROLE_TRANSITIONS = {

  Ejecutivo: {
    Pendiente:               ['En revision', 'Archivada'],
    'En revision':           [],                                    // Read-only: wait for Jefe
    'En espera':             [],                                    // Read-only: Jefe suspended decision
    'Aprobada internamente': ['Enviada al cliente'],
    'Enviada al cliente':    ['Confirmada', 'Rechazada', 'Archivada'],
    Rechazada:               ['Pendiente', 'Archivada'],            // Reset to initial state for rework
    Confirmada:              ['Archivada'],
    Aceptada:                ['Archivada'],                         // LEGACY alias of 'Confirmada'
    Archivada:               [],
  },

  Administracion: {
    // Administracion can submit, place on hold, or cancel — but NOT approve or reject.
    // Approval authority belongs exclusively to the Jefe (business rule: role hierarchy).
    // Post-approval, however, Administracion DOES drive the commercial lifecycle
    // forward: once a quotation is 'Aprobada internamente' it may be sent to the
    // client and then marked accepted/rejected. These are delivery/outcome steps,
    // not approval decisions, so they do not breach the Jefe's exclusive approval
    // authority. This unblocks the linear flow
    // Pendiente → Aprobada internamente → Enviada al cliente → Confirmada.
    Pendiente:               ['En revision', 'En espera', 'Archivada'],
    'En revision':           ['En espera', 'Pendiente', 'Archivada'],   // Can hold or retract
    'En espera':             ['En revision', 'Pendiente', 'Archivada'], // Can resume or retract
    'Aprobada internamente': ['Enviada al cliente', 'Pendiente', 'Archivada'], // Forward to client, request changes, or archive
    'Enviada al cliente':    ['Confirmada', 'Rechazada', 'Archivada'],  // Record client outcome
    Rechazada:               ['Pendiente', 'Archivada'],               // Allow rework cycle
    Confirmada:              ['Archivada'],
    Aceptada:                ['Archivada'],                            // LEGACY alias of 'Confirmada'
    Archivada:               [],
  },

  Jefe: {
    // Absolute commercial authority — can approve, reject, or hold from ANY state.
    // Pendiente can now be directly approved/rejected without requiring the
    // 'En revision' intermediate step (HU08 override fix).
    // 'Enviada al cliente' is reachable from ALL active states so the Jefe can
    // skip the 'Aprobada internamente' intermediate step when the quotation
    // can be sent to the client immediately (HU08 — direct send transition).
    Pendiente:               ['En revision', 'En espera', 'Aprobada internamente', 'Enviada al cliente', 'Rechazada', 'Archivada'],
    'En revision':           ['Aprobada internamente', 'Enviada al cliente', 'Rechazada', 'Pendiente', 'En espera', 'Archivada'],
    'En espera':             ['Aprobada internamente', 'Enviada al cliente', 'Rechazada', 'Pendiente', 'En revision', 'Archivada'],
    // 'En espera' and 'Pendiente' added: allows Jefe to suspend or request changes on
    // a fully-approved quotation before it is sent to the client (HU-CambioPostAprobacion).
    'Aprobada internamente': ['Confirmada', 'Enviada al cliente', 'Rechazada', 'En espera', 'Pendiente', 'Archivada'],
    // 'Pendiente' added: allows Jefe to request changes when the quote has already
    // been sent to the client (asynchronous internal delivery model — HU-CambioPostEnvio).
    // 'En espera' added: Jefe may suspend a delivered quotation while waiting for
    // client confirmation or external factors (HU-EsperaPostEnvio).
    'Enviada al cliente':    ['Confirmada', 'Rechazada', 'Pendiente', 'En espera', 'Archivada'],
    // Rechazada → can be reverted to Pendiente OR En revision by high-privilege roles
    // (HU-Revertir: allows re-injecting into the approval queue after sudden business changes)
    Rechazada:               ['Pendiente', 'En revision', 'Aprobada internamente', 'Archivada'],
    // LLAVE DEL JEFE — 'Pendiente' reabre una venta ya cerrada. Es la excepción
    // para el caso en que el cliente pide corregir datos después de confirmar.
    // No se inventó un estado nuevo: 'Pendiente' es el único donde el ejecutivo
    // dueño puede volver a editar, que es exactamente lo que hace falta.
    // El controller exige un motivo escrito y lo registra como REABRIR_COTIZACION
    // — ver REOPEN_SOURCE_STATES más abajo.
    Confirmada:              ['Archivada', 'Pendiente'],
    Aceptada:                ['Archivada', 'Pendiente'],               // LEGACY alias of 'Confirmada'
    Archivada:               [],
  },

  // SysAdmin — absolute system-wide authority, mirrors Jefe transitions and
  // additionally can fully reset any non-Archivada state back to Pendiente.
  SysAdmin: {
    Pendiente:               ['En revision', 'En espera', 'Aprobada internamente', 'Enviada al cliente', 'Rechazada', 'Archivada'],
    'En revision':           ['Aprobada internamente', 'Enviada al cliente', 'Rechazada', 'Pendiente', 'En espera', 'Archivada'],
    'En espera':             ['Aprobada internamente', 'Enviada al cliente', 'Rechazada', 'Pendiente', 'En revision', 'Archivada'],
    'Aprobada internamente': ['Confirmada', 'Enviada al cliente', 'Rechazada', 'Pendiente', 'Archivada'],
    'Enviada al cliente':    ['Confirmada', 'Rechazada', 'Pendiente', 'Archivada'],
    // Rechazada → can be reverted to Pendiente OR En revision
    Rechazada:               ['Pendiente', 'En revision', 'Aprobada internamente', 'Archivada'],
    Confirmada:              ['Archivada', 'Pendiente'],
    Aceptada:                ['Archivada', 'Pendiente'],              // LEGACY alias of 'Confirmada'
    Archivada:               [],    // Terminal — even SysAdmin cannot un-archive
  },
};

// ---------------------------------------------------------------------------
// LA LLAVE DEL JEFE — reapertura de una venta cerrada
//
// Analogía del área comercial: cuando en un supermercado ya se cerró la venta
// pero hubo un error, se llama al jefe, que tiene una llave para abrir la caja.
// La llave existe, pero se usa poco y deja rastro.
//
// Traducido al sistema: una cotización 'Confirmada' (venta cerrada) puede
// volver a 'Pendiente' — el único estado donde el ejecutivo dueño la puede
// editar de nuevo. NO se agregó un estado "Reabierta": complicaría la máquina de
// estados, los reportes y los badges para representar una situación que dura
// minutos (se corrige el dato y se vuelve a confirmar).
//
// Quién tiene la llave: SOLO 'Jefe' y 'SysAdmin' — se verifica contra el rol
// BASE del usuario, no contra la matriz efectiva. Esto importa porque un
// Ejecutivo con can_approve_quotations opera con la matriz del Jefe: sin este
// recorte, agregarle la llave al Jefe se la habría dado también a cada
// ejecutivo delegado. Reabrir una venta cerrada no se delega, igual que
// revertir un rechazo.
//
// Qué exige: un motivo escrito (el controller responde 422 sin él) que queda
// en cotizacion_historial_estados y en bitacora_auditoria bajo la acción
// dedicada REABRIR_COTIZACION — no mezclada con los CAMBIAR_ESTADO comunes,
// para que buscar "cuántas ventas se reabrieron este mes" sea una consulta y
// no una excavación.
//
// 'Archivada' queda afuera a propósito: sigue siendo terminal para todos. La
// llave abre la caja; no resucita lo que ya se guardó en el archivo.
// ---------------------------------------------------------------------------
const REOPEN_SOURCE_STATES = ['Confirmada', 'Aceptada'];   // 'Aceptada' = alias legado
const REOPEN_TARGET_STATE  = 'Pendiente';
const REOPEN_ROLES         = ['Jefe', 'SysAdmin'];

/**
 * ¿Esta transición es una reapertura de venta cerrada?
 * Se usa en tres lugares (guard de permisos, exigencia del motivo y elección de
 * la acción de auditoría), así que vive acá y no duplicada en cada uno.
 *
 * @param   {string} estadoActual
 * @param   {string} nuevoEstado
 * @returns {boolean}
 */
function isReopening(estadoActual, nuevoEstado) {
  return REOPEN_SOURCE_STATES.includes(estadoActual) && nuevoEstado === REOPEN_TARGET_STATE;
}

// ---------------------------------------------------------------------------
// APPROVAL_SOURCE_STATES — the only quotation states from which an approval
// or rejection decision (nuevoEstado === 'Aprobada internamente'/'Rechazada'
// via the dedicated /:id/aprobar endpoint) may legally be made. Shared between
// validateTransitionByRole (stateMachine.js) and
// QuotationStateController.approveQuotation so both entry points enforce the
// exact same source-state guard.
// ---------------------------------------------------------------------------
const APPROVAL_SOURCE_STATES = ['Pendiente', 'En revision', 'En espera'];

// ---------------------------------------------------------------------------
// REVIEW_REQUIRED_TARGET_STATES — target states a quotation may only reach once
// it satisfies the pre-submission checklist (validateForReview: ≥1 line item,
// monto_total set, fecha_validez set). Historically the checklist was enforced
// ONLY on the 'En revision' transition, letting a Jefe/SysAdmin (or a delegated
// Ejecutivo) bypass it entirely by jumping straight to approval/send — or via
// the dedicated POST /:id/aprobar endpoint. Both entry points now gate on this
// set so an incomplete quotation can never enter the committed/approval phase.
//
// NOT included (deliberately): 'En espera', 'Pendiente', 'Rechazada', 'Archivada'.
// Rejecting or holding an INCOMPLETE quotation is legitimate — the checklist
// only guards forward movement into approval/delivery, never a pull-back.
// ---------------------------------------------------------------------------
const REVIEW_REQUIRED_TARGET_STATES = [
  'En revision',
  'Aprobada internamente',
  'Enviada al cliente',
  'Confirmada',
  'Aceptada',   // LEGACY alias of 'Confirmada'
];

// ---------------------------------------------------------------------------
// STATE_TRANSITIONS — flat fallback matrix (used only for reference / tests).
// ROLE_TRANSITIONS is always the authoritative source in the application.
// ---------------------------------------------------------------------------
const STATE_TRANSITIONS = {
  Pendiente:               ['En revision', 'Archivada'],
  'En revision':           ['Aprobada internamente', 'Rechazada', 'Pendiente', 'En espera', 'Archivada'],
  'En espera':             ['Aprobada internamente', 'Rechazada', 'Pendiente', 'Archivada'],
  'Aprobada internamente': ['Enviada al cliente', 'Archivada'],
  'Enviada al cliente':    ['Confirmada', 'Rechazada', 'Archivada'],
  Rechazada:               ['Pendiente', 'Archivada'],
  Confirmada:              ['Archivada'],
  Aceptada:                ['Archivada'],   // LEGACY alias of 'Confirmada'
  Archivada:               [],
};

// Columns safe for ORDER BY — prevents injection via the sort_by query param
const SORTABLE_COLUMNS = {
  numero_correlativo: 'c.numero_correlativo',
  fecha_emision:      'c.fecha_emision',
  monto_total:        'c.monto_total',
  estado:             'c.estado',
  creado_en:          'c.creado_en',
  cliente_nombre:     'cl.razon_social',
  ejecutivo_nombre:   'u.nombre_completo',
};

// Reusable JOIN block for all SELECT queries on cotizaciones
const BASE_JOINS = `
  INNER JOIN clientes cl ON cl.id = c.id_cliente
  INNER JOIN usuarios u  ON u.id  = c.id_ejecutivo
  LEFT  JOIN usuarios ap ON ap.id = c.aprobado_por
`;

module.exports = {
  VALID_STATES,
  ROLE_TRANSITIONS,
  REOPEN_SOURCE_STATES,
  REOPEN_TARGET_STATE,
  REOPEN_ROLES,
  isReopening,
  APPROVAL_SOURCE_STATES,
  REVIEW_REQUIRED_TARGET_STATES,
  STATE_TRANSITIONS,
  SORTABLE_COLUMNS,
  BASE_JOINS,
};
