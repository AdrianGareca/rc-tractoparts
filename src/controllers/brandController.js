// =============================================================================
// src/controllers/brandController.js
// Brand Controller — GET /api/marcas, POST /api/marcas
//
// Sprint 3: getBrands, createBrand
// =============================================================================

'use strict';

const BrandModel   = require('../models/BrandModel');
const { logEvent } = require('../utils/auditLog');

const BrandController = {

  // ---------------------------------------------------------------------------
  // getBrands — GET /api/marcas
  // Returns all active brands sorted alphabetically.
  // Accessible to any authenticated role (Ejecutivo, Administracion, Jefe, SysAdmin).
  // ---------------------------------------------------------------------------
  async getBrands(req, res) {
    try {
      const brands = await BrandModel.getAll();
      return res.status(200).json({ success: true, data: brands });
    } catch (err) {
      console.error('[BrandController.getBrands]', err);
      return res.status(500).json({ success: false, message: 'Error retrieving brands.' });
    }
  },

  // ---------------------------------------------------------------------------
  // createBrand — POST /api/marcas
  // Creates a new spare part brand.
  //
  // Business rules:
  //   • nombre is trimmed of surrounding whitespace.
  //   • A case-insensitive uniqueness check prevents duplicates
  //     (e.g. 'caterpillar' and 'Caterpillar' map to the same record).
  //   • If the name already exists (active or inactive), 409 Conflict is returned
  //     with the existing record ID so the frontend can auto-select it.
  // ---------------------------------------------------------------------------
  async createBrand(req, res) {
    const { nombre } = req.body;
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    // ── Input validation ──────────────────────────────────────────────────────
    if (!nombre || typeof nombre !== 'string' || nombre.trim().length === 0) {
      return res.status(422).json({
        success: false,
        message: 'El nombre de la marca es requerido.',
      });
    }

    const trimmed = nombre.trim();
    if (trimmed.length > 100) {
      return res.status(422).json({
        success: false,
        message: 'El nombre de la marca no puede superar 100 caracteres.',
      });
    }

    try {
      // ── Uniqueness check (case-insensitive) ──────────────────────────────────
      const existing = await BrandModel.findByNombre(trimmed);
      if (existing) {
        return res.status(409).json({
          success:  false,
          message:  `La marca "${existing.nombre}" ya existe en el catálogo.`,
          data:     existing,
        });
      }

      // ── Create brand ─────────────────────────────────────────────────────────
      const brand = await BrandModel.create(trimmed);

      // ── Audit log ────────────────────────────────────────────────────────────
      await logEvent({
        id_usuario:    req.user?.id      ?? null,
        nombre_usuario: req.user?.nombre_usuario ?? null,
        accion:        'CREAR_MARCA',
        entidad:       'marcas',
        id_entidad:    brand.id,
        detalle:       { nombre: brand.nombre },
        ip_origen:     clientIp,
        resultado:     'exito',
      });

      return res.status(201).json({ success: true, data: brand });

    } catch (err) {
      // Handle MySQL duplicate key error as a safety net (race condition window)
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({
          success: false,
          message: `La marca "${trimmed}" ya existe en el catálogo.`,
        });
      }

      console.error('[BrandController.createBrand]', err);
      return res.status(500).json({ success: false, message: 'Error al crear la marca.' });
    }
  },
};

module.exports = BrandController;
