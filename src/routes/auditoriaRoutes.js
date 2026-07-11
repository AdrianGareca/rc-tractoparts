// =============================================================================
// src/routes/auditoriaRoutes.js
// Auditoria Routes — /api/auditoria
//
// Read-only access to the bitacora_auditoria security log. Restricted to
// management roles — this data reveals who did what across the entire system.
// =============================================================================

'use strict';

const express               = require('express');
const AuditoriaController   = require('../controllers/auditoriaController');
const { authenticate }      = require('../middlewares/authMiddleware');
const authorize             = require('../middlewares/roleMiddleware');

const router = express.Router();
const managerOnly = [authenticate, authorize(['Jefe', 'Administracion', 'SysAdmin'])];

/**
 * @swagger
 * /api/auditoria:
 *   get:
 *     summary: Listado paginado y filtrable de la bitácora de auditoría
 *     description: |
 *       Retorna eventos de bitacora_auditoria (login, creación/edición de
 *       cotizaciones y usuarios, aprobaciones, rechazos, descargas de PDF,
 *       etc.), del más reciente al más antiguo. Exclusivo para Jefe,
 *       Administracion y SysAdmin.
 *     tags: [Auditoria]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: usuario
 *         schema: { type: string }
 *         description: Búsqueda parcial sobre el nombre de usuario que ejecutó la acción.
 *       - in: query
 *         name: accion
 *         schema: { type: string }
 *         description: Código exacto de acción (ver GET /api/auditoria/opciones).
 *       - in: query
 *         name: entidad
 *         schema: { type: string }
 *         description: Tabla afectada (ej. cotizaciones, usuarios, clientes, marcas).
 *       - in: query
 *         name: resultado
 *         schema: { type: string, enum: [exito, fallo] }
 *       - in: query
 *         name: fecha_desde
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: fecha_hasta
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 25 }
 *         description: Máximo 100 por página.
 *     responses:
 *       200:
 *         description: Registros de auditoría obtenidos exitosamente.
 *       401:
 *         description: Token ausente o inválido.
 *       403:
 *         description: Rol insuficiente (requiere Jefe, Administracion o SysAdmin).
 *       422:
 *         description: Parámetro de filtro inválido.
 */
router.get('/', ...managerOnly, AuditoriaController.getAuditLogs);

/**
 * @swagger
 * /api/auditoria/opciones:
 *   get:
 *     summary: Opciones disponibles para los filtros de auditoría
 *     description: Devuelve la lista de códigos de acción, entidades y resultados válidos, para poblar los dropdowns del frontend.
 *     tags: [Auditoria]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Opciones obtenidas exitosamente.
 *       401:
 *         description: Token ausente o inválido.
 *       403:
 *         description: Rol insuficiente.
 */
router.get('/opciones', ...managerOnly, AuditoriaController.getFilterOptions);

module.exports = router;
