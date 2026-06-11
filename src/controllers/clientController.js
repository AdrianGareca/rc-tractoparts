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
  // create — POST /api/clientes  (All roles)
  // Express client registration: used by the "Nuevo Cliente" in-form sub-modal.
  // ---------------------------------------------------------------------------
  async create(req, res) {
    const { razon_social, nit, contacto, email, telefono } = req.body;
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

    try {
      const id = await ClientModel.create({ razon_social, nit, contacto, email, telefono });
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
        return res.status(409).json({
          success: false,
          message: 'A client with this NIT already exists in the system.',
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
};

module.exports = ClientController;
