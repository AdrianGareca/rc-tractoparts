// =============================================================================
// src/controllers/quotationController.js
// Quotation Controller — Core Operations
//
// Sprint 1:  createQuotation (atomic tx + auto-PDF), getQuotationById
// Sprint 2 Step 1: getQuotations (paginated+filtered), getPendingApproval,
//                  getStateSummary
// Sprint 2 Step 2: patchComentarioAdmin (Administracion-only comment)
//                  getNotificaciones (Ejecutivo pending-corrections feed)
//
// PDF operations (uploadPdf, downloadPdf) →  quotation/quotationPdfController.js
// State machine  (updateStatus, approveQuotation, getStateHistory)
//                                          →  quotation/quotationStateController.js
// =============================================================================

'use strict';

// El pool y pdfService los usan ahora quotation/transactionHelpers.js y
// quotation/pdfRegeneration.js respectivamente.
const QuotationModel              = require('../models/QuotationModel');
const LicitacionModel             = require('../models/LicitacionModel');
const QuotationLockModel          = require('../models/QuotationLockModel');
const { logEvent, AuditActions }  = require('../utils/auditLog');
const { broadcastDraftReleased }  = require('../realtime/socketServer');
const { calcularMontoTotal }      = require('../utils/quotationTotals');

// Sub-controllers extraidos (ver el bloque de exports al final del archivo)
const QuotationQueryController        = require('./quotation/quotationQueryController');
const QuotationNotificationController = require('./quotation/quotationNotificationController');

// Helpers compartidos: transaccion con reintento y regeneracion del PDF
const { withDeadlockRetry }      = require('./quotation/transactionHelpers');
const { regenerateQuotationPdf } = require('./quotation/pdfRegeneration');

// ---------------------------------------------------------------------------
// calcularTotalCotizacion — Recalcula monto_total en el servidor a partir de
// los items (el valor que manda el cliente se ignora cuando hay detalles).
// Extraida de createQuotation para que esa funcion no cargue con la cuenta
// ademas de la transaccion y el post-commit. Pura.
//
// IMPORTANTE: cada subtotal de linea se redondea a 2 decimales ANTES de
// sumar, espejando exactamente lo que QuotationModel.createDetalles guarda
// por fila. Redondear una sola vez al final de la suma cruda puede
// desincronizarse por uno o mas centavos con SUM(detalle.subtotal) en montos
// fraccionarios, lo que desalinea los reportes (basados en
// cotizaciones.monto_total) del PDF (basado en las filas de detalle guardadas).
// ---------------------------------------------------------------------------
function calcularTotalCotizacion(detalles, descuento_manual, monto_total) {
  if (detalles.length > 0) {
    const subtotalFromItems = calcularMontoTotal(
      detalles.map((item) => ({
        cantidad:        parseFloat(item.cantidad),
        precio_unitario: parseFloat(item.precio_unitario),
      }))
    );
    const discount = descuento_manual != null ? parseFloat(descuento_manual) : 0;
    return parseFloat(Math.max(0, subtotalFromItems - discount).toFixed(2));
  }
  // No line items — accept an explicit header-level total (e.g. free-text quote)
  return monto_total != null ? parseFloat(monto_total) : null;
}

// ---------------------------------------------------------------------------
// runPostCommitTasks — Todo lo que pasa DESPUES de que la transaccion de
// createQuotation ya cerro: la cotizacion YA existe (correlativo consumido,
// cabecera y detalles escritos). Nada de esto puede hacer fallar la
// respuesta 201 — ver el comentario largo que se movio junto con el codigo.
//
// El reintento es el que rompe los datos, y el reintento lo provoca el
// mensaje de error: antes, un fallo aca (conexion caida, timeout del pool)
// salia como 500 "Failed to create quotation", el usuario reenviaba el
// formulario, y se creaba una SEGUNDA cotizacion con otro correlativo.
//
// @returns {Object|null} la cotizacion recien creada (null si el findById post-commit falló)
// ---------------------------------------------------------------------------
async function runPostCommitTasks({ quotationId, numeroCorrelativo, id_cliente, calculatedTotal, req, clientIp }) {
  // Safety net: clear the draft lock for this serial if it is still present.
  // Normally the client releases its own reservation via the
  // 'cotizacion:draft:leave' socket event right before/after the POST
  // resolves, but a dropped socket message must never leave a phantom
  // "being drafted" warning stuck on everyone else's screen.
  try {
    const stillLocked = await QuotationLockModel.releaseByNumeroCorrelativo(numeroCorrelativo);
    if (stillLocked) broadcastDraftReleased();
  } catch (lockErr) {
    console.warn('[QuotationController.createQuotation] Draft lock cleanup failed (non-fatal):', lockErr.message);
  }

  let createdQuotation = null;
  try {
    createdQuotation = await QuotationModel.findById(quotationId);

    // PDF automatico — no fatal: la cotizacion queda guardada igual.
    // purge:false porque es un registro nuevo: no hay archivo anterior.
    await regenerateQuotationPdf(createdQuotation, {
      purge: false,
      label: `QuotationController.createQuotation ${numeroCorrelativo}`,
    });
  } catch (postErr) {
    console.warn(
      '[QuotationController.createQuotation] Post-commit enrichment failed (non-fatal):',
      postErr.message
    );
  }

  // Initial history record ('Pendiente' is the DB-valid initial state)
  // Non-fatal: audit logging failures must never mask a successfully committed quotation.
  try {
    await QuotationModel.logStateHistory({
      id_cotizacion:  quotationId,
      estado_anterior: null,
      estado_nuevo:   'Pendiente',
      id_usuario:     req.user.id,
      nombre_usuario: req.user.nombre_usuario,
      rol_usuario:    req.user.rol,
      observacion:    'Quotation created.',
      ip_origen:      clientIp,
    });

    await logEvent({
      id_usuario:     req.user.id,
      nombre_usuario: req.user.nombre_usuario,
      accion:         AuditActions.CREAR_COTIZACION,
      entidad:        'cotizaciones',
      id_entidad:     quotationId,
      detalle:        { numero_correlativo: numeroCorrelativo, id_cliente, monto_total: calculatedTotal },
      ip_origen:      clientIp,
      resultado:      'exito',
    });
  } catch (auditErr) {
    console.warn('[QuotationController.createQuotation] Audit logging failed (non-fatal):', auditErr.message);
  }

  return createdQuotation;
}
// Lectura del id de la URL, compartida: estaba escrita a mano 28 veces
// con el mensaje en dos idiomas distintos.
const { parseId } = require('../utils/parseId');
// La verificación del vínculo con una licitación, compartida entre crear y
// editar: estaba escrita dos veces, y el segundo comentario decía «Mirror
// createQuotation» — la duplicación era consciente.
const { verificarVinculoLicitacion } = require('./quotation/licitacionLinkGuard');


const QuotationController = {

  // ===========================================================================
  // SPRINT 1 — Write operations
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // createQuotation — POST /api/cotizaciones  (Roles: Ejecutivo, Administracion)
  // Atomic flow: BEGIN → generateCorrelativo (FOR UPDATE) → INSERT header
  //              → INSERT detalles → COMMIT → auto-generate PDF → persist path
  // ---------------------------------------------------------------------------
  async createQuotation(req, res) {
    const {
      id_cliente,
      descripcion,
      fecha_emision,
      monto_total,
      moneda,
      entidad_emisora,
      observaciones,
      fecha_validez,
      tipo_pedido,
      tiempo_entrega,
      solicitante_nombre,
      solicitante_no_solicitud,
      solicitante_area,
      solicitante_celular,
      solicitante_correo,
      equipo_marca,
      equipo_tipo,
      equipo_modelo,
      equipo_serie,
      equipo_motor,
      descuento_manual,
      forma_pago,
      mostrar_codigos,
      id_licitacion,
      detalles = [],
    } = req.body;

    const clientIp = req.ip || req.socket?.remoteAddress || null;

    // NOTA: acá había una validación manual de id_cliente / descripcion /
    // fecha_emision y de cada detalle. Era inalcanzable: la ruta corre
    // validate(createQuotationSchema) ANTES del controller, y ese schema ya
    // exige exactamente lo mismo (y responde 422 con más detalle). Ver
    // src/routes/quotationRoutes.js y src/validators/quotationValidator.js.

    // El vínculo con una licitación se verifica en ./licitacionLinkGuard.js:
    // estaba escrito igual acá y en updateQuotation. Existe además de la clave
    // foránea porque protege distinto — un 422 que nombra el número, en vez del
    // 500 genérico que produce una violación de FK.
    const errLic = await verificarVinculoLicitacion(id_licitacion, 'QuotationController.createQuotation');
    if (errLic) return res.status(errLic.status).json(errLic.body);

    // ── Duplicate detection (RF06 — non-blocking) ─────────────────────────────
    let duplicateWarning = null;
    try {
      const potentialDuplicates = await QuotationModel.checkDuplicate(
        parseInt(id_cliente, 10),
        descripcion
      );
      if (potentialDuplicates.length > 0) {
        duplicateWarning = {
          message:    'A similar quotation may already exist for this client within the last 30 days.',
          candidates: potentialDuplicates,
        };
      }
    } catch (dupErr) {
      console.warn('[QuotationController] Duplicate check failed (non-fatal):', dupErr.message);
    }

    // Recalculate monto_total server-side from line items so the stored
    // header total always matches the sum of the actual detail rows — see
    // calcularTotalCotizacion for why the rounding order matters here.
    const calculatedTotal = calcularTotalCotizacion(detalles, descuento_manual, monto_total);

    // ── Transacción atómica, con reintento ante deadlocks de InnoDB ───────────
    // El bucle de reintento y el manejo de la conexión viven en
    // quotation/transactionHelpers.js (cubiertos por
    // tests/unit/transactionHelpers.test.js).
    let numeroCorrelativo;
    let quotationId;

    try {
      await withDeadlockRetry(async (connection) => {
        numeroCorrelativo = await QuotationModel.generateCorrelativo(connection);

        quotationId = await QuotationModel.create(connection, {
          numero_correlativo:       numeroCorrelativo,
          id_cliente:               parseInt(id_cliente, 10),
          id_ejecutivo:             req.user.id,
          descripcion:              String(descripcion).trim(),
          monto_total:              calculatedTotal,
          moneda:                   moneda || 'BOB',
          entidad_emisora:          entidad_emisora || 'Empresa unipersonal de Ronald Roca Cartagena',
          observaciones:            observaciones            || null,
          fecha_emision,
          fecha_validez:            fecha_validez            || null,
          tipo_pedido:              tipo_pedido              || null,
          tiempo_entrega:           tiempo_entrega           || null,
          solicitante_nombre:       solicitante_nombre       || null,
          solicitante_no_solicitud: solicitante_no_solicitud || null,
          solicitante_area:         solicitante_area         || null,
          solicitante_celular:      solicitante_celular      || null,
          solicitante_correo:       solicitante_correo       || null,
          equipo_marca:             equipo_marca             || null,
          equipo_tipo:              equipo_tipo              || null,
          equipo_modelo:            equipo_modelo            || null,
          equipo_serie:             equipo_serie             || null,
          equipo_motor:             equipo_motor             || null,
          descuento_manual:         descuento_manual         != null ? parseFloat(descuento_manual) : null,
          forma_pago:               forma_pago               || null,
          mostrar_codigos:          mostrar_codigos          != null ? mostrar_codigos : true,
          id_licitacion:            id_licitacion            != null ? parseInt(id_licitacion, 10) : null,
        });

        if (detalles.length > 0) {
          await QuotationModel.createDetalles(connection, quotationId, detalles);
        }
      }, { label: 'QuotationController.createQuotation' });

      // Todo lo que sigue corre DESPUES del commit — la cotizacion YA existe,
      // así que nada de esto puede hacer fallar la respuesta 201. Ver el
      // comentario largo en runPostCommitTasks sobre por qué un 500 tardío
      // aquí terminaba creando cotizaciones duplicadas.
      const createdQuotation = await runPostCommitTasks({
        quotationId, numeroCorrelativo, id_cliente, calculatedTotal, req, clientIp,
      });

      return res.status(201).json({
        success:          true,
        message:          `Quotation created successfully with serial ${numeroCorrelativo}.`,
        duplicateWarning,
        // Si la re-lectura fallo, se devuelve lo minimo que la pantalla
        // necesita para seguir: con el id y el correlativo alcanza para el
        // aviso de exito y para refrescar el listado.
        data:             createdQuotation ?? { id: quotationId, numero_correlativo: numeroCorrelativo },
      });
    } catch (error) {
      // El rollback y la devolución de la conexión ya los hizo withDeadlockRetry.
      await logEvent({
        id_usuario:     req.user?.id    || null,
        nombre_usuario: req.user?.nombre_usuario || null,
        accion:         AuditActions.CREAR_COTIZACION,
        entidad:        'cotizaciones',
        id_entidad:     null,
        detalle:        { error: error.message },
        ip_origen:      clientIp,
        resultado:      'fallo',
      });

      console.error('[QuotationController.createQuotation] Error:', error.message);

      return res.status(500).json({
        success: false,
        message: 'Failed to create quotation due to an internal error. Please try again.',
      });
    }
  },

  // ---------------------------------------------------------------------------
  // updateQuotation — PUT /api/cotizaciones/:id  (Role: Ejecutivo, owner only)
  //
  // Repairs the "Solicitar Cambios" workflow: when a quotation is sent back to
  // 'Pendiente', the owning Ejecutivo can now edit the SAME record (header +
  // line items) instead of creating a brand-new one. A client who only wants
  // 3 of 10 items has the rest removed via replaceDetalles.
  //
  // Guards (defense-in-depth on top of the route middleware):
  //   • Quotation must exist                       → 404
  //   • Caller must own it (id_ejecutivo === user) → 403
  //   • State must be 'Pendiente'                  → 409 (editing is a draft-only op)
  //
  // Atomic flow: BEGIN → UPDATE header → replace detalles → COMMIT
  //              → regenerate PDF (single-PDF invariant) → audit.
  // ---------------------------------------------------------------------------
  async updateQuotation(req, res) {
    const { id, error: idError } = parseId(req.params.id, 'cotización');
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    if (idError) return res.status(idError.status).json(idError.body);

    const { id_cliente, descripcion, fecha_emision, detalles = [] } = req.body;

    try {
      const existing = await QuotationModel.findById(id);

      if (!existing) {
        return res.status(404).json({ success: false, message: `Quotation with ID ${id} was not found.` });
      }

      // Ownership guard — an executive may only edit their OWN quotations.
      if (existing.id_ejecutivo !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only edit quotations that you own.',
        });
      }

      // State guard — editing is a draft-only operation. Once a quotation has
      // moved past 'Pendiente' it is locked; the lifecycle must drive it instead.
      if (existing.estado !== 'Pendiente') {
        return res.status(409).json({
          success: false,
          message: `Only quotations in 'Pendiente' state can be edited. This quotation is '${existing.estado}'. ` +
                   `Ask a Jefe/Administrador to return it to 'Pendiente' (Solicitar Cambios) first.`,
        });
      }

      // Misma verificación que en createQuotation, ahora compartida.
      // Un null explícito acá significa DESATAR la cotización de su licitación,
      // y el guardián lo deja pasar sin consultar nada.
      const errLic = await verificarVinculoLicitacion(req.body.id_licitacion, 'QuotationController.updateQuotation');
      if (errLic) return res.status(errLic.status).json(errLic.body);

      // Recalculate the header total server-side from the line items so the
      // stored total always matches the actual detail rows (client value ignored).
      // A manual cash discount is subtracted when provided.
      // calcularMontoTotal rounds each line to 2 decimals BEFORE summing — see
      // the matching comment in createQuotation for why this must mirror
      // QuotationModel.createDetalles' per-row rounding.
      const subtotalFromItems = calcularMontoTotal(
        detalles.map((item) => ({
          cantidad:        parseFloat(item.cantidad),
          precio_unitario: parseFloat(item.precio_unitario),
        }))
      );
      const discountUpdate = req.body.descuento_manual != null ? parseFloat(req.body.descuento_manual) : 0;
      const calculatedTotal = parseFloat(Math.max(0, subtotalFromItems - discountUpdate).toFixed(2));

      await withDeadlockRetry(async (connection) => {
        const headerUpdated = await QuotationModel.updateEditableHeader(connection, id, {
        id_cliente:               parseInt(id_cliente, 10),
        descripcion:              String(descripcion).trim(),
        monto_total:              calculatedTotal,
        moneda:                   req.body.moneda || existing.moneda || 'BOB',
        // cotizaciones.entidad_emisora es NOT NULL DEFAULT 'Empresa unipersonal…'
        // (sql/init.sql), así que `existing` siempre trae un valor válido: no hace
        // falta un tercer fallback — el que había usaba el nombre comercial legado
        // ('RC Tractoparts'), que no es ninguna de las dos opciones del formulario.
        entidad_emisora:          req.body.entidad_emisora || existing.entidad_emisora,
        observaciones:            req.body.observaciones,
        fecha_emision,
        fecha_validez:            req.body.fecha_validez,
        tipo_pedido:              req.body.tipo_pedido,
        tiempo_entrega:           req.body.tiempo_entrega,
        solicitante_nombre:       req.body.solicitante_nombre,
        solicitante_no_solicitud: req.body.solicitante_no_solicitud,
        solicitante_area:         req.body.solicitante_area,
        solicitante_celular:      req.body.solicitante_celular,
        solicitante_correo:       req.body.solicitante_correo,
        equipo_marca:             req.body.equipo_marca,
        equipo_tipo:              req.body.equipo_tipo,
        equipo_modelo:            req.body.equipo_modelo,
        equipo_serie:             req.body.equipo_serie,
        equipo_motor:             req.body.equipo_motor,
        descuento_manual:         req.body.descuento_manual != null ? parseFloat(req.body.descuento_manual) : null,
        forma_pago:               req.body.forma_pago               || null,
        mostrar_codigos:          req.body.mostrar_codigos          != null ? req.body.mostrar_codigos : true,
        id_licitacion:            req.body.id_licitacion            != null ? parseInt(req.body.id_licitacion, 10) : null,
      });

        if (!headerUpdated) {
          // El UPDATE lleva `AND estado = 'Pendiente'`: 0 filas significa que la
          // cotización cambió de estado entre nuestra lectura y esta escritura.
          // Se corta con un error tipado para que el helper haga el rollback y
          // el catch de abajo lo traduzca a un 409.
          throw Object.assign(new Error('Quotation state changed concurrently.'), {
            code: 'STATE_CHANGED_CONCURRENTLY',
          });
        }

        await QuotationModel.replaceDetalles(connection, id, detalles);
      }, { label: 'QuotationController.updateQuotation' });

      // ── Post-commit: refetch, regenerate PDF (single-PDF invariant), audit ──
      const updatedQuotation = await QuotationModel.findById(id);

      await regenerateQuotationPdf(updatedQuotation, {
        label: 'QuotationController.updateQuotation',
      });

      try {
        await logEvent({
          id_usuario:     req.user.id,
          nombre_usuario: req.user.nombre_usuario,
          accion:         AuditActions.EDITAR_COTIZACION,
          entidad:        'cotizaciones',
          id_entidad:     id,
          detalle:        { numero_correlativo: existing.numero_correlativo, item_count: detalles.length },
          ip_origen:      clientIp,
          resultado:      'exito',
        });
      } catch (auditErr) {
        console.warn('[QuotationController.updateQuotation] Audit logging failed (non-fatal):', auditErr.message);
      }

      return res.status(200).json({
        success: true,
        message: 'Quotation updated successfully.',
        data:    updatedQuotation,
      });
    } catch (error) {
      if (error.code === 'STATE_CHANGED_CONCURRENTLY') {
        return res.status(409).json({
          success: false,
          message: "Quotation state changed concurrently. It is no longer 'Pendiente'. Refresh and try again.",
        });
      }
      console.error('[QuotationController.updateQuotation] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to update quotation.' });
    }
  },

  // ---------------------------------------------------------------------------
  // getNextCorrelativo — GET /api/cotizaciones/next-correlativo  (All roles)
  // Returns a non-binding preview of what the next serial number will look
  // like. Used by the frontend form to display the number in real-time.
  // ---------------------------------------------------------------------------
  async getNextCorrelativo(req, res) {
    try {
      const preview = await QuotationModel.peekNextCorrelativo();
      return res.status(200).json({ success: true, data: { numero_correlativo: preview } });
    } catch (error) {
      console.error('[QuotationController.getNextCorrelativo] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to preview next correlativo.' });
    }
  },

  // ---------------------------------------------------------------------------
  // getQuotationById — GET /api/cotizaciones/:id  (All roles)
  // ---------------------------------------------------------------------------
  async getQuotationById(req, res) {
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

      return res.status(200).json({ success: true, data: quotation });
    } catch (error) {
      console.error('[QuotationController.getQuotationById] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to retrieve quotation.' });
    }
  },

  // ===========================================================================
  // SPRINT 2 STEP 2 — State machine + approval workflow
  // (updateStatus, approveQuotation, getStateHistory moved to
  //  quotation/quotationStateController.js)
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // patchComentarioAdmin — PATCH /api/cotizaciones/:id/comentario-admin
  //                        (Role: Administracion ONLY)
  //
  // Allows the Administracion role to write or overwrite the supervisor review
  // comment on a quotation WITHOUT changing its state. This is separate from
  // the 'En espera' state transition so admins can update their notes at any
  // time before the Jefe reviews the item.
  //
  // Request body: { "comentario_admin": "text" }
  // ---------------------------------------------------------------------------
  async patchComentarioAdmin(req, res) {
    const { id, error: idError } = parseId(req.params.id, 'cotización');
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    if (idError) return res.status(idError.status).json(idError.body);

    // Defense-in-depth: controller asserts role even though route middleware already guards it
    if (req.user.rol !== 'Administracion') {
      return res.status(403).json({
        success: false,
        message: `Access denied. Only the 'Administracion' role can update admin comments. Your role is '${req.user.rol}'.`,
      });
    }

    const { comentario_admin } = req.body;

    if (comentario_admin === undefined || comentario_admin === null) {
      return res.status(422).json({
        success: false,
        message: "Field 'comentario_admin' is required. Send a string (or empty string to clear).",
      });
    }

    const sanitized = String(comentario_admin).trim();

    try {
      const quotation = await QuotationModel.findById(id);
      if (!quotation) {
        return res.status(404).json({ success: false, message: `Quotation with ID ${id} was not found.` });
      }

      await QuotationModel.updateComentarioAdmin(id, sanitized || null);

      await logEvent({
        id_usuario:     req.user.id,
        nombre_usuario: req.user.nombre_usuario,
        accion:         AuditActions.ACTUALIZAR_COMENTARIO_ADMIN,
        entidad:        'cotizaciones',
        id_entidad:     id,
        detalle:        { comentario_admin: sanitized || null },
        ip_origen:      clientIp,
        resultado:      'exito',
      });

      return res.status(200).json({
        success: true,
        message: 'Admin comment updated successfully.',
        data:    { id, comentarios_admin: sanitized || null },
      });
    } catch (error) {
      console.error('[QuotationController.patchComentarioAdmin] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to update admin comment.' });
    }
  },

  // ---------------------------------------------------------------------------
  // patchSeguimientoVenta — PATCH /api/cotizaciones/:id/seguimiento
  //                        (Roles: Ejecutivo [own quotations only], Jefe,
  //                                Administracion, SysAdmin [any quotation])
  //
  // Commercial follow-up tracking — independent of `estado` (the approval
  // workflow). Editable regardless of the quotation's current state, including
  // Archivada/Rechazada, since sales follow-up can outlive the internal
  // approval decision (e.g. re-engaging a client whose quote was archived).
  //
  // The Ejecutivo is who actually talks to the client, so they can update
  // their OWN quotations' follow-up; Jefe/Administracion/SysAdmin can update
  // any (same ownership rule as the PUT /:id edit endpoint).
  //
  // Every field is optional so a caller can update just one of the three
  // (e.g. only the next-follow-up date) without resending the others —
  // validate() already guarantees no field silently defaults to a value the
  // caller never sent (see the comment on updateSeguimientoVentaSchema).
  //
  // Request body: { estado_venta?, estado_venta_detalle?, fecha_proximo_seguimiento? }
  // ---------------------------------------------------------------------------
  async patchSeguimientoVenta(req, res) {
    const { id, error: idError } = parseId(req.params.id, 'cotización');
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    if (idError) return res.status(idError.status).json(idError.body);

    // Defense-in-depth: controller asserts the role even though route
    // middleware (writeRoles) already guards it.
    if (!['Ejecutivo', 'Administracion', 'Jefe', 'SysAdmin'].includes(req.user.rol)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Your role is '${req.user.rol}'.`,
      });
    }

    const { estado_venta, estado_venta_detalle, fecha_proximo_seguimiento } = req.body;

    try {
      const quotation = await QuotationModel.findById(id);
      if (!quotation) {
        return res.status(404).json({ success: false, message: `Quotation with ID ${id} was not found.` });
      }

      // Ownership check: an Ejecutivo may only update the follow-up on their
      // OWN quotations. Jefe/Administracion/SysAdmin can update any.
      if (req.user.rol === 'Ejecutivo' && quotation.id_ejecutivo !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. Ejecutivos can only update the sales follow-up on their own quotations.',
        });
      }

      // Partial-update semantics: a field the caller never sent must keep its
      // current DB value, not get coerced to null — the same bug family as
      // the Zod .default() issue (see updateSeguimientoVentaSchema), just one
      // layer down. 'in' checks presence in the (already-validated) body so a
      // field sent explicitly as null (to CLEAR it) is still honored.
      const datos = {
        estado_venta:              'estado_venta' in req.body              ? (estado_venta ?? null)              : quotation.estado_venta,
        estado_venta_detalle:      'estado_venta_detalle' in req.body      ? (estado_venta_detalle ?? null)       : quotation.estado_venta_detalle,
        fecha_proximo_seguimiento: 'fecha_proximo_seguimiento' in req.body ? (fecha_proximo_seguimiento ?? null)  : quotation.fecha_proximo_seguimiento,
      };
      await QuotationModel.updateSeguimientoVenta(id, datos);

      await logEvent({
        id_usuario:     req.user.id,
        nombre_usuario: req.user.nombre_usuario,
        accion:         AuditActions.ACTUALIZAR_SEGUIMIENTO_VENTA,
        entidad:        'cotizaciones',
        id_entidad:     id,
        detalle:        datos,
        ip_origen:      clientIp,
        resultado:      'exito',
      });

      return res.status(200).json({
        success: true,
        message: 'Seguimiento comercial actualizado correctamente.',
        data:    { id, ...datos },
      });
    } catch (error) {
      console.error('[QuotationController.patchSeguimientoVenta] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to update sales follow-up.' });
    }
  },

  // ---------------------------------------------------------------------------
  // getSeguimientosOcupados — GET /api/cotizaciones/seguimientos-ocupados?id_ejecutivo=N
  //
  // Fechas (YYYY-MM-DD) que ya tienen un seguimiento agendado para el
  // ejecutivo dado. Alimenta el calendario del campo "Fecha de próximo
  // seguimiento" — marca esos días, pero NO los bloquea.
  //
  // Un Ejecutivo solo puede pedir SU PROPIO calendario (mismo criterio que
  // patchSeguimientoVenta); Jefe/Administracion/SysAdmin pueden pedir el de
  // cualquier ejecutivo — lo necesitan al editar una cotización ajena.
  // ---------------------------------------------------------------------------
  async getSeguimientosOcupados(req, res) {
    const idParam = parseInt(req.query.id_ejecutivo, 10);
    if (!Number.isInteger(idParam) || idParam <= 0) {
      return res.status(422).json({ success: false, message: "Query param 'id_ejecutivo' must be a positive integer." });
    }

    if (req.user.rol === 'Ejecutivo' && idParam !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Ejecutivos can only view their own follow-up calendar.',
      });
    }

    try {
      const fechas = await QuotationModel.findFechasSeguimientoOcupadas(idParam);
      return res.status(200).json({ success: true, data: fechas });
    } catch (error) {
      console.error('[QuotationController.getSeguimientosOcupados] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to retrieve the follow-up calendar.' });
    }
  },
};

// ===========================================================================
// Superficie publica — este archivo sigue siendo el unico punto de entrada
// que importan las rutas (QuotationController.X), pero la implementacion de
// lectura y notificaciones vive en sus propios modulos.
// ===========================================================================

module.exports = {
  ...QuotationController,

  // Lecturas: listado + filtros, cola de aprobacion, resumen por estado
  ...QuotationQueryController,

  // Feed personal de notificaciones (Ejecutivo / Proyectos)
  getNotificaciones:        QuotationNotificationController.getNotificaciones,
  markNotificacionesLeidas: QuotationNotificationController.markNotificacionesLeidas,
};
