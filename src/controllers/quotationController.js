// =============================================================================
// src/controllers/quotationController.js
// Quotation Controller — HU03 through HU08
// (Section 3.10 — /api/cotizaciones endpoints)
//
// Responsibilities:
//   - Receive HTTP requests and validate input
//   - Delegate business operations to QuotationModel
//   - Return structured JSON responses per the API contract
//
// CRITICAL (HU03 / RNF10):
//   createQuotation acquires a pool connection and wraps the correlativo
//   generation + INSERT inside a database transaction to guarantee atomicity.
//   The connection is released in the finally block — always.
// =============================================================================

'use strict';

const path    = require('path'); // Node.js path utilities for PDF filename building
const { pool } = require('../config/db');
const QuotationModel              = require('../models/QuotationModel');
const { logEvent, AuditActions }  = require('../utils/auditLog');

const QuotationController = {

  // ---------------------------------------------------------------------------
  // createQuotation
  // POST /api/cotizaciones  (Roles: Ejecutivo, Administracion)
  //
  // Transaction flow (Section 3.6.1 — Sequence Diagram):
  //   BEGIN TRANSACTION
  //     1. Generate correlativo with SELECT ... FOR UPDATE (atomic)
  //     2. INSERT cotizaciones header row
  //     3. INSERT cotizacion_detalles line items (if any)
  //   COMMIT
  //
  // Any error triggers ROLLBACK and returns an appropriate HTTP error code.
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
      detalles = [], // Array of line-item objects; optional for the header-only use case
    } = req.body;

    const clientIp = req.ip || req.socket?.remoteAddress || null;

    // --- Input validation ---
    const validationErrors = [];

    if (!id_cliente)    validationErrors.push({ field: 'id_cliente',    message: 'Client ID is required.' });
    if (!descripcion)   validationErrors.push({ field: 'descripcion',   message: 'Description is required.' });
    if (!fecha_emision) validationErrors.push({ field: 'fecha_emision', message: 'Emission date is required.' });

    // Validate each line item if provided
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
        message:  'Validation failed. Please review the following fields.',
        errors:   validationErrors,
      });
    }

    // --- Duplicate detection (RF06 — Section 3.1) ---
    // This check runs before the transaction to avoid holding locks unnecessarily.
    let duplicateWarning = null;

    try {
      const potentialDuplicates = await QuotationModel.checkDuplicate(
        parseInt(id_cliente, 10),
        descripcion
      );

      if (potentialDuplicates.length > 0) {
        // Build a non-blocking warning; the client decides whether to proceed
        duplicateWarning = {
          message:    'A similar quotation may already exist for this client within the last 30 days.',
          candidates: potentialDuplicates,
        };
      }
    } catch (dupError) {
      // Duplicate check failure should not block quotation creation
      console.warn('[QuotationController] Duplicate check failed (non-fatal):', dupError.message);
    }

    // --- Atomic transaction: correlativo + INSERT ---
    let connection; // Declared outside try so finally can always release it

    try {
      // Acquire a dedicated connection from the pool for the transaction
      connection = await pool.getConnection();

      await connection.beginTransaction(); // START TRANSACTION

      // Step 1 — Generate the serial number with exclusive row lock
      const numeroCorrelativo = await QuotationModel.generateCorrelativo(connection);

      // Step 2 — Insert the quotation header (cotizaciones table)
      const quotationId = await QuotationModel.create(connection, {
        numero_correlativo: numeroCorrelativo,
        id_cliente:         parseInt(id_cliente, 10),
        id_ejecutivo:       req.user.id, // Set from the authenticated JWT payload
        descripcion:        String(descripcion).trim(),
        monto_total:        monto_total != null ? parseFloat(monto_total) : null,
        moneda:             moneda || 'USD',
        observaciones:      observaciones || null,
        fecha_emision,
        fecha_validez:      fecha_validez || null,
      });

      // Step 3 — Insert line items (cotizacion_detalles table), if any
      if (detalles.length > 0) {
        await QuotationModel.createDetalles(connection, quotationId, detalles);
      }

      await connection.commit(); // COMMIT — releases all locks

      // --- Post-transaction: fetch the full record and write audit log ---
      // These run on the pool (not the transaction connection) after commit
      const createdQuotation = await QuotationModel.findById(quotationId);

      await logEvent({
        id_usuario:    req.user.id,
        nombre_usuario: req.user.nombre_usuario,
        accion:        AuditActions.CREAR_COTIZACION,
        entidad:       'cotizaciones',
        id_entidad:    quotationId,
        detalle:       {
          numero_correlativo: numeroCorrelativo,
          id_cliente:         parseInt(id_cliente, 10),
          monto_total:        monto_total || null,
        },
        ip_origen:     clientIp,
        resultado:     'exito',
      });

      // Return 201 Created with the full quotation record
      return res.status(201).json({
        success:          true,
        message:          `Quotation created successfully with serial ${numeroCorrelativo}.`,
        duplicateWarning, // null if no potential duplicate was found
        data:             createdQuotation,
      });
    } catch (error) {
      // Roll back all changes if anything inside the transaction failed
      if (connection) {
        try {
          await connection.rollback(); // Release locks and discard changes
        } catch (rollbackError) {
          console.error('[QuotationController] Rollback error:', rollbackError.message);
        }
      }

      // Log the failed creation attempt for audit purposes
      await logEvent({
        id_usuario:    req.user?.id    || null,
        nombre_usuario: req.user?.nombre_usuario || null,
        accion:        AuditActions.CREAR_COTIZACION,
        entidad:       'cotizaciones',
        id_entidad:    null,
        detalle:       { error: error.message },
        ip_origen:     clientIp,
        resultado:     'fallo',
      });

      console.error('[QuotationController.createQuotation] Transaction error:', error.message);

      return res.status(500).json({
        success: false,
        message: 'Failed to create quotation due to an internal error. Please try again.',
      });
    } finally {
      // Always release the connection back to the pool — even on error
      if (connection) {
        connection.release();
      }
    }
  },

  // ---------------------------------------------------------------------------
  // getQuotations
  // GET /api/cotizaciones  (All roles)
  // Returns a paginated, filterable list of quotations.
  // ---------------------------------------------------------------------------
  async getQuotations(req, res) {
    try {
      const filters = {
        estado:       req.query.estado       || null,
        id_cliente:   req.query.id_cliente   || null,
        id_ejecutivo: req.query.id_ejecutivo || null,
        desde:        req.query.desde        || null,
        hasta:        req.query.hasta        || null,
        q:            req.query.q            || null,
      };

      // Remove null values so QuotationModel only builds clauses for provided filters
      Object.keys(filters).forEach((key) => {
        if (filters[key] === null || filters[key] === '') {
          delete filters[key];
        }
      });

      const quotations = await QuotationModel.findAll(filters);

      return res.status(200).json({
        success: true,
        total:   quotations.length,
        data:    quotations,
      });
    } catch (error) {
      console.error('[QuotationController.getQuotations] Error:', error.message);

      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve quotations.',
      });
    }
  },

  // ---------------------------------------------------------------------------
  // getQuotationById
  // GET /api/cotizaciones/:id  (All roles)
  // Returns the complete quotation including line items and approval data.
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

      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve quotation.',
      });
    }
  },

  // ---------------------------------------------------------------------------
  // updateStatus
  // PUT /api/cotizaciones/:id/estado  (All roles; transitions validated by model)
  // Change the commercial state of a quotation according to the state machine.
  // ---------------------------------------------------------------------------
  async updateStatus(req, res) {
    const id          = parseInt(req.params.id, 10);
    const { nuevo_estado, observacion } = req.body;
    const clientIp    = req.ip || req.socket?.remoteAddress || null;

    if (isNaN(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'Invalid quotation ID.' });
    }

    if (!nuevo_estado) {
      return res.status(422).json({ success: false, message: 'nuevo_estado is required.' });
    }

    try {
      // Fetch current state before attempting the transition
      const quotation = await QuotationModel.findById(id);

      if (!quotation) {
        return res.status(404).json({
          success: false,
          message: `Quotation with ID ${id} was not found.`,
        });
      }

      const estadoAnterior = quotation.estado;

      // updateStatus validates the transition matrix internally; throws on invalid transition
      const updated = await QuotationModel.updateStatus(id, nuevo_estado, estadoAnterior);

      if (!updated) {
        return res.status(409).json({
          success: false,
          message: 'State could not be updated. The quotation may have been modified concurrently.',
        });
      }

      await logEvent({
        id_usuario:    req.user.id,
        nombre_usuario: req.user.nombre_usuario,
        accion:        AuditActions.CAMBIAR_ESTADO,
        entidad:       'cotizaciones',
        id_entidad:    id,
        detalle:       { estado_anterior: estadoAnterior, nuevo_estado, observacion: observacion || null },
        ip_origen:     clientIp,
        resultado:     'exito',
      });

      return res.status(200).json({
        success: true,
        message: `Quotation status updated: '${estadoAnterior}' → '${nuevo_estado}'.`,
        data:    { id, estado_anterior: estadoAnterior, nuevo_estado },
      });
    } catch (error) {
      // If QuotationModel threw an invalid-transition error, surface it as 409 Conflict
      if (error.message.startsWith('Invalid state transition')) {
        return res.status(409).json({ success: false, message: error.message });
      }

      console.error('[QuotationController.updateStatus] Error:', error.message);

      return res.status(500).json({
        success: false,
        message: 'Failed to update quotation status.',
      });
    }
  },

  // ---------------------------------------------------------------------------
  // approveQuotation
  // POST /api/cotizaciones/:id/aprobar  (Role: Jefe only)
  // HU08 — Approve or reject a quotation that is in "En revision" state.
  // ---------------------------------------------------------------------------
  async approveQuotation(req, res) {
    const id                  = parseInt(req.params.id, 10);
    const { decision, obs_aprobacion } = req.body;
    const clientIp            = req.ip || req.socket?.remoteAddress || null;

    if (isNaN(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'Invalid quotation ID.' });
    }

    // Validate decision value
    if (!decision || !['aprobada', 'rechazada'].includes(decision)) {
      return res.status(422).json({
        success: false,
        message: "Field 'decision' must be either 'aprobada' or 'rechazada'.",
      });
    }

    try {
      // Check that the quotation exists and is in "En revision"
      const quotation = await QuotationModel.findById(id);

      if (!quotation) {
        return res.status(404).json({
          success: false,
          message: `Quotation with ID ${id} was not found.`,
        });
      }

      if (quotation.estado !== 'En revision') {
        return res.status(409).json({
          success: false,
          message: `Only quotations in 'En revision' state can be approved or rejected. ` +
                   `Current state: '${quotation.estado}'.`,
        });
      }

      const approved = await QuotationModel.approve(
        id,
        req.user.id,       // Jefe's user ID
        decision,
        obs_aprobacion || null
      );

      if (!approved) {
        return res.status(409).json({
          success: false,
          message: 'Approval could not be recorded. The quotation state may have changed concurrently.',
        });
      }

      const auditAction = decision === 'aprobada'
        ? AuditActions.APROBAR
        : AuditActions.RECHAZAR;

      await logEvent({
        id_usuario:    req.user.id,
        nombre_usuario: req.user.nombre_usuario,
        accion:        auditAction,
        entidad:       'cotizaciones',
        id_entidad:    id,
        detalle:       { decision, obs_aprobacion: obs_aprobacion || null },
        ip_origen:     clientIp,
        resultado:     'exito',
      });

      const nuevoEstado = decision === 'aprobada' ? 'Aprobada internamente' : 'Rechazada';

      return res.status(200).json({
        success: true,
        message: `Quotation ${decision === 'aprobada' ? 'approved' : 'rejected'} successfully.`,
        data:    { id, nuevo_estado: nuevoEstado },
      });
    } catch (error) {
      console.error('[QuotationController.approveQuotation] Error:', error.message);

      return res.status(500).json({
        success: false,
        message: 'Failed to process approval.',
      });
    }
  },

  // ---------------------------------------------------------------------------
  // uploadPdf
  // POST /api/cotizaciones/:id/pdf  (Role: Ejecutivo only)
  // Multer middleware (configured in routes) handles file validation and storage.
  // This controller only persists the path to the database.
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
        message: 'No PDF file was received. Ensure the field name is "archivo" and the file is a valid PDF.',
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

      // Build a relative path that matches the uploads directory structure
      const relativePath = path.join(
        process.env.UPLOAD_DIR || 'uploads/cotizaciones',
        req.file.filename
      );

      await QuotationModel.updatePdfPath(id, relativePath);

      await logEvent({
        id_usuario:    req.user.id,
        nombre_usuario: req.user.nombre_usuario,
        accion:        AuditActions.SUBIR_PDF,
        entidad:       'cotizaciones',
        id_entidad:    id,
        detalle:       { archivo: req.file.filename, size_bytes: req.file.size },
        ip_origen:     clientIp,
        resultado:     'exito',
      });

      return res.status(200).json({
        success:  true,
        message:  'PDF uploaded and linked to quotation successfully.',
        data:     { id, pdf_ruta: relativePath, filename: req.file.filename },
      });
    } catch (error) {
      console.error('[QuotationController.uploadPdf] Error:', error.message);

      return res.status(500).json({
        success: false,
        message: 'Failed to link the uploaded PDF to the quotation.',
      });
    }
  },

  // ---------------------------------------------------------------------------
  // downloadPdf
  // GET /api/cotizaciones/:id/pdf  (All roles)
  // Stream the stored PDF file to the client with the correct Content-Disposition.
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
        return res.status(404).json({
          success: false,
          message: `Quotation with ID ${id} was not found.`,
        });
      }

      if (!quotation.pdf_ruta) {
        return res.status(404).json({
          success: false,
          message: 'No PDF document is attached to this quotation.',
        });
      }

      // Resolve the absolute file path relative to the project root
      const absolutePath = path.resolve(process.cwd(), quotation.pdf_ruta);

      // Log the download event before streaming the file
      await logEvent({
        id_usuario:    req.user.id,
        nombre_usuario: req.user.nombre_usuario,
        accion:        AuditActions.DESCARGAR_PDF,
        entidad:       'cotizaciones',
        id_entidad:    id,
        detalle:       { pdf_ruta: quotation.pdf_ruta },
        ip_origen:     clientIp,
        resultado:     'exito',
      });

      // res.download streams the file and sets the Content-Disposition header
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

      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve the PDF document.',
      });
    }
  },
};

module.exports = QuotationController;
