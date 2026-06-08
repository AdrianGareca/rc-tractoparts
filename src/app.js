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

const path = require('path');
const express = require('express');
const helmet  = require('helmet');  // HTTP security headers (XSS, clickjacking, CSP…)
const cors    = require('cors');    // Cross-Origin Resource Sharing
const morgan  = require('morgan'); // HTTP request logger
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');

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
// 3. HTTP Request Logging — morgan
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
// CONFIGURACIÓN DE SWAGGER (OPENAPI)
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
          description: 'Introduce tu token JWT en el formato: Bearer <token>',
        },
      },
    },
  },
  apis: [
    path.join(__dirname, 'routes', '*.js').replace(/\\/g, '/'),
    path.join(__dirname, 'controllers', '*.js').replace(/\\/g, '/')
  ], 
};

const swaggerDocs = swaggerJsdoc(swaggerOptions);

// Servir la interfaz interactiva en http://localhost:3000/api-docs
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Redirección de la raíz a la documentación de Swagger
app.get('/', (req, res) => {
  res.redirect('/api-docs');
});

// ---------------------------------------------------------------------------
// 5. Application Routes
// ---------------------------------------------------------------------------
app.use('/api/auth',         authRoutes);       // POST /api/auth/login|logout
app.use('/api/cotizaciones', quotationRoutes);  // CRUD /api/cotizaciones
app.use('/api/usuarios',      userRoutes);       // CRUD /api/usuarios (Jefe only)

// Health-check endpoint
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
// 7. Global Error Handler — OPTIMIZADO CONTRA CRASHES SILENCIOSOS
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[GlobalErrorHandler]', err.stack || err.message || err);

  // Manejo de errores de CORS seguro con encadenamiento opcional
  if (err?.message?.startsWith('CORS:')) {
    return res.status(403).json({ success: false, message: err.message });
  }

  // Fallback seguro 500
  res.status(err.status || 500).json({
    success: false,
    message: err.status
      ? err.message  
      : 'An unexpected internal server error occurred.',
  });
});

module.exports = app;