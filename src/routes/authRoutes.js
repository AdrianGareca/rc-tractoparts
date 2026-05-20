// =============================================================================
// src/routes/authRoutes.js
// Authentication Routes — POST /api/auth/login, POST /api/auth/logout
// (Section 3.10 — API Contract)
// =============================================================================

'use strict';

const express        = require('express');
const AuthController = require('../controllers/authController');
const { authenticate } = require('../middlewares/authMiddleware');

const router = express.Router();

// POST /api/auth/login
// Public — no authentication middleware required; this IS the authentication step
router.post('/login', AuthController.login);

// POST /api/auth/logout
// Protected — authenticate first to get req.token for revocation
router.post('/logout', authenticate, AuthController.logout);

module.exports = router;
