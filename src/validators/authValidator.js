// =============================================================================
// src/validators/authValidator.js
// Authentication Validation Schemas (Zod)
//
// Provides strict input schemas for authentication endpoints.
// Applied BEFORE the controller via the validate() middleware factory to
// neutralize injection payloads and enforce field constraints at the boundary.
//
// Defenses enforced:
//   • .trim()            — strips leading/trailing whitespace (SQLi padding attack)
//   • .max()             — prevents oversized payloads beyond column limits
//   • .regex() on user   — allows only safe identifier characters
//   • .min() on password — enforces a minimum length gate
//   • stripUnknown       — .strict() would reject; instead we strip extra keys
//                          so controllers never see undeclared payload fields
// =============================================================================

'use strict';

const { z } = require('zod');

// ---------------------------------------------------------------------------
// loginSchema — POST /api/auth/login
// ---------------------------------------------------------------------------
const loginSchema = z.object({
  nombre_usuario: z
    .string({ required_error: 'nombre_usuario is required.' })
    .trim()
    .min(3,  'nombre_usuario must be at least 3 characters.')
    .max(50, 'nombre_usuario must not exceed 50 characters.')
    // Allow letters, digits, underscores, and hyphens only — blocks SQL metacharacters
    .regex(/^[\w\-]+$/, 'nombre_usuario may only contain letters, digits, underscores, or hyphens.'),

  password: z
    .string({ required_error: 'password is required.' })
    .min(1, 'password must not be empty.')
    .max(128, 'password must not exceed 128 characters.'),
});

module.exports = { loginSchema };
