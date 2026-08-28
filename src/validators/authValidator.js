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

// Compartido con userController.js (createUser): sin esto, nada impedía
// registrar un nombre_usuario con un punto u otro carácter que esta misma
// regex rechaza acá — la cuenta quedaba creada pero nunca podía loguearse
// (login siempre devuelve el mismo 422 de formato, antes de llegar a
// comparar credenciales). Encontrado en la ronda de estrés del 2026-08-26.
const USERNAME_REGEX = /^[\w\-]+$/;

// Compartido con userController.js (createUser): antes sólo se validaba el
// charset (USERNAME_REGEX) ahí, no el largo. Un nombre de 1-2 caracteres se
// creaba igual y después nunca podía loguearse (login exige este mismo
// mínimo); uno de más de 50 rompía con un 500 al chocar contra el ancho de
// columna en la base. Encontrado en la ronda de estrés del 2026-08-27.
const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 50;

// ---------------------------------------------------------------------------
// loginSchema — POST /api/auth/login
// ---------------------------------------------------------------------------
const loginSchema = z.object({
  nombre_usuario: z
    .string({ required_error: 'nombre_usuario is required.' })
    .trim()
    .min(USERNAME_MIN_LENGTH, `nombre_usuario must be at least ${USERNAME_MIN_LENGTH} characters.`)
    .max(USERNAME_MAX_LENGTH, `nombre_usuario must not exceed ${USERNAME_MAX_LENGTH} characters.`)
    // Allow letters, digits, underscores, and hyphens only — blocks SQL metacharacters
    .regex(USERNAME_REGEX, 'nombre_usuario may only contain letters, digits, underscores, or hyphens.'),

  password: z
    .string({ required_error: 'password is required.' })
    .min(1, 'password must not be empty.')
    .max(128, 'password must not exceed 128 characters.'),
});

module.exports = { loginSchema, USERNAME_REGEX, USERNAME_MIN_LENGTH, USERNAME_MAX_LENGTH };
