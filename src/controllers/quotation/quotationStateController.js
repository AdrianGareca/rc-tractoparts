// =============================================================================
// src/controllers/quotation/quotationStateController.js
// State Machine Transitions & Approval Workflow
//
// Extracted from quotationController.js to enforce single-responsibility:
//   updateStatus      — PUT  /:id/estado  (All roles, role-restricted matrix)
//   approveQuotation  — POST /:id/aprobar (Jefe / SysAdmin — HU08)
//   getStateHistory   — GET  /:id/historial (All roles)
//
// The formal state machine (Section 3.7.4 — ROLE_TRANSITIONS) and all
// business-rule validations are preserved verbatim from the original
// quotationController.js to guarantee regression safety.
// =============================================================================

'use strict';

const QuotationModel             = require('../../models/QuotationModel');
const { logEvent, AuditActions } = require('../../utils/auditLog');
const pdfService                 = require('../../services/pdfService');

const QuotationStateController = {

  // ---------------------------------------------------------------------------
  // updateStatus — PUT /api/cotizaciones/:id/estado  (All roles, role-restricted)
  //
  // Enforces the formal state machine (Section 3.7.4 — ROLE_TRANSITIONS):
  //   • Each role has a limited set of legal transitions per source state.
  //   • Only Jefe can transition from 'En revision' to approval/rejection states.
  //   • Transitioning to 'En revision' triggers a mandatory pre-flight check:
  //     the quotation must have ≥1 line item, monto_total set, and fecha_validez set.
  //   • Optimistic concurrency (AND estado = estadoActual) prevents races.
  //
  // Request body: { nuevo_estado: string, observacion?: string }
  // ---------------------------------------------------------------------------
  async updateStatus(req, res) {
    const id                                          = parseInt(req.params.id, 10);
    const { nuevo_estado, observacion, comentario_admin } = req.body;
    const userRol    = req.user.rol;
    const clientIp   = req.ip || req.socket?.remoteAddress || null;

    // ── Basic validation ──────────────────────────────────────────────────────
    if (isNaN(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'Invalid quotation ID.' });
    }

    if (!nuevo_estado || typeof nuevo_estado !== 'string') {
      return res.status(422).json({ success: false, message: 'nuevo_estado is required and must be a string.' });
    }

    if (!QuotationModel.VALID_STATES.includes(nuevo_estado)) {
      return res.status(422).json({
        success: false,
        message: `Invalid target state '${nuevo_estado}'. Valid states: [${QuotationModel.VALID_STATES.join(', ')}]`,
      });
    }

    try {
      // ── Fetch current state ────────────────────────────────────────────────
      const quotation = await QuotationModel.findById(id);

      if (!quotation) {
        return res.status(404).json({
          success: false,
          message: `Quotation with ID ${id} was not found.`,
        });
      }

      const estadoActual = quotation.estado;

      if (estadoActual === nuevo_estado) {
        return res.status(422).json({
          success: false,
          message: `The quotation is already in the '${estadoActual}' state. No change needed.`,
        });
      }

      // ── Role-based transition guard ────────────────────────────────────────
      // Returns { valid, reason, allowedTransitions } — no DB call needed.
      const transitionCheck = QuotationModel.validateTransitionByRole(
        estadoActual,
        nuevo_estado,
        userRol
      );

      if (!transitionCheck.valid) {
        return res.status(403).json({
          success:             false,
          message:             transitionCheck.reason,
          allowed_transitions: transitionCheck.allowedTransitions || [],
        });
      }

      // ── Special pre-flight check for 'En revision' transition ─────────────
      // The quotation must be complete before it can enter the approval queue.
      if (nuevo_estado === 'En revision') {
        const reviewErrors = await QuotationModel.validateForReview(id);

        if (reviewErrors.length > 0) {
          return res.status(422).json({
            success: false,
            message: 'The quotation does not meet all requirements for submission to review. ' +
                     'Resolve the following issues and try again.',
            errors:  reviewErrors,
          });
        }
      }

      // ── Execute the transition (optimistic concurrency) ───────────────────
      // comentario_admin is forwarded only when the caller's role is Administracion.
      const adminComment = (req.user.rol === 'Administracion' && comentario_admin != null)
        ? String(comentario_admin).trim() || null
        : null;

      const updated = await QuotationModel.updateStatus(
        id,
        nuevo_estado,
        estadoActual,
        userRol,
        adminComment
      );

      if (!updated) {
        // affectedRows = 0 means the state changed between our read and this write
        return res.status(409).json({
          success: false,
          message: 'State could not be updated. The quotation was modified concurrently. ' +
                   'Refresh and try again.',
        });
      }

      // ── Persist in the dedicated state history table (non-fatal) ────────────
      // Audit logging failures must never mask a successfully committed transition.
      try {
        await QuotationModel.logStateHistory({
          id_cotizacion:   id,
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
          accion:         AuditActions.CAMBIAR_ESTADO,
          entidad:        'cotizaciones',
          id_entidad:     id,
          detalle: {
            estado_anterior: estadoActual,
            nuevo_estado,
            observacion:     observacion || null,
          },
          ip_origen:  clientIp,
          resultado:  'exito',
        });
      } catch (auditErr) {
        console.warn('[QuotationStateController.updateStatus] Audit logging failed (non-fatal):', auditErr.message);
      }

      // ── Approval notification for Ejecutivo ────────────────────────────────
      // When the Jefe (or SysAdmin) sends a quotation to the client or marks it
      // accepted, notify the owning Ejecutivo so they can follow up promptly.
      if (['Enviada al cliente', 'Aceptada'].includes(nuevo_estado) &&
          ['Jefe', 'SysAdmin'].includes(userRol)) {
        try {
          const tipoMap = { 'Enviada al cliente': 'envio_cliente', 'Aceptada': 'aprobacion' };
          const mensaje = nuevo_estado === 'Enviada al cliente'
            ? `La cotización #${quotation.numero_correlativo} ` +
              `para ${quotation.cliente_nombre ?? String(quotation.id_cliente)} ` +
              `ha sido enviada al cliente por el Jefe. Ya puedes enviarla.`
            : `La cotización #${quotation.numero_correlativo} ` +
              `para ${quotation.cliente_nombre ?? String(quotation.id_cliente)} ` +
              `ha sido aceptada. ¡Cierre de venta registrado!`;

          await QuotationModel.insertNotificacion({
            id_usuario:    quotation.id_ejecutivo,
            id_cotizacion: id,
            tipo:          tipoMap[nuevo_estado],
            mensaje,
          });
        } catch (notifErr) {
          console.warn('[QuotationStateController.updateStatus] Notification insert failed (non-fatal):', notifErr.message);
        }
      }

      return res.status(200).json({
        success: true,
        message: `Quotation state updated: '${estadoActual}' → '${nuevo_estado}'.`,
        data:    {
          id,
          estado_anterior:     estadoActual,
          nuevo_estado,
          allowed_transitions: transitionCheck.allowedTransitions,
        },
      });
    } catch (error) {
      // FORBIDDEN_TRANSITION is thrown by model's defense-in-depth re-validation.
      // We already handled it above via validateTransitionByRole; this catches
      // any edge case where the controller check was somehow bypassed.
      if (error.code === 'FORBIDDEN_TRANSITION') {
        return res.status(403).json({
          success:             false,
          message:             error.message,
          allowed_transitions: error.allowedTransitions || [],
        });
      }

      console.error('[QuotationStateController.updateStatus] Error:', error.message);

      return res.status(500).json({
        success: false,
        message: 'Failed to update quotation status.',
      });
    }
  },

  // ---------------------------------------------------------------------------
  // approveQuotation — POST /api/cotizaciones/:id/aprobar  (Roles: Jefe, SysAdmin — HU08)
  //
  // Dedicated approval/rejection endpoint. Distinct from updateStatus because:
  //   1. It writes approval metadata (aprobado_por, fecha_aprobacion, obs_aprobacion).
  //   2. It receives a boolean `aprobado` instead of a state string.
  //   3. It mandates `observaciones` when rejecting (business rule).
  //   4. It regenerates the PDF to reflect the updated approval status.
  //
  // Source-state constraint: NONE. Jefe and SysAdmin can approve or reject
  // from ANY active state — 'Pendiente', 'En revision', or 'En espera'.
  //
  // Request body:
  //   { "aprobado": true | false, "observaciones": "text" (required on reject) }
  // ---------------------------------------------------------------------------
  async approveQuotation(req, res) {
    const id       = parseInt(req.params.id, 10);
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    // ── Basic validation ──────────────────────────────────────────────────────
    if (isNaN(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'Invalid quotation ID.' });
    }

    const { aprobado, observaciones } = req.body;

    if (aprobado === undefined || aprobado === null) {
      return res.status(422).json({
        success: false,
        message: "Field 'aprobado' is required. Send true to approve or false to reject.",
      });
    }

    if (typeof aprobado !== 'boolean') {
      return res.status(422).json({
        success: false,
        message: "Field 'aprobado' must be a boolean (true or false), not a string.",
      });
    }

    // Rejection without justification is not permitted (Section 4.3 — business rule)
    if (aprobado === false && (!observaciones || !String(observaciones).trim())) {
      return res.status(422).json({
        success: false,
        message: "Field 'observaciones' is required and must not be empty when rejecting a quotation. " +
                 "The Ejecutivo must understand why the quotation was rejected.",
      });
    }

    // ── Controller-level high-privilege assertion (defense-in-depth after middleware) ──
    if (!['Jefe', 'SysAdmin'].includes(req.user.rol)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Only 'Jefe' or 'SysAdmin' roles can approve or reject quotations. ` +
                 `Your role is '${req.user.rol}'.`,
      });
    }

    try {
      const quotation = await QuotationModel.findById(id);

      if (!quotation) {
        return res.status(404).json({
          success: false,
          message: `Quotation with ID ${id} was not found.`,
        });
      }

      const estadoAnterior = quotation.estado;
      const nuevoEstado    = aprobado ? 'Aprobada internamente' : 'Rechazada';
      const obsText        = observaciones ? String(observaciones).trim() : null;

      const approved = await QuotationModel.approve(id, req.user.id, aprobado, obsText, estadoAnterior);

      if (!approved) {
        return res.status(409).json({
          success: false,
          message: 'Approval could not be recorded. The quotation state changed concurrently. Refresh and try again.',
        });
      }

      // ── Write to the state history table (non-fatal) ─────────────────────
      try {
        await QuotationModel.logStateHistory({
          id_cotizacion:   id,
          estado_anterior: estadoAnterior,
          estado_nuevo:    nuevoEstado,
          id_usuario:      req.user.id,
          nombre_usuario:  req.user.nombre_usuario,
          rol_usuario:     req.user.rol,
          observacion:     obsText,
          ip_origen:       clientIp,
        });

        const auditAction = aprobado ? AuditActions.APROBAR : AuditActions.RECHAZAR;
        await logEvent({
          id_usuario:     req.user.id,
          nombre_usuario: req.user.nombre_usuario,
          accion:         auditAction,
          entidad:        'cotizaciones',
          id_entidad:     id,
          detalle: {
            aprobado,
            observaciones: obsText,
          },
          ip_origen:      clientIp,
          resultado:      'exito',
        });
      } catch (auditErr) {
        console.warn('[QuotationStateController.approveQuotation] Audit logging failed (non-fatal):', auditErr.message);
      }

      // ── Single post-commit re-fetch — reused by PDF regen AND notification ──
      // The approve() call only changes estado/aprobado_por/fecha_aprobacion.
      // All other fields (numero_correlativo, cliente_nombre, id_ejecutivo,
      // pdf_ruta, etc.) are unaffected, so one re-fetch is sufficient for both
      // the PDF check and the notification message.
      let postApprovalQuotation = null;
      try {
        postApprovalQuotation = await QuotationModel.findById(id);
      } catch (fetchErr) {
        console.warn('[QuotationStateController.approveQuotation] Post-commit re-fetch failed (non-fatal):', fetchErr.message);
      }

      // ── PDF regeneration — always regenerate on approval/rejection ──────────
      // Approval is a key lifecycle event: the PDF must always reflect the new
      // estado (Aprobada internamente / Rechazada). We unconditionally regenerate
      // so the status badge and APROBADO stamp are always current, regardless of
      // whether a prior auto-generated PDF already existed at pdf_ruta.
      if (postApprovalQuotation) {
        try {
          const newPdfPath = await pdfService.generateQuotationPdf(postApprovalQuotation);
          await QuotationModel.updatePdfPath(id, newPdfPath);
        } catch (pdfErr) {
          console.warn(
            `[QuotationStateController] PDF regeneration after ${aprobado ? 'approval' : 'rejection'} failed (non-fatal):`,
            pdfErr.message
          );
        }
      }

      // ── Approval notification — target the Ejecutivo who owns this quote ────
      // Fires only on approval (aprobado === true). Rejection does not generate
      // a notification row; the Ejecutivo learns via the correction-request flow.
      if (aprobado && postApprovalQuotation) {
        try {
          const mensaje = `La cotización #${postApprovalQuotation.numero_correlativo} ` +
            `para ${postApprovalQuotation.cliente_nombre ?? String(postApprovalQuotation.id_cliente)} ` +
            `ha sido aprobada por el Jefe. Ya puedes enviarla.`;

          await QuotationModel.insertNotificacion({
            id_usuario:    postApprovalQuotation.id_ejecutivo,
            id_cotizacion: id,
            tipo:          'aprobacion',
            mensaje,
          });
        } catch (notifErr) {
          console.warn('[QuotationStateController.approveQuotation] Notification insert failed (non-fatal):', notifErr.message);
        }
      }

      return res.status(200).json({
        success: true,
        message: aprobado
          ? `Quotation COT#${id} approved successfully. State is now 'Aprobada internamente'.`
          : `Quotation COT#${id} rejected. State is now 'Rechazada'.`,
        data: {
          id,
          estado_anterior: estadoAnterior,
          nuevo_estado:    nuevoEstado,
          aprobado_por:    req.user.nombre_usuario,
          observaciones:   obsText,
        },
      });
    } catch (error) {
      console.error('[QuotationStateController.approveQuotation] Error:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to process the approval decision.',
      });
    }
  },

  // ---------------------------------------------------------------------------
  // getStateHistory — GET /api/cotizaciones/:id/historial  (All roles)
  // Returns the full ordered state-change timeline for a quotation, combining
  // the creation event (from bitacora_auditoria) with all subsequent transitions
  // (from cotizacion_historial_estados). Section 4.3.
  // ---------------------------------------------------------------------------
  async getStateHistory(req, res) {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'Invalid quotation ID.' });
    }

    try {
      const quotation = await QuotationModel.findById(id);

      if (!quotation) {
        return res.status(404).json({
          success: false,
          message: `Quotation with ID ${id} was not found.`,
        });
      }

      const history = await QuotationModel.findStateHistory(id);

      return res.status(200).json({
        success:             true,
        quotation_reference: quotation.numero_correlativo,
        total:               history.length,
        data:                history,
      });
    } catch (error) {
      console.error('[QuotationStateController.getStateHistory] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to retrieve state history.' });
    }
  },
};

module.exports = QuotationStateController;
