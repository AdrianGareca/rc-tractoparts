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
// Progreso dashboard: full management view — Jefe, Administracion and SysAdmin.
const progresoAuth = [authenticate, authorize(['Jefe', 'Administracion', 'SysAdmin'])];
// Advanced reports: managers see company-wide data; Ejecutivo sees own data only
const advancedAuth = [authenticate, authorize(['Jefe', 'Administracion', 'SysAdmin', 'Ejecutivo'])];

/**
 * @swagger
 * /api/reportes/progreso:
 *   get:
 *     summary: Dashboard de progreso ejecutivo (Jefe / Administracion / SysAdmin)
 *     description: |
 *       Volumen, tasa de conversión y desglose por ejecutivo dentro de un rango
 *       de fechas. Si se omiten fecha_desde/fecha_hasta, se usa el mes actual.
 *     tags: [Reportes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: fecha_desde
 *         schema: { type: string, format: date }
 *         description: Límite inferior inclusivo (YYYY-MM-DD).
 *       - in: query
 *         name: fecha_hasta
 *         schema: { type: string, format: date }
 *         description: Límite superior inclusivo (YYYY-MM-DD).
 *     responses:
 *       200:
 *         description: Reporte de progreso obtenido exitosamente.
 *       401:
 *         description: Token ausente o inválido.
 *       403:
 *         description: Rol insuficiente (requiere Jefe, Administracion o SysAdmin).
 *       422:
 *         description: Rango de fechas inválido.
 *       500:
 *         description: Error interno al ejecutar las consultas de agregación.
 */
router.get('/progreso', ...progresoAuth, ReportesController.getProgreso);

/**
 * @swagger
 * /api/reportes/advanced:
 *   get:
 *     summary: Métricas avanzadas de BI — Top Clientes y Leaderboard de Ejecutivos
 *     description: |
 *       Retorna dos datasets analíticos:
 *       - top_clientes: Top 10 clientes por revenue (estados Confirmada / Enviada al cliente)
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

/**
 * @swagger
 * /api/reportes/pdf:
 *   get:
 *     summary: Exportar reporte en PDF (general para managers, individual para Ejecutivo)
 *     description: |
 *       Jefe / Administracion / SysAdmin reciben el reporte completo de la empresa
 *       (volumen, conversión, por ejecutivo, top clientes, distribución por origen
 *       de cliente). Ejecutivo recibe únicamente su propio reporte individual —
 *       sin datos de otros ejecutivos ni agregados de la empresa.
 *       Acepta fecha_desde/fecha_hasta (YYYY-MM-DD); si se omiten, los managers
 *       ven el mes actual y el Ejecutivo ve el histórico completo.
 *     tags: [Reportes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: fecha_desde
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: fecha_hasta
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: PDF generado exitosamente.
 *         content:
 *           application/pdf:
 *             schema: { type: string, format: binary }
 *       401:
 *         description: Token ausente o inválido.
 *       403:
 *         description: Rol insuficiente.
 *       422:
 *         description: Rango de fechas inválido.
 *       500:
 *         description: Error interno al generar el PDF.
 */
router.get('/pdf', ...advancedAuth, ReportesController.getReportePdf);

module.exports = router;
