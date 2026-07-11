// =============================================================================
// src/routes/authRoutes.js
// Authentication Routes — POST /api/auth/login, POST /api/auth/logout
// (Section 3.10 — API Contract)
// =============================================================================

'use strict';

const express        = require('express');
const rateLimit      = require('express-rate-limit');
const AuthController = require('../controllers/authController');
const { authenticate } = require('../middlewares/authMiddleware');
const authorize        = require('../middlewares/roleMiddleware');
const { validate }     = require('../validators/validate');
const { loginSchema }  = require('../validators/authValidator');

const router = express.Router();

// ---------------------------------------------------------------------------
// Strict Rate Limiter — POST /api/auth/login only
// 5 attempts per 15 minutes per IP.
// Prevents credential-stuffing and brute-force attacks on the login endpoint.
// ---------------------------------------------------------------------------
const loginLimiter = rateLimit({
  windowMs:        15 * 60 * 1000, // 15-minute sliding window
  max:             5,               // maximum 5 login attempts per window per IP
  standardHeaders: true,
  legacyHeaders:   false,
  message: {
    success: false,
    message: 'Too many login attempts from this IP. Please try again in 15 minutes.',
  },
  // Bypass in test AND local development so credential testing isn't locked out
  // after 5 attempts. Production keeps the strict brute-force protection.
  skip: () => ['test', 'development'].includes(process.env.NODE_ENV),
});

/**
 * @swagger
 * tags:
 *   name: Autenticación
 *   description: Endpoints de inicio y cierre de sesión
 */

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Iniciar sesión
 *     description: Valida las credenciales y devuelve un token JWT con vigencia de 8 horas.
 *     tags: [Autenticación]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - nombre_usuario
 *               - password
 *             properties:
 *               nombre_usuario:
 *                 type: string
 *                 example: jperez
 *               password:
 *                 type: string
 *                 format: password
 *                 example: MiContraseña123
 *     responses:
 *       200:
 *         description: Autenticación exitosa. Retorna el JWT y los datos básicos del usuario.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     token:
 *                       type: string
 *                     user:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: integer
 *                         nombre_completo:
 *                           type: string
 *                         nombre_usuario:
 *                           type: string
 *                         rol:
 *                           type: string
 *       401:
 *         description: Credenciales inválidas o cuenta bloqueada.
 *       422:
 *         description: Campos obligatorios faltantes.
 *       500:
 *         description: Error interno del servidor.
 */

// POST /api/auth/login
// Public — no authentication required; this IS the authentication step.
// loginLimiter:  blocks brute-force after 5 failed attempts in 15 min.
// validate():    sanitizes and validates the body before hitting the controller.
router.post('/login', loginLimiter, validate(loginSchema), AuthController.login);

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Cerrar sesión
 *     description: Añade el token JWT actual a la lista de tokens revocados (en memoria).
 *     tags: [Autenticación]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Sesión cerrada y token invalidado correctamente.
 *       401:
 *         description: Token inválido, expirado o ausente.
 *       500:
 *         description: Error interno del servidor.
 */

// POST /api/auth/logout
// Protected — authenticate first to get req.token for revocation
router.post('/logout', authenticate, AuthController.logout);

/**
 * @swagger
 * /api/auth/docs-token:
 *   get:
 *     summary: Emitir un token de acceso de corta duración para /api-docs
 *     description: |
 *       Devuelve un JWT de propósito único (10 minutos de vigencia) que el
 *       frontend usa para abrir /api-docs?token=... — Swagger UI es una
 *       navegación de navegador y no puede enviar el header Authorization.
 *       Exclusivo para Jefe y SysAdmin.
 *     tags: [Autenticación]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Token de documentación emitido exitosamente.
 *       401:
 *         description: Token de sesión ausente o inválido.
 *       403:
 *         description: Rol insuficiente (requiere Jefe o SysAdmin).
 */
router.get('/docs-token', authenticate, authorize(['Jefe', 'SysAdmin']), AuthController.getDocsToken);

module.exports = router;
