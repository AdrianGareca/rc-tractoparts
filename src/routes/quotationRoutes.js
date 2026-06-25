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

const express    = require('express');
const multer     = require('multer');
const path       = require('path');
const fs         = require('fs');
const rateLimit  = require('express-rate-limit');

const QuotationController      = require('../controllers/quotationController');
const QuotationPdfController   = require('../controllers/quotation/quotationPdfController');
const QuotationStateController = require('../controllers/quotation/quotationStateController');
const { authenticate }    = require('../middlewares/authMiddleware');
const authorize           = require('../middlewares/roleMiddleware');
const { validate }        = require('../validators/validate');
const {
  createQuotationSchema,
  updateQuotationSchema,
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

// Excel files are stored separately so auditors can download raw spreadsheets
// without mixing them with generated PDF documents.
const excelDir = path.resolve(process.cwd(), 'storage/excels');

// Ensure both destination directories exist at startup
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
if (!fs.existsSync(excelDir)) {
  fs.mkdirSync(excelDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, file, cb) => {
    // Route Excel uploads to a dedicated audit directory
    cb(null, file.fieldname === 'excel' ? excelDir : uploadDir);
  },
  filename: (req, file, cb) => {
    const quotationId = req.params.id || 'draft';
    // Distinguish PDF vs Excel files in the stored filename
    if (file.fieldname === 'excel') {
      cb(null, `EXC-${quotationId}-${Date.now()}.xlsx`);
    } else {
      // Default: PDF
      cb(null, `COT-${quotationId}-${Date.now()}.pdf`);
    }
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

// Dual-field upload: accepts 'pdf' (alias kept for backward compat) + 'excel'
// The controller performs magic-number verification for each file after Multer writes them.
const upload = multer({
  storage,
  // fileFilter is intentionally omitted here — both PDF and xlsx have different
  // declared MIME types and each is verified post-write via magic-number checks
  // in the controller.  Relying solely on declared MIME type (easily spoofed)
  // would give false security while a single filter cannot serve two types.
  limits: {
    fileSize: maxPdfBytes,  // applies per-file
    files:    2,            // at most one PDF + one Excel per request
  },
});

// Legacy single-field uploader retained for the standalone POST /:id/pdf route
// that accepts only a PDF via the 'archivo' field name.
const uploadPdfSingle = multer({
  storage,
  fileFilter: pdfFileFilter,
  limits: {
    fileSize: maxPdfBytes,
    files:    1,
  },
});

// ---------------------------------------------------------------------------
// Upload rate limiter — strictly limits PDF upload calls per IP to prevent
// disk-exhaustion attacks. At the 10 MB file cap, 20 uploads = up to 200 MB
// per window from a single IP, which is a safe operational ceiling.
// Applied ONLY to POST /:id/pdf — does not affect any other endpoint.
// ---------------------------------------------------------------------------
const uploadLimiter = rateLimit({
  windowMs:        15 * 60 * 1000, // 15-minute sliding window
  max:             20,              // max 20 upload attempts per IP per window
  standardHeaders: true,
  legacyHeaders:   false,
  message: {
    success: false,
    message: 'Too many PDF upload attempts from this IP. Please wait 15 minutes.',
  },
  skip: () => process.env.NODE_ENV === 'test',
});

// =============================================================================
// Role middleware shorthands
// Each is an array spread into the route handler chain.
// =============================================================================

const allRoles      = [authenticate, authorize(['Ejecutivo', 'Administracion', 'Jefe', 'SysAdmin'])];
const writeRoles    = [authenticate, authorize(['Ejecutivo', 'Administracion', 'Jefe', 'SysAdmin'])];
const jefeOnly      = [authenticate, authorize(['Jefe', 'SysAdmin'])];
const adminOnly     = [authenticate, authorize(['Administracion'])];
const jefeAdminOnly = [authenticate, authorize(['Jefe', 'Administracion', 'SysAdmin'])];
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
 *     description: Retorna todas las cotizaciones en estado 'En revision', ordenadas de la más antigua a la más reciente. Exclusivo para los roles Jefe, Administracion y SysAdmin.
 *     tags: [Cotizaciones]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de cotizaciones pendientes de aprobación.
 *       401:
 *         description: Token ausente o inválido.
 *       403:
 *         description: Rol insuficiente (requiere Jefe, Administracion o SysAdmin).
 *       500:
 *         description: Error interno del servidor.
 */
// GET /api/cotizaciones/pendientes-aprobacion
// All quotations currently in 'En revision', ordered oldest-first.
// Feeds the Jefe's dedicated approval queue (HU08).
// Administracion can also view this queue per the global-access spec.
router.get(
  '/pendientes-aprobacion',
  ...jefeAdminOnly,
  QuotationController.getPendingApproval
);

// GET /api/cotizaciones/notificaciones
// Pending correction + approval notifications for the authenticated Ejecutivo.
// Must be registered before /:id to avoid parameter collision.
router.get(
  '/notificaciones',
  ...allRoles,
  QuotationController.getNotificaciones
);

// POST /api/cotizaciones/notificaciones/leer
// Marks all unread approval notifications as read for the authenticated Ejecutivo.
router.post(
  '/notificaciones/leer',
  ...allRoles,
  QuotationController.markNotificacionesLeidas
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
 *     description: |
 *       Genera atómicamente el número correlativo, inserta la cabecera y los ítems de detalle
 *       en una sola transacción, y auto-genera el documento PDF.
 *       El cuerpo acepta todos los bloques del formulario proforma:
 *       Metadatos, Cliente (resolución por id), Solicitante, Equipo y Detalle de ítems.
 *       Para adjuntar el archivo .xlsx de auditoría use el endpoint POST /{id}/upload.
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
 *               - detalles
 *             properties:
 *               id_cliente:
 *                 type: integer
 *                 example: 3
 *               descripcion:
 *                 type: string
 *                 example: "Repuestos motor D13 — Excavadora CAT 336"
 *               fecha_emision:
 *                 type: string
 *                 format: date
 *                 example: "2026-06-17"
 *               monto_total:
 *                 type: number
 *                 format: float
 *                 description: Ignorado cuando `detalles` está presente; el servidor recalcula desde los ítems.
 *                 example: 4500.00
 *               moneda:
 *                 type: string
 *                 enum: [USD, BOB]
 *                 default: BOB
 *                 example: "BOB"
 *               observaciones:
 *                 type: string
 *                 example: "Repuestos para mantenimiento preventivo 500 h"
 *               fecha_validez:
 *                 type: string
 *                 format: date
 *                 example: "2026-07-17"
 *               tipo_pedido:
 *                 type: string
 *                 description: Canal/tipo del pedido (aparece en box PEDIDO del PDF)
 *                 example: "EMAIL"
 *               tiempo_entrega:
 *                 type: string
 *                 description: Tiempo de entrega global (aparece en CONDICIONES DE LA OFERTA del PDF)
 *                 example: "25 DÍAS CALENDARIO"
 *               solicitante_no_solicitud:
 *                 type: string
 *                 description: "Nº de Solicitud / Nº de OC del solicitante interno"
 *                 example: "OC-2026-0045"
 *               solicitante_area:
 *                 type: string
 *                 description: Área o departamento del solicitante
 *                 example: "Mantenimiento"
 *               solicitante_celular:
 *                 type: string
 *                 description: Celular del solicitante
 *                 example: "77012345"
 *               solicitante_correo:
 *                 type: string
 *                 format: email
 *                 description: Correo del solicitante
 *                 example: "juan.perez@empresa.com"
 *               equipo_marca:
 *                 type: string
 *                 description: Marca del equipo a reparar
 *                 example: "Caterpillar"
 *               equipo_tipo:
 *                 type: string
 *                 description: Tipo de equipo
 *                 example: "Excavadora"
 *               equipo_modelo:
 *                 type: string
 *                 description: Modelo del equipo
 *                 example: "336"
 *               equipo_serie:
 *                 type: string
 *                 description: Número de serie del equipo
 *                 example: "CAT0336XXXXX"
 *               equipo_motor:
 *                 type: string
 *                 description: Número de motor del equipo
 *                 example: "C9.3"
 *               detalles:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required:
 *                     - descripcion_item
 *                     - cantidad
 *                     - precio_unitario
 *                   properties:
 *                     descripcion_item:
 *                       type: string
 *                       example: "Filtro de aceite motor D13"
 *                     codigo:
 *                       type: string
 *                       description: Código de parte del fabricante (Nº parte)
 *                       example: "7E-6116"
 *                     codigo_alternativo:
 *                       type: string
 *                       description: Código alternativo / código cruzado
 *                       example: "P553191"
 *                     unidad:
 *                       type: string
 *                       description: Unidad de medida
 *                       example: "UND"
 *                     cantidad:
 *                       type: number
 *                       example: 2
 *                     precio_unitario:
 *                       type: number
 *                       example: 850.00
 *                     marca_id:
 *                       type: integer
 *                       description: ID de marca del catálogo
 *                       example: 1
 *                     tiempo_entrega:
 *                       type: string
 *                       description: Tiempo de entrega específico para esta línea
 *                       example: "15 DÍAS HÁBILES"
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
 * /api/cotizaciones/{id}:
 *   put:
 *     summary: Editar una cotización en estado 'Pendiente' (Ejecutivo propietario)
 *     description: |
 *       Reemplaza la cabecera y el conjunto COMPLETO de ítems de una cotización
 *       existente. Habilita el flujo "Solicitar Cambios": cuando una cotización
 *       es devuelta a 'Pendiente', el Ejecutivo propietario corrige el MISMO
 *       registro (por ejemplo, eliminando ítems que el cliente ya no desea) en
 *       lugar de crear una cotización nueva.
 *
 *       Restricciones (defensa en profundidad sobre el middleware de rol):
 *         • La cotización debe existir (404).
 *         • El llamante debe ser el Ejecutivo propietario (403).
 *         • El estado debe ser 'Pendiente' (409).
 *
 *       El total se recalcula en el servidor a partir de los ítems y el PDF se
 *       regenera automáticamente (invariante de PDF único).
 *     tags: [Cotizaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID de la cotización a editar
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
 *               - detalles
 *             properties:
 *               id_cliente:
 *                 type: integer
 *                 example: 1
 *               descripcion:
 *                 type: string
 *                 example: "Repuestos motor CAT 336 (revisado)"
 *               fecha_emision:
 *                 type: string
 *                 format: date
 *                 example: "2026-06-24"
 *               fecha_validez:
 *                 type: string
 *                 format: date
 *               moneda:
 *                 type: string
 *                 enum: [USD, BOB]
 *               observaciones:
 *                 type: string
 *               detalles:
 *                 type: array
 *                 description: Conjunto completo de reemplazo de ítems (los anteriores se eliminan).
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
 *       200:
 *         description: Cotización actualizada y PDF regenerado.
 *       400:
 *         description: ID inválido.
 *       401:
 *         description: Token ausente o inválido.
 *       403:
 *         description: No es el propietario de la cotización.
 *       404:
 *         description: Cotización no encontrada.
 *       409:
 *         description: La cotización no está en estado 'Pendiente' (no editable).
 *       422:
 *         description: Datos de entrada inválidos.
 *       500:
 *         description: Error interno del servidor.
 */
// PUT /api/cotizaciones/:id
// Executive-owner edit of a 'Pendiente' quotation (Solicitar Cambios workflow).
// validate(): enforces the same field rules as creation before the controller.
// Ownership + 'Pendiente'-only state are enforced inside the controller.
router.put(
  '/:id',
  ...ejecutivoOnly,
  validate(updateQuotationSchema),
  QuotationController.updateQuotation
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
  QuotationStateController.getStateHistory
);

/**
 * @swagger
 * /api/cotizaciones/{id}/estado:
 *   put:
 *     summary: Cambiar estado de una cotización
 *     description: |
 *       Ejecuta una transición de estado validada por el rol del usuario.
 *       Solo el Jefe puede aprobar o rechazar desde 'En revision'.
 *       El Administrador puede mover a 'En espera' y opcionalmente adjuntar un comentario de supervisión.
 *       Aplicar a 'En revision' requiere ítems, monto_total y fecha_validez definidos.
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
 *                 enum: [Pendiente, "En revision", "En espera", "Aprobada internamente", "Enviada al cliente", Aceptada, Rechazada, Archivada]
 *                 example: "En espera"
 *               observacion:
 *                 type: string
 *                 description: Comentario opcional sobre la transición (va al historial)
 *               comentario_admin:
 *                 type: string
 *                 description: "Comentario de supervisión del Administrador (solo aplica cuando rol=Administracion; ignorado para otros roles)"
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
  authenticate,
  authorize(['Ejecutivo', 'Administracion', 'Jefe', 'SysAdmin']),
  validate(updateStatusSchema),
  QuotationStateController.updateStatus
);

/**
 * @swagger
 * /api/cotizaciones/{id}/aprobar:
 *   post:
 *     summary: Aprobar o rechazar cotización (HU08 — Jefe y SysAdmin)
 *     description: |
 *       Endpoint dedicado de aprobación/rechazo interno con autoridad absoluta.
 *       Jefe y SysAdmin pueden ejecutar esta acción desde CUALQUIER estado de la
 *       cotización (Pendiente, En revisión, En espera, etc.). Escribe los metadatos
 *       de aprobación, registra el evento de auditoría y regenera el PDF con el
 *       sello de aprobación.
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
 *         description: ID inválido.
 *       401:
 *         description: Token ausente o inválido.
 *       403:
 *         description: Rol insuficiente (requiere Jefe o SysAdmin).
 *       404:
 *         description: Cotización no encontrada.
 *       409:
 *         description: Conflicto de concurrencia optimista (el estado cambió entre lecturas).
 *       422:
 *         description: aprobado no proporcionado, no es booleano, o se rechaza sin observaciones.
 *       500:
 *         description: Error interno del servidor.
 */
// POST /api/cotizaciones/:id/aprobar
// HU08 — Dedicated Jefe / SysAdmin approval / rejection endpoint.
// Body: { aprobado: boolean, observaciones?: string }
// Writes approval metadata, logs audit event, and regenerates the PDF.
// validate(): ensures aprobado is strictly boolean before controller logic.
router.post(
  '/:id/aprobar',
  ...jefeOnly,
  validate(approveQuotationSchema),
  QuotationStateController.approveQuotation
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
  uploadLimiter,
  uploadPdfSingle.single('archivo'),
  QuotationPdfController.uploadPdf
);

// POST /api/cotizaciones/:id/upload
// Dual-file upload: accepts optional 'pdf' field and/or optional 'excel' field
// in the same multipart request.  Magic-number verification is performed by
// the controller after Multer writes the files to disk.
router.post(
  '/:id/upload',
  ...ejecutivoOnly,
  uploadLimiter,
  upload.fields([
    { name: 'pdf',   maxCount: 1 },
    { name: 'excel', maxCount: 1 },
  ]),
  QuotationPdfController.uploadFiles
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
  QuotationPdfController.downloadPdf
);

// GET /api/cotizaciones/:id/excel
// Stream the stored Excel spreadsheet to the client.
// Requires a valid Bearer token — the blob is served only to authenticated sessions.
router.get(
  '/:id/excel',
  ...allRoles,
  QuotationPdfController.downloadExcel
);

/**
 * @swagger
 * /api/cotizaciones/{id}/comentario-admin:
 *   patch:
 *     summary: Agregar/actualizar comentario de supervisión del Administrador
 *     description: |
 *       Permite al Administrador escribir o actualizar un comentario de revisión en una cotización
 *       sin cambiar su estado. El comentario queda visible al Jefe en el panel de aprobación.
 *       Exclusivo para el rol Administracion.
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
 *               - comentario_admin
 *             properties:
 *               comentario_admin:
 *                 type: string
 *                 description: Texto del comentario de supervisión (cadena vacía para limpiar)
 *     responses:
 *       200:
 *         description: Comentario guardado correctamente.
 *       400:
 *         description: ID inválido.
 *       401:
 *         description: Token ausente o inválido.
 *       403:
 *         description: Rol insuficiente (requiere Administracion).
 *       404:
 *         description: Cotización no encontrada.
 *       422:
 *         description: Campo comentario_admin ausente.
 *       500:
 *         description: Error interno del servidor.
 */
// PATCH /api/cotizaciones/:id/comentario-admin
// Administracion-only: write or overwrite the supervisor review comment.
router.patch(
  '/:id/comentario-admin',
  ...adminOnly,
  QuotationController.patchComentarioAdmin
);

// =============================================================================
// Multer error handler
// Must be a 4-argument Express error middleware and must be declared AFTER
// all routes so it only catches errors that bubbled up from within this router.
// =============================================================================
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
