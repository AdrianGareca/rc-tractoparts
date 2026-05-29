// =============================================================================
// src/routes/quotationRoutes.js
// Quotation Routes — /api/cotizaciones
// (Section 3.10 — API Contract + Section 3.7.4 — Permission Matrix)
//
// ROUTE ORDER MATTERS: fixed-path routes (/resumen, /pendientes-aprobacion)
// must be registered BEFORE parametric routes (/:id) or Express will interpret
// the literal path segments as ID values and route to the wrong handler.
//
// Sprint 1: POST /, GET /:id, PUT /:id/estado, POST /:id/aprobar,
//           POST /:id/pdf, GET /:id/pdf
// Sprint 2: GET / (paginated+filtered), GET /resumen, GET /pendientes-aprobacion
// =============================================================================

'use strict';

const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');

const QuotationController = require('../controllers/quotationController');
const { authenticate }    = require('../middlewares/authMiddleware');
const authorize           = require('../middlewares/roleMiddleware');

const router = express.Router();

// ---------------------------------------------------------------------------
// Multer — PDF upload storage and validation
// ---------------------------------------------------------------------------
const uploadDir = path.resolve(
  process.cwd(),
  process.env.UPLOAD_DIR || 'uploads/cotizaciones'
);

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename:    (req, file, cb) => {
    const quotationId = req.params.id || 'draft';
    cb(null, `COT-${quotationId}-${Date.now()}.pdf`);
  },
});

function pdfFilter(req, file, cb) {
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Only PDF files are accepted. Received: ' + file.mimetype), false);
  }
}

const maxPdfBytes = (parseInt(process.env.MAX_PDF_SIZE_MB, 10) || 10) * 1024 * 1024;

const upload = multer({ storage, fileFilter: pdfFilter, limits: { fileSize: maxPdfBytes, files: 1 } });

// ---------------------------------------------------------------------------
// Shorthand middleware stacks for each role combination
// ---------------------------------------------------------------------------
const allRoles     = [authenticate, authorize(['Ejecutivo', 'Administracion', 'Jefe'])];
const execAndAdmin = [authenticate, authorize(['Ejecutivo', 'Administracion'])];
const execOnly     = [authenticate, authorize(['Ejecutivo'])];
const jefeOnly     = [authenticate, authorize(['Jefe'])];

// ---------------------------------------------------------------------------
// SPRINT 2 — Fixed-path routes (must come before /:id parametric routes)
// ---------------------------------------------------------------------------

// GET /api/cotizaciones/resumen
// Quotation counts grouped by estado. Ejecutivos see only their own counts.
router.get('/resumen',
  ...allRoles,
  QuotationController.getStateSummary
);

// GET /api/cotizaciones/pendientes-aprobacion
// All "En revision" quotations ordered oldest-first — the Jefe's approval queue.
router.get('/pendientes-aprobacion',
  ...jefeOnly,
  QuotationController.getPendingApproval
);

// ---------------------------------------------------------------------------
// SPRINT 2 — Main listing (rebuilt with pagination, filters, sort)
// ---------------------------------------------------------------------------
/**
 * @openapi
 * {
 * "/api/auth/login": {
 * "post": {
 * "summary": "Iniciar sesión en el sistema (Obtener Token JWT)",
 * "description": "Envía las credenciales de usuario para recibir un token de acceso válido.",
 * "tags": ["Autenticación"],
 * "requestBody": {
 * "required": true,
 * "content": {
 * "application/json": {
 * "schema": {
 * "type": "object",
 * "required": ["nombre_usuario", "password"],
 * "properties": {
 * "nombre_usuario": { "type": "string", "example": "adrian_admin" },
 * "password": { "type": "string", "example": "Password123!" }
 * }
 * }
 * }
 * }
 * },
 * "responses": {
 * "200": { "description": "Autenticación exitosa. Retorna el token JWT." },
 * "401": { "description": "Credenciales inválidas." }
 * }
 * }
 * }
 * }
 */

// ---------------------------------------------------------------------------
// SPRINT 1 — Write routes (unchanged)
// ---------------------------------------------------------------------------

// POST /api/cotizaciones
// Create a new quotation with atomic serial number generation (HU03)
router.post('/',
  ...execAndAdmin,
  QuotationController.createQuotation
);

// ---------------------------------------------------------------------------
// SPRINT 1 — Parametric routes (must come after fixed-path routes above)
// ---------------------------------------------------------------------------

// GET /api/cotizaciones/:id
// Full quotation detail including line items and approval history (all roles)
router.get('/:id',
  ...allRoles,
  QuotationController.getQuotationById
);

// PUT /api/cotizaciones/:id/estado
// State machine transition — transition rules enforced by model (all roles)
router.put('/:id/estado',
  ...allRoles,
  QuotationController.updateStatus
);

// POST /api/cotizaciones/:id/aprobar
// Approve or reject — Jefe only (HU08)
router.post('/:id/aprobar',
  ...jefeOnly,
  QuotationController.approveQuotation
);

// POST /api/cotizaciones/:id/pdf
// Upload PDF — Ejecutivo only; multer validates MIME type and size first
router.post('/:id/pdf',
  ...execOnly,
  upload.single('archivo'),
  QuotationController.uploadPdf
);

// GET /api/cotizaciones/:id/pdf
// Download the stored PDF (all roles; logged to audit)
router.get('/:id/pdf',
  ...allRoles,
  QuotationController.downloadPdf
);

// ---------------------------------------------------------------------------
// Multer error handler — must be a 4-argument middleware after all routes
// ---------------------------------------------------------------------------
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(422).json({ success: false, message: `File upload error: ${err.message}` });
  }
  if (err?.message?.startsWith('Only PDF')) {
    return res.status(422).json({ success: false, message: err.message });
  }
  next(err); // Propagate anything else to app.js global handler
});

module.exports = router;