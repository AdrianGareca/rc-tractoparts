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
const { buildUploadFilename } = require('../utils/uploadFilename');
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
  updateSeguimientoVentaSchema,
} = require('../validators/quotationValidator');

const router = express.Router();

// =============================================================================
// Multer — PDF upload storage and validation
//
// ⚠️  DEPLOYMENT / STORAGE RISK — EPHEMERAL FILESYSTEM
// Multer here uses diskStorage: uploaded PDFs (uploads/cotizaciones) and Excel
// spreadsheets (storage/excels) are written to the server's LOCAL DISK, and
// only their relative paths are persisted in the DB (pdf_ruta / excel_ruta).
// On ephemeral-filesystem hosts (Render, Heroku, most container PaaS) that disk
// is WIPED on every deploy/restart, so these files vanish while the DB still
// references them (dead links / 404s). PLANNED ARCHITECTURE CHANGE: migrate
// uploads to durable object storage (S3, Cloudflare R2, GCS) or use
// multer.memoryStorage() and stream buffers straight to durable storage.
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
  // El nombre se arma con buildUploadFilename y NO interpolando req.params.id:
  // Express decodifica los params después del match de la ruta, así que un
  // `..%2f..%2f` llegaba acá como '../../' y multer, que hace
  // path.join(destino, nombre), terminaba escribiendo fuera del directorio.
  // Multer corre ANTES del controller, o sea antes de validar el id y de
  // verificar permisos. Ver src/utils/uploadFilename.js.
  filename: (req, file, cb) => {
    // La extensión se fija por campo (no se toma del archivo subido): el
    // fileFilter ya restringe el tipo y así el nombre guardado es predecible.
    const esExcel = file.fieldname === 'excel';
    cb(null, buildUploadFilename({
      prefix:       esExcel ? 'EXC' : 'COT',
      id:           req.params.id,
      originalname: esExcel ? 'a.xlsx' : 'a.pdf',
    }));
  },
});

// El límite documentado (MAX_PDF_SIZE_MB, en MB exactos) es el máximo
// ACEPTADO — no uno menos. Sin el +1 de abajo, un archivo de exactamente
// MAX_PDF_SIZE_MB*1024*1024 bytes se rechazaba igual que uno más grande.
//
// LA CAUSA: busboy (la librería que multer usa por debajo) dispara su
// evento 'limit' — y por lo tanto LIMIT_FILE_SIZE — en cuanto los bytes
// recibidos LLEGAN a `limits.fileSize`, no cuando lo SUPERAN
// (node_modules/busboy/lib/types/multipart.js: `if (fileSize ===
// fileSizeLimit) { ...emit('limit')... }`). Con `fileSize: maxUploadBytes`, un
// archivo de exactamente ese tamaño hace que el contador de bytes llegue
// justo a `fileSizeLimit` y se trunque, aunque ya se haya recibido el
// archivo completo. Configurar el límite un byte más alto que el máximo
// documentado hace que ese `===` sólo dispare en `maxUploadBytes + 1` bytes —
// es decir, el primer tamaño que SÍ debe rechazarse — sin abrir la puerta a
// nada por encima del límite documentado. Encontrado en la ronda de estrés
// del 2026-08-26.
const maxUploadBytes = (parseInt(process.env.MAX_PDF_SIZE_MB, 10) || 10) * 1024 * 1024 + 1;

// Excel upload for a quotation. fileFilter is intentionally omitted here —
// the controller verifies the file post-write via a magic-number check
// (relying solely on the declared MIME type would give false security, since
// it's client-controlled and trivially spoofed).
const upload = multer({
  storage,
  limits: {
    fileSize: maxUploadBytes,  // applies per-file
    files:    1,
  },
});

// ---------------------------------------------------------------------------
// Upload rate limiter — strictly limits upload calls per IP to prevent
// disk-exhaustion attacks. At the 10 MB file cap, 20 uploads = up to 200 MB
// per window from a single IP, which is a safe operational ceiling.
// Applied to POST /:id/upload.
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

// 'Proyectos' tiene acceso de LECTURA a cotizaciones (tab de solo lectura de su
// panel) y recibe notificaciones de licitación por GET/POST /notificaciones.
// NO se incluye en writeRoles → no puede crear/editar cotizaciones.
const allRoles      = [authenticate, authorize(['Ejecutivo', 'Administracion', 'Jefe', 'SysAdmin', 'Proyectos'])];
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
 *         $ref: '#/components/responses/NoAutorizado'
 *       403:
 *         $ref: '#/components/responses/SinPermiso'
 *       500:
 *         $ref: '#/components/responses/ErrorInterno'
 */
// GET /api/cotizaciones/resumen
// Quotation counts grouped by estado for the sidebar / dashboard widget.
// Ejecutivos receive only their own counts; Jefe and Admin see all.
router.get(
  '/resumen',
  ...allRoles,
  QuotationController.getStateSummary
);

// GET /api/cotizaciones/next-correlativo
// Non-binding preview of the next sequential quotation number (COT-YYYY-NNNN).
// Displayed in the "Nueva Cotización" form header before submission.
router.get(
  '/next-correlativo',
  ...allRoles,
  QuotationController.getNextCorrelativo
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
 *         $ref: '#/components/responses/NoAutorizado'
 *       403:
 *         $ref: '#/components/responses/SinPermiso'
 *       500:
 *         $ref: '#/components/responses/ErrorInterno'
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

// GET /api/cotizaciones/seguimientos-ocupados?id_ejecutivo=N
// Fixed-path route — must stay above the /:id catchall. Ownership enforced in
// the controller for Ejecutivo callers (own calendar only).
router.get(
  '/seguimientos-ocupados',
  ...writeRoles,
  QuotationController.getSeguimientosOcupados
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
 *           enum: [Pendiente, "En revision", "Aprobada internamente", "Enviada al cliente", Confirmada, Aceptada, Rechazada, Archivada]
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
 *         $ref: '#/components/responses/NoAutorizado'
 *       403:
 *         $ref: '#/components/responses/SinPermiso'
 *       500:
 *         $ref: '#/components/responses/ErrorInterno'
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
 *         $ref: '#/components/responses/NoAutorizado'
 *       403:
 *         $ref: '#/components/responses/SinPermiso'
 *       422:
 *         description: Validación fallida (campos obligatorios o ítems inválidos).
 *       500:
 *         $ref: '#/components/responses/ErrorInterno'
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
 *         $ref: '#/components/responses/NoAutorizado'
 *       403:
 *         $ref: '#/components/responses/SinPermiso'
 *       404:
 *         description: Cotización no encontrada.
 *       500:
 *         $ref: '#/components/responses/ErrorInterno'
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
 *         $ref: '#/components/responses/NoAutorizado'
 *       403:
 *         description: No es el propietario de la cotización.
 *       404:
 *         description: Cotización no encontrada.
 *       409:
 *         description: La cotización no está en estado 'Pendiente' (no editable).
 *       422:
 *         description: Datos de entrada inválidos.
 *       500:
 *         $ref: '#/components/responses/ErrorInterno'
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
 *         $ref: '#/components/responses/NoAutorizado'
 *       403:
 *         $ref: '#/components/responses/SinPermiso'
 *       404:
 *         description: Cotización no encontrada.
 *       500:
 *         $ref: '#/components/responses/ErrorInterno'
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
 *                 enum: [Pendiente, "En revision", "En espera", "Aprobada internamente", "Enviada al cliente", Confirmada, Aceptada, Rechazada, Archivada]
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
 *         $ref: '#/components/responses/NoAutorizado'
 *       403:
 *         description: Transición no permitida para el rol actual.
 *       404:
 *         description: Cotización no encontrada.
 *       409:
 *         description: Conflicto de concurrencia optimista (el estado cambió entre lecturas).
 *       422:
 *         description: Pre-flight fallido al enviar a revisión (faltan ítems, monto o fecha de validez).
 *       500:
 *         $ref: '#/components/responses/ErrorInterno'
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
 *         $ref: '#/components/responses/NoAutorizado'
 *       403:
 *         $ref: '#/components/responses/SinPermiso'
 *       404:
 *         description: Cotización no encontrada.
 *       409:
 *         description: Conflicto de concurrencia optimista (el estado cambió entre lecturas).
 *       422:
 *         description: aprobado no proporcionado, no es booleano, o se rechaza sin observaciones.
 *       500:
 *         $ref: '#/components/responses/ErrorInterno'
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

// POST /api/cotizaciones/:id/upload
// Excel upload for an Ejecutivo's own quotation. Magic-number verification is
// performed by the controller after Multer writes the file to disk.
//
// Este endpoint aceptaba antes un segundo campo 'pdf' para subir el PDF a
// mano, con toda una máquina de reemplazo atómico (swapFilePath) y una
// columna pdf_origen para que una edición posterior no lo purgara. Se sacó
// el 2026-08-28: el formulario de cotizaciones nunca mandó ese campo — sólo
// el Excel — así que la única forma de llegar a subir un PDF manual era
// pegándole directo a la API (Swagger/Postman), nunca desde la aplicación
// real. Adrian confirmó que nadie lo usa: el PDF siempre lo genera el
// sistema y se regenera en cada edición a propósito. Mantener una ruta y una
// columna de base de datos para una función que ningún botón dispara es
// justamente el tipo de complejidad de más que este proyecto evita.
router.post(
  '/:id/upload',
  ...ejecutivoOnly,
  uploadLimiter,
  upload.fields([
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
 *         $ref: '#/components/responses/NoAutorizado'
 *       403:
 *         $ref: '#/components/responses/SinPermiso'
 *       404:
 *         description: Cotización no encontrada o sin PDF asociado.
 *       500:
 *         $ref: '#/components/responses/ErrorInterno'
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
 *         $ref: '#/components/responses/NoAutorizado'
 *       403:
 *         $ref: '#/components/responses/SinPermiso'
 *       404:
 *         description: Cotización no encontrada.
 *       422:
 *         description: Campo comentario_admin ausente.
 *       500:
 *         $ref: '#/components/responses/ErrorInterno'
 */
// PATCH /api/cotizaciones/:id/comentario-admin
// Administracion-only: write or overwrite the supervisor review comment.
router.patch(
  '/:id/comentario-admin',
  ...adminOnly,
  QuotationController.patchComentarioAdmin
);

/**
 * @swagger
 * /api/cotizaciones/{id}/seguimiento:
 *   patch:
 *     summary: Actualizar el seguimiento comercial de una cotización
 *     description: |
 *       Actualiza el estado de venta (Interesado/En negociación/Confirmado/No le
 *       interesa/Venta concretada/Otro), su detalle libre, y/o la fecha de próximo
 *       seguimiento. Independiente del `estado` de aprobación interno: editable
 *       sin importar el estado actual, incluso Archivada o Rechazada. Cada campo
 *       es opcional — enviar solo los que se quieren cambiar. El Ejecutivo solo
 *       puede editar sus PROPIAS cotizaciones; Jefe, Administracion y SysAdmin
 *       pueden editar cualquiera.
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
 *             properties:
 *               estado_venta:
 *                 type: string
 *                 enum: [Interesado, "En negociacion", Confirmado, "No le interesa", "Venta concretada", Otro]
 *               estado_venta_detalle:
 *                 type: string
 *                 description: Requerido y no vacío cuando estado_venta = Otro
 *               fecha_proximo_seguimiento:
 *                 type: string
 *                 format: date
 *     responses:
 *       200:
 *         description: Seguimiento actualizado correctamente.
 *       400:
 *         description: ID inválido.
 *       401:
 *         $ref: '#/components/responses/NoAutorizado'
 *       403:
 *         $ref: '#/components/responses/SinPermiso'
 *       404:
 *         description: Cotización no encontrada.
 *       422:
 *         description: Datos inválidos (ej. estado_venta = Otro sin estado_venta_detalle).
 *       500:
 *         $ref: '#/components/responses/ErrorInterno'
 */
// PATCH /api/cotizaciones/:id/seguimiento
// Ejecutivo (own quotations only) / Jefe / Administracion / SysAdmin (any):
// commercial follow-up, independent of `estado`. Ownership enforced in the
// controller for Ejecutivo callers.
router.patch(
  '/:id/seguimiento',
  ...writeRoles,
  validate(updateSeguimientoVentaSchema),
  QuotationController.patchSeguimientoVenta
);

// =============================================================================
// Multer error handler
// Must be a 4-argument Express error middleware and must be declared AFTER
// all routes so it only catches errors that bubbled up from within this router.
// =============================================================================
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    // "File too large" es un caso aparte: este router tenía su PROPIO
    // manejador de MulterError (declarado después de todas las rutas), así
    // que interceptaba LIMIT_FILE_SIZE ANTES de que llegara al manejador
    // GLOBAL de src/app.js, que sí responde 413 para ese mismo error. El
    // resultado era el mismo código de estado inconsistente que tenía
    // licitacionRoutes.js para sus propios documentos — arreglado ahí con el
    // mismo criterio. El resto de los MulterError (tipo de archivo inválido,
    // demasiados archivos) sigue siendo 422 como siempre. Encontrado en la
    // ronda de estrés del 2026-08-26.
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        message: `File upload error: ${err.message}`,
      });
    }
    // e.g. LIMIT_UNEXPECTED_FILE
    return res.status(422).json({
      success: false,
      message: `File upload error: ${err.message}`,
    });
  }

  // Unknown error — propagate to the global handler in app.js
  next(err);
});

module.exports = router;
