// =============================================================================
// src/validators/validate.js
// Validation Middleware Factory
//
// Consumes a Zod schema and returns an Express middleware that:
//   1. Parses req.body against the schema.
//   2. On success: replaces req.body with the coerced/sanitized output so
//      downstream controllers always receive clean, typed data.
//   3. On failure: responds 422 with structured field-level error messages —
//      never passes invalid data downstream (neutralizes SQL-injection /
//      XSS payloads at the request boundary).
//
// Usage:
//   const { validate } = require('../validators/validate');
//   const { loginSchema } = require('../validators/authValidator');
//   router.post('/login', validate(loginSchema), AuthController.login);
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// validate
// @param {import('zod').ZodSchema} schema  - Zod schema to parse req.body against
// @returns {import('express').RequestHandler}
// ---------------------------------------------------------------------------
function validate(schema) {
  return function validationMiddleware(req, res, next) {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      // Zod v4 uses .issues (non-enumerable); .errors was removed in v4
      const rawIssues = result.error.issues ?? result.error.errors ?? [];
      const errors = rawIssues.map((issue) => ({
        field:   issue.path.join('.') || 'body',
        message: issue.message,
      }));

      return res.status(422).json({
        success: false,
        message: 'Validation failed. Please check the submitted fields.',
        errors,
      });
    }

    // Replace req.body with the parsed (coerced & stripped) output so that
    // controllers receive only the declared, safe fields.
    req.body = result.data;
    next();
  };
}

module.exports = { validate };
