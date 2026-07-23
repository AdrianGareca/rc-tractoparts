// =============================================================================
// src/routes/licitacionRoutes.js
// Licitación Routes — /api/licitaciones
//
// ⚠  ROUTE ORDER IS LOAD-BEARING
//    Express matches top-to-bottom. Las rutas literales (/next-correlativo)
//    deben registrarse ANTES de la ruta paramétrica /:id, o Express tomaría el
//    segmento literal como un :id y despacharía al handler equivocado.
//
// Matriz de autorización (el modelo decide el detalle de las transiciones):
//   GET    /                    → todos los autenticados (Ejecutivo la usa p/ dropdown)
//   GET    /next-correlativo    → Proyectos, Jefe, SysAdmin
//   POST   /                    → Proyectos, Jefe, SysAdmin
//   GET    /:id                 → todos los autenticados
//   GET    /:id/historial       → todos los autenticados
//   PUT    /:id                 → Proyectos, Jefe, SysAdmin  (ownership en controller)
//   PUT    /:id/estado          → Proyectos, Ejecutivo, Jefe, SysAdmin (matriz decide)
//   POST   /:id/documentos      → responsable, Jefe, SysAdmin (ownership en controller)
//   GET    /:id/documentos      → todos los autenticados
//   GET    /:id/documentos/:docId    → todos los autenticados
//   DELETE /:id/documentos/:docId    → responsable, Jefe, SysAdmin (ownership en controller)
// =============================================================================

'use strict';

const express   = require('express');
const multer    = require('multer');
const path      = require('path');
const fs        = require('fs');
const crypto    = require('crypto');
const rateLimit = require('express-rate-limit');

const LicitacionController         = require('../controllers/licitacionController');
const LicitacionDocumentController = require('../controllers/licitacionDocumentController');
const LicitacionGastoController    = require('../controllers/licitacionGastoController');
const { authenticate }     = require('../middlewares/authMiddleware');
const authorize            = require('../middlewares/roleMiddleware');
const { validate }         = require('../validators/validate');
const {
  createLicitacionSchema,
  updateLicitacionSchema,
  updateLicitacionStatusSchema,
  createGastoSchema,
} = require('../validators/licitacionValidator');

const router = express.Router();

// =============================================================================
// Multer — licitación document uploads (PDF, Word, Excel, images)
//
// Extension allowlist runs here (fast, first pass); the controller re-verifies
// each file's actual content via magic-number check after multer writes it to
// disk (see licitacionDocumentController.js) — the declared extension/MIME is
// never trusted alone (OWASP A08).
// =============================================================================

const licDocsDir = path.resolve(process.cwd(), 'storage/licitaciones');
if (!fs.existsSync(licDocsDir)) {
  fs.mkdirSync(licDocsDir, { recursive: true });
}

const ALLOWED_DOC_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png']);
const MAX_DOC_FILES = 10;

const licDocStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, licDocsDir),
  filename: (req, file, cb) => {
    const licitacionId = req.params.id || 'draft';
    const ext    = path.extname(file.originalname).toLowerCase();
    const unique = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    cb(null, `LICDOC-${licitacionId}-${unique}${ext}`);
  },
});

function licDocFileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  if (ALLOWED_DOC_EXTENSIONS.has(ext)) {
    cb(null, true);
  } else {
    cb(new Error(
      `Tipo de archivo no permitido: ".${ext}". Permitidos: PDF, Word (.doc/.docx), Excel (.xls/.xlsx), imágenes (.jpg/.jpeg/.png).`
    ), false);
  }
}

const maxDocBytes = (parseInt(process.env.MAX_PDF_SIZE_MB, 10) || 10) * 1024 * 1024;

const uploadLicDocs = multer({
  storage:    licDocStorage,
  fileFilter: licDocFileFilter,
  limits:     { fileSize: maxDocBytes, files: MAX_DOC_FILES },
});

// Mirrors quotationRoutes.js's uploadLimiter — protects against disk-exhaustion
// via repeated multi-file uploads from a single IP.
const licDocUploadLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             20,
  standardHeaders: true,
  legacyHeaders:   false,
  message: {
    success: false,
    message: 'Demasiados intentos de subida de documentos desde esta IP. Espere 15 minutos.',
  },
  skip: () => process.env.NODE_ENV === 'test',
});

// Role middleware shorthands (cada uno se hace spread en la cadena del handler).
const allRoles     = [authenticate, authorize(['Ejecutivo', 'Administracion', 'Jefe', 'SysAdmin', 'Proyectos'])];
const manageRoles  = [authenticate, authorize(['Proyectos', 'Jefe', 'SysAdmin'])];
const stateRoles   = [authenticate, authorize(['Proyectos', 'Ejecutivo', 'Jefe', 'SysAdmin'])];
// Gastos: Administración participa del análisis de resultado (junto a Proyectos
// y Jefe/SysAdmin). El ownership fino (Proyectos = responsable) y el gate de
// estado (Adjudicada/Archivada) los aplica el controller.
const gastoRoles   = [authenticate, authorize(['Administracion', 'Proyectos', 'Jefe', 'SysAdmin'])];

/**
 * @swagger
 * tags:
 *   name: Licitaciones
 *   description: Ciclo de vida de licitaciones (entidad paraguas de cotizaciones)
 */

// =============================================================================
// 1. FIXED-PATH ROUTES (antes de cualquier /:id)
// =============================================================================

/**
 * @swagger
 * /api/licitaciones/next-correlativo:
 *   get:
 *     summary: Vista previa del próximo código de licitación (LIC-YYYY/NNNN)
 *     description: Previsualización no vinculante del siguiente correlativo, para el encabezado del formulario "Nueva Licitación".
 *     tags: [Licitaciones]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Próximo correlativo previsualizado.
 *       401:
 *         description: Token ausente o inválido.
 *       403:
 *         description: Rol insuficiente.
 */
// GET /api/licitaciones/next-correlativo
router.get(
  '/next-correlativo',
  ...manageRoles,
  LicitacionController.getNextCorrelativo
);

// =============================================================================
// 2. COLLECTION ROUTES
// =============================================================================

/**
 * @swagger
 * /api/licitaciones:
 *   get:
 *     summary: Listar licitaciones (paginado y filtrado)
 *     description: Lista paginada y filtrable. Disponible para todos los roles autenticados (el Ejecutivo la usa para el dropdown de "Licitación asociada").
 *     tags: [Licitaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Búsqueda en código, nombre y razón social del cliente.
 *       - in: query
 *         name: estado
 *         schema:
 *           type: string
 *           enum: ["En preparacion", "Cotizando", "En evaluacion", "Presentada", "Adjudicada", "No adjudicada", "Archivada"]
 *       - in: query
 *         name: id_responsable
 *         schema: { type: integer }
 *       - in: query
 *         name: id_cliente
 *         schema: { type: integer }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *       - in: query
 *         name: sort_by
 *         schema:
 *           type: string
 *           enum: [codigo, nombre, estado, fecha_limite, creado_en, cliente_nombre]
 *           default: creado_en
 *       - in: query
 *         name: sort_order
 *         schema: { type: string, enum: [ASC, DESC], default: DESC }
 *     responses:
 *       200:
 *         description: Lista paginada de licitaciones.
 *       401:
 *         description: Token ausente o inválido.
 */
// GET /api/licitaciones
router.get(
  '/',
  ...allRoles,
  LicitacionController.getLicitaciones
);

/**
 * @swagger
 * /api/licitaciones:
 *   post:
 *     summary: Crear una nueva licitación (Proyectos, Jefe, SysAdmin)
 *     description: Genera el correlativo LIC-YYYY/NNNN e inserta la cabecera. El responsable es el propio usuario Proyectos, o el indicado cuando crea Jefe/SysAdmin.
 *     tags: [Licitaciones]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nombre, id_cliente]
 *             properties:
 *               nombre:                  { type: string, example: "Provisión de repuestos flota municipal 2026" }
 *               id_cliente:              { type: integer, example: 1 }
 *               descripcion:             { type: string }
 *               presupuesto_referencial: { type: number, format: float, example: 250000.00 }
 *               moneda:                  { type: string, enum: [BOB, USD], default: BOB }
 *               fecha_limite:            { type: string, format: date, example: "2026-09-30" }
 *               id_responsable:          { type: integer, description: "Solo Jefe/SysAdmin; ignorado si el creador es Proyectos." }
 *     responses:
 *       201:
 *         description: Licitación creada.
 *       403:
 *         description: Rol insuficiente.
 *       422:
 *         description: Validación fallida o cliente/responsable inexistente.
 */
// POST /api/licitaciones
router.post(
  '/',
  ...manageRoles,
  validate(createLicitacionSchema),
  LicitacionController.createLicitacion
);

// =============================================================================
// 3. PARAMETRIC ROUTES (después de todas las literales)
// =============================================================================

/**
 * @swagger
 * /api/licitaciones/{id}:
 *   get:
 *     summary: Obtener una licitación por ID
 *     description: Devuelve la cabecera, las cotizaciones vinculadas y el total comprometido vs. el presupuesto referencial.
 *     tags: [Licitaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Detalle de la licitación. }
 *       404: { description: Licitación no encontrada. }
 */
// GET /api/licitaciones/:id
router.get(
  '/:id',
  ...allRoles,
  LicitacionController.getLicitacionById
);

/**
 * @swagger
 * /api/licitaciones/{id}/historial:
 *   get:
 *     summary: Historial de cambios de estado de una licitación
 *     tags: [Licitaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Historial cronológico. }
 *       404: { description: Licitación no encontrada. }
 */
// GET /api/licitaciones/:id/historial
router.get(
  '/:id/historial',
  ...allRoles,
  LicitacionController.getStateHistory
);

/**
 * @swagger
 * /api/licitaciones/{id}:
 *   put:
 *     summary: Editar la cabecera de una licitación (responsable, Jefe, SysAdmin)
 *     description: Solo editable en estados 'En preparacion' o 'Cotizando'. La propiedad (ownership) se valida en el controller.
 *     tags: [Licitaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nombre, id_cliente]
 *             properties:
 *               nombre:                  { type: string }
 *               id_cliente:              { type: integer }
 *               descripcion:             { type: string }
 *               presupuesto_referencial: { type: number, format: float }
 *               moneda:                  { type: string, enum: [BOB, USD] }
 *               fecha_limite:            { type: string, format: date }
 *     responses:
 *       200: { description: Licitación actualizada. }
 *       403: { description: No es el responsable. }
 *       409: { description: La licitación ya no es editable en su estado actual. }
 */
// PUT /api/licitaciones/:id
router.put(
  '/:id',
  ...manageRoles,
  validate(updateLicitacionSchema),
  LicitacionController.updateLicitacion
);

/**
 * @swagger
 * /api/licitaciones/{id}/estado:
 *   put:
 *     summary: Cambiar el estado de una licitación
 *     description: |
 *       Transición validada por la matriz del modelo según (rol, delegación, si es responsable).
 *       El responsable Proyectos y el Ejecutivo delegado comparten la decisión en 'En evaluacion'.
 *       Un Ejecutivo sin delegación recibe 403. 'observacion' es obligatoria para 'No adjudicada'.
 *     tags: [Licitaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nuevo_estado]
 *             properties:
 *               nuevo_estado:
 *                 type: string
 *                 enum: ["En preparacion", "Cotizando", "En evaluacion", "Presentada", "Adjudicada", "No adjudicada", "Archivada"]
 *               observacion:
 *                 type: string
 *                 description: Nota de la transición (obligatoria para 'No adjudicada').
 *     responses:
 *       200: { description: Estado actualizado. }
 *       403: { description: Transición no permitida para el rol/actor. }
 *       409: { description: Conflicto de concurrencia optimista. }
 *       422: { description: Estado inválido o falta 'observacion' para 'No adjudicada'. }
 */
// PUT /api/licitaciones/:id/estado
router.put(
  '/:id/estado',
  ...stateRoles,
  validate(updateLicitacionStatusSchema),
  LicitacionController.updateStatus
);

/**
 * @swagger
 * /api/licitaciones/{id}/documentos:
 *   post:
 *     summary: Subir documentos a una licitación (responsable, Jefe, SysAdmin)
 *     description: |
 *       Sube uno o varios archivos (PDF, Word, Excel o imágenes) vinculados a la licitación,
 *       para que el ejecutivo comercial delegado (y Jefe/SysAdmin) los revisen.
 *       Cada archivo se verifica por número mágico después de escribirse en disco —
 *       la extensión/MIME declarados por el cliente nunca son la única defensa.
 *     tags: [Licitaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               documentos:
 *                 type: array
 *                 items: { type: string, format: binary }
 *                 description: Hasta 10 archivos por solicitud (PDF, .doc/.docx, .xls/.xlsx, .jpg/.jpeg/.png).
 *     responses:
 *       201: { description: Documentos subidos. }
 *       403: { description: Solo el responsable de la licitación (o Jefe/SysAdmin) puede subir documentos. }
 *       404: { description: Licitación no encontrada. }
 *       422: { description: Sin archivos, tipo no permitido, o falló la verificación de contenido. }
 */
// POST /api/licitaciones/:id/documentos
router.post(
  '/:id/documentos',
  ...manageRoles,
  licDocUploadLimiter,
  uploadLicDocs.array('documentos', MAX_DOC_FILES),
  LicitacionDocumentController.uploadDocumentos
);

/**
 * @swagger
 * /api/licitaciones/{id}/documentos:
 *   get:
 *     summary: Listar los documentos adjuntos de una licitación
 *     tags: [Licitaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Lista de documentos. }
 *       404: { description: Licitación no encontrada. }
 */
// GET /api/licitaciones/:id/documentos
router.get(
  '/:id/documentos',
  ...allRoles,
  LicitacionDocumentController.getDocumentos
);

/**
 * @swagger
 * /api/licitaciones/{id}/documentos/{docId}:
 *   get:
 *     summary: Descargar un documento adjunto
 *     tags: [Licitaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: docId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Archivo. }
 *       404: { description: Documento no encontrado o ya no disponible en disco. }
 */
// GET /api/licitaciones/:id/documentos/:docId
router.get(
  '/:id/documentos/:docId',
  ...allRoles,
  LicitacionDocumentController.downloadDocumento
);

/**
 * @swagger
 * /api/licitaciones/{id}/documentos/{docId}:
 *   delete:
 *     summary: Eliminar un documento adjunto (responsable, Jefe, SysAdmin)
 *     tags: [Licitaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: docId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Documento eliminado. }
 *       403: { description: Solo el responsable de la licitación (o Jefe/SysAdmin) puede eliminar documentos. }
 *       404: { description: Documento no encontrado. }
 */
// DELETE /api/licitaciones/:id/documentos/:docId
router.delete(
  '/:id/documentos/:docId',
  ...manageRoles,
  LicitacionDocumentController.deleteDocumento
);

// =============================================================================
// GASTOS — análisis de resultado (post-adjudicación)
// =============================================================================

/**
 * @swagger
 * /api/licitaciones/{id}/gastos:
 *   post:
 *     summary: Registrar un gasto operativo (Administración, responsable Proyectos, Jefe, SysAdmin)
 *     description: Solo permitido cuando la licitación está 'Adjudicada' o 'Archivada'. Alimenta el resultado (ingreso − gastos).
 *     tags: [Licitaciones]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [concepto, monto]
 *             properties:
 *               concepto: { type: string, example: "Transporte a obra" }
 *               monto:    { type: number, format: float, example: 1200.50 }
 *               moneda:   { type: string, enum: [BOB, USD], default: BOB }
 *     responses:
 *       201: { description: Gasto registrado. }
 *       403: { description: Rol sin permiso para cargar gastos. }
 *       409: { description: La licitación no está adjudicada. }
 */
// POST /api/licitaciones/:id/gastos
router.post(
  '/:id/gastos',
  ...gastoRoles,
  validate(createGastoSchema),
  LicitacionGastoController.addGasto
);

/**
 * @swagger
 * /api/licitaciones/{id}/gastos:
 *   get:
 *     summary: Listar gastos + resumen de resultado (ingreso − gastos)
 *     tags: [Licitaciones]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Lista de gastos + totales + resultado. }
 *       404: { description: Licitación no encontrada. }
 */
// GET /api/licitaciones/:id/gastos
router.get(
  '/:id/gastos',
  ...allRoles,
  LicitacionGastoController.getGastos
);

/**
 * @swagger
 * /api/licitaciones/{id}/gastos/{gastoId}:
 *   delete:
 *     summary: Eliminar un gasto (Administración, responsable Proyectos, Jefe, SysAdmin)
 *     tags: [Licitaciones]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: gastoId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Gasto eliminado. }
 *       403: { description: Rol sin permiso. }
 *       404: { description: Gasto no encontrado. }
 */
// DELETE /api/licitaciones/:id/gastos/:gastoId
router.delete(
  '/:id/gastos/:gastoId',
  ...gastoRoles,
  LicitacionGastoController.deleteGasto
);

/**
 * @swagger
 * /api/licitaciones/{id}/pdf:
 *   get:
 *     summary: Descargar el expediente PDF de la licitación
 *     description: Genera on-demand un PDF con datos, resumen económico (ingreso/gastos/resultado), cotizaciones vinculadas y gastos.
 *     tags: [Licitaciones]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: PDF del expediente. }
 *       404: { description: Licitación no encontrada. }
 */
// GET /api/licitaciones/:id/pdf
router.get(
  '/:id/pdf',
  ...allRoles,
  LicitacionController.downloadPdf
);

// =============================================================================
// Multer error handler — must be a 4-argument Express error middleware and
// declared AFTER all routes so it only catches errors bubbled up from within
// this router (mirrors quotationRoutes.js's handler).
// =============================================================================
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(422).json({
      success: false,
      message: `Error al subir el archivo: ${err.message}`,
    });
  }

  if (err?.message?.startsWith('Tipo de archivo no permitido')) {
    return res.status(422).json({ success: false, message: err.message });
  }

  next(err);
});

module.exports = router;
