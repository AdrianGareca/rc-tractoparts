// =============================================================================
// src/controllers/origenClienteController.js
// Origen Cliente Controller — GET /api/origenes-cliente, POST /api/origenes-cliente
//
// Mirrors brandController.js — same validation/uniqueness/audit contract,
// just for the client acquisition/type catalog instead of part brands.
// =============================================================================

'use strict';

const OrigenClienteModel = require('../models/OrigenClienteModel');
const { logEvent, AuditActions } = require('../utils/auditLog');

const OrigenClienteController = {

  // ---------------------------------------------------------------------------
  // getOrigenes — GET /api/origenes-cliente
  // Returns all active client origins sorted alphabetically.
  // Accessible to any authenticated role that manages clients.
  // ---------------------------------------------------------------------------
  async getOrigenes(req, res) {
    try {
      const origenes = await OrigenClienteModel.getAll();
      return res.status(200).json({ success: true, data: origenes });
    } catch (err) {
      console.error('[OrigenClienteController.getOrigenes]', err);
      return res.status(500).json({ success: false, message: 'Error retrieving client origins.' });
    }
  },

  // ---------------------------------------------------------------------------
  // createOrigen — POST /api/origenes-cliente
  // Creates a new client origin/type.
  //
  // Business rules (same as BrandController.createBrand):
  //   • nombre is trimmed of surrounding whitespace.
  //   • A case-insensitive uniqueness check prevents duplicates.
  //   • If the name already exists (active or inactive), 409 Conflict is
  //     returned with the existing record ID so the frontend can auto-select it.
  // ---------------------------------------------------------------------------
  async createOrigen(req, res) {
    const { nombre } = req.body;
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    if (!nombre || typeof nombre !== 'string' || nombre.trim().length === 0) {
      return res.status(422).json({
        success: false,
        message: 'El nombre del origen es requerido.',
      });
    }

    const trimmed = nombre.trim();
    if (trimmed.length > 100) {
      return res.status(422).json({
        success: false,
        message: 'El nombre del origen no puede superar 100 caracteres.',
      });
    }

    try {
      const existing = await OrigenClienteModel.findByNombre(trimmed);
      if (existing) {
        return res.status(409).json({
          success:  false,
          message:  `El origen "${existing.nombre}" ya existe en el catálogo.`,
          data:     existing,
        });
      }

      const origen = await OrigenClienteModel.create(trimmed);

      await logEvent({
        id_usuario:    req.user?.id      ?? null,
        nombre_usuario: req.user?.nombre_usuario ?? null,
        accion:        AuditActions.CREAR_ORIGEN_CLIENTE,
        entidad:       'origenes_cliente',
        id_entidad:    origen.id,
        detalle:       { nombre: origen.nombre },
        ip_origen:     clientIp,
        resultado:     'exito',
      });

      return res.status(201).json({ success: true, data: origen });

    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({
          success: false,
          message: `El origen "${trimmed}" ya existe en el catálogo.`,
        });
      }

      console.error('[OrigenClienteController.createOrigen]', err);
      return res.status(500).json({ success: false, message: 'Error al crear el origen de cliente.' });
    }
  },
};

module.exports = OrigenClienteController;
