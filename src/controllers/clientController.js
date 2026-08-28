// =============================================================================
// src/controllers/clientController.js
// Client Controller — GET /api/clientes, POST /api/clientes
// =============================================================================

'use strict';

const ClientModel              = require('../models/ClientModel');
const { logEvent, AuditActions } = require('../utils/auditLog');
// Lectura del id de la URL, compartida: estaba escrita a mano 28 veces
// con el mensaje en dos idiomas distintos.
const { parseId } = require('../utils/parseId');
// El bloque `pagination`, compartido.
const { construirPaginacion } = require('../utils/paginacion');

// Simple RFC 5322-compliant email pattern (no external dependency)
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// _validarCamposCliente — reglas compartidas entre create() y update() (antes
// duplicadas palabra por palabra en las dos, ver el comentario "mirrors
// create" que quedaba en update). telefono (VARCHAR(30)) y contacto
// (VARCHAR(100)) eran los dos únicos campos de esta tabla sin tope de
// longitud acá — un valor más largo que la columna rompía la restricción de
// MySQL sin capturar (HTTP 500 genérico en vez de un 422 claro). Encontrado
// en la ronda de estrés del 2026-08-26.
//
// @returns {{status:number, body:object}|null} el primer error encontrado, o null
// ---------------------------------------------------------------------------
function _validarCamposCliente({ razon_social, nit, email, direccion, ciudad, telefono, contacto }) {
  if (!razon_social || !String(razon_social).trim()) {
    return { status: 422, body: { success: false, message: 'razon_social (Business Name) is required.' } };
  }
  if (String(razon_social).trim().length > 150) {
    return { status: 422, body: { success: false, message: 'razon_social must not exceed 150 characters.' } };
  }
  if (nit && String(nit).trim().length > 20) {
    return { status: 422, body: { success: false, message: 'nit must not exceed 20 characters.' } };
  }
  if (email && !EMAIL_REGEX.test(String(email).trim())) {
    return { status: 422, body: { success: false, message: 'Invalid email format.' } };
  }
  if (direccion && String(direccion).trim().length > 200) {
    return { status: 422, body: { success: false, message: 'direccion must not exceed 200 characters.' } };
  }
  if (ciudad && String(ciudad).trim().length > 100) {
    return { status: 422, body: { success: false, message: 'ciudad must not exceed 100 characters.' } };
  }
  if (telefono && String(telefono).trim().length > 30) {
    return { status: 422, body: { success: false, message: 'telefono must not exceed 30 characters.' } };
  }
  if (contacto && String(contacto).trim().length > 100) {
    return { status: 422, body: { success: false, message: 'contacto must not exceed 100 characters.' } };
  }
  return null;
}

// ---------------------------------------------------------------------------
// _validarOrigenCliente — verifica que id_origen_cliente exista ANTES del
// INSERT/UPDATE. Sin esto, un id_origen_cliente que no está en la tabla
// origenes_cliente llegaba hasta la consulta y la restricción de clave
// foránea la rechazaba con una excepción sin capturar: HTTP 500 genérico en
// vez de un 422 claro. Mismo patrón que clienteLinkGuard.js/
// licitacionLinkGuard.js en cotizaciones. Encontrado en la ronda de estrés
// del 2026-08-27.
//
// El campo es opcional: null/undefined significa "sin origen" y no se valida
// (mismo criterio que verificarVinculoLicitacion para id_licitacion).
//
// @returns {Promise<{status:number, body:object}|null>}
// ---------------------------------------------------------------------------
async function _validarOrigenCliente(idOrigenCliente) {
  if (idOrigenCliente == null) return null;

  const parsedId = parseInt(idOrigenCliente, 10);
  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    return {
      status: 422,
      body: { success: false, message: `id_origen_cliente inválido: "${idOrigenCliente}".` },
    };
  }

  const existe = await ClientModel.origenExists(parsedId);
  if (!existe) {
    return {
      status: 422,
      body: { success: false, message: `El origen de cliente #${parsedId} indicado no existe.` },
    };
  }

  return null;
}

// MEDIO — encontrado en la ronda de estrés del 2026-08-27: los 5 roles tenían
// el mismo permiso para desactivar/reactivar un cliente que para
// crear/editar/listar/ver. La desactivación tiene su propio endpoint (DELETE,
// restringido en clientRoutes.js), pero la reactivación es sólo un campo
// (`activo`) dentro del PUT general — así que ese permiso más estricto se
// aplica acá, adentro del controller, que es el único lugar que sabe si el
// body está efectivamente cambiando el estado activo/inactivo.
const ROLES_ESTADO_CLIENTE = ['Administracion', 'Jefe', 'SysAdmin'];

const ClientController = {

  // ---------------------------------------------------------------------------
  // search — GET /api/clientes?q=<term>  (All roles)
  // Autocomplete endpoint: returns up to 20 clients matching the search term.
  // ---------------------------------------------------------------------------
  async search(req, res) {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    try {
      const clients = await ClientModel.search(q);
      return res.status(200).json({ success: true, data: clients });
    } catch (err) {
      console.error('[ClientController.search] Error:', err.message);
      return res.status(500).json({ success: false, message: 'Error retrieving clients.' });
    }
  },

  // ---------------------------------------------------------------------------
  // getById — GET /api/clientes/:id  (All roles)
  // Returns full client detail (contacto/email/telefono aren't shown in the
  // search-autocomplete results) — used to prefill the "Editar Cliente" modal.
  // Uses findByIdAny (not findById) so an already-deactivated client can still
  // be looked up from the management screen (e.g. to reactivate it).
  // ---------------------------------------------------------------------------
  async getById(req, res) {
    const { id, error: idError } = parseId(req.params.id, 'cliente');

    if (idError) return res.status(idError.status).json(idError.body);

    try {
      const client = await ClientModel.findByIdAny(id);

      if (!client) {
        return res.status(404).json({ success: false, message: `Client with ID ${id} was not found.` });
      }

      return res.status(200).json({ success: true, data: client });
    } catch (err) {
      console.error('[ClientController.getById] Error:', err.message);
      return res.status(500).json({ success: false, message: 'Error retrieving client.' });
    }
  },

  // ---------------------------------------------------------------------------
  // listAll — GET /api/clientes/all?page=&limit=&q=  (All roles)
  // Paginated management list — unlike `search` (capped at 20 ACTIVE results
  // for the quotation-form autocomplete), this returns both active and
  // inactive clients so the "Gestión de Clientes" screen can show, edit,
  // deactivate, and reactivate any of them.
  // ---------------------------------------------------------------------------
  async listAll(req, res) {
    const q     = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const page  = parseInt(req.query.page, 10)  || 1;
    const limit = parseInt(req.query.limit, 10) || 20;

    try {
      const [clients, total] = await Promise.all([
        ClientModel.findAllPaginated({ q, page, limit }),
        ClientModel.countAll({ q }),
      ]);

      const limitNum = Math.min(100, Math.max(1, limit));

      return res.status(200).json({
        success: true,
        data:    clients,
        // Antes este bloque NO mandaba hasNext ni hasPrev, mientras los otros
        // tres endpoints paginados si. Ahora los cuatro cumplen el mismo
        // contrato, que es el que documenta Swagger.
        pagination: construirPaginacion({ page, limit: limitNum, totalRecords: total }),
      });
    } catch (err) {
      console.error('[ClientController.listAll] Error:', err.message);
      return res.status(500).json({ success: false, message: 'Error retrieving clients.' });
    }
  },

  // ---------------------------------------------------------------------------
  // create — POST /api/clientes  (All roles)
  // Express client registration: used by the "Nuevo Cliente" in-form sub-modal.
  // ---------------------------------------------------------------------------
  async create(req, res) {
    const { razon_social, nit, contacto, email, telefono, direccion, ciudad, id_origen_cliente } = req.body;
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    // ── Input validation ──────────────────────────────────────────────────────
    const errValidacion = _validarCamposCliente({ razon_social, nit, email, direccion, ciudad, telefono, contacto });
    if (errValidacion) return res.status(errValidacion.status).json(errValidacion.body);

    const errOrigen = await _validarOrigenCliente(id_origen_cliente);
    if (errOrigen) return res.status(errOrigen.status).json(errOrigen.body);

    try {
      const id = await ClientModel.create({ razon_social, nit, contacto, email, telefono, direccion, ciudad, id_origen_cliente });
      const newClient = await ClientModel.findById(id);

      await logEvent({
        id_usuario:     req.user.id,
        nombre_usuario: req.user.nombre_usuario,
        accion:         AuditActions.CREAR_CLIENTE,
        entidad:        'clientes',
        id_entidad:     id,
        detalle:        { razon_social: String(razon_social).trim(), nit: nit || null },
        ip_origen:      clientIp,
        resultado:      'exito',
      });

      return res.status(201).json({ success: true, data: newClient });

    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        // Reveal WHICH client already holds this NIT so the frontend can
        // offer "select this client instead" rather than leaving the user
        // stuck with only a generic rejection.
        const conflictingClient = await ClientModel.findByNit(nit).catch(() => null);

        return res.status(409).json({
          success: false,
          message: 'A client with this NIT already exists in the system.',
          data:    conflictingClient ? { conflictingClient } : undefined,
        });
      }

      await logEvent({
        id_usuario:     req.user?.id    || null,
        nombre_usuario: req.user?.nombre_usuario || null,
        accion:         AuditActions.CREAR_CLIENTE,
        entidad:        'clientes',
        id_entidad:     null,
        detalle:        { error: err.message },
        ip_origen:      clientIp,
        resultado:      'fallo',
      });

      console.error('[ClientController.create] Error:', err.message);
      return res.status(500).json({ success: false, message: 'Error creating client.' });
    }
  },

  // ---------------------------------------------------------------------------
  // update — PUT /api/clientes/:id  (All roles)
  // Corrects an existing client's data (e.g. adding a NIT that was left blank
  // at express-registration time). Without this endpoint the only way to fix
  // a client record was to attempt re-creating it, which is rejected by the
  // NIT uniqueness constraint with no path forward for the user.
  //
  // Optionally accepts `activo` (boolean) to reactivate a deactivated client
  // from the management screen — mirrors UserController.updateUser, where
  // reactivation is just a field on the general update rather than its own
  // endpoint. When omitted, the client's current active status is preserved.
  // ---------------------------------------------------------------------------
  async update(req, res) {
    const { id, error: idError } = parseId(req.params.id, 'cliente');
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    if (idError) return res.status(idError.status).json(idError.body);

    const { razon_social, nit, contacto, email, telefono, direccion, ciudad, id_origen_cliente } = req.body;

    // ── Input validation (mismas reglas que create) ───────────────────────────
    const errValidacion = _validarCamposCliente({ razon_social, nit, email, direccion, ciudad, telefono, contacto });
    if (errValidacion) return res.status(errValidacion.status).json(errValidacion.body);

    // Sólo se valida cuando el campo viene explícito en el body — omitirlo
    // conserva el id_origen_cliente ya guardado (que ya pasó esta misma
    // validación cuando se guardó), y un null explícito lo vacía sin problema.
    const errOrigen = await _validarOrigenCliente(id_origen_cliente);
    if (errOrigen) return res.status(errOrigen.status).json(errOrigen.body);

    try {
      const existing = await ClientModel.findByIdAny(id);

      if (!existing) {
        return res.status(404).json({ success: false, message: `Client with ID ${id} was not found.` });
      }

      const activo = req.body.activo != null ? (req.body.activo ? 1 : 0) : existing.activo;

      // Cambiar el estado activo/inactivo (reactivar o desactivar por esta
      // vía) exige el mismo permiso más estricto que el DELETE de
      // desactivación — Ejecutivo/Proyectos conservan el resto del PUT
      // (renombrar, corregir NIT/contacto, etc.) sin este chequeo.
      if (activo !== existing.activo && !ROLES_ESTADO_CLIENTE.includes(req.user.rol)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. Only Administracion, Jefe, or SysAdmin can activate or deactivate a client.',
        });
      }

      // Every optional field follows the same resolve-from-existing rule as
      // `activo`: ClientModel.update always writes EVERY column, so a caller that
      // omits a field (e.g. the reactivation button or a rename-only action, which
      // post a fixed field list) would otherwise blank it out. `undefined` means
      // "not sent — keep the stored value"; an explicit null/'' still clears the
      // field on purpose. This guard MUST cover contacto/email/telefono/nit too —
      // omitting it there was silently wiping stored contact info.
      const nextNit       = nit       !== undefined ? nit       : existing.nit;
      const nextContacto  = contacto  !== undefined ? contacto  : existing.contacto;
      const nextEmail     = email     !== undefined ? email     : existing.email;
      const nextTelefono  = telefono  !== undefined ? telefono  : existing.telefono;
      const nextDireccion = direccion !== undefined ? direccion : existing.direccion;
      const nextCiudad    = ciudad    !== undefined ? ciudad    : existing.ciudad;
      const nextOrigen    = id_origen_cliente !== undefined ? id_origen_cliente : existing.id_origen_cliente;

      const updated = await ClientModel.update(id, {
        razon_social,
        nit:       nextNit,
        contacto:  nextContacto,
        email:     nextEmail,
        telefono:  nextTelefono,
        direccion: nextDireccion,
        ciudad:    nextCiudad,
        id_origen_cliente: nextOrigen,
        activo,
      });

      if (!updated) {
        return res.status(404).json({ success: false, message: `Client with ID ${id} was not found.` });
      }

      const updatedClient = await ClientModel.findByIdAny(id);

      await logEvent({
        id_usuario:     req.user.id,
        nombre_usuario: req.user.nombre_usuario,
        accion:         AuditActions.EDITAR_CLIENTE,
        entidad:        'clientes',
        id_entidad:     id,
        detalle:        { razon_social: String(razon_social).trim(), nit: nit || null },
        ip_origen:      clientIp,
        resultado:      'exito',
      });

      return res.status(200).json({ success: true, data: updatedClient });

    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        const conflictingClient = await ClientModel.findByNit(nit).catch(() => null);

        return res.status(409).json({
          success: false,
          message: 'A client with this NIT already exists in the system.',
          data:    conflictingClient ? { conflictingClient } : undefined,
        });
      }

      await logEvent({
        id_usuario:     req.user?.id    || null,
        nombre_usuario: req.user?.nombre_usuario || null,
        accion:         AuditActions.EDITAR_CLIENTE,
        entidad:        'clientes',
        id_entidad:     id,
        detalle:        { error: err.message },
        ip_origen:      clientIp,
        resultado:      'fallo',
      });

      console.error('[ClientController.update] Error:', err.message);
      return res.status(500).json({ success: false, message: 'Error updating client.' });
    }
  },

  // ---------------------------------------------------------------------------
  // deactivate — DELETE /api/clientes/:id  (All roles)
  // Soft delete: sets activo=0. A hard delete is not possible once a client
  // has any cotizaciones (fk_cot_cliente is ON DELETE RESTRICT, by design —
  // deleting the client row would orphan its quotation history). Mirrors
  // UserController.deactivateUser's exact pattern.
  // ---------------------------------------------------------------------------
  async deactivate(req, res) {
    const { id, error: idError } = parseId(req.params.id, 'cliente');
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    if (idError) return res.status(idError.status).json(idError.body);

    try {
      const existing = await ClientModel.findByIdAny(id);

      if (!existing) {
        return res.status(404).json({ success: false, message: `Client with ID ${id} was not found.` });
      }

      if (!existing.activo) {
        return res.status(409).json({
          success: false,
          message: 'Client is already inactive.',
        });
      }

      await ClientModel.update(id, {
        razon_social: existing.razon_social,
        nit:          existing.nit,
        contacto:     existing.contacto,
        email:        existing.email,
        telefono:     existing.telefono,
        direccion:    existing.direccion,
        ciudad:       existing.ciudad,
        id_origen_cliente: existing.id_origen_cliente,
        activo:       0,
      });

      await logEvent({
        id_usuario:     req.user.id,
        nombre_usuario: req.user.nombre_usuario,
        accion:         AuditActions.DESACTIVAR_CLIENTE,
        entidad:        'clientes',
        id_entidad:     id,
        detalle:        { razon_social: existing.razon_social },
        ip_origen:      clientIp,
        resultado:      'exito',
      });

      return res.status(200).json({
        success: true,
        message: `Client '${existing.razon_social}' has been deactivated.`,
      });
    } catch (err) {
      console.error('[ClientController.deactivate] Error:', err.message);
      return res.status(500).json({ success: false, message: 'Error deactivating client.' });
    }
  },
};

module.exports = ClientController;
