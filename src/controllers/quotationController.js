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

const { pool }                    = require('../config/db');
const QuotationModel              = require('../models/QuotationModel');
const { logEvent, AuditActions }  = require('../utils/auditLog');
const pdfService                  = require('../services/pdfService');

// Valid sort column keys exposed to GET /api/cotizaciones callers
const VALID_SORT_KEYS = Object.keys(QuotationModel.SORTABLE_COLUMNS);

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
      observaciones,
      fecha_validez,
      tipo_pedido,
      tiempo_entrega,
      solicitante_no_solicitud,
      solicitante_area,
      solicitante_celular,
      solicitante_correo,
      equipo_marca,
      equipo_tipo,
      equipo_modelo,
      equipo_serie,
      equipo_motor,
      detalles = [],
    } = req.body;

    const clientIp = req.ip || req.socket?.remoteAddress || null;

    // ── Input validation ──────────────────────────────────────────────────────
    const validationErrors = [];
    if (!id_cliente)    validationErrors.push({ field: 'id_cliente',    message: 'Client ID is required.' });
    if (!descripcion)   validationErrors.push({ field: 'descripcion',   message: 'Description is required.' });
    if (!fecha_emision) validationErrors.push({ field: 'fecha_emision', message: 'Emission date is required.' });

    detalles.forEach((item, idx) => {
      if (!item.descripcion_item) {
        validationErrors.push({ field: `detalles[${idx}].descripcion_item`, message: 'Item description is required.' });
      }
      if (item.cantidad == null || parseFloat(item.cantidad) <= 0) {
        validationErrors.push({ field: `detalles[${idx}].cantidad`, message: 'Quantity must be greater than 0.' });
      }
      if (item.precio_unitario == null || parseFloat(item.precio_unitario) < 0) {
        validationErrors.push({ field: `detalles[${idx}].precio_unitario`, message: 'Unit price must be 0 or greater.' });
      }
    });

    if (validationErrors.length > 0) {
      return res.status(422).json({
        success: false,
        message: 'Validation failed.',
        errors:  validationErrors,
      });
    }

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

    // ── Atomic transaction ────────────────────────────────────────────────────
    let connection;

    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();

      const numeroCorrelativo = await QuotationModel.generateCorrelativo(connection);

      // Recalculate monto_total server-side from line items so the stored
      // header total always matches the sum of the actual detail rows.
      // The client-supplied value is ignored when detalles are present.
      let calculatedTotal = null;
      if (detalles.length > 0) {
        calculatedTotal = parseFloat(
          detalles.reduce((sum, item) => {
            return sum + parseFloat(item.cantidad) * parseFloat(item.precio_unitario);
          }, 0).toFixed(2)
        );
      } else if (monto_total != null) {
        // No line items — accept an explicit header-level total (e.g. free-text quote)
        calculatedTotal = parseFloat(monto_total);
      }

      const quotationId = await QuotationModel.create(connection, {
        numero_correlativo:       numeroCorrelativo,
        id_cliente:               parseInt(id_cliente, 10),
        id_ejecutivo:             req.user.id,
        descripcion:              String(descripcion).trim(),
        monto_total:              calculatedTotal,
        moneda:                   moneda || 'BOB',
        observaciones:            observaciones            || null,
        fecha_emision,
        fecha_validez:            fecha_validez            || null,
        tipo_pedido:              tipo_pedido              || null,
        tiempo_entrega:           tiempo_entrega           || null,
        solicitante_no_solicitud: solicitante_no_solicitud || null,
        solicitante_area:         solicitante_area         || null,
        solicitante_celular:      solicitante_celular      || null,
        solicitante_correo:       solicitante_correo       || null,
        equipo_marca:             equipo_marca             || null,
        equipo_tipo:              equipo_tipo              || null,
        equipo_modelo:            equipo_modelo            || null,
        equipo_serie:             equipo_serie             || null,
        equipo_motor:             equipo_motor             || null,
      });

      if (detalles.length > 0) {
        await QuotationModel.createDetalles(connection, quotationId, detalles);
      }

      await connection.commit();

      // ── Post-commit: fetch full record, generate PDF, write audit ───────────
      const createdQuotation = await QuotationModel.findById(quotationId);

      // Auto-generate PDF — non-fatal: the quotation is saved regardless
      try {
        const pdfRelativePath = await pdfService.generateQuotationPdf(createdQuotation);
        await QuotationModel.updatePdfPath(quotationId, pdfRelativePath);
        createdQuotation.pdf_ruta = pdfRelativePath;
      } catch (pdfErr) {
        console.error(
          `[QuotationController] Auto PDF generation failed for ${numeroCorrelativo}:`,
          pdfErr.message
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
          detalle:        { numero_correlativo: numeroCorrelativo, id_cliente, monto_total: monto_total || null },
          ip_origen:      clientIp,
          resultado:      'exito',
        });
      } catch (auditErr) {
        console.warn('[QuotationController.createQuotation] Audit logging failed (non-fatal):', auditErr.message);
      }

      return res.status(201).json({
        success:          true,
        message:          `Quotation created successfully with serial ${numeroCorrelativo}.`,
        duplicateWarning,
        data:             createdQuotation,
      });
    } catch (error) {
      if (connection) {
        try { await connection.rollback(); } catch (rbErr) {
          console.error('[QuotationController] Rollback error:', rbErr.message);
        }
      }

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
    } finally {
      if (connection) connection.release();
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
    const id       = parseInt(req.params.id, 10);
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    if (isNaN(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'Invalid quotation ID.' });
    }

    const { id_cliente, descripcion, fecha_emision, detalles = [] } = req.body;

    let connection;
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

      // Recalculate the header total server-side from the line items so the
      // stored total always matches the actual detail rows (client value ignored).
      const calculatedTotal = parseFloat(
        detalles.reduce((sum, item) =>
          sum + parseFloat(item.cantidad) * parseFloat(item.precio_unitario), 0).toFixed(2)
      );

      connection = await pool.getConnection();
      await connection.beginTransaction();

      await QuotationModel.updateEditableHeader(connection, id, {
        id_cliente:               parseInt(id_cliente, 10),
        descripcion:              String(descripcion).trim(),
        monto_total:              calculatedTotal,
        moneda:                   req.body.moneda || existing.moneda || 'BOB',
        observaciones:            req.body.observaciones,
        fecha_emision,
        fecha_validez:            req.body.fecha_validez,
        tipo_pedido:              req.body.tipo_pedido,
        tiempo_entrega:           req.body.tiempo_entrega,
        solicitante_no_solicitud: req.body.solicitante_no_solicitud,
        solicitante_area:         req.body.solicitante_area,
        solicitante_celular:      req.body.solicitante_celular,
        solicitante_correo:       req.body.solicitante_correo,
        equipo_marca:             req.body.equipo_marca,
        equipo_tipo:              req.body.equipo_tipo,
        equipo_modelo:            req.body.equipo_modelo,
        equipo_serie:             req.body.equipo_serie,
        equipo_motor:             req.body.equipo_motor,
      });

      await QuotationModel.replaceDetalles(connection, id, detalles);

      await connection.commit();

      // ── Post-commit: refetch, regenerate PDF (single-PDF invariant), audit ──
      const updatedQuotation = await QuotationModel.findById(id);

      try {
        await pdfService.purgeQuotationPdf(updatedQuotation.pdf_ruta);
        const newPdfPath = await pdfService.generateQuotationPdf(updatedQuotation);
        await QuotationModel.updatePdfPath(id, newPdfPath);
        updatedQuotation.pdf_ruta = newPdfPath;
      } catch (pdfErr) {
        console.warn('[QuotationController.updateQuotation] PDF regeneration failed (non-fatal):', pdfErr.message);
      }

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
      if (connection) {
        try { await connection.rollback(); } catch (rbErr) {
          console.error('[QuotationController.updateQuotation] Rollback error:', rbErr.message);
        }
      }
      console.error('[QuotationController.updateQuotation] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to update quotation.' });
    } finally {
      if (connection) connection.release();
    }
  },

  // ---------------------------------------------------------------------------
  // getQuotationById — GET /api/cotizaciones/:id  (All roles)
  // ---------------------------------------------------------------------------
  async getQuotationById(req, res) {
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

      return res.status(200).json({ success: true, data: quotation });
    } catch (error) {
      console.error('[QuotationController.getQuotationById] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to retrieve quotation.' });
    }
  },

  // ===========================================================================
  // SPRINT 2 STEP 1 — Advanced read operations
  // (uploadPdf / downloadPdf moved to quotation/quotationPdfController.js)
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // getQuotations — GET /api/cotizaciones  (All roles)
  // Full filter set + pagination + sort. See QuotationModel._buildWhereClause
  // for the complete list of accepted query parameters.
  // ---------------------------------------------------------------------------
  async getQuotations(req, res) {
    try {
      const filters  = {};
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

      if (req.query.q)            filters.q            = String(req.query.q);
      if (req.query.razon_social) filters.razon_social = String(req.query.razon_social);
      if (req.query.nit)          filters.nit          = String(req.query.nit);

      if (req.query.estado) {
        if (!QuotationModel.VALID_STATES.includes(req.query.estado)) {
          return res.status(422).json({
            success: false,
            message: `Invalid estado '${req.query.estado}'. Valid values: [${QuotationModel.VALID_STATES.join(', ')}]`,
          });
        }
        filters.estado = req.query.estado;
      }

      if (req.query.id_cliente) {
        const parsed = parseInt(req.query.id_cliente, 10);
        if (isNaN(parsed) || parsed < 1) {
          return res.status(422).json({ success: false, message: 'id_cliente must be a positive integer.' });
        }
        filters.id_cliente = parsed;
      }

      if (req.query.id_ejecutivo) {
        const parsed = parseInt(req.query.id_ejecutivo, 10);
        if (isNaN(parsed) || parsed < 1) {
          return res.status(422).json({ success: false, message: 'id_ejecutivo must be a positive integer.' });
        }
        filters.id_ejecutivo = parsed;
      }

      if (req.query.fecha_desde) {
        if (!dateRegex.test(req.query.fecha_desde)) {
          return res.status(422).json({ success: false, message: 'fecha_desde must be in YYYY-MM-DD format.' });
        }
        filters.fecha_desde = req.query.fecha_desde;
      }

      if (req.query.fecha_hasta) {
        if (!dateRegex.test(req.query.fecha_hasta)) {
          return res.status(422).json({ success: false, message: 'fecha_hasta must be in YYYY-MM-DD format.' });
        }
        filters.fecha_hasta = req.query.fecha_hasta;
      }

      if (filters.fecha_desde && filters.fecha_hasta && filters.fecha_desde > filters.fecha_hasta) {
        return res.status(422).json({ success: false, message: 'fecha_desde cannot be later than fecha_hasta.' });
      }

      if (req.query.moneda) {
        const moneda = String(req.query.moneda).toUpperCase();
        if (!['USD', 'BOB'].includes(moneda)) {
          return res.status(422).json({ success: false, message: "moneda must be 'USD' or 'BOB'." });
        }
        filters.moneda = moneda;
      }

      if (req.query.tiene_pdf !== undefined) {
        if      (req.query.tiene_pdf === 'true')  filters.tiene_pdf = true;
        else if (req.query.tiene_pdf === 'false') filters.tiene_pdf = false;
        else return res.status(422).json({ success: false, message: "tiene_pdf must be 'true' or 'false'." });
      }

      // Shortcut filter: hoy=true constrains fecha_emision to today (CURDATE()).
      // Overrides any explicit fecha_desde / fecha_hasta values — used by the
      // "Proformas del Día" executive widget.
      if (req.query.hoy === 'true') {
        const today = new Date().toISOString().slice(0, 10);
        filters.fecha_desde = today;
        filters.fecha_hasta = today;
      }

      // Explicit parseInt(..., 10) guarantees strict integer type before injection
      // into the MySQL prepared-statement parameter array (prevents the
      // "Incorrect arguments to mysqld_stmt_execute" error from raw string coercion).
      const page      = Math.max(1, parseInt(req.query.page,  10) || 1);
      const limit     = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const sortBy    = req.query.sort_by || 'creado_en';
      const sortOrder = (req.query.sort_order || '').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      if (!VALID_SORT_KEYS.includes(sortBy)) {
        return res.status(422).json({
          success: false,
          message: `Invalid sort_by '${sortBy}'. Valid keys: [${VALID_SORT_KEYS.join(', ')}]`,
        });
      }

      // Fire data query and count query in parallel to halve round-trip latency
      const [rows, totalRecords] = await Promise.all([
        QuotationModel.findAll(filters, { page, limit }, { by: sortBy, order: sortOrder }),
        QuotationModel.countAll(filters),
      ]);

      const totalPages = Math.ceil(totalRecords / limit) || 1;

      return res.status(200).json({
        success: true,
        data:    rows,
        pagination: {
          page,
          limit,
          totalRecords,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      });
    } catch (error) {
      console.error('[QuotationController.getQuotations] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to retrieve quotations.' });
    }
  },

  // ---------------------------------------------------------------------------
  // getPendingApproval — GET /api/cotizaciones/pendientes-aprobacion  (Jefe)
  // The Jefe's approval queue: all quotations in 'Pendiente', 'En revision',
  // or 'En espera' states, ordered oldest-first (HU08 — all active states).
  // ---------------------------------------------------------------------------
  async getPendingApproval(req, res) {
    try {
      const rows = await QuotationModel.findPendingApproval();
      return res.status(200).json({ success: true, total: rows.length, data: rows });
    } catch (error) {
      console.error('[QuotationController.getPendingApproval] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to retrieve approval queue.' });
    }
  },

  // ---------------------------------------------------------------------------
  // getStateSummary — GET /api/cotizaciones/resumen  (All roles)
  // Ejecutivos see only their own counts; Jefe/Admin see all (or scoped by param).
  // ---------------------------------------------------------------------------
  async getStateSummary(req, res) {
    try {
      let id_ejecutivo = null;

      if (req.user.rol === 'Ejecutivo') {
        id_ejecutivo = req.user.id;  // Always scoped to self for Ejecutivo
      } else if (req.query.id_ejecutivo) {
        const parsed = parseInt(req.query.id_ejecutivo, 10);
        if (!isNaN(parsed) && parsed > 0) id_ejecutivo = parsed;
      }

      const summary = await QuotationModel.findSummaryByState(id_ejecutivo);

      // Always return all 8 states so the frontend never has to handle missing keys
      const totals = Object.fromEntries(
        QuotationModel.VALID_STATES.map((s) => [s, 0])
      );

      summary.forEach((row) => { totals[row.estado] = row.total; });

      const grandTotal = Object.values(totals).reduce((a, b) => a + b, 0);

      return res.status(200).json({ success: true, data: totals, grandTotal });
    } catch (error) {
      console.error('[QuotationController.getStateSummary] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to retrieve state summary.' });
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
    const id       = parseInt(req.params.id, 10);
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    if (isNaN(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'Invalid quotation ID.' });
    }

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
        accion:         'ACTUALIZAR_COMENTARIO_ADMIN',
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
  // getNotificaciones — GET /api/cotizaciones/notificaciones  (Role: Ejecutivo)
  // Returns two notification streams merged into a single response:
  //   1. Correction notifications — quotations sent back to 'Pendiente'
  //      (from cotizacion_historial_estados, existing behaviour)
  //   2. Approval notifications   — quotations approved / sent to client by Jefe
  //      (from the dedicated notificaciones table, new behaviour)
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
      // Only Ejecutivos receive personal notifications.
      // Jefe / Admin see all state changes via the audit log.
      if (req.user.rol !== 'Ejecutivo') {
        return res.status(200).json({ success: true, total: 0, data: [] });
      }

      // Fetch both notification streams in parallel
      const [correcciones, aprobaciones] = await Promise.all([
        QuotationModel.findNotificacionesPendientes(req.user.id),
        QuotationModel.findNotificacionesEjecutivo(req.user.id),
      ]);

      // Tag correction rows so the frontend can distinguish them
      const taggedCorrecciones = correcciones.map(r => ({ ...r, tipo: 'correccion' }));

      const combined = [...taggedCorrecciones, ...aprobaciones]
        .sort((a, b) => new Date(b.fecha_solicitud) - new Date(a.fecha_solicitud));

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
      if (req.user.rol !== 'Ejecutivo') {
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

module.exports = QuotationController;