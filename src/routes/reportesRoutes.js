// =============================================================================
// src/routes/reportesRoutes.js
// Reportes Routes — /api/reportes
//
// Restricted endpoints for analytics and performance tracking.
// All routes require Jefe or SysAdmin role.
// =============================================================================

'use strict';

const express              = require('express');
const ReportesController   = require('../controllers/reportesController');
const { authenticate }     = require('../middlewares/authMiddleware');
const authorize            = require('../middlewares/roleMiddleware');

const router   = express.Router();
const jefeOnly = [authenticate, authorize(['Jefe', 'SysAdmin'])];

/**
 * @swagger
 * /api/reportes/progreso:
 *   get:
 *     summary: Dashboard de progreso ejecutivo (Jefe / SysAdmin)
 *     description: |
 *       Retorna tres conjuntos de datos analíticos:
 *       - Volumen total cotizado en el mes actual (USD + BOB)
 *       - Tasa de conversión Aceptada vs Rechazada (histórico)
 *       - Desglose de rendimiento por Ejecutivo (mes actual)
 *     tags: [Reportes]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Reporte de progreso obtenido exitosamente.
 *       401:
 *         description: Token ausente o inválido.
 *       403:
 *         description: Rol insuficiente (requiere Jefe o SysAdmin).
 *       500:
 *         description: Error interno al ejecutar las consultas de agregación.
 */
router.get('/progreso', ...jefeOnly, ReportesController.getProgreso);

module.exports = router;
