// =============================================================================
// src/routes/brandRoutes.js
// Brand Routes — /api/marcas
//
// GET  /api/marcas  — List active brands (all authenticated roles)
// POST /api/marcas  — Create a new brand (quote-creating roles)
// =============================================================================

'use strict';

const express           = require('express');
const BrandController   = require('../controllers/brandController');
const { authenticate }  = require('../middlewares/authMiddleware');
const authorize         = require('../middlewares/roleMiddleware');

const router = express.Router();

// All roles that can create quotations (and therefore need to assign brands)
const QUOTE_ROLES = ['Ejecutivo', 'Administracion', 'Jefe', 'SysAdmin'];

/**
 * @swagger
 * tags:
 *   name: Marcas
 *   description: Catálogo de marcas de repuestos de maquinaria pesada
 */

/**
 * @swagger
 * /api/marcas:
 *   get:
 *     summary: Listar marcas activas
 *     description: Devuelve todas las marcas de repuestos activas ordenadas alfabéticamente. Usado para poblar el selector de marca en el formulario de cotización.
 *     tags: [Marcas]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de marcas activas
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         example: 1
 *                       nombre:
 *                         type: string
 *                         example: Caterpillar
 *       401:
 *         description: Token JWT ausente o inválido
 *       500:
 *         description: Error interno del servidor
 */
router.get(
  '/',
  authenticate,
  authorize(QUOTE_ROLES),
  BrandController.getBrands
);

/**
 * @swagger
 * /api/marcas:
 *   post:
 *     summary: Crear nueva marca de repuesto
 *     description: |
 *       Registra una nueva marca en el catálogo. El nombre se normaliza (trim) antes de
 *       guardarse. La verificación de unicidad es case-insensitive para evitar duplicados
 *       como "caterpillar" y "Caterpillar". Si la marca ya existe, se devuelve HTTP 409
 *       con el registro existente para que el frontend pueda auto-seleccionarla.
 *     tags: [Marcas]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - nombre
 *             properties:
 *               nombre:
 *                 type: string
 *                 maxLength: 100
 *                 example: Hitachi
 *     responses:
 *       201:
 *         description: Marca creada exitosamente
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
 *                     id:
 *                       type: integer
 *                       example: 9
 *                     nombre:
 *                       type: string
 *                       example: Hitachi
 *                     activo:
 *                       type: integer
 *                       example: 1
 *       409:
 *         description: La marca ya existe en el catálogo
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: La marca "Caterpillar" ya existe en el catálogo.
 *                 data:
 *                   type: object
 *                   description: Registro existente para auto-selección en el frontend
 *                   properties:
 *                     id:
 *                       type: integer
 *                     nombre:
 *                       type: string
 *                     activo:
 *                       type: integer
 *       401:
 *         description: Token JWT ausente o inválido
 *       403:
 *         description: Rol no autorizado
 *       422:
 *         description: El campo nombre es requerido o supera 100 caracteres
 *       500:
 *         description: Error interno del servidor
 */
router.post(
  '/',
  authenticate,
  authorize(QUOTE_ROLES),
  BrandController.createBrand
);

module.exports = router;
