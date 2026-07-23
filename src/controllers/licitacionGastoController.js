// =============================================================================
// src/controllers/licitacionGastoController.js
// Licitación Gastos Controller — operating expenses for the profit/loss analysis.
//
//   addGasto    — POST   /:id/gastos          (Administracion, responsable Proyectos, Jefe, SysAdmin)
//   getGastos   — GET    /:id/gastos          (todos los autenticados)
//   deleteGasto — DELETE /:id/gastos/:gastoId (Administracion, responsable Proyectos, Jefe, SysAdmin)
//
// Business rules:
//   • Gastos sólo se cargan cuando la licitación fue ADJUDICADA — se permite en
//     'Adjudicada' y 'Archivada' (el periodo de seguimiento de gastos tras
//     ganar). En cualquier otro estado, el alta/baja se rechaza con 409.
//   • Resultado = Σ(cotizaciones vinculadas aprobadas/confirmadas) − Σ(gastos).
// =============================================================================

'use strict';

const LicitacionModel            = require('../models/LicitacionModel');
const LicitacionGastoModel       = require('../models/LicitacionGastoModel');
const { logEvent, AuditActions } = require('../utils/auditLog');

// Estados en los que se pueden gestionar gastos (post-adjudicación).
const GASTO_ALLOWED_STATES = ['Adjudicada', 'Archivada'];

// ---------------------------------------------------------------------------
// canManageGastos — Administracion, el responsable Proyectos, o Jefe/SysAdmin.
// (A diferencia de la gestión de la cabecera/documentos, Administracion SÍ puede
//  cargar gastos — es parte del análisis de resultado que hacen en conjunto.)
// ---------------------------------------------------------------------------
function canManageGastos(user, licitacion) {
  if (user.rol === 'Jefe' || user.rol === 'SysAdmin' || user.rol === 'Administracion') return true;
  return user.rol === 'Proyectos' && user.id === licitacion.id_responsable;
}

const LicitacionGastoController = {

  // ---------------------------------------------------------------------------
  // addGasto — POST /api/licitaciones/:id/gastos
  // ---------------------------------------------------------------------------
  async addGasto(req, res) {
    const id       = parseInt(req.params.id, 10);
    const clientIp = req.ip || req.socket?.remoteAddress || null;
    if (isNaN(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'ID de licitación inválido.' });
    }

    const { concepto, monto, moneda } = req.body;

    try {
      const licitacion = await LicitacionModel.findById(id);
      if (!licitacion) {
        return res.status(404).json({ success: false, message: `No se encontró la licitación con ID ${id}.` });
      }

      if (!canManageGastos(req.user, licitacion)) {
        return res.status(403).json({
          success: false,
          message: 'Solo Administración, el responsable de la licitación o Jefe/SysAdmin pueden cargar gastos.',
        });
      }

      if (!GASTO_ALLOWED_STATES.includes(licitacion.estado)) {
        return res.status(409).json({
          success: false,
          message: `Los gastos se cargan solo cuando la licitación fue adjudicada. ` +
                   `Estado actual: '${licitacion.estado}'.`,
        });
      }

      const gastoId = await LicitacionGastoModel.create({
        id_licitacion:  id,
        concepto:       String(concepto).trim(),
        monto:          Number(monto),
        moneda:         moneda || licitacion.moneda || 'BOB',
        id_usuario:     req.user.id,
        nombre_usuario: req.user.nombre_usuario,
      });

      try {
        await logEvent({
          id_usuario:     req.user.id,
          nombre_usuario: req.user.nombre_usuario,
          accion:         AuditActions.AGREGAR_GASTO_LICITACION,
          entidad:        'licitaciones',
          id_entidad:     id,
          detalle:        { concepto, monto, moneda: moneda || licitacion.moneda },
          ip_origen:      clientIp,
          resultado:      'exito',
        });
      } catch (auditErr) {
        console.warn('[LicitacionGastoController.addGasto] Audit logging failed (non-fatal):', auditErr.message);
      }

      return res.status(201).json({ success: true, message: 'Gasto registrado.', data: { id: gastoId } });
    } catch (error) {
      console.error('[LicitacionGastoController.addGasto] Error:', error.message);
      return res.status(500).json({ success: false, message: 'No se pudo registrar el gasto.' });
    }
  },

  // ---------------------------------------------------------------------------
  // getGastos — GET /api/licitaciones/:id/gastos  (todos los autenticados)
  // ---------------------------------------------------------------------------
  async getGastos(req, res) {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'ID de licitación inválido.' });
    }
    try {
      const licitacion = await LicitacionModel.findById(id);
      if (!licitacion) {
        return res.status(404).json({ success: false, message: `No se encontró la licitación con ID ${id}.` });
      }
      const gastos = await LicitacionGastoModel.findByLicitacion(id);
      const totalGastos = gastos.reduce((acc, g) => acc + Number(g.monto), 0);
      return res.status(200).json({
        success:            true,
        total:              gastos.length,
        total_gastos:       totalGastos,
        total_comprometido: licitacion.total_comprometido,
        resultado:          Number(licitacion.total_comprometido) - totalGastos,
        data:               gastos,
      });
    } catch (error) {
      console.error('[LicitacionGastoController.getGastos] Error:', error.message);
      return res.status(500).json({ success: false, message: 'No se pudieron obtener los gastos.' });
    }
  },

  // ---------------------------------------------------------------------------
  // deleteGasto — DELETE /api/licitaciones/:id/gastos/:gastoId
  // ---------------------------------------------------------------------------
  async deleteGasto(req, res) {
    const id       = parseInt(req.params.id, 10);
    const gastoId  = parseInt(req.params.gastoId, 10);
    const clientIp = req.ip || req.socket?.remoteAddress || null;
    if (isNaN(id) || id < 1 || isNaN(gastoId) || gastoId < 1) {
      return res.status(400).json({ success: false, message: 'ID inválido.' });
    }

    try {
      const licitacion = await LicitacionModel.findById(id);
      if (!licitacion) {
        return res.status(404).json({ success: false, message: `No se encontró la licitación con ID ${id}.` });
      }
      if (!canManageGastos(req.user, licitacion)) {
        return res.status(403).json({
          success: false,
          message: 'Solo Administración, el responsable de la licitación o Jefe/SysAdmin pueden eliminar gastos.',
        });
      }

      const gasto = await LicitacionGastoModel.findById(gastoId);
      if (!gasto || gasto.id_licitacion !== id) {
        return res.status(404).json({ success: false, message: 'Gasto no encontrado.' });
      }

      await LicitacionGastoModel.deleteById(gastoId);

      try {
        await logEvent({
          id_usuario:     req.user.id,
          nombre_usuario: req.user.nombre_usuario,
          accion:         AuditActions.ELIMINAR_GASTO_LICITACION,
          entidad:        'licitaciones',
          id_entidad:     id,
          detalle:        { concepto: gasto.concepto, monto: gasto.monto },
          ip_origen:      clientIp,
          resultado:      'exito',
        });
      } catch (auditErr) {
        console.warn('[LicitacionGastoController.deleteGasto] Audit logging failed (non-fatal):', auditErr.message);
      }

      return res.status(200).json({ success: true, message: 'Gasto eliminado.' });
    } catch (error) {
      console.error('[LicitacionGastoController.deleteGasto] Error:', error.message);
      return res.status(500).json({ success: false, message: 'No se pudo eliminar el gasto.' });
    }
  },
};

module.exports = LicitacionGastoController;
