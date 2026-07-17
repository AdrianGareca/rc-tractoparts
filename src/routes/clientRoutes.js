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
 *               direccion:
 *                 type: string
 *                 maxLength: 200
 *                 description: Dirección impresa en la grilla "DATOS GENERALES DEL CLIENTE" del PDF.
 *                 example: Av. Cristo Redentor #123, 3er Anillo
 *               ciudad:
 *                 type: string
 *                 maxLength: 100
 *                 description: Ciudad impresa en la grilla "DATOS GENERALES DEL CLIENTE" del PDF.
 *                 example: Santa Cruz de la Sierra
 *               id_origen_cliente:
 *                 type: integer
 *                 description: FK->origenes_cliente. Solo para reportes — nunca se imprime en el PDF de cotización.
 *                 example: 2
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

/**
 * @swagger
 * /api/clientes/all:
 *   get:
 *     summary: Listar todos los clientes (activos e inactivos, paginado)
 *     description: >-
 *       Pantalla de gestión de clientes — a diferencia de GET /api/clientes
 *       (autocomplete, máx. 20 activos), retorna TODOS los clientes con
 *       paginación, para poder verlos, editarlos, desactivarlos o reactivarlos.
 *     tags: [Clientes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Filtro opcional por razón social o NIT
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Lista paginada de clientes.
 *       401:
 *         description: Token ausente o inválido.
 *       500:
 *         description: Error interno del servidor.
 */
// NOTE: this literal route MUST be registered before GET /:id — otherwise
// Express would match "/all" against the :id param route and try to parse
// "all" as a client ID.
router.get('/all', ...allRoles, ClientController.listAll);

/**
 * @swagger
 * /api/clientes/{id}:
 *   get:
 *     summary: Obtener el detalle completo de un cliente
 *     description: Usado para precargar el modal de edición (la búsqueda por autocomplete no incluye contacto/email/teléfono).
 *     tags: [Clientes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Detalle del cliente.
 *       404:
 *         description: Cliente no encontrado.
 */
router.get('/:id', ...allRoles, ClientController.getById);

/**
 * @swagger
 * /api/clientes/{id}:
 *   put:
 *     summary: Editar un cliente existente
 *     description: Corrige datos de un cliente ya registrado (p. ej. agregar un NIT que quedó vacío en el registro exprés).
 *     tags: [Clientes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
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
 *               nit:
 *                 type: string
 *               contacto:
 *                 type: string
 *               email:
 *                 type: string
 *               telefono:
 *                 type: string
 *               direccion:
 *                 type: string
 *                 maxLength: 200
 *                 description: >-
 *                   Omitir el campo conserva el valor almacenado; enviarlo como
 *                   null lo vacía explícitamente.
 *               ciudad:
 *                 type: string
 *                 maxLength: 100
 *                 description: >-
 *                   Omitir el campo conserva el valor almacenado; enviarlo como
 *                   null lo vacía explícitamente.
 *               id_origen_cliente:
 *                 type: integer
 *                 description: >-
 *                   FK->origenes_cliente. Omitir el campo conserva el valor
 *                   almacenado; enviarlo como null lo vacía explícitamente.
 *               activo:
 *                 type: boolean
 *                 description: Permite reactivar un cliente previamente desactivado.
 *     responses:
 *       200:
 *         description: Cliente actualizado exitosamente.
 *       404:
 *         description: Cliente no encontrado.
 *       409:
 *         description: Ya existe otro cliente con ese NIT.
 *       422:
 *         description: Datos de entrada inválidos.
 */
router.put('/:id', ...allRoles, ClientController.update);

/**
 * @swagger
 * /api/clientes/{id}:
 *   delete:
 *     summary: Desactivar cliente (baja lógica)
 *     description: >-
 *       Establece activo=0 en lugar de eliminar el registro físicamente — un
 *       borrado físico no es posible una vez que el cliente tiene cotizaciones
 *       asociadas (restricción de integridad referencial). Reversible vía
 *       PUT /api/clientes/{id} con activo=true.
 *     tags: [Clientes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Cliente desactivado correctamente.
 *       404:
 *         description: Cliente no encontrado.
 *       409:
 *         description: El cliente ya está inactivo.
 */
router.delete('/:id', ...allRoles, ClientController.deactivate);

module.exports = router;
