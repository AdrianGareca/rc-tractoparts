// =============================================================================
// src/routes/origenClienteRoutes.js
// Origen Cliente Routes — /api/origenes-cliente
//
// GET  /api/origenes-cliente  — List active client origins (client-managing roles)
// POST /api/origenes-cliente  — Create a new client origin (client-managing roles)
//
// Mirrors brandRoutes.js — same shape, different catalog.
// =============================================================================

'use strict';

const express                 = require('express');
const OrigenClienteController = require('../controllers/origenClienteController');
const { authenticate }        = require('../middlewares/authMiddleware');
const authorize                = require('../middlewares/roleMiddleware');

const router = express.Router();

// All roles that manage clients (same set as brandRoutes' QUOTE_ROLES)
const CLIENT_ROLES = ['Ejecutivo', 'Administracion', 'Jefe', 'SysAdmin'];

/**
 * @swagger
 * tags:
 *   name: OrigenesCliente
 *   description: Catálogo de origen/tipo de cliente (para reportes, no aparece en el PDF de cotización)
 */

/**
 * @swagger
 * /api/origenes-cliente:
 *   get:
 *     summary: Listar orígenes de cliente activos
 *     description: Devuelve todos los orígenes de cliente activos ordenados alfabéticamente. Usado para poblar el selector en el modal de Cliente.
 *     tags: [OrigenesCliente]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de orígenes activos
 *       401:
 *         description: Token JWT ausente o inválido
 *       500:
 *         description: Error interno del servidor
 */
router.get('/', authenticate, authorize(CLIENT_ROLES), OrigenClienteController.getOrigenes);

/**
 * @swagger
 * /api/origenes-cliente:
 *   post:
 *     summary: Crear nuevo origen de cliente
 *     description: Registra un nuevo origen/tipo de cliente en el catálogo (p. ej. "Feria comercial"). Nombre normalizado (trim) y verificación de unicidad case-insensitive.
 *     tags: [OrigenesCliente]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nombre]
 *             properties:
 *               nombre:
 *                 type: string
 *                 maxLength: 100
 *                 example: Feria comercial
 *     responses:
 *       201:
 *         description: Origen creado exitosamente
 *       409:
 *         description: El origen ya existe en el catálogo
 *       422:
 *         description: El campo nombre es requerido o supera 100 caracteres
 *       500:
 *         description: Error interno del servidor
 */
router.post('/', authenticate, authorize(CLIENT_ROLES), OrigenClienteController.createOrigen);

module.exports = router;
