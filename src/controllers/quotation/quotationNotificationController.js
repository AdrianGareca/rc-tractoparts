// =============================================================================
// src/controllers/quotation/quotationNotificationController.js
// Feed personal de notificaciones del Ejecutivo / Proyectos.
//
//   getNotificaciones       — GET  /api/cotizaciones/notificaciones
//   markNotificacionesLeidas— POST /api/cotizaciones/notificaciones/leer
//
// Extraído de quotationController.js sin cambios de comportamiento.
// La fusión y el orden de los dos streams viven en mergeNotificaciones, que es
// pura y está cubierta por tests/unit/quotationNotificaciones.test.js.
// =============================================================================

'use strict';

const QuotationModel = require('../../models/QuotationModel');

/** Roles que reciben notificaciones personales. Jefe y Administracion ven todos
 *  los cambios de estado por la bitácora de auditoría, no por este feed. */
const NOTIFIED_ROLES = ['Ejecutivo', 'Proyectos'];

/**
 * Fusiona los dos streams en una sola lista ordenada por fecha descendente.
 * Función pura.
 *
 * Las correcciones se etiquetan acá porque salen del historial de estados y no
 * traen `tipo`; las de la tabla `notificaciones` ya vienen etiquetadas.
 */
function mergeNotificaciones(correcciones = [], aprobaciones = []) {
  const taggedCorrecciones = correcciones.map(r => ({ ...r, tipo: 'correccion' }));

  return [...taggedCorrecciones, ...aprobaciones]
    .sort((a, b) => new Date(b.fecha_solicitud) - new Date(a.fecha_solicitud));
}

const QuotationNotificationController = {

  // ---------------------------------------------------------------------------
  // getNotificaciones — GET /api/cotizaciones/notificaciones  (Role: Ejecutivo)
  // Returns two notification streams merged into a single response:
  //   1. Correction notifications — quotations sent back to 'Pendiente'
  //      (from cotizacion_historial_estados)
  //   2. Approval notifications   — quotations approved / sent to client by Jefe
  //      (from the dedicated notificaciones table)
  //
  // Each row carries a `tipo` field so the frontend can style them differently:
  //   tipo = 'correccion'    — from stream 1 (correction needed)
  //   tipo = 'aprobacion'    — Jefe approved to 'Aprobada internamente'
  //   tipo = 'envio_cliente' — Jefe sent to 'Enviada al cliente'
  //
  // Opening the modal triggers markNotificacionesLeidas so the badge resets
  // for approval notifications (correction notifications clear naturally when
  // the Ejecutivo re-submits the quote and it leaves 'Pendiente').
  // ---------------------------------------------------------------------------
  async getNotificaciones(req, res) {
    try {
      if (!NOTIFIED_ROLES.includes(req.user.rol)) {
        return res.status(200).json({ success: true, total: 0, data: [] });
      }

      // Fetch both notification streams in parallel
      const [correcciones, aprobaciones] = await Promise.all([
        QuotationModel.findNotificacionesPendientes(req.user.id),
        QuotationModel.findNotificacionesEjecutivo(req.user.id),
      ]);

      const combined = mergeNotificaciones(correcciones, aprobaciones);

      return res.status(200).json({
        success: true,
        total:   combined.length,
        data:    combined,
      });
    } catch (error) {
      console.error('[QuotationController.getNotificaciones] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to retrieve notifications.' });
    }
  },

  // markNotificacionesLeidas — POST /api/cotizaciones/notificaciones/leer  (Ejecutivo)
  // Marks all unread approval/envio notifications as read for the caller.
  // Correction notifications are implicitly cleared when the quote is re-submitted.
  async markNotificacionesLeidas(req, res) {
    try {
      if (!NOTIFIED_ROLES.includes(req.user.rol)) {
        return res.status(200).json({ success: true });
      }
      await QuotationModel.markNotificacionesLeidas(req.user.id);
      return res.status(200).json({ success: true });
    } catch (error) {
      console.error('[QuotationController.markNotificacionesLeidas] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to mark notifications as read.' });
    }
  },
};

module.exports = Object.assign(QuotationNotificationController, {
  mergeNotificaciones,
  NOTIFIED_ROLES,
});
