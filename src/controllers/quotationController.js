// =============================================================================
// src/controllers/quotationController.js
// Quotation Controller — HU03–HU08 (Sprint 1) + Advanced queries (Sprint 2)
//
// Sprint 2 additions in this file:
//   getQuotations  — rebuilt with pagination, full filter set, sort control,
//                    parallel count query, and structured pagination envelope
//   getPendingApproval — Jefe's approval queue (all "En revision" quotations)
//   getStateSummary    — grouped counts per estado for sidebar/dashboard use
//
// All Sprint 1 methods (createQuotation, getQuotationById, updateStatus,
// approveQuotation, uploadPdf, downloadPdf) are preserved exactly.
// =============================================================================

'use strict';

const path             = require('path');
const { pool }         = require('../config/db');
const QuotationModel   = require('../models/QuotationModel');
const { logEvent, AuditActions } = require('../utils/auditLog');

// Valid sort column keys exposed to callers (values come from the model constant)
const VALID_SORT_KEYS = Object.keys(QuotationModel.SORTABLE_COLUMNS);

const QuotationController = {

  // ==========================================================================
  // SPRINT 1 — Write operations (unchanged)
  // ==========================================================================

  // ---------------------------------------------------------------------------
  // createQuotation — POST /api/cotizaciones
  // Atomic transaction: correlativo + header INSERT + line-item INSERT
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

    const validationErrors = [];
    if (!id_cliente)    validationErrors.push({ field: 'id_cliente',    message: 'Client ID is required.' });
    if (!descripcion)   validationErrors.push({ field: 'descripcion',   message: 'Description is required.' });
    if (!fecha_emision) validationErrors.push({ field: 'fecha_emision', message: 'Emission date is required.' });

    detalles.forEach((item, index) => {
      if (!item.descripcion_item) {
        validationErrors.push({ field: `detalles[${index}].descripcion_item`, message: 'Item description is required.' });
      }
      if (item.cantidad == null || parseFloat(item.cantidad) <= 0) {
        validationErrors.push({ field: `detalles[${index}].cantidad`, message: 'Quantity must be greater than 0.' });
      }
      if (item.precio_unitario == null || parseFloat(item.precio_unitario) < 0) {
        validationErrors.push({ field: `detalles[${index}].precio_unitario`, message: 'Unit price must be 0 or greater.' });
      }
    });

    if (validationErrors.length > 0) {
      return res.status(422).json({
        success: false,
        message: 'Validation failed. Please review the following fields.',
        errors:  validationErrors,
      });
    }

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
    } catch (dupError) {
      console.warn('[QuotationController] Duplicate check failed (non-fatal):', dupError.message);
    }

    let connection;

    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();

      const numeroCorrelativo = await QuotationModel.generateCorrelativo(connection);

      const quotationId = await QuotationModel.create(connection, {
        numero_correlativo: numeroCorrelativo,
        id_cliente:         parseInt(id_cliente, 10),
        id_ejecutivo:       req.user.id,
        descripcion:        String(descripcion).trim(),
        monto_total:        monto_total != null ? parseFloat(monto_total) : null,
        moneda:             moneda || 'USD',
        observaciones:      observaciones || null,
        fecha_emision,
        fecha_validez:      fecha_validez || null,
      });

      if (detalles.length > 0) {
        await QuotationModel.createDetalles(connection, quotationId, detalles);
      }

      await connection.commit();

      const createdQuotation = await QuotationModel.findById(quotationId);

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
  // updateStatus — PUT /api/cotizaciones/:id/estado  (All roles)
  // ---------------------------------------------------------------------------
  async updateStatus(req, res) {
    const id                         = parseInt(req.params.id, 10);
    const { nuevo_estado, observacion } = req.body;
    const clientIp                   = req.ip || req.socket?.remoteAddress || null;

    if (isNaN(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'Invalid quotation ID.' });
    }

    if (!nuevo_estado) {
      return res.status(422).json({ success: false, message: 'nuevo_estado is required.' });
    }

    if (!QuotationModel.VALID_STATES.includes(nuevo_estado)) {
      return res.status(422).json({
        success: false,
        message: `Invalid state '${nuevo_estado}'. Valid states: [${QuotationModel.VALID_STATES.join(', ')}]`,
      });
    }

    try {
      const quotation = await QuotationModel.findById(id);
      if (!quotation) {
        return res.status(404).json({ success: false, message: `Quotation with ID ${id} was not found.` });
      }

      const estadoAnterior = quotation.estado;
      const updated        = await QuotationModel.updateStatus(id, nuevo_estado, estadoAnterior);

      if (!updated) {
        return res.status(409).json({
          success: false,
          message: 'State could not be updated. The quotation may have been modified concurrently.',
        });
      }

      await logEvent({
        id_usuario:     req.user.id,
        nombre_usuario: req.user.nombre_usuario,
        accion:         AuditActions.CAMBIAR_ESTADO,
        entidad:        'cotizaciones',
        id_entidad:     id,
        detalle:        { estado_anterior: estadoAnterior, nuevo_estado, observacion: observacion || null },
        ip_origen:      clientIp,
        resultado:      'exito',
      });

      return res.status(200).json({
        success: true,
        message: `Quotation status updated: '${estadoAnterior}' → '${nuevo_estado}'.`,
        data:    { id, estado_anterior: estadoAnterior, nuevo_estado },
      });
    } catch (error) {
      if (error.message.startsWith('Invalid state transition')) {
        return res.status(409).json({ success: false, message: error.message });
      }
      console.error('[QuotationController.updateStatus] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to update quotation status.' });
    }
  },

  // ---------------------------------------------------------------------------
  // approveQuotation — POST /api/cotizaciones/:id/aprobar  (Role: Jefe)
  // ---------------------------------------------------------------------------
  async approveQuotation(req, res) {
    const id                           = parseInt(req.params.id, 10);
    const { decision, obs_aprobacion } = req.body;
    const clientIp                     = req.ip || req.socket?.remoteAddress || null;

    if (isNaN(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'Invalid quotation ID.' });
    }

    if (!decision || !['aprobada', 'rechazada'].includes(decision)) {
      return res.status(422).json({
        success: false,
        message: "Field 'decision' must be either 'aprobada' or 'rechazada'.",
      });
    }

    try {
      const quotation = await QuotationModel.findById(id);

      if (!quotation) {
        return res.status(404).json({ success: false, message: `Quotation with ID ${id} was not found.` });
      }

      if (quotation.estado !== 'En revision') {
        return res.status(409).json({
          success: false,
          message: `Only quotations in 'En revision' state can be approved or rejected. Current: '${quotation.estado}'.`,
        });
      }

      const approved = await QuotationModel.approve(id, req.user.id, decision, obs_aprobacion || null);

      if (!approved) {
        return res.status(409).json({
          success: false,
          message: 'Approval could not be recorded. The quotation state may have changed concurrently.',
        });
      }

      const auditAction = decision === 'aprobada' ? AuditActions.APROBAR : AuditActions.RECHAZAR;

      await logEvent({
        id_usuario:     req.user.id,
        nombre_usuario: req.user.nombre_usuario,
        accion:         auditAction,
        entidad:        'cotizaciones',
        id_entidad:     id,
        detalle:        { decision, obs_aprobacion: obs_aprobacion || null },
        ip_origen:      clientIp,
        resultado:      'exito',
      });

      const nuevoEstado = decision === 'aprobada' ? 'Aprobada internamente' : 'Rechazada';

      return res.status(200).json({
        success: true,
        message: `Quotation ${decision === 'aprobada' ? 'approved' : 'rejected'} successfully.`,
        data:    { id, nuevo_estado: nuevoEstado },
      });
    } catch (error) {
      console.error('[QuotationController.approveQuotation] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to process approval.' });
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

      const relativePath = path.join(
        process.env.UPLOAD_DIR || 'uploads/cotizaciones',
        req.file.filename
      );

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

  // ==========================================================================
  // SPRINT 2 — Advanced read operations
  // ==========================================================================

  // ---------------------------------------------------------------------------
  // getQuotations — GET /api/cotizaciones  (All roles)
  //
  // Accepted query parameters:
  //   Filters:
  //     q            {string}  General search (correlativo, client name, NIT)
  //     razon_social {string}  Client name partial match
  //     nit          {string}  Client NIT partial match
  //     estado       {string}  Exact state name
  //     id_cliente   {number}  Exact client ID
  //     id_ejecutivo {number}  Exact executive ID
  //     fecha_desde  {string}  Date lower bound (YYYY-MM-DD)
  //     fecha_hasta  {string}  Date upper bound (YYYY-MM-DD)
  //     moneda       {string}  'USD' | 'BOB'
  //     tiene_pdf    {string}  'true' | 'false'
  //
  //   Pagination:
  //     page  {number}  Page number, 1-based (default: 1)
  //     limit {number}  Records per page, max 100 (default: 20)
  //
  //   Sorting:
  //     sort_by    {string}  Column key (default: 'creado_en')
  //     sort_order {string}  'ASC' | 'DESC' (default: 'DESC')
  //
  // Response envelope:
  //   { success, data[], pagination: { page, limit, totalRecords, totalPages, hasNext, hasPrev } }
  // ---------------------------------------------------------------------------
  async getQuotations(req, res) {
    try {
      // -----------------------------------------------------------------------
      // 1. Parse and validate query parameters
      // -----------------------------------------------------------------------

      // --- Filters ---
      const filters = {};

      if (req.query.q)            filters.q            = String(req.query.q);
      if (req.query.razon_social) filters.razon_social = String(req.query.razon_social);
      if (req.query.nit)          filters.nit          = String(req.query.nit);

      // Estado: validate against the canonical state list
      if (req.query.estado) {
        if (!QuotationModel.VALID_STATES.includes(req.query.estado)) {
          return res.status(422).json({
            success: false,
            message: `Invalid estado '${req.query.estado}'. ` +
                     `Valid values: [${QuotationModel.VALID_STATES.join(', ')}]`,
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

      // Date range: both must be valid YYYY-MM-DD strings
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

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

      // Logical date range check: desde must not be after hasta
      if (filters.fecha_desde && filters.fecha_hasta && filters.fecha_desde > filters.fecha_hasta) {
        return res.status(422).json({
          success: false,
          message: 'fecha_desde cannot be later than fecha_hasta.',
        });
      }

      if (req.query.moneda) {
        const moneda = String(req.query.moneda).toUpperCase();
        if (!['USD', 'BOB'].includes(moneda)) {
          return res.status(422).json({ success: false, message: "moneda must be 'USD' or 'BOB'." });
        }
        filters.moneda = moneda;
      }

      // tiene_pdf is a boolean flag — coerce the string query value
      if (req.query.tiene_pdf !== undefined) {
        if (req.query.tiene_pdf === 'true')  filters.tiene_pdf = true;
        else if (req.query.tiene_pdf === 'false') filters.tiene_pdf = false;
        else {
          return res.status(422).json({ success: false, message: "tiene_pdf must be 'true' or 'false'." });
        }
      }

      // --- Pagination ---
      const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

      // --- Sorting ---
      const sortBy = req.query.sort_by || 'creado_en';

      if (!VALID_SORT_KEYS.includes(sortBy)) {
        return res.status(422).json({
          success: false,
          message: `Invalid sort_by '${sortBy}'. Valid keys: [${VALID_SORT_KEYS.join(', ')}]`,
        });
      }

      const sortOrder = (req.query.sort_order || '').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      // -----------------------------------------------------------------------
      // 2. Execute data query and count query in parallel
      //    Using Promise.all halves the wait time vs running them sequentially.
      // -----------------------------------------------------------------------
      const [rows, totalRecords] = await Promise.all([
        QuotationModel.findAll(filters, { page, limit }, { by: sortBy, order: sortOrder }),
        QuotationModel.countAll(filters),
      ]);

      // -----------------------------------------------------------------------
      // 3. Build the pagination metadata envelope
      // -----------------------------------------------------------------------
      const totalPages = Math.ceil(totalRecords / limit) || 1;

      return res.status(200).json({
        success: true,
        data:    rows,
        pagination: {
          page,
          limit,
          totalRecords,
          totalPages,
          hasNext: page < totalPages,  // true if there is a next page
          hasPrev: page > 1,           // true if there is a previous page
        },
      });
    } catch (error) {
      console.error('[QuotationController.getQuotations] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to retrieve quotations.' });
    }
  },

  // ---------------------------------------------------------------------------
  // getPendingApproval — GET /api/cotizaciones/pendientes-aprobacion  (Role: Jefe)
  //
  // Returns all "En revision" quotations in chronological order.
  // This is the Jefe's dedicated approval queue — no pagination needed because
  // the queue is kept short by design (daily review cadence).
  // ---------------------------------------------------------------------------
  async getPendingApproval(req, res) {
    try {
      const rows = await QuotationModel.findPendingApproval();

      return res.status(200).json({
        success: true,
        total:   rows.length,
        data:    rows,
      });
    } catch (error) {
      console.error('[QuotationController.getPendingApproval] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to retrieve approval queue.' });
    }
  },

  // ---------------------------------------------------------------------------
  // getStateSummary — GET /api/cotizaciones/resumen  (All roles)
  //
  // Returns quotation counts grouped by estado.
  // Executives receive only their own counts; Jefe and Admin see all.
  //
  // Query parameter:
  //   id_ejecutivo {number} (optional, Jefe/Admin only) — scope to one executive
  // ---------------------------------------------------------------------------
  async getStateSummary(req, res) {
    try {
      let id_ejecutivo = null;

      // If the caller is an Ejecutivo, always scope to their own records only
      if (req.user.rol === 'Ejecutivo') {
        id_ejecutivo = req.user.id;
      } else if (req.query.id_ejecutivo) {
        // Jefe or Admin may optionally scope to a specific executive
        const parsed = parseInt(req.query.id_ejecutivo, 10);
        if (!isNaN(parsed) && parsed > 0) {
          id_ejecutivo = parsed;
        }
      }

      const summary = await QuotationModel.findSummaryByState(id_ejecutivo);

      // Build a normalized object that always includes all 7 states
      // so the frontend never has to handle missing keys
      const totals = Object.fromEntries(
        QuotationModel.VALID_STATES.map((state) => [state, 0])
      );

      summary.forEach((row) => {
        totals[row.estado] = row.total;
      });

      const grandTotal = Object.values(totals).reduce((a, b) => a + b, 0);

      return res.status(200).json({
        success:    true,
        data:       totals,
        grandTotal,
      });
    } catch (error) {
      console.error('[QuotationController.getStateSummary] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to retrieve state summary.' });
    }
  },
};

module.exports = QuotationController;