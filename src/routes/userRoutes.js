// =============================================================================
// src/routes/userRoutes.js
// User Management Routes — /api/usuarios
// (Section 3.10 — API Contract + Section 3.7.4 — Role: Jefe only)
// =============================================================================

'use strict';

const express        = require('express');
const UserController = require('../controllers/userController');
const { authenticate } = require('../middlewares/authMiddleware');
const authorize        = require('../middlewares/roleMiddleware');

const router = express.Router();

// All user management endpoints are restricted to the Jefe role (Section 3.7.4)
const jefeOnly = [authenticate, authorize(['Jefe'])];

// GET  /api/usuarios      — list all users
router.get('/', ...jefeOnly, UserController.listUsers);

// POST /api/usuarios      — create a new user
router.post('/', ...jefeOnly, UserController.createUser);

// GET  /api/usuarios/:id  — get one user by ID
router.get('/:id', ...jefeOnly, UserController.getUserById);

// PUT  /api/usuarios/:id  — partial update (name, role, active flag, password reset)
router.put('/:id', ...jefeOnly, UserController.updateUser);

// DELETE /api/usuarios/:id — soft delete (sets activo=0)
router.delete('/:id', ...jefeOnly, UserController.deactivateUser);

module.exports = router;
