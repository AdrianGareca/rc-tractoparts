// =============================================================================
// src/validators/quotationValidator.js
// Quotation Validation Schemas (Zod)
//
// Provides strict input schemas for quotation creation and status updates.
// Applied BEFORE the controller via the validate() middleware factory.
//
// Defenses enforced:
//   • .trim()       — removes whitespace padding used in bypass attempts
//   • .max()        — caps field lengths to match DB column definitions
//   • .int() / .positive() — ensures numeric fields are valid and safe
//   • Allowlists for enum fields (estado, moneda) — prevents arbitrary values
//   • Extra keys stripped via Zod's default behavior (.parse strips unknowns)
//   • .optional() fields are explicitly declared to prevent prototype pollution
// =============================================================================

'use strict';

const { z } = require('zod');

// ---------------------------------------------------------------------------
// Valid business values (mirrors the ENUM in the cotizaciones table exactly)
// ---------------------------------------------------------------------------
const VALID_STATES = [
  'Pendiente',
  'En revision',
  'En espera',
  'Aprobada internamente',
  'Enviada al cliente',
  'Aceptada',
  'Rechazada',
  'Archivada',
];

const VALID_CURRENCIES = ['USD', 'BOB'];

// ---------------------------------------------------------------------------
// detalleItemSchema — individual line item inside a quotation
// ---------------------------------------------------------------------------
const detalleItemSchema = z.object({
  id_producto: z
    .number({ invalid_type_error: 'id_producto must be a number.' })
    .int('id_producto must be an integer.')
    .positive('id_producto must be a positive integer.')
    .optional()
    .nullable(),

  descripcion_item: z
    .string({ required_error: 'Item description is required.' })
    .trim()
    .min(1,   'Item description must not be empty.')
    .max(255, 'Item description must not exceed 255 characters.'),

  cantidad: z
    .number({ required_error: 'Quantity is required.', invalid_type_error: 'cantidad must be a number.' })
    .positive('Quantity must be greater than 0.')
    .max(999999.9999, 'Quantity is too large.'),

  precio_unitario: z
    .number({ required_error: 'Unit price is required.', invalid_type_error: 'precio_unitario must be a number.' })
    .min(0, 'Unit price must be 0 or greater.')
    .max(99999999999.99, 'Unit price is too large.'),
});

// ---------------------------------------------------------------------------
// createQuotationSchema — POST /api/cotizaciones
// ---------------------------------------------------------------------------
const createQuotationSchema = z.object({
  id_cliente: z
    .number({ required_error: 'id_cliente is required.', invalid_type_error: 'id_cliente must be a number.' })
    .int('id_cliente must be an integer.')
    .positive('id_cliente must be a positive integer.'),

  descripcion: z
    .string({ required_error: 'Description is required.' })
    .trim()
    .min(1,    'Description must not be empty.')
    .max(5000, 'Description must not exceed 5000 characters.'),

  fecha_emision: z
    .string({ required_error: 'fecha_emision is required.' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha_emision must be in YYYY-MM-DD format.'),

  fecha_validez: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha_validez must be in YYYY-MM-DD format.')
    .optional()
    .nullable(),

  monto_total: z
    .number({ invalid_type_error: 'monto_total must be a number.' })
    .min(0, 'monto_total must be 0 or greater.')
    .max(99999999999.99, 'monto_total is too large.')
    .optional()
    .nullable(),

  moneda: z
    .string()
    .toUpperCase()
    .refine((v) => VALID_CURRENCIES.includes(v), {
      message: `moneda must be one of: ${VALID_CURRENCIES.join(', ')}.`,
    })
    .default('USD'),

  observaciones: z
    .string()
    .trim()
    .max(2000, 'observaciones must not exceed 2000 characters.')
    .optional()
    .nullable(),

  detalles: z
    .array(detalleItemSchema)
    .max(200, 'A quotation may not have more than 200 line items.')
    .default([]),
}).refine(
  (data) => {
    // fecha_validez must be equal to or after fecha_emision (both present)
    if (!data.fecha_validez || !data.fecha_emision) return true;
    return data.fecha_validez >= data.fecha_emision;
  },
  {
    message: 'fecha_validez must be on or after fecha_emision.',
    path: ['fecha_validez'],
  }
);

// ---------------------------------------------------------------------------
// updateStatusSchema — PUT /api/cotizaciones/:id/estado
// ---------------------------------------------------------------------------
const updateStatusSchema = z.object({
  nuevo_estado: z
    .string({ required_error: 'nuevo_estado is required.' })
    .refine((v) => VALID_STATES.includes(v), {
      message: `nuevo_estado must be one of: [${VALID_STATES.join(', ')}].`,
    }),

  observacion: z
    .string()
    .trim()
    .max(2000, 'observacion must not exceed 2000 characters.')
    .optional()
    .nullable(),
});

// ---------------------------------------------------------------------------
// approveQuotationSchema — POST /api/cotizaciones/:id/aprobar
// ---------------------------------------------------------------------------
const approveQuotationSchema = z.object({
  aprobado: z
    .boolean({ required_error: 'aprobado (boolean) is required.' }),

  // Field name MUST match what quotationController.approveQuotation reads
  // from req.body after validate() replaces it with the parsed output.
  observaciones: z
    .string()
    .trim()
    .max(2000, 'observaciones must not exceed 2000 characters.')
    .optional()
    .nullable(),
});

module.exports = {
  createQuotationSchema,
  updateStatusSchema,
  approveQuotationSchema,
};
