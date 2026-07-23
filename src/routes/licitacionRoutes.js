// =============================================================================
// src/routes/licitacionRoutes.js
// Licitación Routes — /api/licitaciones
//
// ⚠  ROUTE ORDER IS LOAD-BEARING
//    Express matches top-to-bottom. Las rutas literales (/next-correlativo)
//    deben registrarse ANTES de la ruta paramétrica /:id, o Express tomaría el
//    segmento literal como un :id y despacharía al handler equivocado.
//
// Matriz de autorización (el modelo decide el detalle de las transiciones):
//   GET  /                 → todos los autenticados (Ejecutivo la usa p/ dropdown)
//   GET  /next-correlativo → Proyectos, Jefe, SysAdmin
//   POST /                 → Proyectos, Jefe, SysAdmin
//   GET  /:id              → todos los autenticados
//   GET  /:id/historial    → todos los autenticados
//   PUT  /:id              → Proyectos, Jefe, SysAdmin  (ownership en controller)
//   PUT  /:id/estado       → Proyectos, Ejecutivo, Jefe, SysAdmin (matriz decide)
// =============================================================================

'use strict';

const express = require('express');

const LicitacionController = require('../controllers/licitacionController');
const { authenticate }     = require('../middlewares/authMiddleware');
const authorize            = require('../middlewares/roleMiddleware');
const { validate }         = require('../validators/validate');
const {
  createLicitacionSchema,
  updateLicitacionSchema,
  updateLicitacionStatusSchema,
} = require('../validators/licitacionValidator');

const router = express.Router();

// Role middleware shorthands (cada uno se hace spread en la cadena del handler).
const allRoles     = [authenticate, authorize(['Ejecutivo', 'Administracion', 'Jefe', 'SysAdmin', 'Proyectos'])];
const manageRoles  = [authenticate, authorize(['Proyectos', 'Jefe', 'SysAdmin'])];
const stateRoles   = [authenticate, authorize(['Proyectos', 'Ejecutivo', 'Jefe', 'SysAdmin'])];

/**
 * @swagger
 * tags:
 *   name: Licitaciones
 *   description: Ciclo de vida de licitaciones (entidad paraguas de cotizaciones)
 */

// =============================================================================
// 1. FIXED-PATH ROUTES (antes de cualquier /:id)
// =============================================================================

/**
 * @swagger
 * /api/licitaciones/next-correlativo:
 *   get:
 *     summary: Vista previa del próximo código de licitación (LIC-YYYY/NNNN)
 *     description: Previsualización no vinculante del siguiente correlativo, para el encabezado del formulario "Nueva Licitación".
 *     tags: [Licitaciones]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Próximo correlativo previsualizado.
 *       401:
 *         description: Token ausente o inválido.
 *       403:
 *         description: Rol insuficiente.
 */
// GET /api/licitaciones/next-correlativo
router.get(
  '/next-correlativo',
  ...manageRoles,
  LicitacionController.getNextCorrelativo
);

// =============================================================================
// 2. COLLECTION ROUTES
// =============================================================================

/**
 * @swagger
 * /api/licitaciones:
 *   get:
 *     summary: Listar licitaciones (paginado y filtrado)
 *     description: Lista paginada y filtrable. Disponible para todos los roles autenticados (el Ejecutivo la usa para el dropdown de "Licitación asociada").
 *     tags: [Licitaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Búsqueda en código, nombre y razón social del cliente.
 *       - in: query
 *         name: estado
 *         schema:
 *           type: string
 *           enum: ["En preparacion", "Cotizando", "En evaluacion", "Presentada", "Adjudicada", "No adjudicada", "Archivada"]
 *       - in: query
 *         name: id_responsable
 *         schema: { type: integer }
 *       - in: query
 *         name: id_cliente
 *         schema: { type: integer }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *       - in: query
 *         name: sort_by
 *         schema:
 *           type: string
 *           enum: [codigo, nombre, estado, fecha_limite, creado_en, cliente_nombre]
 *           default: creado_en
 *       - in: query
 *         name: sort_order
 *         schema: { type: string, enum: [ASC, DESC], default: DESC }
 *     responses:
 *       200:
 *         description: Lista paginada de licitaciones.
 *       401:
 *         description: Token ausente o inválido.
 */
// GET /api/licitaciones
router.get(
  '/',
  ...allRoles,
  LicitacionController.getLicitaciones
);

/**
 * @swagger
 * /api/licitaciones:
 *   post:
 *     summary: Crear una nueva licitación (Proyectos, Jefe, SysAdmin)
 *     description: Genera el correlativo LIC-YYYY/NNNN e inserta la cabecera. El responsable es el propio usuario Proyectos, o el indicado cuando crea Jefe/SysAdmin.
 *     tags: [Licitaciones]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nombre, id_cliente]
 *             properties:
 *               nombre:                  { type: string, example: "Provisión de repuestos flota municipal 2026" }
 *               id_cliente:              { type: integer, example: 1 }
 *               descripcion:             { type: string }
 *               presupuesto_referencial: { type: number, format: float, example: 250000.00 }
 *               moneda:                  { type: string, enum: [BOB, USD], default: BOB }
 *               fecha_limite:            { type: string, format: date, example: "2026-09-30" }
 *               id_responsable:          { type: integer, description: "Solo Jefe/SysAdmin; ignorado si el creador es Proyectos." }
 *     responses:
 *       201:
 *         description: Licitación creada.
 *       403:
 *         description: Rol insuficiente.
 *       422:
 *         description: Validación fallida o cliente/responsable inexistente.
 */
// POST /api/licitaciones
router.post(
  '/',
  ...manageRoles,
  validate(createLicitacionSchema),
  LicitacionController.createLicitacion
);

// =============================================================================
// 3. PARAMETRIC ROUTES (después de todas las literales)
// =============================================================================

/**
 * @swagger
 * /api/licitaciones/{id}:
 *   get:
 *     summary: Obtener una licitación por ID
 *     description: Devuelve la cabecera, las cotizaciones vinculadas y el total comprometido vs. el presupuesto referencial.
 *     tags: [Licitaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Detalle de la licitación. }
 *       404: { description: Licitación no encontrada. }
 */
// GET /api/licitaciones/:id
router.get(
  '/:id',
  ...allRoles,
  LicitacionController.getLicitacionById
);

/**
 * @swagger
 * /api/licitaciones/{id}/historial:
 *   get:
 *     summary: Historial de cambios de estado de una licitación
 *     tags: [Licitaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Historial cronológico. }
 *       404: { description: Licitación no encontrada. }
 */
// GET /api/licitaciones/:id/historial
router.get(
  '/:id/historial',
  ...allRoles,
  LicitacionController.getStateHistory
);

/**
 * @swagger
 * /api/licitaciones/{id}:
 *   put:
 *     summary: Editar la cabecera de una licitación (responsable, Jefe, SysAdmin)
 *     description: Solo editable en estados 'En preparacion' o 'Cotizando'. La propiedad (ownership) se valida en el controller.
 *     tags: [Licitaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nombre, id_cliente]
 *             properties:
 *               nombre:                  { type: string }
 *               id_cliente:              { type: integer }
 *               descripcion:             { type: string }
 *               presupuesto_referencial: { type: number, format: float }
 *               moneda:                  { type: string, enum: [BOB, USD] }
 *               fecha_limite:            { type: string, format: date }
 *     responses:
 *       200: { description: Licitación actualizada. }
 *       403: { description: No es el responsable. }
 *       409: { description: La licitación ya no es editable en su estado actual. }
 */
// PUT /api/licitaciones/:id
router.put(
  '/:id',
  ...manageRoles,
  validate(updateLicitacionSchema),
  LicitacionController.updateLicitacion
);

/**
 * @swagger
 * /api/licitaciones/{id}/estado:
 *   put:
 *     summary: Cambiar el estado de una licitación
 *     description: |
 *       Transición validada por la matriz del modelo según (rol, delegación, si es responsable).
 *       El responsable Proyectos y el Ejecutivo delegado comparten la decisión en 'En evaluacion'.
 *       Un Ejecutivo sin delegación recibe 403. 'observacion' es obligatoria para 'No adjudicada'.
 *     tags: [Licitaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nuevo_estado]
 *             properties:
 *               nuevo_estado:
 *                 type: string
 *                 enum: ["En preparacion", "Cotizando", "En evaluacion", "Presentada", "Adjudicada", "No adjudicada", "Archivada"]
 *               observacion:
 *                 type: string
 *                 description: Nota de la transición (obligatoria para 'No adjudicada').
 *     responses:
 *       200: { description: Estado actualizado. }
 *       403: { description: Transición no permitida para el rol/actor. }
 *       409: { description: Conflicto de concurrencia optimista. }
 *       422: { description: Estado inválido o falta 'observacion' para 'No adjudicada'. }
 */
// PUT /api/licitaciones/:id/estado
router.put(
  '/:id/estado',
  ...stateRoles,
  validate(updateLicitacionStatusSchema),
  LicitacionController.updateStatus
);

module.exports = router;
