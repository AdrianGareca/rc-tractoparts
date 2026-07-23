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
//   3. Static files  (public/)
//   4. Rate limiting (global)
//   5. Request logging (morgan)
//   6. Body parsing
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
const jwt         = require('jsonwebtoken'); // Verifies the short-lived docs-access token (see requireDocsAccess below)

// Route modules
const authRoutes        = require('./routes/authRoutes');
const quotationRoutes   = require('./routes/quotationRoutes');
const licitacionRoutes  = require('./routes/licitacionRoutes');
const userRoutes        = require('./routes/userRoutes');
const clientRoutes      = require('./routes/clientRoutes');
const brandRoutes       = require('./routes/brandRoutes');
const origenClienteRoutes = require('./routes/origenClienteRoutes');
const reportesRoutes    = require('./routes/reportesRoutes');
const auditoriaRoutes   = require('./routes/auditoriaRoutes');

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

// Añadimos explícitamente el puerto local de Swagger para evitar bloqueos en local.
// IMPORTANT: this fallback must NEVER apply in production — if it did, a
// deploy that forgot to set CORS_ORIGIN would silently allow only
// http://localhost:3000 and reject every request from the real production
// frontend domain (a full, silent outage). Fail fast instead.
if (process.env.NODE_ENV !== 'production') {
  if (!allowedOrigins.includes('http://localhost:3000')) {
    allowedOrigins.push('http://localhost:3000');
  }
} else if (allowedOrigins.length === 0) {
  throw new Error(
    'CORS_ORIGIN must be set to at least one allowed origin in production. ' +
    'Refusing to start with an empty allow-list.'
  );
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
// 3. Static Files — public/ directory
// Serves the login page (index.html), dashboard, global stylesheet, and all
// ES module scripts. Mounted BEFORE the rate limiter so static assets are
// never blocked by request-count limits. express.static silently falls through
// for paths that have no matching file, so /api/* requests reach route handlers.
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, '..', 'public')));

// Serve backend image assets (logo, brand images) at /assets/images/ so the
// frontend can reference the same canonical rc_logo.png used by the PDF engine.
app.use('/assets/images', express.static(path.join(__dirname, 'assets', 'images')));

// ---------------------------------------------------------------------------
// 4. Global Rate Limiter — applied to ALL routes.
//    Protects against resource-abuse and generic DDoS vectors.
//    Strict per-endpoint limits (e.g. login) are applied in the route files.
// ---------------------------------------------------------------------------
const globalLimiter = rateLimit({
  windowMs:         15 * 60 * 1000, // 15-minute sliding window
  max:              1000,            // max requests per IP per window
  standardHeaders:  true,            // Return limit info in `RateLimit-*` headers
  legacyHeaders:    false,           // Disable deprecated `X-RateLimit-*` headers
  message: {
    success: false,
    message: 'Too many requests from this IP. Please try again later.',
  },
  // Skip rate limiting in test AND local development so integration tests and
  // rapid manual/Swagger testing don't hit 429s. Production (and any non-dev/test
  // NODE_ENV) stays fully rate-limited.
  skip: () => ['test', 'development'].includes(process.env.NODE_ENV),
});

app.use(globalLimiter);

// ---------------------------------------------------------------------------
// 5. HTTP Request Logging — morgan
// ---------------------------------------------------------------------------
const morganFormat = process.env.NODE_ENV === 'production' ? 'combined' : 'dev';
app.use(morgan(morganFormat));

// ---------------------------------------------------------------------------
// 6. Body Parsers
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
    // Relative server URL: Swagger UI resolves every "Try it out" request
    // against the SAME origin the docs page was loaded from. Locally that is
    // http://localhost:3000; in production it is https://rctractoparts.org —
    // no hardcoded host, no per-environment lists, no HTTPS→HTTP mixed-content
    // blocks. (A hardcoded localhost here previously made the production docs
    // fire requests at the viewer's own machine instead of the real API.)
    servers: [
      {
        url: '/',
        description: 'Servidor actual (mismo origen de esta página)',
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
// 6b. requireDocsAccess — gates the Swagger index page (Jefe / SysAdmin only)
//
// /api-docs is browser-navigated (a plain GET, not an XHR from apiClient), so
// it cannot carry an Authorization header. The frontend instead fetches a
// short-lived, single-purpose token from GET /api/auth/docs-token and opens
// /api-docs?token=<that token>. This middleware verifies it here, independent
// of the normal Bearer-header authMiddleware (which this route can't use).
//
// The API's full endpoint map (routes, params, roles) is meaningful recon
// value even though every endpoint still requires its own JWT — this keeps
// that map out of reach of anyone without a live Jefe/SysAdmin session.
// ---------------------------------------------------------------------------
function requireDocsAccess(req, res, next) {
  const token = req.query.token;
  const deny = (status, msg) => res.status(status).send(`
    <!DOCTYPE html>
    <html lang="es"><head><meta charset="utf-8"><title>Acceso restringido</title></head>
    <body style="font-family:sans-serif;max-width:480px;margin:15vh auto;text-align:center;color:#334155;">
      <h2>🔒 Acceso restringido</h2>
      <p>${msg}</p>
      <p>Volvé al panel y usá el enlace "Documentación API" desde tu sesión (Jefe / SysAdmin).</p>
    </body></html>`);

  if (!token) return deny(401, 'Este enlace requiere un token de acceso a la documentación.');

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.purpose !== 'api-docs') {
      return deny(403, 'Token no válido para este propósito.');
    }
    if (payload.rol !== 'Jefe' && payload.rol !== 'SysAdmin') {
      return deny(403, 'Tu rol no tiene acceso a la documentación de la API.');
    }
    next();
  } catch {
    return deny(401, 'El enlace expiró o no es válido. Los enlaces de documentación duran 10 minutos.');
  }
}

// ---------------------------------------------------------------------------
// 7. Swagger UI — interactive API documentation at /api-docs
//
// Split into two mounts on purpose:
//   • swaggerUi.serve — static framework assets (bundle.js, css, icons).
//     Generic swagger-ui-dist files with zero application-specific content;
//     left PUBLIC so the browser's follow-up asset requests (which cannot
//     carry our ?token=) still load and the page renders correctly.
//   • swaggerUi.setup — the actual HTML page with the API spec embedded
//     (every route, param and role — real recon value). GATED behind
//     requireDocsAccess. swaggerUi.serve calls next() for any path that
//     isn't a real static file (i.e. just "/api-docs" itself), so only that
//     request ever reaches the gate.
// ---------------------------------------------------------------------------
app.use('/api-docs', swaggerUi.serve);
app.use('/api-docs', requireDocsAccess, swaggerUi.setup(swaggerDocs));

// ---------------------------------------------------------------------------
// 6. Application Routes
// ---------------------------------------------------------------------------
app.use('/api/auth',         authRoutes);         // POST /api/auth/login|logout
app.use('/api/cotizaciones', quotationRoutes);    // CRUD /api/cotizaciones
app.use('/api/licitaciones', licitacionRoutes);   // CRUD /api/licitaciones (módulo licitaciones)
app.use('/api/usuarios',      userRoutes);         // CRUD /api/usuarios (Jefe only)
app.use('/api/clientes',      clientRoutes);       // GET|POST /api/clientes (all roles)
app.use('/api/marcas',        brandRoutes);        // GET|POST /api/marcas (brand catalog)
app.use('/api/origenes-cliente', origenClienteRoutes); // GET|POST /api/origenes-cliente (client origin catalog)
app.use('/api/reportes',      reportesRoutes);     // GET /api/reportes/progreso (Jefe/SysAdmin)
app.use('/api/auditoria',     auditoriaRoutes);     // GET /api/auditoria (Jefe/Administracion/SysAdmin)

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