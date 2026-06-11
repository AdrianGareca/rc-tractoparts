// =============================================================================
// src/controllers/quotationController.js
// Quotation Controller — All Sprints
//
// Sprint 1:  createQuotation (atomic tx + auto-PDF), getQuotationById,
//            uploadPdf, downloadPdf
// Sprint 2 Step 1: getQuotations (paginated+filtered), getPendingApproval,
//                  getStateSummary
// Sprint 2 Step 2: updateStatus (role-based state machine + 'En revision'
//                  mandatory-field pre-check), approveQuotation (HU08 with
//                  boolean aprobado + mandatory observaciones on rejection +
//                  PDF regeneration on approval), getStateHistory
// =============================================================================

'use strict';

const path                        = require('path');
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
        numero_correlativo: numeroCorrelativo,
        id_cliente:         parseInt(id_cliente, 10),
        id_ejecutivo:       req.user.id,
        descripcion:        String(descripcion).trim(),
        monto_total:        calculatedTotal,
        moneda:             moneda || 'USD',
        observaciones:      observaciones || null,
        fecha_emision,
        fecha_validez:      fecha_validez || null,
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

  // ---------------------------------------------------------------------------
  // uploadPdf — POST /api/cotizaciones/:id/pdf  (Role: Ejecutivo)
  // ---------------------------------------------------------------------------
  async uploadPdf(req, res) {
    const id       = parseInt(req.params.id, 10);
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    if (isNaN(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'Invalid quotation ID.' });
    }

    if (!req.file) {
      return res.status(422).json({
        success: false,
        message: 'No PDF file received. Ensure the field name is "archivo" and the file is a valid PDF.',
      });
    }

    try {
      const quotation = await QuotationModel.findById(id);
      if (!quotation) {
        return res.status(404).json({ success: false, message: `Quotation with ID ${id} was not found.` });
      }

      // Use forward slashes regardless of OS so the stored DB path is
      // portable and consistent when displayed or queried cross-platform.
      const relativePath = [
        (process.env.UPLOAD_DIR || 'uploads/cotizaciones').replace(/\\/g, '/'),
        req.file.filename,
      ].join('/');

      await QuotationModel.updatePdfPath(id, relativePath);

      await logEvent({
        id_usuario:     req.user.id,
        nombre_usuario: req.user.nombre_usuario,
        accion:         AuditActions.SUBIR_PDF,
        entidad:        'cotizaciones',
        id_entidad:     id,
        detalle:        { archivo: req.file.filename, size_bytes: req.file.size },
        ip_origen:      clientIp,
        resultado:      'exito',
      });

      return res.status(200).json({
        success:  true,
        message:  'PDF uploaded and linked to quotation successfully.',
        data:     { id, pdf_ruta: relativePath, filename: req.file.filename },
      });
    } catch (error) {
      console.error('[QuotationController.uploadPdf] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to link the uploaded PDF.' });
    }
  },

  // ---------------------------------------------------------------------------
  // downloadPdf — GET /api/cotizaciones/:id/pdf  (All roles)
  // ---------------------------------------------------------------------------
  async downloadPdf(req, res) {
    const id       = parseInt(req.params.id, 10);
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    if (isNaN(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'Invalid quotation ID.' });
    }

    try {
      const quotation = await QuotationModel.findById(id);

      if (!quotation) {
        return res.status(404).json({ success: false, message: `Quotation with ID ${id} was not found.` });
      }

      if (!quotation.pdf_ruta) {
        return res.status(404).json({ success: false, message: 'No PDF document is attached to this quotation.' });
      }

      const absolutePath = path.resolve(process.cwd(), quotation.pdf_ruta);

      await logEvent({
        id_usuario:     req.user.id,
        nombre_usuario: req.user.nombre_usuario,
        accion:         AuditActions.DESCARGAR_PDF,
        entidad:        'cotizaciones',
        id_entidad:     id,
        detalle:        { pdf_ruta: quotation.pdf_ruta },
        ip_origen:      clientIp,
        resultado:      'exito',
      });

      const downloadFilename = `${quotation.numero_correlativo}.pdf`;
      res.download(absolutePath, downloadFilename, (err) => {
        if (err) {
          console.error('[QuotationController.downloadPdf] File send error:', err.message);
          if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'Failed to send the PDF file.' });
          }
        }
      });
    } catch (error) {
      console.error('[QuotationController.downloadPdf] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to retrieve the PDF document.' });
    }
  },

  // ===========================================================================
  // SPRINT 2 STEP 1 — Advanced read operations
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
  // The Jefe's approval queue: all 'En revision' quotations, oldest-first.
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
  // SPRINT 2 STEP 2 — State machine enforcement and HU08 approval workflow
  // ===========================================================================

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
    const userRol                                     = req.user.rol;
    const clientIp                                    = req.ip || req.socket?.remoteAddress || null;

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
      // comentario_admin is forwarded only when the calling role is Administracion;
      // it is silently ignored for other roles to prevent privilege escalation
      // via field injection.
      const adminComment = (userRol === 'Administracion' && comentario_admin != null)
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

      // ── Persist in the dedicated state history table ──────────────────────
      await QuotationModel.logStateHistory({
        id_cotizacion:  id,
        estado_anterior: estadoActual,
        estado_nuevo:   nuevo_estado,
        id_usuario:     req.user.id,
        nombre_usuario: req.user.nombre_usuario,
        rol_usuario:    userRol,
        observacion:    observacion || null,
        ip_origen:      clientIp,
      });

      // ── Write the generic audit event ─────────────────────────────────────
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

      console.error('[QuotationController.updateStatus] Error:', error.message);

      return res.status(500).json({
        success: false,
        message: 'Failed to update quotation status.',
      });
    }
  },

  // ---------------------------------------------------------------------------
  // approveQuotation — POST /api/cotizaciones/:id/aprobar  (Role: Jefe ONLY — HU08)
  //
  // Dedicated approval/rejection endpoint. Distinct from updateStatus because:
  //   1. It writes approval metadata (aprobado_por, fecha_aprobacion, obs_aprobacion).
  //   2. It receives a boolean `aprobado` instead of a state string.
  //   3. It mandates `observaciones` when rejecting (business rule).
  //   4. It regenerates the PDF to reflect the updated approval status.
  //
  // Request body:
  //   {
  //     "aprobado":      true | false,   (required)
  //     "observaciones": "text"          (required when aprobado = false)
  //   }
  //
  // The middleware authorize(['Jefe']) already enforces the role before this
  // method is called. The controller asserts it again as defense-in-depth.
  // ---------------------------------------------------------------------------
  async approveQuotation(req, res) {
    const id       = parseInt(req.params.id, 10);
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    // ── Basic validation ──────────────────────────────────────────────────────
    if (isNaN(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'Invalid quotation ID.' });
    }

    const { aprobado, observaciones } = req.body;

    // aprobado must be explicitly provided and must be a boolean
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
    // If the middleware is misconfigured, this line catches the gap before any
    // approval data reaches the database.
    if (!['Jefe', 'SysAdmin'].includes(req.user.rol)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Only 'Jefe' or 'SysAdmin' roles can approve or reject quotations. ` +
                 `Your role is '${req.user.rol}'.`,
      });
    }

    try {
      // ── Verify quotation exists ───────────────────────────────────────────
      // Jefe and SysAdmin hold absolute authority: they can approve or reject
      // a quotation from ANY state (Pendiente, En revision, En espera, etc.).
      // The state restriction has been removed to unblock the HU08 workflow.
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

      // ── Execute the approval write (optimistic concurrency on current state) ─
      const approved = await QuotationModel.approve(id, req.user.id, aprobado, obsText, estadoAnterior);

      if (!approved) {
        // Another request changed the state between our findById and the UPDATE
        return res.status(409).json({
          success: false,
          message: 'Approval could not be recorded. The quotation state changed concurrently. Refresh and try again.',
        });
      }

      // ── Write to the state history table ──────────────────────────────────
      await QuotationModel.logStateHistory({
        id_cotizacion:  id,
        estado_anterior: estadoAnterior,
        estado_nuevo:   nuevoEstado,
        id_usuario:     req.user.id,
        nombre_usuario: req.user.nombre_usuario,
        rol_usuario:    req.user.rol,
        observacion:    obsText,
        ip_origen:      clientIp,
      });

      // ── Write the audit event ─────────────────────────────────────────────
      const auditAction = aprobado ? AuditActions.APROBAR : AuditActions.RECHAZAR;

      await logEvent({
        id_usuario:     req.user.id,
        nombre_usuario: req.user.nombre_usuario,
        accion:         auditAction,
        entidad:        'cotizaciones',
        id_entidad:     id,
        detalle:        { aprobado, observaciones: obsText },
        ip_origen:      clientIp,
        resultado:      'exito',
      });

      // ── PDF regeneration — reflect the new status in the document ─────────
      // Non-fatal: the approval is committed regardless of PDF outcome.
      try {
        const updatedQuotation = await QuotationModel.findById(id);
        const newPdfPath       = await pdfService.generateQuotationPdf(updatedQuotation);
        await QuotationModel.updatePdfPath(id, newPdfPath);
      } catch (pdfErr) {
        console.warn(
          `[QuotationController] PDF regeneration after ${aprobado ? 'approval' : 'rejection'} failed (non-fatal):`,
          pdfErr.message
        );
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
      console.error('[QuotationController.approveQuotation] Error:', error.message);

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
      // Verify the quotation exists before querying history
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
      console.error('[QuotationController.getStateHistory] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to retrieve state history.' });
    }
  },

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
};

module.exports = QuotationController;
