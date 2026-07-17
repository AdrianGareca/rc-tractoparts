// =============================================================================
// src/controllers/clientController.js
// Client Controller — GET /api/clientes, POST /api/clientes
// =============================================================================

'use strict';

const ClientModel              = require('../models/ClientModel');
const { logEvent, AuditActions } = require('../utils/auditLog');

// Simple RFC 5322-compliant email pattern (no external dependency)
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    const id = parseInt(req.params.id, 10);

    if (isNaN(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'Invalid client ID.' });
    }

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
        pagination: {
          page:            Math.max(1, page),
          limit:           limitNum,
          totalRecords:    total,
          totalPages:      Math.max(1, Math.ceil(total / limitNum)),
        },
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
    if (!razon_social || !String(razon_social).trim()) {
      return res.status(422).json({
        success: false,
        message: 'razon_social (Business Name) is required.',
      });
    }

    if (String(razon_social).trim().length > 150) {
      return res.status(422).json({
        success: false,
        message: 'razon_social must not exceed 150 characters.',
      });
    }

    if (nit && String(nit).trim().length > 20) {
      return res.status(422).json({
        success: false,
        message: 'nit must not exceed 20 characters.',
      });
    }

    if (email && !EMAIL_REGEX.test(String(email).trim())) {
      return res.status(422).json({
        success: false,
        message: 'Invalid email format.',
      });
    }

    if (direccion && String(direccion).trim().length > 200) {
      return res.status(422).json({
        success: false,
        message: 'direccion must not exceed 200 characters.',
      });
    }

    if (ciudad && String(ciudad).trim().length > 100) {
      return res.status(422).json({
        success: false,
        message: 'ciudad must not exceed 100 characters.',
      });
    }

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
    const id       = parseInt(req.params.id, 10);
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    if (isNaN(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'Invalid client ID.' });
    }

    const { razon_social, nit, contacto, email, telefono, direccion, ciudad, id_origen_cliente } = req.body;

    // ── Input validation (mirrors create) ─────────────────────────────────────
    if (!razon_social || !String(razon_social).trim()) {
      return res.status(422).json({
        success: false,
        message: 'razon_social (Business Name) is required.',
      });
    }

    if (String(razon_social).trim().length > 150) {
      return res.status(422).json({
        success: false,
        message: 'razon_social must not exceed 150 characters.',
      });
    }

    if (nit && String(nit).trim().length > 20) {
      return res.status(422).json({
        success: false,
        message: 'nit must not exceed 20 characters.',
      });
    }

    if (email && !EMAIL_REGEX.test(String(email).trim())) {
      return res.status(422).json({
        success: false,
        message: 'Invalid email format.',
      });
    }

    if (direccion && String(direccion).trim().length > 200) {
      return res.status(422).json({
        success: false,
        message: 'direccion must not exceed 200 characters.',
      });
    }

    if (ciudad && String(ciudad).trim().length > 100) {
      return res.status(422).json({
        success: false,
        message: 'ciudad must not exceed 100 characters.',
      });
    }

    try {
      const existing = await ClientModel.findByIdAny(id);

      if (!existing) {
        return res.status(404).json({ success: false, message: `Client with ID ${id} was not found.` });
      }

      const activo = req.body.activo != null ? (req.body.activo ? 1 : 0) : existing.activo;

      // direccion/ciudad follow the same resolve-from-existing rule as `activo`:
      // ClientModel.update always writes every column, so a caller that omits
      // these (e.g. the reactivation button, which posts a fixed field list)
      // would otherwise blank them out. `undefined` means "not sent — keep the
      // stored value"; an explicit null/'' still clears the field on purpose.
      const nextDireccion = direccion !== undefined ? direccion : existing.direccion;
      const nextCiudad    = ciudad    !== undefined ? ciudad    : existing.ciudad;
      const nextOrigen    = id_origen_cliente !== undefined ? id_origen_cliente : existing.id_origen_cliente;

      const updated = await ClientModel.update(id, {
        razon_social, nit, contacto, email, telefono,
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
    const id       = parseInt(req.params.id, 10);
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    if (isNaN(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'Invalid client ID.' });
    }

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
