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
const LicitacionModel            = require('../../models/LicitacionModel');
const UserModel                  = require('../../models/UserModel');
const { logEvent, AuditActions } = require('../../utils/auditLog');
// La regeneración del PDF (purgar + generar + guardar ruta, no fatal) estaba
// duplicada en cuatro controllers; ahora vive en pdfRegeneration.js.
const { regenerateQuotationPdf } = require('./pdfRegeneration');
// Las siete verificaciones previas a un cambio de estado, una por función.
// Se importan agrupadas y no sueltas para que en el cuerpo se lea
// `Guards.verificarPermisoDeRol(...)`: el prefijo dice de dónde sale la regla.
const Guards = require('./stateTransitionGuards');

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
    const id                                             = parseInt(req.params.id, 10);
    const { nuevo_estado, observacion, comentario_admin } = req.body;
    const userRol  = req.user.rol;
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    // ── Las siete verificaciones previas ──────────────────────────────────────
    // Viven en ./stateTransitionGuards.js, una función por verificación. Cada
    // una devuelve null si está todo bien, o { status, body } si hay que cortar.
    //
    // Están escritas para correr EN ESTE ORDEN y no es intercambiable: el
    // motivo de reapertura se pide después del permiso de rol (a quien no puede
    // se le responde 403, no 422 por un campo que igual no lo habría salvado), y
    // la lista previa corre después de confirmar que el destino es alcanzable,
    // para no consultar la base por una transición que ya se sabe inválida.

    // 1. La forma de lo que llegó. Es la única que no toca la base, así que va
    //    primera: una petición mal formada no llega a costar una consulta.
    const errEntrada = Guards.verificarEntrada(req.params.id, nuevo_estado);
    if (errEntrada) return res.status(errEntrada.status).json(errEntrada.body);

    try {
      const quotation = await QuotationModel.findById(id);

      // 2. Que exista, y que no esté ya en el estado pedido.
      const errExiste = Guards.verificarExistenciaYEstado(quotation, id, nuevo_estado);
      if (errExiste) return res.status(errExiste.status).json(errExiste.body);

      const estadoActual = quotation.estado;

      // 3. La delegación, leída de la base y no del token: revocarla tiene que
      //    surtir efecto en el acto, sin esperar a que el JWT venza.
      const canApproveDelegated = await Guards.resolverDelegacion(
        userRol, nuevo_estado, req.user.id
      );

      // 4. El permiso de rol contra la matriz de transiciones. Devuelve la lista
      //    de destinos válidos en los DOS casos: acompaña al 403 para que la
      //    pantalla corrija sus opciones, y al 200 de más abajo para que pueda
      //    redibujar el menú sin volver a preguntar.
      const { error: errRol, allowedTransitions } = Guards.verificarPermisoDeRol(
        estadoActual, nuevo_estado, userRol, canApproveDelegated
      );
      if (errRol) return res.status(errRol.status).json(errRol.body);

      // 5. El motivo obligatorio si esto es una reapertura. Devuelve además los
      //    dos datos calculados, que hacen falta más abajo para elegir la acción
      //    de bitácora y para guardarlos en el detalle.
      const { error: errMotivo, esReapertura, motivo } =
        Guards.verificarMotivoDeReapertura(estadoActual, nuevo_estado, observacion);
      if (errMotivo) return res.status(errMotivo.status).json(errMotivo.body);

      // 6. La cotización tiene que estar completa para entrar al circuito.
      const errLista = await Guards.verificarListaPrevia(id, nuevo_estado);
      if (errLista) return res.status(errLista.status).json(errLista.body);

      // 7. El comentario del Administrador, que sólo ese rol puede adjuntar.
      const adminComment = Guards.normalizarComentarioAdmin(userRol, comentario_admin);

      // ── A partir de acá se escribe ────────────────────────────────────────
      const updated = await QuotationModel.updateStatus(
        id,
        nuevo_estado,
        estadoActual,
        userRol,
        adminComment,
        canApproveDelegated,
        req.user.id   // approval traceability: stamps aprobado_por/fecha_aprobacion on 'Aprobada internamente'
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

        // Una reapertura se registra con su propia acción: buscar "qué ventas se
        // reabrieron" tiene que ser un filtro, no una excavación entre cientos
        // de CAMBIAR_ESTADO rutinarios.
        await logEvent({
          id_usuario:     req.user.id,
          nombre_usuario: req.user.nombre_usuario,
          accion:         esReapertura ? AuditActions.REABRIR_COTIZACION : AuditActions.CAMBIAR_ESTADO,
          entidad:        'cotizaciones',
          id_entidad:     id,
          detalle: {
            estado_anterior: estadoActual,
            nuevo_estado,
            observacion:     observacion || null,
            ...(esReapertura ? { motivo_reapertura: motivo } : {}),
          },
          ip_origen:  clientIp,
          resultado:  'exito',
        });
      } catch (auditErr) {
        console.warn('[QuotationStateController.updateStatus] Audit logging failed (non-fatal):', auditErr.message);
      }

      // ── Live PDF regeneration after every successful transition ─────────────
      // The PDF's "ESTADO" card must always reflect the CURRENT state. Rather
      // than keeping a frozen file (which would stay stuck on, e.g., 'Aprobada
      // internamente'), we re-fetch the quotation with its new estado and
      // overwrite the stored PDF on every successful transition. Non-fatal:
      // a regeneration failure must never roll back a committed state change.
      //
      // SINGLE-PDF INVARIANT: a quotation may only ever own ONE physical file.
      // We purge the previously stored PDF from disk BEFORE generating the new
      // one, so storage never accumulates a trail of stale state PDFs.
      const refreshed = await QuotationModel.findById(id);
      await regenerateQuotationPdf(refreshed, {
        label: `QuotationStateController.updateStatus → '${nuevo_estado}'`,
      });

      // ── Notification for the owning Ejecutivo ──────────────────────────────
      // Fires whenever a quotation reaches 'Enviada al cliente' or 'Confirmada',
      // REGARDLESS of who drove the transition (Jefe, SysAdmin, Administracion,
      // or a delegated Ejecutivo). The owner is notified so they can follow up.
      // Self-notification is skipped — the actor already knows about their action.
      // 'Aceptada' is accepted as a legacy alias of 'Confirmada'.
      if (['Enviada al cliente', 'Confirmada', 'Aceptada'].includes(nuevo_estado) &&
          quotation.id_ejecutivo !== req.user.id) {
        try {
          const tipoMap = {
            'Enviada al cliente': 'envio_cliente',
            'Confirmada':         'aprobacion',
            'Aceptada':           'aprobacion',
          };
          const mensaje = nuevo_estado === 'Enviada al cliente'
            ? `La cotización #${quotation.numero_correlativo} ` +
              `para ${quotation.cliente_nombre ?? String(quotation.id_cliente)} ` +
              `ha sido enviada al cliente. Ya puedes darle seguimiento.`
            : `La cotización #${quotation.numero_correlativo} ` +
              `para ${quotation.cliente_nombre ?? String(quotation.id_cliente)} ` +
              `ha sido confirmada. ¡Cierre de venta registrado!`;

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

      // ── Aviso al ejecutivo dueño cuando le reabren una venta cerrada ───────
      // Sin esto la cotización reaparecería en su lista como 'Pendiente' sin
      // ninguna explicación: él la dio por cerrada. El motivo que escribió el
      // jefe viaja en el mensaje, porque es justamente lo que el ejecutivo
      // necesita para saber qué corregir. Se omite la autonotificación.
      if (esReapertura && quotation.id_ejecutivo !== req.user.id) {
        try {
          await QuotationModel.insertNotificacion({
            id_usuario:    quotation.id_ejecutivo,
            id_cotizacion: id,
            tipo:          'correccion',
            mensaje: `La cotización #${quotation.numero_correlativo} fue REABIERTA por ` +
                     `${req.user.nombre_usuario} y volvió a estado Pendiente para que la corrijas. ` +
                     `Motivo: ${motivo}`,
          });
        } catch (notifErr) {
          console.warn('[QuotationStateController.updateStatus] Reopen notification failed (non-fatal):', notifErr.message);
        }
      }

      // ── Notificación al responsable de la licitación vinculada ──────────────
      // Si esta cotización pertenece a una licitación y avanza a un hito clave
      // (aprobada internamente / enviada / confirmada), se avisa al responsable
      // Proyectos para que lleve el control del concurso. Skip auto-notificación
      // si el propio responsable ejecutó la transición. Todo no fatal.
      if (quotation.id_licitacion != null &&
          ['Aprobada internamente', 'Enviada al cliente', 'Confirmada', 'Aceptada'].includes(nuevo_estado)) {
        try {
          const lic = await LicitacionModel.findById(quotation.id_licitacion);
          if (lic && lic.id_responsable !== req.user.id) {
            await QuotationModel.insertNotificacion({
              id_usuario:    lic.id_responsable,
              id_licitacion: lic.id,
              tipo:          'licitacion',
              mensaje: `La cotización #${quotation.numero_correlativo} vinculada a la licitación ` +
                       `${lic.codigo} cambió a "${nuevo_estado}".`,
            });
          }
        } catch (licNotifErr) {
          console.warn('[QuotationStateController.updateStatus] Licitación notification failed (non-fatal):', licNotifErr.message);
        }
      }

      return res.status(200).json({
        success: true,
        message: `Quotation state updated: '${estadoActual}' → '${nuevo_estado}'.`,
        data:    {
          id,
          estado_anterior:     estadoActual,
          nuevo_estado,
          allowed_transitions: allowedTransitions,
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
  // Source-state constraint: Jefe and SysAdmin can approve or reject only
  // from the active pre-approval states — 'Pendiente', 'En revision', or
  // 'En espera' (QuotationModel.APPROVAL_SOURCE_STATES). Terminal/closed
  // states (Archivada, Confirmada, Enviada al cliente, Rechazada) are not
  // eligible — this endpoint must not be usable to reopen a closed sale.
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

      // Source-state guard: approval/rejection is only legal from the active
      // pre-approval states. Without this check a Jefe/SysAdmin could "approve"
      // a quotation that is already Archivada, Confirmada, Enviada al cliente,
      // etc., silently reopening a closed sale or resurrecting a terminal record.
      if (!QuotationModel.APPROVAL_SOURCE_STATES.includes(estadoAnterior)) {
        return res.status(409).json({
          success: false,
          message: `Cannot approve/reject a quotation in state '${estadoAnterior}'. ` +
                   `Only ${QuotationModel.APPROVAL_SOURCE_STATES.join(', ')} are eligible.`,
        });
      }

      // ── Pre-submission checklist — APPROVAL only ──────────────────────────
      // Approving via this dedicated endpoint must satisfy the same checklist as
      // any other entry into the approval pipeline (≥1 line item, monto_total,
      // fecha_validez). Rejection is exempt: you reject BECAUSE the quote is
      // incomplete/wrong, so blocking a rejection on completeness makes no sense.
      if (aprobado === true) {
        const reviewErrors = await QuotationModel.validateForReview(id);

        if (reviewErrors.length > 0) {
          return res.status(422).json({
            success: false,
            message: 'The quotation does not meet all requirements for approval. ' +
                     'Resolve the following issues and try again.',
            errors:  reviewErrors,
          });
        }
      }

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
      //
      // SINGLE-PDF INVARIANT: purge the previously stored file from disk BEFORE
      // generating the replacement so a quotation never owns more than one PDF.
      await regenerateQuotationPdf(postApprovalQuotation, {
        label: `QuotationStateController.approveQuotation (${aprobado ? 'approval' : 'rejection'})`,
      });

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
