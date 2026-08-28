// =============================================================================
// src/controllers/userController.js
// User Management Controller — HU02 (Gestión de usuarios y roles)
// (Section 3.10 — /api/usuarios endpoints; Role: Jefe only)
// =============================================================================

'use strict';

const bcrypt    = require('bcryptjs');
const UserModel = require('../models/UserModel');
const { ROLES }                  = require('../config/roles');
const { USERNAME_REGEX, USERNAME_MIN_LENGTH, USERNAME_MAX_LENGTH } = require('../validators/authValidator');
const { logEvent, AuditActions } = require('../utils/auditLog');
// Lectura del id de la URL, compartida: estaba escrita a mano 28 veces
// con el mensaje en dos idiomas distintos.
const { parseId } = require('../utils/parseId');

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

// Los 5 roles son fijos y los referencia el código (ver sql/init.sql: "IDs
// are fixed and referenced by application code") — no hace falta consultar la
// tabla `roles` para validarlos.
const VALID_ROLE_IDS = new Set([1, 2, 3, 4, 5]);

// Mismo mínimo que scripts/seed-users.js exige para las cuentas semilla
// (SysAdmin/Jefe/Administracion) — no tenía sentido pedirle 10 caracteres a
// esas tres cuentas y ninguno a las que se crean desde acá. Antes
// createUser/updateUser sólo exigían que password no estuviera vacío:
// "1" pasaba (201). Encontrado en la ronda de estrés del 2026-08-26.
const MIN_PASSWORD_LENGTH = 10;

function _validarPassword(password) {
  if (String(password).length < MIN_PASSWORD_LENGTH) {
    return {
      field:   'password',
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`,
    };
  }
  return null;
}

// _validarIdRol — controla que id_rol sea uno de los 5 conocidos ANTES de
// llegar al INSERT/UPDATE. Sin esto, un id_rol inválido (negativo,
// absurdamente grande, o no numérico) rompe la restricción de clave foránea
// en la base y sale como un HTTP 500 genérico en vez de un 422 claro.
// Encontrado en la ronda de estrés del 2026-08-25.
function _validarIdRol(idRol) {
  const parsed = parseInt(idRol, 10);
  if (!VALID_ROLE_IDS.has(parsed)) {
    return {
      field:   'id_rol',
      message: `id_rol inválido: "${idRol}". Debe ser uno de: ${[...VALID_ROLE_IDS].join(', ')}.`,
    };
  }
  return null;
}

// CRÍTICO — encontrado en la ronda de estrés del 2026-08-26: la ruta sólo
// exigía Jefe/Administracion/SysAdmin por igual (userMgmtRoles en
// userRoutes.js) y el controller nunca distinguía QUÉ id_rol se podía asignar
// ni A QUIÉN se podía tocar. Con eso, cualquier Administracion o Jefe podía
// crear una cuenta SysAdmin nueva (POST con id_rol:4), auto-promoverse a
// SysAdmin (PUT sobre sí mismo), o editar/desactivar al SysAdmin real —
// verificado en el servidor: Administracion creó una cuenta SysAdmin real
// (201) y se auto-promovió (200), ambas con su propio token.
//
// SysAdmin es "autoridad absoluta sobre todo el sistema" (ver
// config/roles.js) — sólo otro SysAdmin puede crear, promover a, degradar
// desde, o desactivar una cuenta SysAdmin. El resto de las combinaciones de
// roles para gestión de usuarios sigue exactamente igual que antes.
const ID_ROL_SYSADMIN = ROLES.find((r) => r.nombre === 'SysAdmin').id;

// ALTO — encontrado en la ronda de estrés del 2026-08-27: el chequeo de arriba
// sólo cubría el salto hacia/desde SysAdmin. No había ninguna regla para
// Administracion→Jefe, así que cualquier Administracion podía asignarse (o
// asignarle a otra cuenta) el rol "Jefe" — que aprueba cotizaciones y gestiona
// usuarios — con su propio token. "Jefe" es, junto con SysAdmin, uno de los
// ROLES_CON_AUTORIDAD_TOTAL (config/roles.js); sólo alguien que ya tiene esa
// autoridad (Jefe o SysAdmin) puede otorgarla.
const ID_ROL_JEFE = ROLES.find((r) => r.nombre === 'Jefe').id;

/**
 * _validarPermisoSobreAscensoAJefe — sólo Jefe y SysAdmin pueden asignar el
 * rol "Jefe" a una cuenta, sea en la creación o en una edición posterior.
 *
 * @param   {number} idRolSolicitado — el id_rol que se quiere ASIGNAR
 * @param   {string} rolActor        — req.user.rol, quien hace el pedido
 * @returns {{status:number, body:object}|null}
 */
function _validarPermisoSobreAscensoAJefe(idRolSolicitado, rolActor) {
  if (idRolSolicitado === ID_ROL_JEFE && rolActor !== 'Jefe' && rolActor !== 'SysAdmin') {
    return {
      status: 403,
      body: {
        success: false,
        message: 'Access denied. Only a Jefe or SysAdmin can assign the "Jefe" role to an account.',
      },
    };
  }
  return null;
}

/**
 * _validarNoAutoEdicionDeRol — nadie puede cambiar su PROPIO id_rol, ni
 * siquiera un Jefe o un SysAdmin. Sin esto, cualquier cuenta con acceso a
 * PUT /api/usuarios/:id podía auto-promoverse editándose a sí misma (p. ej.
 * Administracion→Jefe con su propio token, saltándose el chequeo de arriba
 * porque ahí el actor y el objetivo son la misma persona). Si hace falta
 * cambiar el rol propio, que lo haga OTRA cuenta.
 *
 * @param   {number} idUsuarioObjetivo — a quién se está editando (req.params.id)
 * @param   {number} idUsuarioActor    — quien hace el pedido (req.user.id)
 * @returns {{status:number, body:object}|null}
 */
function _validarNoAutoEdicionDeRol(idUsuarioObjetivo, idUsuarioActor) {
  if (idUsuarioObjetivo === idUsuarioActor) {
    return {
      status: 403,
      body: {
        success: false,
        message: 'Access denied. You cannot change your own role. Ask another account to do it.',
      },
    };
  }
  return null;
}

/**
 * @param   {number}      idRolSolicitado — el id_rol que se quiere ASIGNAR (crear o cambiar a)
 * @param   {string}      rolActor        — req.user.rol, quien hace el pedido
 * @param   {number|null} idRolActual     — id_rol que YA tiene el usuario objetivo (null si es alta)
 * @returns {{status:number, body:object}|null}
 */
function _validarPermisoSobreSysAdmin(idRolSolicitado, rolActor, idRolActual = null) {
  const tocaSysAdmin =
    idRolSolicitado === ID_ROL_SYSADMIN ||
    idRolActual === ID_ROL_SYSADMIN;

  if (tocaSysAdmin && rolActor !== 'SysAdmin') {
    return {
      status: 403,
      body: {
        success: false,
        message: 'Access denied. Only a SysAdmin can create, modify, or deactivate a SysAdmin account.',
      },
    };
  }
  return null;
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
    const { id, error: idError } = parseId(req.params.id, 'usuario');

    if (idError) return res.status(idError.status).json(idError.body);

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
    if (!nombre_usuario) {
      errors.push({ field: 'nombre_usuario', message: 'Username is required.' });
    } else {
      const nombreUsuarioTrimmed = String(nombre_usuario).trim();

      // ALTO — encontrado en la ronda de estrés del 2026-08-27: acá sólo se
      // validaba el charset (USERNAME_REGEX), nunca el largo. loginSchema SÍ
      // exige este mismo mínimo/máximo — un nombre de 1-2 caracteres se creaba
      // igual y quedaba inutilizable (el login lo rechaza siempre), y uno de
      // más de 50 rompía con un 500 al chocar contra el ancho de la columna.
      // Mismas constantes que loginSchema, para que no se desincronicen.
      if (nombreUsuarioTrimmed.length < USERNAME_MIN_LENGTH || nombreUsuarioTrimmed.length > USERNAME_MAX_LENGTH) {
        errors.push({
          field:   'nombre_usuario',
          message: `Username must be between ${USERNAME_MIN_LENGTH} and ${USERNAME_MAX_LENGTH} characters long.`,
        });
      } else if (!USERNAME_REGEX.test(nombreUsuarioTrimmed)) {
        // Sin esto, un nombre_usuario con un punto (u otro carácter que el
        // login rechaza) se creaba igual y la cuenta quedaba inutilizable: el
        // login siempre devuelve el mismo 422 de formato, antes de comparar
        // credenciales. Mismo regex que loginSchema en authValidator.js.
        errors.push({
          field:   'nombre_usuario',
          message: 'Username may only contain letters, digits, underscores, or hyphens.',
        });
      }
    }
    if (!password) {
      errors.push({ field: 'password', message: 'Password is required.' });
    } else {
      const passError = _validarPassword(password);
      if (passError) errors.push(passError);
    }
    if (!id_rol) {
      errors.push({ field: 'id_rol', message: 'Role ID is required.' });
    } else {
      const rolError = _validarIdRol(id_rol);
      if (rolError) errors.push(rolError);
    }

    if (errors.length > 0) {
      return res.status(422).json({ success: false, message: 'Validation failed.', errors });
    }

    const errSysAdmin = _validarPermisoSobreSysAdmin(parseInt(id_rol, 10), req.user.rol);
    if (errSysAdmin) return res.status(errSysAdmin.status).json(errSysAdmin.body);

    // Misma regla que en updateUser: crear una cuenta nueva con id_rol=Jefe es
    // el mismo salto de autoridad que promover una existente, así que se
    // valida acá también — no sólo en la edición.
    const errJefe = _validarPermisoSobreAscensoAJefe(parseInt(id_rol, 10), req.user.rol);
    if (errJefe) return res.status(errJefe.status).json(errJefe.body);

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
    const { id, error: idError } = parseId(req.params.id, 'usuario');
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    if (idError) return res.status(idError.status).json(idError.body);

    try {
      const existing = await UserModel.findById(id);

      if (!existing) {
        return res.status(404).json({ success: false, message: `User with ID ${id} not found.` });
      }

      if (req.body.id_rol != null) {
        const rolError = _validarIdRol(req.body.id_rol);
        if (rolError) return res.status(422).json({ success: false, message: 'Validation failed.', errors: [rolError] });
      }

      // Cubre las dos direcciones: promover A SysAdmin (id_rol solicitado) y
      // tocar una cuenta que YA ES SysAdmin (id_rol actual) — un Jefe no debe
      // poder, por ejemplo, cambiarle sólo el nombre al SysAdmin real tampoco,
      // ya que esa misma ruta es la que degradaría su rol si se lo pidiera.
      const errSysAdmin = _validarPermisoSobreSysAdmin(
        req.body.id_rol != null ? parseInt(req.body.id_rol, 10) : null,
        req.user.rol,
        existing.id_rol
      );
      if (errSysAdmin) return res.status(errSysAdmin.status).json(errSysAdmin.body);

      // CRÍTICO — encontrado en la ronda de estrés del 2026-08-27: el chequeo
      // de arriba sólo restringe el salto hacia/desde SysAdmin. No había
      // ninguna regla para que un usuario se edite A SÍ MISMO el id_rol, ni
      // para el salto Administracion→Jefe. Un Administracion podía
      // auto-promoverse a Jefe (PUT sobre sí mismo) o promover a cualquier
      // otra cuenta, ambos con su propio token.
      //
      // BUG DEL PROPIO ARREGLO, encontrado el mismo día por Adrian probándolo
      // en vivo: el modal "Editar usuario" del frontend siempre manda id_rol
      // en el body —el valor que ya estaba seleccionado en el desplegable—
      // aunque el usuario sólo haya tocado el nombre o la contraseña. Con
      // `if (req.body.id_rol != null)` a secas, CUALQUIER auto-edición
      // (cambiar la contraseña propia, por ejemplo) quedaba bloqueada con
      // 403, porque el id_rol "presente" era el mismo de siempre, no uno
      // nuevo. La pregunta correcta no es "¿vino id_rol en el body?" sino
      // "¿el id_rol pedido es DISTINTO del que la cuenta ya tiene?" — sólo
      // ahí hay una promoción/degradación real que evaluar.
      const idRolSolicitado    = req.body.id_rol != null ? parseInt(req.body.id_rol, 10) : null;
      const idRolRealmenteCambia = idRolSolicitado != null && idRolSolicitado !== existing.id_rol;

      if (idRolRealmenteCambia) {
        const errAutoRol = _validarNoAutoEdicionDeRol(id, req.user.id);
        if (errAutoRol) return res.status(errAutoRol.status).json(errAutoRol.body);

        const errJefe = _validarPermisoSobreAscensoAJefe(idRolSolicitado, req.user.rol);
        if (errJefe) return res.status(errJefe.status).json(errJefe.body);
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
        const passError = _validarPassword(req.body.password);
        if (passError) {
          return res.status(422).json({ success: false, message: 'Validation failed.', errors: [passError] });
        }
        const bcryptRounds = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;
        updateData.password_hash = await bcrypt.hash(req.body.password, bcryptRounds);

        // Sin esto, resetear la contraseña de una cuenta bloqueada por
        // intentos fallidos no la desbloqueaba: bloqueado_hasta seguía
        // activo y el usuario recibía "Account temporarily locked" al
        // intentar entrar con la contraseña NUEVA — la única vía de auxilio
        // (no hay recuperación de contraseña propia) no funcionaba mientras
        // durara el bloqueo. Encontrado en la ronda de estrés del
        // 2026-08-26.
        updateData.intentos_fallidos = 0;
        updateData.bloqueado_hasta   = null;
      }

      if (Object.keys(updateData).length === 0) {
        return res.status(422).json({
          success: false,
          message: 'No valid fields provided for update.',
        });
      }

      await UserModel.update(id, updateData);

      // Role, active-status, or password changes must invalidate any already-issued
      // JWT for this user immediately — otherwise a demoted/deactivated user, or a
      // stolen token reset via password change, keeps working until the token
      // naturally expires (up to JWT_EXPIRES_IN).
      //
      // Se usa idRolRealmenteCambia (no `updateData.id_rol !== undefined`) por el
      // mismo motivo que el guardián de arriba: el frontend reenvía siempre el
      // id_rol actual, así que `updateData.id_rol` está definido en CADA
      // auto-edición (cambiar solo el nombre, por ejemplo) aunque el rol no
      // cambie de verdad. Sin este ajuste, cualquier edición de tu propio
      // perfil te deslogueaba al instante, no sólo las que de verdad importan
      // (rol, contraseña, activo/inactivo). Encontrado por Adrian en vivo el
      // mismo día del fix original.
      if (idRolRealmenteCambia || updateData.activo !== undefined || updateData.password_hash !== undefined) {
        await UserModel.incrementTokenVersion(id);
      }

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
    const { id, error: idError } = parseId(req.params.id, 'usuario');
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    if (idError) return res.status(idError.status).json(idError.body);

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

      const errSysAdmin = _validarPermisoSobreSysAdmin(null, req.user.rol, existing.id_rol);
      if (errSysAdmin) return res.status(errSysAdmin.status).json(errSysAdmin.body);

      await UserModel.update(id, { activo: 0 });

      // Invalidate any already-issued JWT for this user immediately — otherwise
      // the deactivated user keeps operating until their token naturally expires.
      await UserModel.incrementTokenVersion(id);

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
