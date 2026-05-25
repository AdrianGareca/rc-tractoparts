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
const pdfService                  = require('../services/pdfService'); // Sprint 2: auto PDF generation

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

      // --- Post-transaction: fetch the full record, auto-generate PDF, write audit log ---
      // These run on the shared pool (not the transaction connection) after commit.
      const createdQuotation = await QuotationModel.findById(quotationId);

      // -----------------------------------------------------------------------
      // Sprint 2: Automatic PDF generation
      // The PDF is generated from the fully-populated quotation object (including
      // the detalles[] already joined by findById) and the resulting file path
      // is persisted back to the database before the 201 response is sent.
      //
      // NON-FATAL: a PDF generation failure does not roll back the committed
      // quotation record. The quotation is saved; the executive can upload the
      // PDF manually via POST /api/cotizaciones/:id/pdf if auto-generation fails.
      // -----------------------------------------------------------------------
      try {
        const pdfRelativePath = await pdfService.generateQuotationPdf(createdQuotation);
        await QuotationModel.updatePdfPath(quotationId, pdfRelativePath);
        createdQuotation.pdf_ruta = pdfRelativePath; // Reflect the new path in the response
      } catch (pdfError) {
        console.error(
          `[QuotationController] Auto PDF generation failed for ${numeroCorrelativo}:`,
          pdfError.message
        );
        // pdf_ruta remains null; the quotation is still returned with pdf_ruta: null
      }

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
  // PUT /api/cotizaciones/:id/estado  (Todos los roles; validación por máquina de estados)
  // Cambia el estado comercial de una cotización controlando flujos y roles.
  // ---------------------------------------------------------------------------
  async updateStatus(req, res) {
    const id = parseInt(req.params.id, 10);
    const { nuevo_estado, observacion } = req.body;
    const clientIp = req.ip || req.socket?.remoteAddress || null;
    const userRole = req.user.rol; // 'Ejecutivo', 'Administrador', 'Jefe'

    if (isNaN(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'Invalid quotation ID.' });
    }

    if (!nuevo_estado) {
      return res.status(422).json({ success: false, message: 'nuevo_estado is required.' });
    }

    try {
      // Usar el helper del modelo para capturar los datos de control del registro
      const quotation = await QuotationModel.getStateInfo(id);

      if (!quotation) {
        return res.status(404).json({
          success: false,
          message: `Quotation with ID ${id} was not found.`,
        });
      }

      const estadoActual = quotation.estado;

      // --- VALIDACIONES DE MÁQUINA DE ESTADOS & ROLES (Sección 3.7.4) ---

      // Desviar resoluciones definitivas al endpoint dedicado de aprobaciones si no es el Jefe
      if ((nuevo_estado === 'Aprobada internamente' || nuevo_estado === 'Rechazada') && userRole !== 'Jefe') {
        return res.status(403).json({
          success: false,
          message: 'Transición denegada. Solo el rol de Jefe puede resolver o dictaminar una cotización.'
        });
      }

      // Evitar saltos de flujo directos desde Pendiente a estados finales
      if (estadoActual === 'Pendiente' && (nuevo_estado === 'Aprobada internamente' || nuevo_estado === 'Rechazada')) {
        return res.status(422).json({
          success: false,
          message: 'Violación de flujo: No se puede aprobar o rechazar una cotización que está Pendiente sin antes pasar por En revision.'
        });
      }

      // Restricción para Ejecutivos: Solo pueden promover su borrador hacia revisión
      if (userRole === 'Ejecutivo') {
        if (estadoActual !== 'Pendiente' || nuevo_estado !== 'En revision') {
          return res.status(403).json({
            success: false,
            message: 'Permiso denegado. Un Ejecutivo solo puede promover una cotización de Pendiente a En revision.'
          });
        }
      }

      // Si se intenta setear el mismo estado actual, retornar éxito para ahorrar I/O en la BD
      if (estadoActual === nuevo_estado) {
        return res.status(200).json({ success: true, message: 'No state changes required.', data: { id, estado: estadoActual } });
      }

      // Ejecutar la transición estándar validando la matriz del modelo
      const updated = await QuotationModel.updateStatus(id, nuevo_estado, estadoActual);

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
        detalle:        { estado_anterior: estadoActual, nuevo_estado, observacion: observacion || null },
        ip_origen:      clientIp,
        resultado:      'exito',
      });

      return res.status(200).json({
        success: true,
        message: `Quotation status updated: '${estadoActual}' → '${nuevo_estado}'.`,
        data:    { id, estado_anterior: estadoActual, nuevo_estado },
      });
    } catch (error) {
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
  // POST /api/cotizaciones/:id/aprobar  (Exclusivo rol: Jefe - HU08)
  // Procesa la aprobación o rechazo de una cotización bajo transacciones atómicas
  // ---------------------------------------------------------------------------
  async approveQuotation(req, res) {
    const id = parseInt(req.params.id, 10);
    const { decision, obs_aprobacion } = req.body; // decision: 'aprobada' | 'rechazada'
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    if (isNaN(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'Invalid quotation ID.' });
    }

    // Doble verificación programática de seguridad
    if (req.user.rol !== 'Jefe') {
      return res.status(403).json({
        success: false,
        message: 'Acceso Denegado. Esta operación es de uso exclusivo para el Jefe de Área (HU08).'
      });
    }

    if (!decision || !['aprobada', 'rechazada'].includes(decision)) {
      return res.status(422).json({
        success: false,
        errors: [{ field: 'decision', message: "Field 'decision' must be either 'aprobada' or 'rechazada'." }],
      });
    }

    // Exigencia del motivo técnico en caso de rechazos
    if (decision === 'rechazada' && (!obs_aprobacion || obs_aprobacion.trim().length === 0)) {
      return res.status(422).json({
        success: false,
        errors: [{ field: 'obs_aprobacion', message: 'Debe especificar de forma obligatoria las observaciones o el motivo del rechazo.' }]
      });
    }

    let connection;
    try {
      const quotation = await QuotationModel.getStateInfo(id);

      if (!quotation) {
        return res.status(404).json({
          success: false,
          message: `Quotation with ID ${id} was not found.`,
        });
      }

      if (quotation.estado !== 'En revision') {
        return res.status(409).json({
          success: false,
          message: `Only quotations in 'En revision' state can be approved or rejected. Current state: '${quotation.estado}'.`,
        });
      }

      const determinanteEstado = decision === 'aprobada' ? 'Aprobada internamente' : 'Rechazada';
      const accionHistorial = decision === 'aprobada' ? 'APROBADA' : 'RECHAZADA';

      // --- EJECUCIÓN DEL FLUJO ATÓMICO (ACID) ---
      connection = await pool.getConnection();
      await connection.beginTransaction();

      // 1. Modificar encabezado principal
      await QuotationModel.updateStatusInTransaction(connection, id, determinanteEstado);

      // 2. Persistir registro en la tabla histórica de aprobaciones (HU08)
      await QuotationModel.insertApprovalHistory(connection, {
        id_cotizacion: id,
        id_jefe: req.user.id,
        accion: accionHistorial,
        observaciones: obs_aprobacion ? obs_aprobacion.trim() : null
      });

      await connection.commit();

      // 3. Registrar auditoría global inmutable
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

      return res.status(200).json({
        success: true,
        message: `Quotation ${decision === 'aprobada' ? 'approved' : 'rejected'} successfully.`,
        data:    { id, nuevo_estado: determinanteEstado },
      });
    } catch (error) {
      if (connection) {
        try { await connection.rollback(); } catch (rbErr) { console.error('Rollback failed:', rbErr.message); }
      }
      console.error('[QuotationController.approveQuotation] Error:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to process approval due to an internal isolation error.',
      });
    } finally {
      if (connection) {
        connection.release();
      }
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
        message: 'Failed to create or retrieve the PDF document.',
      });
    }
  },

  // ===========================================================================
  // MÉTODOS COMPLEMENTARIOS ADICIONALES (SPRINT 2)
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // getStateSummary
  // GET /api/cotizaciones/resumen  (Todos los roles)
  // Retorna el conteo de cotizaciones agrupadas por estado.
  // ---------------------------------------------------------------------------
  async getStateSummary(req, res) {
    try {
      // Si el rol es Ejecutivo, se restringe para que solo vea el conteo de sus registros
      const idEjecutivo = req.user.rol === 'Ejecutivo' ? req.user.id : null;
      
      const summary = await QuotationModel.findSummaryByState(idEjecutivo);
      
      return res.status(200).json({
        success: true,
        data: summary
      });
    } catch (error) {
      console.error('[QuotationController.getStateSummary] Error:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve states summary.'
      });
    }
  },

  // ---------------------------------------------------------------------------
  // getPendingApproval
  // GET /api/cotizaciones/pendientes-aprobacion  (Exclusivo: Jefe)
  // Devuelve la cola ordenada cronológicamente de cotizaciones "En revision".
  // ---------------------------------------------------------------------------
  async getPendingApproval(req, res) {
    try {
      if (req.user.rol !== 'Jefe') {
        return res.status(403).json({ success: false, message: 'Access denied. Area Chief role required.' });
      }

      const pending = await QuotationModel.findPendingApproval();
      
      return res.status(200).json({
        success: true,
        total: pending.length,
        data: pending
      });
    } catch (error) {
      console.error('[QuotationController.getPendingApproval] Error:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve the pending approvals queue.'
      });
    }
  },
};

module.exports = QuotationController;