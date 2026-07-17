// =============================================================================
// src/utils/auditLog.js
// Centralized Audit Logger (Section 3.5.2 — bitacora_auditoria table)
//
// Inserts an immutable record into bitacora_auditoria for every significant
// system event (login, create, approve, state change, download, etc.).
// This function is fire-and-forget: it logs errors internally but never throws,
// so a logging failure never blocks the primary business operation.
// =============================================================================

'use strict';

const { pool } = require('../config/db'); // Shared MySQL connection pool

// ---------------------------------------------------------------------------
// logEvent
// Inserts one audit record into bitacora_auditoria.
//
// @param {Object} params
//   @param {number|null}  params.id_usuario     - ID of the acting user (null for system actions)
//   @param {string|null}  params.nombre_usuario  - Username at the time of the event
//   @param {string}       params.accion          - Action code: LOGIN, CREAR_COTIZACION, APROBAR…
//   @param {string|null}  params.entidad         - Table name of the affected entity
//   @param {number|null}  params.id_entidad      - Primary key of the affected record
//   @param {Object|null}  params.detalle         - Extra context (JSON); e.g. {before, after}
//   @param {string|null}  params.ip_origen       - Client IP address (IPv4 or IPv6)
//   @param {'exito'|'fallo'} params.resultado    - Outcome of the operation
// ---------------------------------------------------------------------------
async function logEvent({
  id_usuario    = null,
  nombre_usuario = null,
  accion,
  entidad       = null,
  id_entidad    = null,
  detalle       = null,
  ip_origen     = null,
  resultado     = 'exito',
}) {
  try {
    // Serialize the detail object to JSON string for the JSON column.
    // MySQL 8 stores this natively; using a string value is safe.
    const detalleJson = detalle ? JSON.stringify(detalle) : null;

    // Parameterized INSERT — immune to SQL injection
    const sql = `
      INSERT INTO bitacora_auditoria
        (id_usuario, nombre_usuario, accion, entidad, id_entidad, detalle, ip_origen, resultado)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await pool.execute(sql, [
      id_usuario,
      nombre_usuario,
      accion,
      entidad,
      id_entidad,
      detalleJson,
      ip_origen,
      resultado,
    ]);
  } catch (error) {
    // Log to stdout but never propagate — audit failures must not disrupt business logic
    console.error('[AuditLog] Failed to write audit record:', error.message, {
      accion,
      entidad,
      id_entidad,
    });
  }
}

// ---------------------------------------------------------------------------
// Convenience helpers — pre-fill the action code so callers stay DRY
// ---------------------------------------------------------------------------

const AuditActions = {
  LOGIN:             'LOGIN',
  LOGOUT:            'LOGOUT',
  LOGIN_FAILED:      'LOGIN_FAILED',
  CREAR_COTIZACION:  'CREAR_COTIZACION',
  EDITAR_COTIZACION: 'EDITAR_COTIZACION',
  CAMBIAR_ESTADO:    'CAMBIAR_ESTADO',
  APROBAR:           'APROBAR',
  RECHAZAR:          'RECHAZAR',
  SUBIR_PDF:         'SUBIR_PDF',
  DESCARGAR_PDF:     'DESCARGAR_PDF',
  CREAR_USUARIO:     'CREAR_USUARIO',
  EDITAR_USUARIO:    'EDITAR_USUARIO',
  DESACTIVAR_USUARIO:'DESACTIVAR_USUARIO',
  CREAR_CLIENTE:     'CREAR_CLIENTE',
  EDITAR_CLIENTE:    'EDITAR_CLIENTE',
  DESACTIVAR_CLIENTE:'DESACTIVAR_CLIENTE',
  CREAR_ORIGEN_CLIENTE: 'CREAR_ORIGEN_CLIENTE',
  GENERAR_REPORTE_PDF:  'GENERAR_REPORTE_PDF',
};

module.exports = { logEvent, AuditActions };
