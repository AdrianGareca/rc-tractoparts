// =============================================================================
// src/models/quotation/stateMachine.js
// State-machine enforcement and the approval workflow (HU08):
// role-based transition validation, the pre-submission checklist, the
// role-aware UPDATE, the dedicated approve/reject write, and the
// cotizacion_historial_estados timeline (write + read).
// =============================================================================

'use strict';

const { pool } = require('../../config/db');
const { ROLE_TRANSITIONS, APPROVAL_SOURCE_STATES } = require('./constants');

// ---------------------------------------------------------------------------
// validateTransitionByRole (Section 3.7.4 — Permission Matrix)
// Synchronous helper: looks up the role-based transition matrix and returns a
// structured result object. The controller uses this before calling updateStatus
// so it can return a specific HTTP 403 with an actionable error message.
//
// @param {string}  estadoActual          - Current state of the quotation
// @param {string}  nuevoEstado           - Target state requested by the caller
// @param {string}  rol                   - Calling user's role name
// @param {boolean} canApproveQuotations  - Delegación de Funciones flag for the
//                                          calling user (usuarios.can_approve_quotations).
//                                          Defaults to false so all existing
//                                          callers keep their exact behavior.
//
// @returns {{ valid: boolean, reason?: string, allowedTransitions?: string[] }}
// ---------------------------------------------------------------------------
function validateTransitionByRole(estadoActual, nuevoEstado, rol, canApproveQuotations = false) {
  // ── Delegación de Funciones AMPLIADA ────────────────────────────────────
  // An Ejecutivo holding the can_approve_quotations flag operates the FULL
  // quotation lifecycle with the Jefe's transition matrix (aprobar, enviar,
  // confirmar, solicitar cambios, en espera, rechazar). They remain an
  // 'Ejecutivo' everywhere else — user management, audit logs and every other
  // route enforce the base role via middleware and never consult this matrix.
  // The flag is re-read fresh from the DB by the controller on every call, so
  // revoking it takes effect immediately without waiting for JWT expiry.
  const effectiveRol = (rol === 'Ejecutivo' && canApproveQuotations === true) ? 'Jefe' : rol;
  const roleMatrix = ROLE_TRANSITIONS[effectiveRol];

  // Rol desconocido — no debería llegar aquí si el middleware de autenticación está activo
  if (!roleMatrix) {
    return {
      valid:  false,
      reason: `El rol '${rol}' no está reconocido en la máquina de estados del sistema.`,
    };
  }

  const allowedFromState = roleMatrix[estadoActual] || [];

  // ── Dynamic Function Delegation (Delegación de Funciones) ──────────────────
  // A transition to 'Aprobada internamente' is authorized when the caller is a
  // Jefe (id_rol 3) or SysAdmin (superuser) — OR any user holding the delegated
  // can_approve_quotations flag — provided the source state is one of the
  // legitimate pre-approval states. Administracion is intentionally EXCLUDED
  // here: per ROLE_TRANSITIONS.Administracion in constants.js, approval authority
  // belongs exclusively to the Jefe unless explicitly delegated via the flag
  // (an Administracion user without the flag must not be able to approve).
  // This is strictly ADDITIVE: it only ever GRANTS the single
  // 'Aprobada internamente' target and never removes a transition the base
  // role already had, so the audited core lifecycle is preserved.
  const isDelegatedApproval =
    nuevoEstado === 'Aprobada internamente' &&
    APPROVAL_SOURCE_STATES.includes(estadoActual) &&
    (rol === 'Jefe' || rol === 'SysAdmin' || canApproveQuotations === true);

  if (isDelegatedApproval) {
    return {
      valid:              true,
      allowedTransitions: Array.from(new Set([...allowedFromState, 'Aprobada internamente'])),
    };
  }

  if (!allowedFromState.includes(nuevoEstado)) {
    // Mensaje de error específico: distinguir "sin transiciones posibles" de "destino incorrecto"
    const reason = allowedFromState.length === 0
      ? `El rol '${rol}' no puede realizar ninguna transición desde el estado '${estadoActual}'. ` +
        `Este estado es de solo lectura para su rol.`
      : `El rol '${rol}' no puede transicionar desde '${estadoActual}' hacia '${nuevoEstado}'. ` +
        `Transiciones permitidas desde '${estadoActual}' para su rol: [${allowedFromState.join(', ')}].`;

    return {
      valid:              false,
      reason,
      allowedTransitions: allowedFromState,
    };
  }

  return { valid: true, allowedTransitions: allowedFromState };
}

// ---------------------------------------------------------------------------
// validateForReview (Section 4.3 — Pre-submission checklist)
// Validates that a quotation satisfies all mandatory conditions before it can
// be transitioned to 'En revision'. Returns a (possibly empty) errors array.
// An empty array means the quotation is ready; any errors block the transition.
//
// Checks:
//   1. At least one line item exists in cotizacion_detalles
//   2. monto_total is set (not NULL) — must be calculated before submission
//   3. fecha_validez is set — client needs a validity window
//
// @param  {number} quotationId
// @returns {Promise<Array<{ field: string, message: string }>>}
// ---------------------------------------------------------------------------
async function validateForReview(quotationId) {
  const errors = [];

  // Check mandatory header fields in a single query
  const [headerRows] = await pool.execute(
    'SELECT monto_total, fecha_validez FROM cotizaciones WHERE id = ?',
    [quotationId]
  );

  if (!headerRows[0]) {
    return [{ field: 'id', message: 'Quotation not found.' }];
  }

  const { monto_total, fecha_validez } = headerRows[0];

  if (monto_total === null) {
    errors.push({
      field:   'monto_total',
      message: 'Total amount (monto_total) must be calculated and set before submitting for review.',
    });
  }

  if (!fecha_validez) {
    errors.push({
      field:   'fecha_validez',
      message: 'A validity date (fecha_validez) must be specified before submitting for review.',
    });
  }

  // Verify at least one line item exists
  const [countRows] = await pool.execute(
    'SELECT COUNT(*) AS total FROM cotizacion_detalles WHERE id_cotizacion = ?',
    [quotationId]
  );

  if (countRows[0].total === 0) {
    errors.push({
      field:   'detalles',
      message: 'The quotation must contain at least one line item before submission for review.',
    });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// updateStatus (Sprint 2 — role-aware)
// Executes a state transition after role-based validation. The caller is
// expected to have already called validateTransitionByRole and handled the
// error response. This method validates again as defense-in-depth and uses
// optimistic concurrency (AND estado = estadoActual) to prevent race conditions.
//
// @param {number}  id              - Quotation primary key
// @param {string}  nuevoEstado     - Validated target state
// @param {string}  estadoActual    - Current state (optimistic concurrency lock)
// @param {string}  rol             - Calling user's role (for re-validation)
// @param {string|null} comentarioAdmin - Optional admin comment to persist alongside the transition
// @param {boolean} canApproveQuotations - Delegación de Funciones flag (forwarded to the guard)
// @returns {boolean}               - true if the row was updated
// ---------------------------------------------------------------------------
async function updateStatus(id, nuevoEstado, estadoActual, rol, comentarioAdmin = null, canApproveQuotations = false, aprobadoPor = null) {
  // Defense-in-depth: re-validate the role-based transition inside the model
  const check = validateTransitionByRole(estadoActual, nuevoEstado, rol, canApproveQuotations);

  if (!check.valid) {
    const err = new Error(check.reason);
    err.code  = 'FORBIDDEN_TRANSITION';         // Controller checks this code
    err.allowedTransitions = check.allowedTransitions || [];
    throw err;
  }

  // Optimistic concurrency: the WHERE clause includes the expected current state.
  // If another request changed the state between our findById and this UPDATE,
  // affectedRows = 0 and the controller returns a 409 Conflict.
  //
  // If comentarioAdmin is provided, persist it in the same atomic UPDATE so
  // the comment and the state change are never split across two writes.
  // Build the SET clause dynamically so a single atomic UPDATE can carry the
  // state change, the optional admin comment, and the sale-closure timestamp.
  const setClauses = ['estado = ?'];
  const params     = [nuevoEstado];

  if (comentarioAdmin !== null && comentarioAdmin !== undefined) {
    setClauses.push('comentarios_admin = ?');
    params.push(String(comentarioAdmin).trim() || null);
  }

  // Sale-closure timestamp: stamp the EXACT moment the quotation becomes
  // 'Confirmada' (venta cerrada). 'Aceptada' is the legacy alias of the same
  // terminal outcome, handled defensively. 'Confirmada' is near-terminal (only
  // → 'Archivada'), so this is written exactly once and never overwritten.
  if (nuevoEstado === 'Confirmada' || nuevoEstado === 'Aceptada') {
    setClauses.push('fecha_confirmacion = NOW()');
  }

  // Approval traceability: when the target is 'Aprobada internamente' and the
  // controller supplied the acting user's id, record WHO approved and WHEN —
  // exactly like the dedicated POST /:id/aprobar endpoint does. This closes
  // the metadata gap for approvals executed through this generic transition
  // route (delegated executives, or a Jefe using the state endpoint directly).
  if (nuevoEstado === 'Aprobada internamente' && aprobadoPor != null) {
    setClauses.push('aprobado_por = ?', 'fecha_aprobacion = NOW()');
    params.push(aprobadoPor);
  }

  const sql = `UPDATE cotizaciones SET ${setClauses.join(', ')} WHERE id = ? AND estado = ?`;
  params.push(id, estadoActual);

  const [result] = await pool.execute(sql, params);
  return result.affectedRows > 0;
}

// ---------------------------------------------------------------------------
// approve (HU08 — Jefe / SysAdmin approval/rejection)
// Dedicated method for the approval workflow. Records the decision, the
// approver's identity, the timestamp, and the mandatory observation text.
//
// The caller (QuotationStateController.approveQuotation) validates that
// `currentState` is one of APPROVAL_SOURCE_STATES before invoking this
// method — this function itself enforces no state restriction. The WHERE
// clause uses the caller-supplied `currentState` for optimistic concurrency
// — it guarantees that two concurrent requests for the same quotation
// cannot both succeed.
//
// @param {number}  id            - Quotation primary key
// @param {number}  aprobadoPor   - User ID of the approver (from req.user.id)
// @param {boolean} aprobado      - true = Aprobada internamente; false = Rechazada
// @param {string}  observaciones - Justification text (mandatory on rejection)
// @param {string}  currentState  - State read by the controller (optimistic lock)
// @returns {boolean}             - true if the row was updated
// ---------------------------------------------------------------------------
async function approve(id, aprobadoPor, aprobado, observaciones, currentState) {
  const nuevoEstado = aprobado
    ? 'Aprobada internamente'
    : 'Rechazada';

  // Use the caller-supplied currentState as the concurrency guard so that
  // any state (not only 'En revision') can be the source of an approval.
  const sql = `
      UPDATE cotizaciones
      SET
        estado           = ?,
        aprobado_por     = ?,
        fecha_aprobacion = NOW(),
        obs_aprobacion   = ?
      WHERE id = ? AND estado = ?
    `;

  const [result] = await pool.execute(sql, [
    nuevoEstado,
    aprobadoPor,
    observaciones || null,
    id,
    currentState,
  ]);

  return result.affectedRows > 0;
}

// ---------------------------------------------------------------------------
// logStateHistory (Section 4.3 — Historial de estados)
// Inserts one record into cotizacion_historial_estados whenever a state
// transition occurs. This table is dedicated to the quotation lifecycle
// and provides a cleaner timeline view than querying bitacora_auditoria.
//
// This method is fire-and-forget (errors are caught and logged; they must
// never block the primary business operation).
//
// @param {Object} data
//   id_cotizacion  {number}
//   estado_anterior {string}
//   estado_nuevo    {string}
//   id_usuario      {number|null}
//   nombre_usuario  {string|null}
//   rol_usuario     {string|null}
//   observacion     {string|null}
//   ip_origen       {string|null}
// ---------------------------------------------------------------------------
async function logStateHistory({
  id_cotizacion,
  estado_anterior,
  estado_nuevo,
  id_usuario    = null,
  nombre_usuario = null,
  rol_usuario   = null,
  observacion   = null,
  ip_origen     = null,
}) {
  try {
    await pool.execute(
      `INSERT INTO cotizacion_historial_estados
           (id_cotizacion, estado_anterior, estado_nuevo, id_usuario,
            nombre_usuario, rol_usuario, observacion, ip_origen)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id_cotizacion,
        estado_anterior,
        estado_nuevo,
        id_usuario,
        nombre_usuario,
        rol_usuario,
        observacion,
        ip_origen,
      ]
    );
  } catch (err) {
    // Log internally but never propagate — history failure must not block transitions
    console.error(
      '[QuotationModel.logStateHistory] Failed to write history record:',
      err.message,
      { id_cotizacion, estado_anterior, estado_nuevo }
    );
  }
}

// ---------------------------------------------------------------------------
// findStateHistory (Section 4.3 — GET /api/cotizaciones/:id/historial)
// Returns the complete ordered timeline of state transitions for a quotation,
// combining the dedicated history table with the creation event from the
// audit log so the timeline starts at the moment of creation.
//
// @param  {number} quotationId
// @returns {Promise<Array<Object>>}
// ---------------------------------------------------------------------------
async function findStateHistory(quotationId) {
  // Primary source: dedicated history table (all state changes after creation)
  const sqlHistory = `
      SELECT
        h.id,
        h.estado_anterior,
        h.estado_nuevo,
        h.nombre_usuario,
        h.rol_usuario,
        h.observacion,
        h.ip_origen,
        h.creado_en,
        'transicion'         AS tipo_evento
      FROM cotizacion_historial_estados h
      WHERE h.id_cotizacion = ?
      ORDER BY h.creado_en ASC
    `;

  const [historyRows] = await pool.execute(sqlHistory, [quotationId]);

  // Enrich with the creation event from bitacora_auditoria so the
  // timeline's first entry is always the creation record
  const sqlCreation = `
      SELECT
        ba.id,
        NULL                 AS estado_anterior,
        'Pendiente'          AS estado_nuevo,
        ba.nombre_usuario,
        NULL                 AS rol_usuario,
        NULL                 AS observacion,
        ba.ip_origen,
        ba.creado_en,
        'creacion'           AS tipo_evento
      FROM bitacora_auditoria ba
      WHERE ba.entidad = 'cotizaciones'
        AND ba.id_entidad = ?
        AND ba.accion     = 'CREAR_COTIZACION'
        AND ba.resultado  = 'exito'
      LIMIT 1
    `;

  const [creationRows] = await pool.execute(sqlCreation, [quotationId]);

  // Merge: creation event first, then the state transitions in order
  return [...creationRows, ...historyRows];
}

module.exports = {
  validateTransitionByRole,
  validateForReview,
  updateStatus,
  approve,
  logStateHistory,
  findStateHistory,
};
