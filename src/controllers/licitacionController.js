// =============================================================================
// src/controllers/licitacionController.js
// Licitación Controller — ciclo de vida de licitaciones (entidad paraguas).
//
//   createLicitacion   — POST /api/licitaciones        (Proyectos, Jefe, SysAdmin)
//   getLicitaciones    — GET  /api/licitaciones         (todos los autenticados)
//   getLicitacionById  — GET  /api/licitaciones/:id     (todos los autenticados)
//   getStateHistory    — GET  /api/licitaciones/:id/historial
//   updateLicitacion   — PUT  /api/licitaciones/:id     (responsable, Jefe, SysAdmin)
//   updateStatus       — PUT  /api/licitaciones/:id/estado
//
// Layering: el controller orquesta; solo LicitacionModel ejecuta SQL sobre las
// tablas de licitaciones. Patrón calcado de quotationController /
// quotationStateController (transacción + liberación de conexión antes de
// auditar, re-lectura fresca de can_approve_quotations, auditoría no fatal).
// =============================================================================

'use strict';

const { pool }                   = require('../config/db');
const LicitacionModel            = require('../models/LicitacionModel');
const QuotationModel             = require('../models/QuotationModel');
const UserModel                  = require('../models/UserModel');
const { logEvent, AuditActions } = require('../utils/auditLog');
const licitacionPdfService       = require('../services/licitacionPdfService');

const LicitacionController = {

  // ---------------------------------------------------------------------------
  // downloadPdf — GET /api/licitaciones/:id/pdf  (todos los autenticados)
  // Genera el expediente de la licitación ON-DEMAND (no se persiste) y lo
  // transmite directo, así siempre refleja el estado/cotizaciones/gastos actual.
  // ---------------------------------------------------------------------------
  async downloadPdf(req, res) {
    const id       = parseInt(req.params.id, 10);
    const clientIp = req.ip || req.socket?.remoteAddress || null;
    if (isNaN(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'ID de licitación inválido.' });
    }

    try {
      const licitacion = await LicitacionModel.findById(id);
      if (!licitacion) {
        return res.status(404).json({ success: false, message: `No se encontró la licitación con ID ${id}.` });
      }

      const safeName = String(licitacion.codigo || `LIC-${id}`).replace(/[^\w\-]/g, '_');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="Expediente_${safeName}.pdf"`);

      const doc = licitacionPdfService.createDoc(licitacion);
      doc.pipe(res);
      licitacionPdfService.renderExpediente(doc, licitacion);
      doc.end();

      // Auditoría no fatal (el stream ya se está enviando).
      logEvent({
        id_usuario:     req.user.id,
        nombre_usuario: req.user.nombre_usuario,
        accion:         AuditActions.DESCARGAR_PDF_LICITACION,
        entidad:        'licitaciones',
        id_entidad:     id,
        detalle:        { codigo: licitacion.codigo },
        ip_origen:      clientIp,
        resultado:      'exito',
      }).catch(() => {});
    } catch (error) {
      console.error('[LicitacionController.downloadPdf] Error:', error.message);
      if (!res.headersSent) {
        return res.status(500).json({ success: false, message: 'No se pudo generar el PDF de la licitación.' });
      }
    }
  },

  // ---------------------------------------------------------------------------
  // createLicitacion — POST /api/licitaciones  (Proyectos, Jefe, SysAdmin)
  // Transacción atómica: generateCorrelativo (FOR UPDATE) + create → commit →
  // liberar conexión → auditar (fuera de la conexión de la transacción).
  // ---------------------------------------------------------------------------
  async createLicitacion(req, res) {
    const {
      nombre,
      id_cliente,
      descripcion,
      presupuesto_referencial,
      moneda,
      fecha_limite,
      id_responsable,
    } = req.body;

    const clientIp = req.ip || req.socket?.remoteAddress || null;

    // El responsable es el propio usuario si es Proyectos; si es Jefe/SysAdmin
    // debe indicar a qué usuario Proyectos pertenece (o se asigna a sí mismo).
    const responsableId = req.user.rol === 'Proyectos'
      ? req.user.id
      : (id_responsable != null ? parseInt(id_responsable, 10) : req.user.id);

    let connection;
    let codigo;
    let licitacionId;

    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();

      codigo = await LicitacionModel.generateCorrelativo(connection);

      licitacionId = await LicitacionModel.create(connection, {
        codigo,
        nombre:                  String(nombre).trim(),
        id_cliente:              parseInt(id_cliente, 10),
        descripcion:             descripcion ? String(descripcion).trim() : null,
        presupuesto_referencial: presupuesto_referencial ?? null,
        moneda:                  moneda || 'BOB',
        fecha_limite:            fecha_limite || null,
        id_responsable:          responsableId,
      });

      await connection.commit();
      // Liberar la conexión de la transacción ANTES de auditar / releer.
      connection.release();
      connection = null;

      // ── Auditoría (no fatal) ─────────────────────────────────────────────
      try {
        await logEvent({
          id_usuario:     req.user.id,
          nombre_usuario: req.user.nombre_usuario,
          accion:         AuditActions.CREAR_LICITACION,
          entidad:        'licitaciones',
          id_entidad:     licitacionId,
          detalle:        { codigo, nombre, id_cliente, id_responsable: responsableId },
          ip_origen:      clientIp,
          resultado:      'exito',
        });
      } catch (auditErr) {
        console.warn('[LicitacionController.createLicitacion] Audit logging failed (non-fatal):', auditErr.message);
      }

      const created = await LicitacionModel.findById(licitacionId);

      return res.status(201).json({
        success: true,
        message: `Licitación ${codigo} creada exitosamente.`,
        data:    created,
      });
    } catch (error) {
      if (connection) {
        try { await connection.rollback(); } catch (rbErr) {
          console.error('[LicitacionController.createLicitacion] Rollback error:', rbErr.message);
        }
        connection.release();
      }

      // FK violation (cliente o responsable inexistente) → 422 legible.
      if (error.code === 'ER_NO_REFERENCED_ROW_2' || error.code === 'ER_NO_REFERENCED_ROW') {
        return res.status(422).json({
          success: false,
          message: 'El cliente convocante o el responsable indicado no existe.',
        });
      }

      console.error('[LicitacionController.createLicitacion] Error:', error.message);
      return res.status(500).json({ success: false, message: 'No se pudo crear la licitación.' });
    }
  },

  // ---------------------------------------------------------------------------
  // getNextCorrelativo — GET /api/licitaciones/next-correlativo
  // Vista previa no vinculante del próximo código (para el encabezado del form).
  // ---------------------------------------------------------------------------
  async getNextCorrelativo(req, res) {
    try {
      const codigo = await LicitacionModel.peekNextCorrelativo();
      return res.status(200).json({ success: true, data: { codigo } });
    } catch (error) {
      console.error('[LicitacionController.getNextCorrelativo] Error:', error.message);
      return res.status(500).json({ success: false, message: 'No se pudo previsualizar el correlativo.' });
    }
  },

  // ---------------------------------------------------------------------------
  // getLicitaciones — GET /api/licitaciones  (todos los autenticados)
  // Listado paginado + filtros (estado, q, id_responsable, id_cliente).
  // ---------------------------------------------------------------------------
  async getLicitaciones(req, res) {
    try {
      const filters = {
        q:              req.query.q,
        estado:         req.query.estado,
        id_responsable: req.query.id_responsable,
        id_cliente:     req.query.id_cliente,
      };

      const pagination = { page: req.query.page, limit: req.query.limit };
      const sort       = { by: req.query.sort_by, order: req.query.sort_order };

      const [data, total] = await Promise.all([
        LicitacionModel.findAll(filters, pagination, sort),
        LicitacionModel.countAll(filters),
      ]);

      const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

      return res.status(200).json({
        success:    true,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        data,
      });
    } catch (error) {
      console.error('[LicitacionController.getLicitaciones] Error:', error.message);
      return res.status(500).json({ success: false, message: 'No se pudieron obtener las licitaciones.' });
    }
  },

  // ---------------------------------------------------------------------------
  // getLicitacionById — GET /api/licitaciones/:id  (todos los autenticados)
  // ---------------------------------------------------------------------------
  async getLicitacionById(req, res) {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'ID de licitación inválido.' });
    }

    try {
      const licitacion = await LicitacionModel.findById(id);
      if (!licitacion) {
        return res.status(404).json({ success: false, message: `No se encontró la licitación con ID ${id}.` });
      }
      return res.status(200).json({ success: true, data: licitacion });
    } catch (error) {
      console.error('[LicitacionController.getLicitacionById] Error:', error.message);
      return res.status(500).json({ success: false, message: 'No se pudo obtener la licitación.' });
    }
  },

  // ---------------------------------------------------------------------------
  // getStateHistory — GET /api/licitaciones/:id/historial  (todos los autenticados)
  // ---------------------------------------------------------------------------
  async getStateHistory(req, res) {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'ID de licitación inválido.' });
    }

    try {
      const licitacion = await LicitacionModel.findById(id);
      if (!licitacion) {
        return res.status(404).json({ success: false, message: `No se encontró la licitación con ID ${id}.` });
      }

      const history = await LicitacionModel.findStateHistory(id);
      return res.status(200).json({
        success:              true,
        licitacion_reference: licitacion.codigo,
        total:                history.length,
        data:                 history,
      });
    } catch (error) {
      console.error('[LicitacionController.getStateHistory] Error:', error.message);
      return res.status(500).json({ success: false, message: 'No se pudo obtener el historial.' });
    }
  },

  // ---------------------------------------------------------------------------
  // updateLicitacion — PUT /api/licitaciones/:id  (responsable, Jefe, SysAdmin)
  // Solo se puede editar la cabecera en estados 'En preparacion'/'Cotizando'.
  // ---------------------------------------------------------------------------
  async updateLicitacion(req, res) {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'ID de licitación inválido.' });
    }

    const clientIp = req.ip || req.socket?.remoteAddress || null;

    try {
      const licitacion = await LicitacionModel.findById(id);
      if (!licitacion) {
        return res.status(404).json({ success: false, message: `No se encontró la licitación con ID ${id}.` });
      }

      // Ownership: Proyectos solo puede editar SUS licitaciones; Jefe/SysAdmin, todas.
      const isPrivileged  = req.user.rol === 'Jefe' || req.user.rol === 'SysAdmin';
      const isResponsable = req.user.id === licitacion.id_responsable;
      if (!isPrivileged && !isResponsable) {
        return res.status(403).json({
          success: false,
          message: 'Solo el responsable de la licitación (o Jefe/SysAdmin) puede editarla.',
        });
      }

      // Guard de estado: la cabecera es editable solo en preparación/cotizando.
      if (!LicitacionModel.EDITABLE_STATES.includes(licitacion.estado)) {
        return res.status(409).json({
          success: false,
          message: `La licitación en estado '${licitacion.estado}' ya no es editable. ` +
                   `Solo se puede editar en: [${LicitacionModel.EDITABLE_STATES.join(', ')}].`,
        });
      }

      const { nombre, id_cliente, descripcion, presupuesto_referencial, moneda, fecha_limite } = req.body;

      const updated = await LicitacionModel.update(id, {
        nombre:                  String(nombre).trim(),
        id_cliente:              parseInt(id_cliente, 10),
        descripcion:             descripcion ? String(descripcion).trim() : null,
        presupuesto_referencial: presupuesto_referencial ?? null,
        moneda:                  moneda || 'BOB',
        fecha_limite:            fecha_limite || null,
      });

      if (!updated) {
        // El estado cambió entre la lectura y la escritura (concurrencia).
        return res.status(409).json({
          success: false,
          message: 'No se pudo actualizar: la licitación fue modificada concurrentemente. Refresque e intente de nuevo.',
        });
      }

      try {
        await logEvent({
          id_usuario:     req.user.id,
          nombre_usuario: req.user.nombre_usuario,
          accion:         AuditActions.EDITAR_LICITACION,
          entidad:        'licitaciones',
          id_entidad:     id,
          detalle:        { nombre, id_cliente },
          ip_origen:      clientIp,
          resultado:      'exito',
        });
      } catch (auditErr) {
        console.warn('[LicitacionController.updateLicitacion] Audit logging failed (non-fatal):', auditErr.message);
      }

      const refreshed = await LicitacionModel.findById(id);
      return res.status(200).json({ success: true, message: 'Licitación actualizada.', data: refreshed });
    } catch (error) {
      if (error.code === 'ER_NO_REFERENCED_ROW_2' || error.code === 'ER_NO_REFERENCED_ROW') {
        return res.status(422).json({ success: false, message: 'El cliente convocante indicado no existe.' });
      }
      console.error('[LicitacionController.updateLicitacion] Error:', error.message);
      return res.status(500).json({ success: false, message: 'No se pudo actualizar la licitación.' });
    }
  },

  // ---------------------------------------------------------------------------
  // updateStatus — PUT /api/licitaciones/:id/estado
  // Roles autorizados por ruta: Proyectos, Ejecutivo, Jefe, SysAdmin. La matriz
  // del modelo decide según (rol, delegación, si es responsable). Un Ejecutivo
  // sin delegación → 403 del modelo.
  // ---------------------------------------------------------------------------
  async updateStatus(req, res) {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'ID de licitación inválido.' });
    }

    const { nuevo_estado, observacion } = req.body;
    const userRol  = req.user.rol;
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    if (!LicitacionModel.VALID_STATES.includes(nuevo_estado)) {
      return res.status(422).json({
        success: false,
        message: `Estado destino inválido '${nuevo_estado}'. Válidos: [${LicitacionModel.VALID_STATES.join(', ')}].`,
      });
    }

    try {
      const licitacion = await LicitacionModel.findById(id);
      if (!licitacion) {
        return res.status(404).json({ success: false, message: `No se encontró la licitación con ID ${id}.` });
      }

      const estadoActual  = licitacion.estado;
      const isResponsable = req.user.id === licitacion.id_responsable;

      if (estadoActual === nuevo_estado) {
        return res.status(422).json({
          success: false,
          message: `La licitación ya está en el estado '${estadoActual}'. No hay cambio que aplicar.`,
        });
      }

      // Re-lectura fresca de la delegación desde BD (nunca confiar en el JWT):
      // un Ejecutivo delegado opera la matriz 'delegado'. Se resuelve solo para
      // Ejecutivos (los otros roles no dependen de la bandera).
      let canApproveDelegated = false;
      if (userRol === 'Ejecutivo') {
        const actingUser = await UserModel.findById(req.user.id);
        canApproveDelegated = Boolean(actingUser?.can_approve_quotations);
      }

      const transitionCheck = LicitacionModel.validateTransitionByRole(
        estadoActual,
        nuevo_estado,
        userRol,
        canApproveDelegated,
        isResponsable
      );

      if (!transitionCheck.valid) {
        return res.status(403).json({
          success:             false,
          message:             transitionCheck.reason,
          allowed_transitions: transitionCheck.allowedTransitions || [],
        });
      }

      const updated = await LicitacionModel.updateStatus(id, nuevo_estado, estadoActual, observacion || null);
      if (!updated) {
        return res.status(409).json({
          success: false,
          message: 'No se pudo actualizar el estado: la licitación fue modificada concurrentemente. Refresque e intente de nuevo.',
        });
      }

      // ── Historial + auditoría (no fatales) ───────────────────────────────
      try {
        await LicitacionModel.logStateHistory({
          id_licitacion:   id,
          estado_anterior: estadoActual,
          estado_nuevo:    nuevo_estado,
          id_usuario:      req.user.id,
          nombre_usuario:  req.user.nombre_usuario,
          rol_usuario:     userRol,
          observacion:     observacion || null,
          ip_origen:       clientIp,
        });

        await logEvent({
          id_usuario:     req.user.id,
          nombre_usuario: req.user.nombre_usuario,
          accion:         AuditActions.CAMBIAR_ESTADO_LICITACION,
          entidad:        'licitaciones',
          id_entidad:     id,
          detalle:        { estado_anterior: estadoActual, nuevo_estado, observacion: observacion || null },
          ip_origen:      clientIp,
          resultado:      'exito',
        });
      } catch (auditErr) {
        console.warn('[LicitacionController.updateStatus] Audit logging failed (non-fatal):', auditErr.message);
      }

      // ── Notificaciones (no fatales) ──────────────────────────────────────
      await notifyStateChange({
        licitacion,
        nuevoEstado: nuevo_estado,
        actorId:     req.user.id,
      });

      return res.status(200).json({
        success: true,
        message: `Estado de la licitación actualizado: '${estadoActual}' → '${nuevo_estado}'.`,
        data:    {
          id,
          estado_anterior:     estadoActual,
          nuevo_estado,
          allowed_transitions: transitionCheck.allowedTransitions,
        },
      });
    } catch (error) {
      console.error('[LicitacionController.updateStatus] Error:', error.message);
      return res.status(500).json({ success: false, message: 'No se pudo actualizar el estado de la licitación.' });
    }
  },
};

// ---------------------------------------------------------------------------
// notifyStateChange — Notificaciones mínimas de licitación (no fatales).
//
//   • Al entrar en 'Cotizando': se avisa a los ejecutivos comerciales delegados
//     (can_approve_quotations=1) para que "primero vean lo que subió Proyectos"
//     y armen/manden la cotización vinculada.
//   • En cualquier otra transición: si quien la ejecuta NO es el responsable,
//     se avisa al responsable de la licitación para que le dé seguimiento.
//
// Todo va envuelto en try/catch: una notificación nunca revierte la transición.
// ---------------------------------------------------------------------------
async function notifyStateChange({ licitacion, nuevoEstado, actorId }) {
  try {
    if (nuevoEstado === 'Cotizando') {
      const delegados = await UserModel.findDelegatedExecutives();
      const mensaje = `La licitación ${licitacion.codigo} — "${licitacion.nombre}" ` +
        `pasó a Cotizando. Revisa la información cargada y arma la cotización vinculada.`;
      await Promise.all(
        delegados
          .filter((d) => d.id !== actorId) // no auto-notificar al que la movió
          .map((d) => QuotationModel.insertNotificacion({
            id_usuario:    d.id,
            id_licitacion: licitacion.id,
            tipo:          'licitacion',
            mensaje,
          }))
      );
      return;
    }

    // Cualquier otra transición hecha por alguien distinto del responsable
    // → avisar al responsable Proyectos.
    if (actorId !== licitacion.id_responsable) {
      await QuotationModel.insertNotificacion({
        id_usuario:    licitacion.id_responsable,
        id_licitacion: licitacion.id,
        tipo:          'licitacion',
        mensaje: `La licitación ${licitacion.codigo} — "${licitacion.nombre}" ` +
                 `cambió a "${nuevoEstado}".`,
      });
    }
  } catch (notifErr) {
    console.warn('[LicitacionController.notifyStateChange] Notification insert failed (non-fatal):', notifErr.message);
  }
}

module.exports = LicitacionController;
