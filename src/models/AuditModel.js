// =============================================================================
// src/models/AuditModel.js
// Audit Model — HU11: Sprint 2 Audit Log System (auditoria table)
//
// Manages parameterized INSERT operations against the `auditoria` table.
// Every call is fire-and-forget: errors are caught and logged internally so
// that an audit failure NEVER disrupts the primary business operation.
//
// Schema (auditoria):
//   id_auditoria         INT AUTO_INCREMENT PK
//   id_usuario           INT NULL           → FK usuarios.id  ON DELETE SET NULL
//   tabla_afectada       VARCHAR(50) NOT NULL
//   accion               VARCHAR(20) NOT NULL
//   id_registro_afectado INT NULL
//   detalles             TEXT NULL          (JSON-serialized details)
//   ip_cliente           VARCHAR(45) NOT NULL DEFAULT '0.0.0.0'
//   fecha_hora           TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
// =============================================================================

'use strict';

const { pool } = require('../config/db'); // Shared MySQL connection pool — Singleton

// ---------------------------------------------------------------------------
// Action constants — kept short (≤ 20 chars) to fit the VARCHAR(20) column.
// ---------------------------------------------------------------------------
const Actions = Object.freeze({
  LOGIN:            'LOGIN',
  LOGIN_FAILED:     'LOGIN_FAILED',
  LOGOUT:           'LOGOUT',
  CREAR:            'CREAR',
  ACTUALIZAR:       'ACTUALIZAR',
  CAMBIO_ESTADO:    'CAMBIO_ESTADO',
  APROBAR:          'APROBAR',
  RECHAZAR:         'RECHAZAR',
  SUBIR_PDF:        'SUBIR_PDF',
  DESCARGAR_PDF:    'DESCARGAR_PDF',
  CREAR_USUARIO:    'CREAR_USUARIO',
  EDITAR_USUARIO:   'EDITAR_USUARIO',
  DESACT_USUARIO:   'DESACT_USUARIO',
});

// ---------------------------------------------------------------------------
// insertAudit
// Inserts one record into the `auditoria` table.
// This function NEVER throws: all exceptions are swallowed and logged to stderr
// so a database or serialization failure cannot interrupt the caller.
//
// @param {Object} params
//   @param {number|null}  params.id_usuario            - Acting user's PK (null = system / pre-auth)
//   @param {string}       params.tabla_afectada         - Name of the affected entity table
//   @param {string}       params.accion                 - One of AuditModel.Actions
//   @param {number|null}  params.id_registro_afectado   - PK of the affected record (null if N/A)
//   @param {Object|null}  params.detalles               - Extra context; serialized to JSON string
//   @param {string}       params.ip_cliente             - IPv4 or IPv6 of the originating request
// ---------------------------------------------------------------------------
async function insertAudit({
  id_usuario           = null,
  tabla_afectada,
  accion,
  id_registro_afectado = null,
  detalles             = null,
  ip_cliente           = '0.0.0.0',
}) {
  try {
    const detallesJson = detalles ? JSON.stringify(detalles) : null;

    // Clamp accion to 20 characters to prevent column overflow exceptions
    const accionSafe = String(accion).slice(0, 20);

    const sql = `
      INSERT INTO auditoria
        (id_usuario, tabla_afectada, accion, id_registro_afectado, detalles, ip_cliente)
      VALUES
        (?, ?, ?, ?, ?, ?)
    `;

    await pool.execute(sql, [
      id_usuario,
      tabla_afectada,
      accionSafe,
      id_registro_afectado,
      detallesJson,
      ip_cliente,
    ]);
  } catch (err) {
    // Never propagate — audit failure must not block the business operation.
    // Log to stderr for alerting/monitoring pipelines to pick up.
    console.error('[AuditModel.insertAudit] Non-fatal error:', err.message);
  }
}

module.exports = { insertAudit, Actions };
