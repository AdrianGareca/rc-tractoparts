// =============================================================================
// src/routes/authRoutes.js
// Authentication Routes — POST /api/auth/login, POST /api/auth/logout
// (Section 3.10 — API Contract)
// =============================================================================

'use strict';

const express        = require('express');
const AuthController = require('../controllers/authController');
const { authenticate } = require('../middlewares/authMiddleware');

const router = express.Router();

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
// Public — no authentication middleware required; this IS the authentication step
router.post('/login', AuthController.login);

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

module.exports = router;
