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
//   3. Rate limiting (global)
//   4. Request logging (morgan)
//   5. Body parsing
//   6. Static files  (public/)
//   7. Swagger UI    (/api-docs)
//   8. API routes
//   9. 404 handler
//  10. Global error handler
// =============================================================================

'use strict';

require('dotenv').config(); // Load .env before any module reads process.env

const path      = require('path');
const express   = require('express');
const helmet    = require('helmet');     // HTTP security headers (XSS, clickjacking, CSP…)
const cors      = require('cors');       // Cross-Origin Resource Sharing
const morgan    = require('morgan');     // HTTP request logger
const rateLimit = require('express-rate-limit'); // Brute-force / DDoS protection
const swaggerUi   = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');

// Route modules
const authRoutes      = require('./routes/authRoutes');
const quotationRoutes = require('./routes/quotationRoutes');
const userRoutes      = require('./routes/userRoutes');
const clientRoutes    = require('./routes/clientRoutes');
const brandRoutes     = require('./routes/brandRoutes');
const reportesRoutes  = require('./routes/reportesRoutes');

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
// 2. CORS — OPTIMIZADO PARA DESARROLLO Y SWAGGER UI
// ---------------------------------------------------------------------------
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// Añadimos explícitamente el puerto local de Swagger para evitar bloqueos en local
if (process.env.NODE_ENV !== 'production' || allowedOrigins.length === 0) {
  if (!allowedOrigins.includes('http://localhost:3000')) {
    allowedOrigins.push('http://localhost:3000');
  }
}

app.use(cors({
  origin: (origin, callback) => {
    // Permite peticiones sin origen (Postman/curl) o si está en la lista blanca extendida
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`CORS: Origin '${origin}' is not allowed.`));
  },
  methods:         ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders:  ['Content-Type', 'Authorization'],
  exposedHeaders:  ['Content-Disposition'], // Necesario para descargas de PDFs
  credentials:     true,
  optionsSuccessStatus: 204,
}));

// ---------------------------------------------------------------------------
// 3. Global Rate Limiter — applied to ALL routes.
//    Protects against resource-abuse and generic DDoS vectors.
//    Strict per-endpoint limits (e.g. login) are applied in the route files.
// ---------------------------------------------------------------------------
const globalLimiter = rateLimit({
  windowMs:         15 * 60 * 1000, // 15-minute sliding window
  max:              300,             // max requests per IP per window
  standardHeaders:  true,            // Return limit info in `RateLimit-*` headers
  legacyHeaders:    false,           // Disable deprecated `X-RateLimit-*` headers
  message: {
    success: false,
    message: 'Too many requests from this IP. Please try again later.',
  },
  // Skip rate limiting in test environments to avoid breaking integration tests
  skip: () => process.env.NODE_ENV === 'test',
});

app.use(globalLimiter);

// ---------------------------------------------------------------------------
// 4. HTTP Request Logging — morgan
// ---------------------------------------------------------------------------
const morganFormat = process.env.NODE_ENV === 'production' ? 'combined' : 'dev';
app.use(morgan(morganFormat));

// ---------------------------------------------------------------------------
// 5. Body Parsers
//    JSON payloads are capped at 5 MB to prevent large-payload DoS attacks.
//    Requests that exceed this limit return HTTP 413 before touching any route.
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// ---------------------------------------------------------------------------
// 6. CONFIGURACIÓN DE SWAGGER (OPENAPI)
// ---------------------------------------------------------------------------
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'API de Gestión de Cotizaciones — RC Tractoparts',
      version: '1.0.0',
      description: 'Documentación interactiva de la API para el control de cotizaciones, usuarios y auditorías (XP-SCRUM).',
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Servidor Local de Desarrollo',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Introduce tu token JWT. Pega SOLO el token sin el prefijo "Bearer".',
        },
      },
    },
    // Apply bearerAuth globally so every endpoint shows the padlock icon
    // and Swagger UI automatically injects the Authorization header.
    security: [{ bearerAuth: [] }],
  },
  apis: [
    path.join(__dirname, 'routes', '*.js').replace(/\\/g, '/'),
    path.join(__dirname, 'controllers', '*.js').replace(/\\/g, '/')
  ], 
};

const swaggerDocs = swaggerJsdoc(swaggerOptions);

// ---------------------------------------------------------------------------
// 6. Static Files — public/ directory
// Serves the login page (index.html), dashboard, global stylesheet, and all
// ES module scripts. Mounted before Swagger so "/" resolves to the login SPA
// rather than the API docs. express.static silently falls through for paths
// that have no matching file, so /api/* requests reach the route handlers.
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------------------------------------------------------------------------
// 7. Swagger UI — interactive API documentation at /api-docs
// ---------------------------------------------------------------------------
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// ---------------------------------------------------------------------------
// 6. Application Routes
// ---------------------------------------------------------------------------
app.use('/api/auth',         authRoutes);       // POST /api/auth/login|logout
app.use('/api/cotizaciones', quotationRoutes);  // CRUD /api/cotizaciones
app.use('/api/usuarios',      userRoutes);       // CRUD /api/usuarios (Jefe only)
app.use('/api/clientes',      clientRoutes);     // GET|POST /api/clientes (all roles)
app.use('/api/marcas',        brandRoutes);      // GET|POST /api/marcas (brand catalog)
app.use('/api/reportes',      reportesRoutes);   // GET /api/reportes/progreso (Jefe/SysAdmin)

// Health-check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status:    'ok',
    service:   process.env.APP_NAME || 'RC-Tractoparts-API',
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// 7. 404 Handler — catches requests to undefined routes
// ---------------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// ---------------------------------------------------------------------------
// 8. Global Error Handler — Production-hardened
//
// Security contract (OWASP A05 / CWE-209 — Information Exposure):
//   • Stack traces, SQL structures, and internal paths NEVER reach the client.
//   • err.stack is written ONLY to server stderr (log aggregation picks it up).
//   • For HTTP errors with an explicit status (4xx), the message is safe to
//     surface because it is application-controlled (e.g. CORS rejection).
//   • For unhandled exceptions (no explicit status or status >= 500), the
//     client receives only a generic 500 message — no leak of internals.
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Always log the full detail server-side for diagnostics
  console.error('[GlobalErrorHandler]', err.stack || err.message || err);

  // CORS rejection — safe to relay the message (it is our own error text)
  if (err?.message?.startsWith('CORS:')) {
    return res.status(403).json({ success: false, message: err.message });
  }

  // Express body-parser payload size error (413)
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      message: 'Request payload too large. Maximum allowed size is 5 MB.',
    });
  }

  // Multer file-type or size errors (surfaced as 4xx)
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      message: `Uploaded file exceeds the maximum allowed size.`,
    });
  }

  // For intentional HTTP errors (status 400–499), relay the message safely
  const statusCode = err.status || err.statusCode || 500;
  if (statusCode >= 400 && statusCode < 500) {
    return res.status(statusCode).json({ success: false, message: err.message });
  }

  // For all 5xx / unhandled: NEVER leak err.message, stack, or any internal detail
  res.status(500).json({
    success: false,
    message: 'An unexpected internal server error occurred. Please try again later.',
  });
});

module.exports = app;