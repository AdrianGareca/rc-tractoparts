// =============================================================================
// src/models/quotation/notificationRepository.js
// Quotation-driven notifications: correction requests derived from the state
// history, plus the targeted `notificaciones` table (insert / read / mark read).
// =============================================================================

'use strict';

const { pool } = require('../../config/db');

// ---------------------------------------------------------------------------
// findNotificacionesPendientes — Returns quotations that were sent back to
// 'Pendiente' via a change-request from Administracion or Jefe, signalling
// the assigned Ejecutivo that corrections are required.
//
// A "pending correction notification" is defined as: a history entry where
// estado_nuevo = 'Pendiente' AND estado_anterior IS NOT NULL (i.e. not the
// initial creation event) AND the quotation's current estado is still 'Pendiente'.
// ---------------------------------------------------------------------------
async function findNotificacionesPendientes(id_ejecutivo) {
  const sql = `
      SELECT
        c.id                AS id_cotizacion,
        c.numero_correlativo,
        cl.razon_social     AS cliente_nombre,
        h.observacion,
        h.nombre_usuario    AS solicitado_por,
        h.rol_usuario       AS rol_solicitante,
        h.creado_en         AS fecha_solicitud
      FROM cotizacion_historial_estados h
      INNER JOIN cotizaciones c  ON c.id  = h.id_cotizacion
      INNER JOIN clientes    cl  ON cl.id = c.id_cliente
      WHERE h.estado_nuevo      = 'Pendiente'
        AND h.estado_anterior   IS NOT NULL
        AND h.estado_anterior   != 'Pendiente'
        AND c.estado            = 'Pendiente'
        AND c.id_ejecutivo      = ?
      ORDER BY h.creado_en DESC
    `;

  const [rows] = await pool.execute(sql, [parseInt(id_ejecutivo, 10)]);
  return rows;
}

// ---------------------------------------------------------------------------
// insertNotificacion — Writes a targeted notification into the `notificaciones`
// table. Called after Jefe approves ('Aprobada internamente') or sends the
// quotation to the client ('Enviada al cliente'). Non-fatal: callers wrap in
// try/catch so an INSERT failure never rolls back the main state transition.
//
// @param {Object} params
//   id_usuario     {number}  — Recipient Ejecutivo's user ID
//   id_cotizacion  {number}  — Quotation primary key
//   tipo           {string}  — 'aprobacion' | 'envio_cliente'
//   mensaje        {string}  — Human-readable message for the Ejecutivo
// ---------------------------------------------------------------------------
async function insertNotificacion({ id_usuario, id_cotizacion, tipo, mensaje }) {
  await pool.execute(
    `INSERT INTO notificaciones (id_usuario, id_cotizacion, tipo, mensaje)
       VALUES (?, ?, ?, ?)`,
    [
      parseInt(id_usuario,    10),
      parseInt(id_cotizacion, 10),
      tipo,
      String(mensaje).substring(0, 1000), // cap to prevent runaway payloads
    ]
  );
}

// ---------------------------------------------------------------------------
// findNotificacionesEjecutivo — Returns all unread notifications from the
// `notificaciones` table that target the given Ejecutivo. Shapes each row to
// match the field names expected by getNotificaciones / notificationsView.js
// so the frontend can render both correction and approval alerts uniformly.
// ---------------------------------------------------------------------------
async function findNotificacionesEjecutivo(id_ejecutivo) {
  const sql = `
      SELECT
        n.id                AS notificacion_id,
        n.tipo,
        n.mensaje           AS observacion,
        n.creado_en         AS fecha_solicitud,
        c.id                AS id_cotizacion,
        c.numero_correlativo,
        cl.razon_social     AS cliente_nombre,
        u.nombre_completo   AS solicitado_por,
        u.nombre_completo   AS rol_solicitante
      FROM notificaciones n
      INNER JOIN cotizaciones c  ON c.id  = n.id_cotizacion
      INNER JOIN clientes    cl  ON cl.id = c.id_cliente
      INNER JOIN usuarios    u   ON u.id  = c.id_ejecutivo
      WHERE n.id_usuario = ?
        AND n.leida      = 0
      ORDER BY n.creado_en DESC
    `;

  const [rows] = await pool.execute(sql, [parseInt(id_ejecutivo, 10)]);
  return rows;
}

// ---------------------------------------------------------------------------
// markNotificacionesLeidas — Marks all unread notifications for a given
// Ejecutivo as read. Called when the Ejecutivo opens the notification modal
// so the badge count resets after they have acknowledged the alerts.
// ---------------------------------------------------------------------------
async function markNotificacionesLeidas(id_ejecutivo) {
  await pool.execute(
    `UPDATE notificaciones SET leida = 1
       WHERE id_usuario = ? AND leida = 0`,
    [parseInt(id_ejecutivo, 10)]
  );
}

module.exports = {
  findNotificacionesPendientes,
  insertNotificacion,
  findNotificacionesEjecutivo,
  markNotificacionesLeidas,
};
