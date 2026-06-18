// =============================================================================
// src/routes/delegacionRoutes.js
// Temporal Delegation Routes — /api/delegaciones
//
// Access matrix:
//   GET  /ejecutivos   → Jefe, SysAdmin (populate UI dropdown)
//   GET  /             → Jefe, SysAdmin (list own delegations)
//   POST /             → Jefe, SysAdmin (create delegation)
//   DELETE /:id        → Jefe, SysAdmin (revoke delegation)
// =============================================================================

'use strict';

const express               = require('express');
const DelegacionController  = require('../controllers/delegacionController');
const { authenticate }      = require('../middlewares/authMiddleware');
const authorize             = require('../middlewares/roleMiddleware');

const router    = express.Router();
const jefeOnly  = [authenticate, authorize(['Jefe', 'SysAdmin'])];

// GET /api/delegaciones/ejecutivos — list Ejecutivo users for dropdown
// NOTE: must be declared BEFORE /:id to avoid Express treating 'ejecutivos' as an ID
router.get('/ejecutivos', ...jefeOnly, DelegacionController.listEjecutivos);

// GET /api/delegaciones — list delegations created by the authenticated Jefe
router.get('/', ...jefeOnly, DelegacionController.listDelegaciones);

// POST /api/delegaciones — create a new temporal delegation
router.post('/', ...jefeOnly, DelegacionController.createDelegacion);

// DELETE /api/delegaciones/:id — revoke a delegation
router.delete('/:id', ...jefeOnly, DelegacionController.revocarDelegacion);

module.exports = router;
