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

/**
 * @swagger
 * /api/reportes/cliente-item:
 *   get:
 *     summary: Consumo por cliente y codigo de item (cualquier rol autenticado)
 *     description: |
 *       Tabla plana: una fila por (cliente, codigo de item, unidad) con la
 *       cantidad total. Es el unico reporte que baja al nivel de LINEA — el
 *       resto agrega sobre la cabecera de la cotizacion.
 *
 *       El codigo se resuelve como `productos.codigo` y, si no hay, el
 *       `codigo_parte` escrito a mano en la linea: el mismo repuesto entra por
 *       un camino o por el otro segun como lo cargo cada ejecutivo, y sin
 *       unificarlos aparece partido en dos filas.
 *
 *       Las lineas SIN codigo se agrupan por descripcion y vienen marcadas con
 *       `sin_codigo: 1`.
 *
 *       Por defecto cuenta TODAS las cotizaciones, incluidas las rechazadas, asi
 *       que el numero es "lo que el cliente pidio cotizar". Usar `estado=Confirmada`
 *       para "lo que efectivamente compro".
 *
 *       NO devuelve montos: un cliente puede tener cotizaciones en USD y en Bs.,
 *       y sumarlas daria un numero sin significado.
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
 *       - in: query
 *         name: estado
 *         schema: { type: string }
 *         description: Acota a un estado del ciclo de vida. Omitido = todos.
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Busca en razon social, codigo de item o descripcion.
 *       - in: query
 *         name: id_cliente
 *         schema: { type: integer }
 *       - in: query
 *         name: sort_by
 *         schema: { type: string, enum: [cantidad, cliente, codigo, items] }
 *       - in: query
 *         name: sort_order
 *         schema: { type: string, enum: [ASC, DESC] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 25, maximum: 200 }
 *     responses:
 *       200:
 *         description: Reporte generado.
 *       401:
 *         description: Token ausente o invalido.
 *       422:
 *         description: Fecha, estado u orden invalidos.
 *       500:
 *         description: Error interno al ejecutar la agregacion.
 */
router.get('/cliente-item', authenticate, ReportesController.getClienteItem);

/**
 * @swagger
 * /api/reportes/mis-metricas:
 *   get:
 *     summary: Metricas propias del ejecutivo (cualquier rol autenticado)
 *     description: |
 *       Conversion, tiempos de cierre, desglose por estado y evolucion mes a mes.
 *
 *       La metrica principal es la CONVERSION: de lo que salio al cliente,
 *       cuanto se cerro. El denominador son los estados 'Enviada al cliente',
 *       'Confirmada' y 'Rechazada' — lo que sigue en preparacion no cuenta, para
 *       no castigar a quien tiene trabajo en curso.
 *
 *       Los montos van SIEMPRE desglosados por moneda: sumar USD con Bs. daria
 *       un numero sin significado.
 *
 *       Por defecto devuelve las metricas de quien llama. Solo Jefe,
 *       Administracion y SysAdmin pueden pedir las de otro con id_ejecutivo.
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
 *       - in: query
 *         name: id_ejecutivo
 *         schema: { type: integer }
 *         description: Solo para roles de gestion; un Ejecutivo lo recibe ignorado.
 *     responses:
 *       200:
 *         description: Metricas obtenidas.
 *       401:
 *         description: Token ausente o invalido.
 *       422:
 *         description: Fechas o id_ejecutivo invalidos.
 *       500:
 *         description: Error interno al ejecutar las agregaciones.
 */
router.get('/mis-metricas', authenticate, ReportesController.getMisMetricas);

module.exports = router;
