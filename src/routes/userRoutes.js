// =============================================================================
// src/routes/userRoutes.js
// User Management Routes — /api/usuarios
// (Section 3.10 — API Contract + Section 3.7.4 — Permission Matrix)
//
// Role access matrix (per SYSTEM HIERARCHY & PRIVILEGES SPECIFICATION):
//   View, Create, Edit  → Jefe, Administracion, SysAdmin (unrestricted access)
//   Delete (soft)       → Jefe, Administracion, SysAdmin
// =============================================================================

'use strict';

const express        = require('express');
const UserController = require('../controllers/userController');
const { authenticate } = require('../middlewares/authMiddleware');
const authorize        = require('../middlewares/roleMiddleware');

const router = express.Router();

// Jefe + Administracion + SysAdmin can view, create, edit, and deactivate users
const userMgmtRoles = [authenticate, authorize(['Jefe', 'Administracion', 'SysAdmin'])];

/**
 * @swagger
 * tags:
 *   name: Usuarios
 *   description: Gestión de usuarios del sistema (Jefe, Administracion y SysAdmin pueden ver/crear/editar; solo Jefe y SysAdmin pueden desactivar)
 */

/**
 * @swagger
 * /api/usuarios:
 *   get:
 *     summary: Listar todos los usuarios
 *     description: Retorna la lista completa de usuarios registrados en el sistema.
 *     tags: [Usuarios]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de usuarios obtenida exitosamente.
 *       401:
 *         description: Token ausente o inválido.
 *       403:
 *         description: Rol insuficiente (requiere Jefe, Administracion o SysAdmin).
 *       500:
 *         description: Error interno del servidor.
 */

// GET  /api/usuarios      — list all users
router.get('/', ...userMgmtRoles, UserController.listUsers);

/**
 * @swagger
 * /api/usuarios:
 *   post:
 *     summary: Crear un nuevo usuario
 *     description: Registra un nuevo usuario en el sistema con el rol especificado.
 *     tags: [Usuarios]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - nombre_completo
 *               - nombre_usuario
 *               - password
 *               - id_rol
 *             properties:
 *               nombre_completo:
 *                 type: string
 *                 example: Juan Pérez
 *               nombre_usuario:
 *                 type: string
 *                 example: jperez
 *               password:
 *                 type: string
 *                 format: password
 *                 example: Segura@2024
 *               id_rol:
 *                 type: integer
 *                 example: 2
 *               can_approve_quotations:
 *                 type: boolean
 *                 description: >-
 *                   Delegación de Funciones. Permite que el usuario transicione
 *                   cotizaciones a 'Aprobada internamente' aunque su rol base no lo
 *                   permita. Solo puede ser establecido por Jefe, Administracion o
 *                   SysAdmin; para cualquier otro emisor el campo se ignora
 *                   (protección anti-escalamiento). Por defecto false.
 *                 example: false
 *     responses:
 *       201:
 *         description: Usuario creado exitosamente.
 *       401:
 *         description: Token ausente o inválido.
 *       403:
 *         description: Rol insuficiente (requiere Jefe, Administracion o SysAdmin).
 *       422:
 *         description: Datos de entrada inválidos.
 *       500:
 *         description: Error interno del servidor.
 */

// POST /api/usuarios      — create a new user
router.post('/', ...userMgmtRoles, UserController.createUser);

/**
 * @swagger
 * /api/usuarios/{id}:
 *   get:
 *     summary: Obtener usuario por ID
 *     tags: [Usuarios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID del usuario
 *     responses:
 *       200:
 *         description: Datos del usuario.
 *       401:
 *         description: Token ausente o inválido.
 *       403:
 *         description: Rol insuficiente (requiere Jefe, Administracion o SysAdmin).
 *       404:
 *         description: Usuario no encontrado.
 *       500:
 *         description: Error interno del servidor.
 */

// GET  /api/usuarios/:id  — get one user by ID
router.get('/:id', ...userMgmtRoles, UserController.getUserById);

/**
 * @swagger
 * /api/usuarios/{id}:
 *   put:
 *     summary: Actualizar usuario
 *     description: Actualización parcial de nombre, rol, estado activo o contraseña.
 *     tags: [Usuarios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID del usuario a actualizar
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nombre_completo:
 *                 type: string
 *               id_rol:
 *                 type: integer
 *               activo:
 *                 type: boolean
 *               can_approve_quotations:
 *                 type: boolean
 *                 description: >-
 *                   Delegación de Funciones. Solo aplicado cuando el emisor es Jefe,
 *                   Administracion o SysAdmin; en caso contrario el cambio se descarta
 *                   (protección anti-escalamiento).
 *               password:
 *                 type: string
 *                 format: password
 *     responses:
 *       200:
 *         description: Usuario actualizado correctamente.
 *       401:
 *         description: Token ausente o inválido.
 *       403:
 *         description: Rol insuficiente (requiere Jefe, Administracion o SysAdmin).
 *       404:
 *         description: Usuario no encontrado.
 *       422:
 *         description: Datos de entrada inválidos.
 *       500:
 *         description: Error interno del servidor.
 */

// PUT  /api/usuarios/:id  — partial update (name, role, active flag, password reset)
router.put('/:id', ...userMgmtRoles, UserController.updateUser);

/**
 * @swagger
 * /api/usuarios/{id}:
 *   delete:
 *     summary: Desactivar usuario (baja lógica)
 *     description: Establece activo=0 en lugar de eliminar el registro físicamente.
 *     tags: [Usuarios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID del usuario a desactivar
 *     responses:
 *       200:
 *         description: Usuario desactivado correctamente.
 *       401:
 *         description: Token ausente o inválido.
 *       403:
 *         description: Rol insuficiente (requiere Jefe, Administracion o SysAdmin).
 *       404:
 *         description: Usuario no encontrado.
 *       500:
 *         description: Error interno del servidor.
 */

// DELETE /api/usuarios/:id — soft delete (sets activo=0)
router.delete('/:id', ...userMgmtRoles, UserController.deactivateUser);

module.exports = router;
