// =============================================================================
// src/routes/reportesRoutes.js
// Reportes Routes — /api/reportes
//
// Restricted endpoints for analytics and performance tracking.
// =============================================================================

'use strict';

const express              = require('express');
const ReportesController   = require('../controllers/reportesController');
const { authenticate }     = require('../middlewares/authMiddleware');
const authorize            = require('../middlewares/roleMiddleware');

const router      = express.Router();
const jefeOnly    = [authenticate, authorize(['Jefe', 'SysAdmin'])];
// Advanced reports: managers see company-wide data; Ejecutivo sees own data only
const advancedAuth = [authenticate, authorize(['Jefe', 'Administracion', 'SysAdmin', 'Ejecutivo'])];

/**
 * @swagger
 * /api/reportes/progreso:
 *   get:
 *     summary: Dashboard de progreso ejecutivo (Jefe / SysAdmin)
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

/**
 * @swagger
 * /api/reportes/advanced:
 *   get:
 *     summary: Métricas avanzadas de BI — Top Clientes y Leaderboard de Ejecutivos
 *     description: |
 *       Retorna dos datasets analíticos:
 *       - top_clientes: Top 10 clientes por revenue (estados Aceptada / Enviada al cliente)
 *       - leaderboard: Rendimiento histórico por ejecutivo
 *
 *       **Row-Level Security:** Los usuarios con rol Ejecutivo reciben únicamente
 *       sus propios datos. Jefe / Administracion / SysAdmin reciben el consolidado
 *       de toda la empresa.
 *     tags: [Reportes]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Reporte avanzado obtenido exitosamente.
 *       401:
 *         description: Token ausente o inválido.
 *       403:
 *         description: Rol insuficiente.
 *       500:
 *         description: Error interno al ejecutar las consultas de agregación.
 */
router.get('/advanced', ...advancedAuth, ReportesController.getAdvancedReports);

module.exports = router;
