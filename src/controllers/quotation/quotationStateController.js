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
// Los cuatro efectos posteriores a una transicion ya confirmada.
const Effects = require('./stateTransitionEffects');
// Lectura del id de la URL, compartida: estaba escrita a mano 28 veces
// con el mensaje en dos idiomas distintos.
const { parseId } = require('../../utils/parseId');

// ---------------------------------------------------------------------------
// _validateApproveRequest — las cuatro verificaciones de entrada de
// approveQuotation, antes de tocar la base: presencia y tipo de `aprobado`,
// la justificacion obligatoria al rechazar, y la asercion de rol (defensa en
// profundidad ademas del middleware de ruta). Devuelve { status, body } para
// cortar con esa respuesta, o null si esta todo bien — mismo contrato que
// las funciones de ./stateTransitionGuards.js.
// ---------------------------------------------------------------------------
function _validateApproveRequest(req) {
  const { aprobado, observaciones } = req.body;

  if (aprobado === undefined || aprobado === null) {
    return { status: 422, body: {
      success: false,
      message: "Field 'aprobado' is required. Send true to approve or false to reject.",
    } };
  }

  if (typeof aprobado !== 'boolean') {
    return { status: 422, body: {
      success: false,
      message: "Field 'aprobado' must be a boolean (true or false), not a string.",
    } };
  }

  // Rejection without justification is not permitted (Section 4.3 — business rule)
  if (aprobado === false && (!observaciones || !String(observaciones).trim())) {
    return { status: 422, body: {
      success: false,
      message: "Field 'observaciones' is required and must not be empty when rejecting a quotation. " +
               "The Ejecutivo must understand why the quotation was rejected.",
    } };
  }

  if (!['Jefe', 'SysAdmin'].includes(req.user.rol)) {
    return { status: 403, body: {
      success: false,
      message: `Access denied. Only 'Jefe' or 'SysAdmin' roles can approve or reject quotations. ` +
               `Your role is '${req.user.rol}'.`,
    } };
  }

  return null;
}

// ---------------------------------------------------------------------------
// _sendApprovalNotification — avisa al Ejecutivo dueño que su cotizacion fue
// aprobada. Solo en aprobacion: el rechazo no genera notificacion, el
// Ejecutivo se entera por el flujo de solicitud de correccion. No fatal: un
// fallo acá no debe deshacer la aprobación ya confirmada.
// ---------------------------------------------------------------------------
async function _sendApprovalNotification({ aprobado, postApprovalQuotation, id }) {
  if (!(aprobado && postApprovalQuotation)) return;

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
    const { id, error: idError } = parseId(req.params.id, 'cotización');
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

      // ── Los cuatro efectos posteriores ────────────────────────────────────
      // Viven en ./stateTransitionEffects.js. Comparten una regla: el UPDATE ya
      // esta confirmado, asi que NINGUNO puede hacer fallar la respuesta. Si el
      // registro en bitacora falla, o el PDF no se regenera, o la notificacion
      // no entra, la cotizacion igual cambio de estado — y decirle al usuario
      // "no funciono" lo llevaria a reintentar sobre un estado que ya no es el
      // que el cree.
      const usuario = {
        id:             req.user.id,
        nombre_usuario: req.user.nombre_usuario,
        rol:            userRol,
      };

      // 1. La huella: la linea de tiempo de esta cotizacion y la bitacora
      //    transversal del sistema. Son dos registros con propositos distintos.
      await Effects.registrarHuella({
        id, estadoActual, nuevoEstado: nuevo_estado, usuario,
        observacion, clientIp, esReapertura, motivo,
      });

      // 2. El PDF: su tarjeta de ESTADO tiene que reflejar el estado ACTUAL, asi
      //    que se regenera en cada transicion en vez de quedar congelado. Se
      //    relee la cotizacion porque `quotation` todavia tiene el estado viejo.
      const refreshed = await QuotationModel.findById(id);
      await regenerateQuotationPdf(refreshed, {
        label: `QuotationStateController.updateStatus → '${nuevo_estado}'`,
      });

      // 3. El aviso al ejecutivo dueño: por el hito comercial, y por la
      //    reapertura si la hubo. Omite la autonotificacion.
      await Effects.notificarAlEjecutivo({
        id, quotation, nuevoEstado: nuevo_estado, usuario, esReapertura, motivo,
      });

      // 4. El aviso al responsable de la licitacion, si esta cotizacion
      //    pertenece a un concurso y llego a un hito que le importa.
      await Effects.notificarALicitacion({
        quotation, nuevoEstado: nuevo_estado, usuario,
      });

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
    const { id, error: idError } = parseId(req.params.id, 'cotización');
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    // ── Basic validation ──────────────────────────────────────────────────────
    if (idError) return res.status(idError.status).json(idError.body);

    const reqError = _validateApproveRequest(req);
    if (reqError) return res.status(reqError.status).json(reqError.body);

    const { aprobado, observaciones } = req.body;

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

      // ── La huella, con la misma función que usa updateStatus ──────────────
      // Este bloque era una copia de treinta líneas idéntica a la de allá salvo
      // por dos valores: la acción de bitácora (APROBAR/RECHAZAR en vez de
      // CAMBIAR_ESTADO) y el detalle. Ahora se pasan como parámetro.
      //
      // La acción propia importa: contar aprobaciones tiene que ser un filtro,
      // no leer el detalle de cada cambio de estado para ver cuál lo era.
      await Effects.registrarHuella({
        id,
        estadoActual: estadoAnterior,
        nuevoEstado,
        usuario: {
          id:             req.user.id,
          nombre_usuario: req.user.nombre_usuario,
          rol:            req.user.rol,
        },
        observacion: obsText,
        clientIp,
        accion:  aprobado ? AuditActions.APROBAR : AuditActions.RECHAZAR,
        detalle: { aprobado, observaciones: obsText },
      });

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

      // Fires only on approval (aprobado === true). Rejection does not generate
      // a notification row; the Ejecutivo learns via the correction-request flow.
      await _sendApprovalNotification({ aprobado, postApprovalQuotation, id });

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
    const { id, error: idError } = parseId(req.params.id, 'cotización');

    if (idError) return res.status(idError.status).json(idError.body);

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
