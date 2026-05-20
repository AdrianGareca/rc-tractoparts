// =============================================================================
// src/routes/quotationRoutes.js
// Quotation Routes — /api/cotizaciones
// (Section 3.10 — API Contract + Section 3.7.4 — Permission Matrix)
//
// Multer is configured here to handle PDF file uploads.
// Only .pdf MIME type is accepted; files exceeding MAX_PDF_SIZE_MB are rejected.
// The file is renamed to include the quotation's correlativo for traceability.
// =============================================================================

'use strict';

const express  = require('express');
const multer   = require('multer'); // Multipart form-data parser for file uploads
const path     = require('path');
const fs       = require('fs');

const QuotationController = require('../controllers/quotationController');
const { authenticate }    = require('../middlewares/authMiddleware');
const authorize           = require('../middlewares/roleMiddleware');

const router = express.Router();

// ---------------------------------------------------------------------------
// Multer storage engine — files are saved to UPLOAD_DIR with a structured name
// ---------------------------------------------------------------------------
const uploadDir = path.resolve(
  process.cwd(),
  process.env.UPLOAD_DIR || 'uploads/cotizaciones'
);

// Ensure the upload directory exists at startup (create recursively if absent)
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir); // Save all uploads to the configured directory
  },
  filename: (req, file, cb) => {
    // Use quotation ID and timestamp to build a unique, traceable filename
    const quotationId = req.params.id || 'draft';
    const timestamp   = Date.now();
    const safeName    = `COT-${quotationId}-${timestamp}.pdf`; // e.g. COT-42-1716000000000.pdf
    cb(null, safeName);
  },
});

// File filter — reject anything that is not application/pdf
function pdfFilter(req, file, cb) {
  if (file.mimetype === 'application/pdf') {
    cb(null, true); // Accept the file
  } else {
    cb(new Error('Only PDF files are accepted. Received: ' + file.mimetype), false);
  }
}

const maxPdfBytes = (parseInt(process.env.MAX_PDF_SIZE_MB, 10) || 10) * 1024 * 1024;

const upload = multer({
  storage,
  fileFilter: pdfFilter,
  limits: {
    fileSize: maxPdfBytes,      // Reject files exceeding the configured limit
    files:    1,                // Only one file per request
  },
});

// ---------------------------------------------------------------------------
// Route definitions
// Middleware chain: authenticate → authorize(roles) → controller method
// (Section 3.7.4 — Permission Matrix)
// ---------------------------------------------------------------------------

// POST /api/cotizaciones
// Create a new quotation with atomic serial number generation (HU03 / RNF10)
router.post(
  '/',
  authenticate,
  authorize(['Ejecutivo', 'Administracion', 'Jefe']),
  QuotationController.createQuotation
);

// GET /api/cotizaciones
// List quotations with optional filters (all roles)
router.get(
  '/',
  authenticate,
  authorize(['Ejecutivo', 'Administracion', 'Jefe']),
  QuotationController.getQuotations
);

// GET /api/cotizaciones/:id
// Retrieve a single quotation with line items (all roles)
router.get(
  '/:id',
  authenticate,
  authorize(['Ejecutivo', 'Administracion', 'Jefe']),
  QuotationController.getQuotationById
);

// PUT /api/cotizaciones/:id/estado
// Update commercial status — transition validated by state machine (Section 3.6.2)
router.put(
  '/:id/estado',
  authenticate,
  authorize(['Ejecutivo', 'Administracion', 'Jefe']),
  QuotationController.updateStatus
);

// POST /api/cotizaciones/:id/aprobar
// Approve or reject (Jefe only — HU08)
router.post(
  '/:id/aprobar',
  authenticate,
  authorize(['Jefe']),
  QuotationController.approveQuotation
);

// POST /api/cotizaciones/:id/pdf
// Upload PDF — Ejecutivo only; multer validates type and size before controller runs
router.post(
  '/:id/pdf',
  authenticate,
  authorize(['Ejecutivo']),
  upload.single('archivo'), // Field name must be "archivo" in the multipart form
  QuotationController.uploadPdf
);

// GET /api/cotizaciones/:id/pdf
// Download the PDF attached to a quotation (all roles)
router.get(
  '/:id/pdf',
  authenticate,
  authorize(['Ejecutivo', 'Administracion', 'Jefe']),
  QuotationController.downloadPdf
);

// ---------------------------------------------------------------------------
// Multer error handler — catches file size and type rejection errors
// Must be defined as a 4-argument error middleware after the routes
// ---------------------------------------------------------------------------
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    // Multer-specific errors (e.g. LIMIT_FILE_SIZE)
    return res.status(422).json({
      success: false,
      message: `File upload error: ${err.message}`,
    });
  }

  if (err && err.message && err.message.startsWith('Only PDF')) {
    // Custom fileFilter rejection
    return res.status(422).json({
      success: false,
      message: err.message,
    });
  }

  // Propagate other errors to the global error handler in app.js
  next(err);
});

module.exports = router;
