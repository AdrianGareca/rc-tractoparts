// =============================================================================
// src/app.js
// Express Application Configuration
//
// Configures and exports the Express app instance without starting the HTTP
// server. Keeping app.js and server.js separate allows test suites (Jest +
// Supertest) to import the app directly without binding to a port.
//
// Middleware registration order (important):
//   1. Security headers (helmet)
//   2. CORS
//   3. Request logging (morgan)
//   4. JSON body parsing
//   5. Application routes
//   6. 404 handler
//   7. Global error handler
// =============================================================================

'use strict';

require('dotenv').config(); // Load .env before any module reads process.env

const express = require('express');
const helmet  = require('helmet');  // HTTP security headers (XSS, clickjacking, CSP…)
const cors    = require('cors');    // Cross-Origin Resource Sharing
const morgan  = require('morgan'); // HTTP request logger

// Route modules
const authRoutes      = require('./routes/authRoutes');
const quotationRoutes = require('./routes/quotationRoutes');
const userRoutes      = require('./routes/userRoutes');

const app = express();

// ---------------------------------------------------------------------------
// 1. Security Headers — helmet sets recommended HTTP security headers:
//    Content-Security-Policy, X-Frame-Options, Strict-Transport-Security, etc.
// ---------------------------------------------------------------------------
app.use(helmet());

// Trust the first proxy hop (needed for req.ip to return the real client IP
// when running behind Nginx — Section 3.9.2)
app.set('trust proxy', 1);

// ---------------------------------------------------------------------------
// 2. CORS — allow requests from the configured frontend origin(s)
//    Multiple origins can be provided as a comma-separated list in .env
// ---------------------------------------------------------------------------
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean); // Remove empty strings

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. Postman, curl, server-to-server)
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: Origin '${origin}' is not allowed.`));
    }
  },
  methods:          ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders:   ['Content-Type', 'Authorization'],
  exposedHeaders:   ['Content-Disposition'], // Needed for file downloads
  credentials:      true,
  optionsSuccessStatus: 204, // Some legacy browsers (IE11) choke on 204
}));

// ---------------------------------------------------------------------------
// 3. HTTP Request Logging — morgan
//    "combined" format in production (includes IP, date, status, response time)
//    "dev"      format in development (colored, concise)
// ---------------------------------------------------------------------------
const morganFormat = process.env.NODE_ENV === 'production' ? 'combined' : 'dev';
app.use(morgan(morganFormat));

// ---------------------------------------------------------------------------
// 4. Body Parsers
//    JSON payloads are limited to 5MB to prevent large-payload DoS attempts.
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// ---------------------------------------------------------------------------
// 5. Application Routes
//    All API routes are prefixed with /api (RESTful convention)
// ---------------------------------------------------------------------------
app.use('/api/auth',         authRoutes);       // POST /api/auth/login|logout
app.use('/api/cotizaciones', quotationRoutes);  // CRUD /api/cotizaciones
app.use('/api/usuarios',     userRoutes);       // CRUD /api/usuarios (Jefe only)

// Health-check endpoint — used by monitoring tools and deployment pipelines
app.get('/health', (req, res) => {
  res.status(200).json({
    status:    'ok',
    service:   process.env.APP_NAME || 'RC-Tractoparts-API',
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// 6. 404 Handler — catches requests to undefined routes
// ---------------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// ---------------------------------------------------------------------------
// 7. Global Error Handler — Express identifies error handlers by their 4 args
//    Catches errors thrown by route handlers, middleware, and multer
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Log the full stack trace for debugging (avoid leaking to the client)
  console.error('[GlobalErrorHandler]', err.stack || err.message);

  // CORS errors thrown from the cors() middleware
  if (err.message && err.message.startsWith('CORS:')) {
    return res.status(403).json({ success: false, message: err.message });
  }

  // Fallback: generic 500 with a safe, non-revealing message
  res.status(err.status || 500).json({
    success: false,
    message: err.status
      ? err.message  // Known HTTP error with a safe message
      : 'An unexpected internal server error occurred.',
  });
});

module.exports = app;
