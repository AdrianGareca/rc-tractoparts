// =============================================================================
// src/routes/clientRoutes.js
// Client Routes — /api/clientes
// =============================================================================

'use strict';

const express          = require('express');
const ClientController = require('../controllers/clientController');
const { authenticate } = require('../middlewares/authMiddleware');
const authorize        = require('../middlewares/roleMiddleware');

const router = express.Router();

// All three roles can search and register clients
const allRoles = [authenticate, authorize(['Ejecutivo', 'Administracion', 'Jefe'])];

/**
 * @swagger
 * tags:
 *   name: Clientes
 *   description: Gestión de clientes (autocomplete y registro express)
 */

/**
 * @swagger
 * /api/clientes:
 *   get:
 *     summary: Buscar clientes por nombre o NIT
 *     description: Autocomplete endpoint — retorna hasta 20 clientes que coincidan con el término de búsqueda en razon_social o NIT.
 *     tags: [Clientes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Término de búsqueda (nombre o NIT)
 *     responses:
 *       200:
 *         description: Lista de clientes coincidentes.
 *       401:
 *         description: Token ausente o inválido.
 *       500:
 *         description: Error interno del servidor.
 */
router.get('/', ...allRoles, ClientController.search);

/**
 * @swagger
 * /api/clientes:
 *   post:
 *     summary: Registrar un nuevo cliente
 *     description: Registro express de cliente desde el formulario de cotización.
 *     tags: [Clientes]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - razon_social
 *             properties:
 *               razon_social:
 *                 type: string
 *                 example: Importadora Nueva S.A.
 *               nit:
 *                 type: string
 *                 example: "9876543210"
 *               contacto:
 *                 type: string
 *                 example: Pedro García
 *               email:
 *                 type: string
 *                 format: email
 *                 example: contacto@nueva.com
 *               telefono:
 *                 type: string
 *                 example: "77099999"
 *     responses:
 *       201:
 *         description: Cliente creado exitosamente.
 *       409:
 *         description: Ya existe un cliente con ese NIT.
 *       422:
 *         description: Datos de entrada inválidos.
 *       500:
 *         description: Error interno del servidor.
 */
router.post('/', ...allRoles, ClientController.create);

module.exports = router;
