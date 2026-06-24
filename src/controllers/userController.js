// =============================================================================
// src/controllers/userController.js
// User Management Controller — HU02 (Gestión de usuarios y roles)
// (Section 3.10 — /api/usuarios endpoints; Role: Jefe only)
// =============================================================================

'use strict';

const bcrypt    = require('bcryptjs');
const UserModel = require('../models/UserModel');
const { logEvent, AuditActions } = require('../utils/auditLog');

// Roles permitted to grant/revoke "Delegación de Funciones"
// (can_approve_quotations). Jefe (id_rol 3) and Administracion (id_rol 2) per
// the business rule; SysAdmin (id_rol 4) is included as the system-wide
// superuser that already holds a strict superset of the Jefe's authority.
// Any other initiator has the field stripped from the payload (anti-escalation).
const DELEGATION_AUTHORIZED_ROLES = ['Jefe', 'Administracion', 'SysAdmin'];

// resolveDelegationFlag — anti-escalation helper.
// Returns 1/0 when the initiator is authorized AND the field was supplied;
// returns undefined when the field must be ignored (not supplied, or the
// initiator lacks authority — preventing API-level privilege escalation).
function resolveDelegationFlag(reqUserRol, rawValue) {
  if (rawValue === undefined) return undefined;
  if (!DELEGATION_AUTHORIZED_ROLES.includes(reqUserRol)) return undefined;
  return rawValue ? 1 : 0;
}

const UserController = {

  // ---------------------------------------------------------------------------
  // listUsers — GET /api/usuarios
  // Return all system users with their role names.
  // ---------------------------------------------------------------------------
  async listUsers(req, res) {
    try {
      const users = await UserModel.findAll();

      return res.status(200).json({
        success: true,
        total:   users.length,
        data:    users,
      });
    } catch (error) {
      console.error('[UserController.listUsers] Error:', error.message);

      return res.status(500).json({ success: false, message: 'Failed to retrieve users.' });
    }
  },

  // ---------------------------------------------------------------------------
  // getUserById — GET /api/usuarios/:id
  // ---------------------------------------------------------------------------
  async getUserById(req, res) {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'Invalid user ID.' });
    }

    try {
      const user = await UserModel.findById(id);

      if (!user) {
        return res.status(404).json({ success: false, message: `User with ID ${id} not found.` });
      }

      return res.status(200).json({ success: true, data: user });
    } catch (error) {
      console.error('[UserController.getUserById] Error:', error.message);

      return res.status(500).json({ success: false, message: 'Failed to retrieve user.' });
    }
  },

  // ---------------------------------------------------------------------------
  // createUser — POST /api/usuarios
  // Hash password before persisting. All users created by the Jefe.
  // ---------------------------------------------------------------------------
  async createUser(req, res) {
    const { nombre_completo, nombre_usuario, password, id_rol } = req.body;
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    // Validate required fields
    const errors = [];
    if (!nombre_completo) errors.push({ field: 'nombre_completo', message: 'Full name is required.' });
    if (!nombre_usuario)  errors.push({ field: 'nombre_usuario',  message: 'Username is required.' });
    if (!password)        errors.push({ field: 'password',        message: 'Password is required.' });
    if (!id_rol)          errors.push({ field: 'id_rol',          message: 'Role ID is required.' });

    if (errors.length > 0) {
      return res.status(422).json({ success: false, message: 'Validation failed.', errors });
    }

    try {
      // Hash the password with the configured cost factor
      const bcryptRounds  = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;
      const password_hash = await bcrypt.hash(password, bcryptRounds);

      // Anti-escalation: only authorized initiators may set the delegation flag.
      // For everyone else the value is stripped and the column keeps its DEFAULT 0.
      const canApprove = resolveDelegationFlag(req.user.rol, req.body.can_approve_quotations);

      const newUserId = await UserModel.create({
        nombre_completo: String(nombre_completo).trim(),
        nombre_usuario:  String(nombre_usuario).trim().toLowerCase(),
        password_hash,
        id_rol:          parseInt(id_rol, 10),
        can_approve_quotations: canApprove === undefined ? 0 : canApprove,
      });

      await logEvent({
        id_usuario:    req.user.id,
        nombre_usuario: req.user.nombre_usuario,
        accion:        AuditActions.CREAR_USUARIO,
        entidad:       'usuarios',
        id_entidad:    newUserId,
        detalle:       { nombre_usuario: String(nombre_usuario).trim(), id_rol },
        ip_origen:     clientIp,
        resultado:     'exito',
      });

      const createdUser = await UserModel.findById(newUserId);

      return res.status(201).json({
        success: true,
        message: 'User created successfully.',
        data:    createdUser,
      });
    } catch (error) {
      // MySQL duplicate entry error code for UNIQUE constraint violation
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({
          success: false,
          message: `Username '${nombre_usuario}' is already taken. Choose a different username.`,
        });
      }

      console.error('[UserController.createUser] Error:', error.message);

      return res.status(500).json({ success: false, message: 'Failed to create user.' });
    }
  },

  // ---------------------------------------------------------------------------
  // updateUser — PUT /api/usuarios/:id
  // Partial update: supports nombre_completo, id_rol, activo, and password reset.
  // ---------------------------------------------------------------------------
  async updateUser(req, res) {
    const id       = parseInt(req.params.id, 10);
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    if (isNaN(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'Invalid user ID.' });
    }

    try {
      const existing = await UserModel.findById(id);

      if (!existing) {
        return res.status(404).json({ success: false, message: `User with ID ${id} not found.` });
      }

      const updateData = {};

      if (req.body.nombre_completo != null) updateData.nombre_completo = String(req.body.nombre_completo).trim();
      if (req.body.id_rol          != null) updateData.id_rol          = parseInt(req.body.id_rol, 10);
      if (req.body.activo          != null) updateData.activo          = req.body.activo ? 1 : 0;

      // Dynamic Function Delegation — anti-escalation guard. The flag is applied
      // only when the initiator is Jefe/Administracion/SysAdmin; any attempt by
      // an unauthorized initiator to alter can_approve_quotations is silently
      // dropped so it can never be used as a privilege-escalation injection.
      const canApprove = resolveDelegationFlag(req.user.rol, req.body.can_approve_quotations);
      if (canApprove !== undefined) updateData.can_approve_quotations = canApprove;

      // Password reset: hash the new password if provided
      if (req.body.password) {
        const bcryptRounds = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;
        updateData.password_hash = await bcrypt.hash(req.body.password, bcryptRounds);
      }

      if (Object.keys(updateData).length === 0) {
        return res.status(422).json({
          success: false,
          message: 'No valid fields provided for update.',
        });
      }

      await UserModel.update(id, updateData);

      await logEvent({
        id_usuario:    req.user.id,
        nombre_usuario: req.user.nombre_usuario,
        accion:        AuditActions.EDITAR_USUARIO,
        entidad:       'usuarios',
        id_entidad:    id,
        detalle:       { updated_fields: Object.keys(updateData) },
        ip_origen:     clientIp,
        resultado:     'exito',
      });

      const updatedUser = await UserModel.findById(id);

      return res.status(200).json({
        success: true,
        message: 'User updated successfully.',
        data:    updatedUser,
      });
    } catch (error) {
      console.error('[UserController.updateUser] Error:', error.message);

      return res.status(500).json({ success: false, message: 'Failed to update user.' });
    }
  },

  // ---------------------------------------------------------------------------
  // deactivateUser — DELETE /api/usuarios/:id
  // Soft delete: sets activo=0. Hard delete is blocked if the user has quotations.
  // ---------------------------------------------------------------------------
  async deactivateUser(req, res) {
    const id       = parseInt(req.params.id, 10);
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    if (isNaN(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'Invalid user ID.' });
    }

    try {
      const existing = await UserModel.findById(id);

      if (!existing) {
        return res.status(404).json({ success: false, message: `User with ID ${id} not found.` });
      }

      if (!existing.activo) {
        return res.status(409).json({
          success: false,
          message: 'User is already inactive.',
        });
      }

      // Prevent accidental self-deactivation by the calling Jefe
      if (id === req.user.id) {
        return res.status(409).json({
          success: false,
          message: 'You cannot deactivate your own account.',
        });
      }

      await UserModel.update(id, { activo: 0 });

      await logEvent({
        id_usuario:    req.user.id,
        nombre_usuario: req.user.nombre_usuario,
        accion:        AuditActions.DESACTIVAR_USUARIO,
        entidad:       'usuarios',
        id_entidad:    id,
        detalle:       { nombre_usuario: existing.nombre_usuario },
        ip_origen:     clientIp,
        resultado:     'exito',
      });

      return res.status(200).json({
        success: true,
        message: `User '${existing.nombre_usuario}' has been deactivated.`,
      });
    } catch (error) {
      console.error('[UserController.deactivateUser] Error:', error.message);

      return res.status(500).json({ success: false, message: 'Failed to deactivate user.' });
    }
  },
};

module.exports = UserController;
