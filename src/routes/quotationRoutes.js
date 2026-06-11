// =============================================================================
// src/routes/quotationRoutes.js
// Quotation Routes — /api/cotizaciones
// (Section 3.10 — API Contract · Section 3.7.4 — Permission Matrix)
//
// ⚠  ROUTE ORDER IS LOAD-BEARING
//    Express matches routes top-to-bottom. Fixed literal paths (/resumen,
//    /pendientes-aprobacion) MUST be registered before the /:id catchall or
//    Express will interpret the literal segment as an ID parameter and dispatch
//    to the wrong handler with no error.
//
//    Correct order:
//      1. Fixed-path  GET  /resumen
//      2. Fixed-path  GET  /pendientes-aprobacion
//      3. Collection  GET  /
//      4. Collection  POST /
//      5. Parametric  GET  /:id
//      6. Parametric  GET  /:id/historial
//      7. Parametric  PUT  /:id/estado
//      8. Parametric  POST /:id/aprobar
//      9. Parametric  POST /:id/pdf
//     10. Parametric  GET  /:id/pdf
//
// Sprint 1: POST /, GET /:id, PUT /:id/estado, POST /:id/aprobar,
//           POST /:id/pdf, GET /:id/pdf
// Sprint 2: GET / (paginated+filtered), GET /resumen,
//           GET /pendientes-aprobacion, GET /:id/historial
// =============================================================================

'use strict';

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const QuotationController = require('../controllers/quotationController');
const { authenticate }    = require('../middlewares/authMiddleware');
const authorize           = require('../middlewares/roleMiddleware');
const { validate }        = require('../validators/validate');
const {
  createQuotationSchema,
  updateStatusSchema,
  approveQuotationSchema,
} = require('../validators/quotationValidator');

const router = express.Router();

// =============================================================================
// Multer — PDF upload storage and validation
// =============================================================================

const uploadDir = path.resolve(
  process.cwd(),
  process.env.UPLOAD_DIR || 'uploads/cotizaciones'
);

// Ensure the destination directory exists at startup
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename:    (req, _file, cb) => {
    // COT-<quotationId>-<unix_ms>.pdf — unique and traceable
    const quotationId = req.params.id || 'draft';
    cb(null, `COT-${quotationId}-${Date.now()}.pdf`);
  },
});

function pdfFileFilter(_req, file, cb) {
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error(`Only PDF files are accepted. Received MIME type: ${file.mimetype}`), false);
  }
}

const maxPdfBytes = (parseInt(process.env.MAX_PDF_SIZE_MB, 10) || 10) * 1024 * 1024;

const upload = multer({
  storage,
  fileFilter: pdfFileFilter,
  limits: {
    fileSize: maxPdfBytes,  // Reject oversized files before reaching the controller
    files:    1,            // Only one attachment per request
  },
});

// =============================================================================
// Role middleware shorthands
// Each is an array spread into the route handler chain.
// =============================================================================

const allRoles     = [authenticate, authorize(['Ejecutivo', 'Administracion', 'Jefe'])];
const writeRoles   = [authenticate, authorize(['Ejecutivo', 'Administracion', 'Jefe'])];
const jefeOnly     = [authenticate, authorize(['Jefe'])];
const ejecutivoOnly = [authenticate, authorize(['Ejecutivo'])];

/**
 * @swagger
 * tags:
 *   name: Cotizaciones
 *   description: Gestión completa del ciclo de vida de cotizaciones
 */

// =============================================================================
// 1–2. FIXED-PATH ROUTES (must be registered before any /:id route)
// =============================================================================

/**
 * @swagger
 * /api/cotizaciones/resumen:
 *   get:
 *     summary: Resumen de cotizaciones por estado
 *     description: Retorna el conteo de cotizaciones agrupadas por estado. Los Ejecutivos solo ven sus propios registros; Jefe y Administración ven todos.
 *     tags: [Cotizaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: id_ejecutivo
 *         schema:
 *           type: integer
 *         description: Filtrar por ID de ejecutivo (solo Jefe/Administración)
 *     responses:
 *       200:
 *         description: Resumen de estados obtenido exitosamente.
 *       401:
 *         description: Token ausente o inválido.
 *       403:
 *         description: Rol insuficiente.
 *       500:
 *         description: Error interno del servidor.
 */
// GET /api/cotizaciones/resumen
// Quotation counts grouped by estado for the sidebar / dashboard widget.
// Ejecutivos receive only their own counts; Jefe and Admin see all.
router.get(
  '/resumen',
  ...allRoles,
  QuotationController.getStateSummary
);

/**
 * @swagger
 * /api/cotizaciones/pendientes-aprobacion:
 *   get:
 *     summary: Cola de cotizaciones pendientes de aprobación (HU08)
 *     description: Retorna todas las cotizaciones en estado 'En revision', ordenadas de la más antigua a la más reciente. Exclusivo para el rol Jefe.
 *     tags: [Cotizaciones]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de cotizaciones pendientes de aprobación.
 *       401:
 *         description: Token ausente o inválido.
 *       403:
 *         description: Rol insuficiente (requiere Jefe).
 *       500:
 *         description: Error interno del servidor.
 */
// GET /api/cotizaciones/pendientes-aprobacion
// All quotations currently in 'En revision', ordered oldest-first.
// Feeds the Jefe's dedicated approval queue (HU08).
router.get(
  '/pendientes-aprobacion',
  ...jefeOnly,
  QuotationController.getPendingApproval
);

// =============================================================================
// 3–4. COLLECTION ROUTES
// =============================================================================

/**
 * @swagger
 * /api/cotizaciones:
 *   get:
 *     summary: Listar cotizaciones (paginado y filtrado)
 *     description: Retorna una lista paginada y filtrable de cotizaciones. Soporta múltiples parámetros de búsqueda y ordenamiento.
 *     tags: [Cotizaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Búsqueda de texto libre en número correlativo, razón social y NIT
 *       - in: query
 *         name: estado
 *         schema:
 *           type: string
 *           enum: [Pendiente, "En revision", "Aprobada internamente", "Enviada al cliente", Aceptada, Rechazada, Archivada]
 *         description: Filtrar por estado exacto
 *       - in: query
 *         name: id_cliente
 *         schema:
 *           type: integer
 *         description: Filtrar por ID de cliente
 *       - in: query
 *         name: id_ejecutivo
 *         schema:
 *           type: integer
 *         description: Filtrar por ID de ejecutivo
 *       - in: query
 *         name: fecha_desde
 *         schema:
 *           type: string
 *           format: date
 *         description: Fecha de emisión mínima (YYYY-MM-DD, inclusiva)
 *       - in: query
 *         name: fecha_hasta
 *         schema:
 *           type: string
 *           format: date
 *         description: Fecha de emisión máxima (YYYY-MM-DD, inclusiva)
 *       - in: query
 *         name: moneda
 *         schema:
 *           type: string
 *           enum: [USD, BOB]
 *         description: Filtrar por moneda
 *       - in: query
 *         name: tiene_pdf
 *         schema:
 *           type: boolean
 *         description: true = solo con PDF adjunto; false = solo sin PDF
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Número de página
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *         description: Registros por página (máximo 100)
 *       - in: query
 *         name: sort_by
 *         schema:
 *           type: string
 *           enum: [numero_correlativo, fecha_emision, monto_total, estado, creado_en, cliente_nombre, ejecutivo_nombre]
 *           default: creado_en
 *         description: Campo de ordenamiento
 *       - in: query
 *         name: sort_order
 *         schema:
 *           type: string
 *           enum: [ASC, DESC]
 *           default: DESC
 *         description: Dirección del ordenamiento
 *     responses:
 *       200:
 *         description: Lista paginada de cotizaciones.
 *       401:
 *         description: Token ausente o inválido.
 *       403:
 *         description: Rol insuficiente.
 *       500:
 *         description: Error interno del servidor.
 */
// GET /api/cotizaciones
// Paginated, filtered, sorted listing.
// Accepted query params: q, razon_social, nit, estado, id_cliente,
// id_ejecutivo, fecha_desde, fecha_hasta, moneda, tiene_pdf,
// page, limit, sort_by, sort_order
router.get(
  '/',
  ...allRoles,
  QuotationController.getQuotations
);

/**
 * @swagger
 * /api/cotizaciones:
 *   post:
 *     summary: Crear nueva cotización (HU03)
 *     description: Genera atómicamente el número correlativo, inserta la cabecera y los ítems de detalle en una sola transacción, y auto-genera el documento PDF.
 *     tags: [Cotizaciones]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - id_cliente
 *               - descripcion
 *               - fecha_emision
 *             properties:
 *               id_cliente:
 *                 type: integer
 *                 example: 1
 *               descripcion:
 *                 type: string
 *                 example: Repuestos motor D13
 *               fecha_emision:
 *                 type: string
 *                 format: date
 *                 example: "2026-06-08"
 *               monto_total:
 *                 type: number
 *                 format: float
 *                 example: 4500.00
 *               moneda:
 *                 type: string
 *                 enum: [USD, BOB]
 *                 default: USD
 *               observaciones:
 *                 type: string
 *               fecha_validez:
 *                 type: string
 *                 format: date
 *               detalles:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - descripcion_item
 *                     - cantidad
 *                     - precio_unitario
 *                   properties:
 *                     descripcion_item:
 *                       type: string
 *                     cantidad:
 *                       type: number
 *                     precio_unitario:
 *                       type: number
 *     responses:
 *       201:
 *         description: Cotización creada exitosamente. Incluye número correlativo y datos completos.
 *       401:
 *         description: Token ausente o inválido.
 *       403:
 *         description: Rol insuficiente.
 *       422:
 *         description: Validación fallida (campos obligatorios o ítems inválidos).
 *       500:
 *         description: Error interno del servidor.
 */
// POST /api/cotizaciones
// Create a new quotation. Atomically generates the correlativo serial,
// inserts the header + line items in a single transaction, and
// auto-generates the PDF document. (HU03 / RNF10)
// validate(): sanitizes body and rejects malformed/malicious payloads at boundary.
router.post(
  '/',
  ...writeRoles,
  validate(createQuotationSchema),
  QuotationController.createQuotation
);

// =============================================================================
// 5–10. PARAMETRIC ROUTES (registered after all fixed-path routes)
// =============================================================================

/**
 * @swagger
 * /api/cotizaciones/{id}:
 *   get:
 *     summary: Obtener cotización por ID
 *     description: Retorna la cabecera, los ítems de detalle y los metadatos de aprobación de una cotización.
 *     tags: [Cotizaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID de la cotización
 *     responses:
 *       200:
 *         description: Datos completos de la cotización.
 *       400:
 *         description: ID inválido.
 *       401:
 *         description: Token ausente o inválido.
 *       403:
 *         description: Rol insuficiente.
 *       404:
 *         description: Cotización no encontrada.
 *       500:
 *         description: Error interno del servidor.
 */
// GET /api/cotizaciones/:id
// Full quotation detail: header + line items + approval metadata.
router.get(
  '/:id',
  ...allRoles,
  QuotationController.getQuotationById
);

/**
 * @swagger
 * /api/cotizaciones/{id}/historial:
 *   get:
 *     summary: Historial de cambios de estado
 *     description: Retorna la línea de tiempo completa y ordenada de todas las transiciones de estado de una cotización. (Section 4.3)
 *     tags: [Cotizaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID de la cotización
 *     responses:
 *       200:
 *         description: Historial de estados ordenado cronológicamente.
 *       400:
 *         description: ID inválido.
 *       401:
 *         description: Token ausente o inválido.
 *       403:
 *         description: Rol insuficiente.
 *       404:
 *         description: Cotización no encontrada.
 *       500:
 *         description: Error interno del servidor.
 */
// GET /api/cotizaciones/:id/historial
// Complete state-change timeline combining the creation event and every
// subsequent transition recorded in cotizacion_historial_estados.
// (Section 4.3 — Historial de estados)
router.get(
  '/:id/historial',
  ...allRoles,
  QuotationController.getStateHistory
);

/**
 * @swagger
 * /api/cotizaciones/{id}/estado:
 *   put:
 *     summary: Cambiar estado de una cotización
 *     description: Ejecuta una transición de estado validada por el rol del usuario. Solo el Jefe puede aprobar o rechazar desde 'En revision'. Aplicar a 'En revision' requiere ítems, monto_total y fecha_validez definidos.
 *     tags: [Cotizaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID de la cotización
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - nuevo_estado
 *             properties:
 *               nuevo_estado:
 *                 type: string
 *                 enum: [Pendiente, "En revision", "Aprobada internamente", "Enviada al cliente", Aceptada, Rechazada, Archivada]
 *                 example: "En revision"
 *               observacion:
 *                 type: string
 *                 description: Comentario opcional sobre la transición
 *     responses:
 *       200:
 *         description: Estado actualizado correctamente.
 *       400:
 *         description: ID inválido o estado no reconocido.
 *       401:
 *         description: Token ausente o inválido.
 *       403:
 *         description: Transición no permitida para el rol actual.
 *       404:
 *         description: Cotización no encontrada.
 *       409:
 *         description: Conflicto de concurrencia optimista (el estado cambió entre lecturas).
 *       422:
 *         description: Pre-flight fallido al enviar a revisión (faltan ítems, monto o fecha de validez).
 *       500:
 *         description: Error interno del servidor.
 */
// PUT /api/cotizaciones/:id/estado
// Role-restricted state machine transition.
// Body: { nuevo_estado: string, observacion?: string }
// Role matrix enforced: only Jefe can approve/reject (En revision → resolved).
// validate(): blocks invalid/malicious nuevo_estado values before controller.
router.put(
  '/:id/estado',
  ...allRoles,
  validate(updateStatusSchema),
  QuotationController.updateStatus
);

/**
 * @swagger
 * /api/cotizaciones/{id}/aprobar:
 *   post:
 *     summary: Aprobar o rechazar cotización (HU08 — solo Jefe)
 *     description: Endpoint dedicado de aprobación/rechazo interno. Escribe los metadatos de aprobación, registra el evento de auditoría y regenera el PDF con el sello de aprobación.
 *     tags: [Cotizaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID de la cotización (debe estar en estado 'En revision')
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - aprobado
 *             properties:
 *               aprobado:
 *                 type: boolean
 *                 description: true = Aprobada internamente; false = Rechazada
 *                 example: true
 *               observaciones:
 *                 type: string
 *                 description: Justificación (obligatoria cuando aprobado = false)
 *                 example: "Precios fuera del presupuesto aprobado."
 *     responses:
 *       200:
 *         description: Decisión de aprobación registrada y PDF regenerado.
 *       400:
 *         description: ID inválido o cotización no está en estado 'En revision'.
 *       401:
 *         description: Token ausente o inválido.
 *       403:
 *         description: Rol insuficiente (requiere Jefe).
 *       404:
 *         description: Cotización no encontrada.
 *       422:
 *         description: aprobado no proporcionado, no es booleano, o se rechaza sin observaciones.
 *       500:
 *         description: Error interno del servidor.
 */
// POST /api/cotizaciones/:id/aprobar
// HU08 — Dedicated Jefe approval / rejection endpoint.
// Body: { aprobado: boolean, obs_aprobacion?: string }
// Writes approval metadata, logs audit event, and regenerates the PDF.
// validate(): ensures aprobado is strictly boolean before controller logic.
router.post(
  '/:id/aprobar',
  ...jefeOnly,
  validate(approveQuotationSchema),
  QuotationController.approveQuotation
);

/**
 * @swagger
 * /api/cotizaciones/{id}/pdf:
 *   post:
 *     summary: Subir PDF manualmente a una cotización
 *     description: Vincula un archivo PDF cargado manualmente a la cotización. El nombre del campo en el formulario multipart debe ser "archivo". Solo Ejecutivos pueden usar este endpoint.
 *     tags: [Cotizaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID de la cotización
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - archivo
 *             properties:
 *               archivo:
 *                 type: string
 *                 format: binary
 *                 description: Archivo PDF (máximo 10 MB)
 *     responses:
 *       200:
 *         description: PDF subido y vinculado correctamente.
 *       400:
 *         description: ID inválido.
 *       401:
 *         description: Token ausente o inválido.
 *       403:
 *         description: Rol insuficiente (requiere Ejecutivo).
 *       404:
 *         description: Cotización no encontrada.
 *       422:
 *         description: Archivo ausente, tipo MIME no permitido o tamaño excedido.
 *       500:
 *         description: Error interno del servidor.
 */
// POST /api/cotizaciones/:id/pdf
// Manual PDF upload by an Ejecutivo.
// Multer validates MIME type and file size before the controller is invoked.
// Field name in the multipart form must be "archivo".
router.post(
  '/:id/pdf',
  ...ejecutivoOnly,
  upload.single('archivo'),
  QuotationController.uploadPdf
);

/**
 * @swagger
 * /api/cotizaciones/{id}/pdf:
 *   get:
 *     summary: Descargar el PDF de una cotización
 *     description: Transmite el PDF almacenado al cliente con el encabezado Content-Disposition correcto. Cada descarga queda registrada en bitacora_auditoria.
 *     tags: [Cotizaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID de la cotización
 *     responses:
 *       200:
 *         description: Archivo PDF.
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: ID inválido.
 *       401:
 *         description: Token ausente o inválido.
 *       403:
 *         description: Rol insuficiente.
 *       404:
 *         description: Cotización no encontrada o sin PDF asociado.
 *       500:
 *         description: Error interno del servidor.
 */
// GET /api/cotizaciones/:id/pdf
// Stream the stored PDF to the client with the correct Content-Disposition.
// Logged to bitacora_auditoria on each download.
router.get(
  '/:id/pdf',
  ...allRoles,
  QuotationController.downloadPdf
);

// =============================================================================
// Multer error handler
// Must be a 4-argument Express error middleware and must be declared AFTER
// all routes so it only catches errors that bubbled up from within this router.
// =============================================================================
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    // e.g. LIMIT_FILE_SIZE, LIMIT_UNEXPECTED_FILE
    return res.status(422).json({
      success: false,
      message: `File upload error: ${err.message}`,
    });
  }

  if (err?.message?.startsWith('Only PDF')) {
    // Thrown by pdfFileFilter when the MIME type is wrong
    return res.status(422).json({
      success: false,
      message: err.message,
    });
  }

  // Unknown error — propagate to the global handler in app.js
  next(err);
});

module.exports = router;
