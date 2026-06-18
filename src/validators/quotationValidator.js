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

  // Manufacturer Part Number (Código de Parte).
  // Optional: present when the technician knows the exact part code.
  // Stored in cotizacion_detalles.codigo_parte (VARCHAR 50).
  //
  // Deduplication uses a COMPOSITE KEY of (codigo, marca_id).
  // This is a CLIENT-SIDE concern: the quotation form only merges rows when
  // BOTH the part code AND the selected brand are identical within the same
  // editing session. The backend imposes NO unique constraint on (codigo_parte,
  // marca_id) within a cotizacion, because:
  //   • Different brands (e.g. CAT vs CUMMINS) may share part numbers — those
  //     must be stored as separate line items.
  //   • Each detalle row is validated independently; every INSERT is scoped
  //     exclusively to the cotizacion_id of the current transaction.
  //   • Multiple rows with the same codigo but different marca_id in a single
  //     request are explicitly VALID and expected.
  codigo: z
    .string({ invalid_type_error: 'codigo must be a string.' })
    .trim()
    .max(50, 'codigo (Part Number) must not exceed 50 characters.')
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

  marca_id: z
    .number({ invalid_type_error: 'marca_id must be a number.' })
    .int('marca_id must be an integer.')
    .positive('marca_id must be a positive integer.')
    .optional()
    .nullable(),

  // Alternate / cross-reference part code (PDF column: CODIGO ALTERNATIVO)
  codigo_alternativo: z
    .string({ invalid_type_error: 'codigo_alternativo must be a string.' })
    .trim()
    .max(100, 'codigo_alternativo must not exceed 100 characters.')
    .optional()
    .nullable(),

  // Unit of measure for this line item (PDF column: UNI)
  unidad: z
    .string({ invalid_type_error: 'unidad must be a string.' })
    .trim()
    .max(20, 'unidad must not exceed 20 characters.')
    .optional()
    .nullable(),

  // Delivery time for this specific line (PDF column: TIEMPO DE ENTREGA)
  tiempo_entrega: z
    .string({ invalid_type_error: 'tiempo_entrega must be a string.' })
    .trim()
    .max(100, 'tiempo_entrega must not exceed 100 characters.')
    .optional()
    .nullable(),
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
    // Bolivia operates natively in Bolivianos. Executives pre-calculate all
    // prices in Excel in BOB. USD is still accepted for multi-currency records
    // but must be explicit — defaulting to BOB prevents silent currency errors.
    .default('BOB'),

  observaciones: z
    .string()
    .trim()
    .max(2000, 'observaciones must not exceed 2000 characters.')
    .optional()
    .nullable(),

  // ---------------------------------------------------------------------------
  // Requester block — DATOS DEL SOLICITANTE (physical sheet)
  // ---------------------------------------------------------------------------
  solicitante_no_solicitud: z
    .string()
    .trim()
    .max(100, 'solicitante_no_solicitud must not exceed 100 characters.')
    .optional()
    .nullable(),

  solicitante_area: z
    .string()
    .trim()
    .max(100, 'solicitante_area must not exceed 100 characters.')
    .optional()
    .nullable(),

  solicitante_celular: z
    .string()
    .trim()
    .max(30, 'solicitante_celular must not exceed 30 characters.')
    .optional()
    .nullable(),

  solicitante_correo: z
    .string()
    .trim()
    .email('solicitante_correo must be a valid email address.')
    .max(120, 'solicitante_correo must not exceed 120 characters.')
    .optional()
    .nullable(),

  // ---------------------------------------------------------------------------
  // Equipment block — DATOS DEL EQUIPO (physical sheet)
  // ---------------------------------------------------------------------------
  equipo_marca: z
    .string()
    .trim()
    .max(80, 'equipo_marca must not exceed 80 characters.')
    .optional()
    .nullable(),

  equipo_tipo: z
    .string()
    .trim()
    .max(80, 'equipo_tipo must not exceed 80 characters.')
    .optional()
    .nullable(),

  equipo_modelo: z
    .string()
    .trim()
    .max(80, 'equipo_modelo must not exceed 80 characters.')
    .optional()
    .nullable(),

  // Equipment serial number — fully optional; empty string is treated as absent.
  equipo_serie: z.preprocess(
    v => (v === '' ? null : v),
    z.string()
      .trim()
      .max(80, 'equipo_serie must not exceed 80 characters.')
      .nullable()
      .optional()
  ),

  // Engine number — fully optional; empty string is treated as absent.
  equipo_motor: z.preprocess(
    v => (v === '' ? null : v),
    z.string()
      .trim()
      .max(80, 'equipo_motor must not exceed 80 characters.')
      .nullable()
      .optional()
  ),

  // ---------------------------------------------------------------------------
  // Quotation metadata fields (physical sheet metadata box)
  // ---------------------------------------------------------------------------
  tipo_pedido: z
    .string()
    .trim()
    .max(50, 'tipo_pedido must not exceed 50 characters.')
    .optional()
    .nullable(),

  // General delivery time for the entire quotation (appears in CONDICIONES block)
  tiempo_entrega: z
    .string()
    .trim()
    .max(100, 'tiempo_entrega must not exceed 100 characters.')
    .optional()
    .nullable(),

  detalles: z
    .array(detalleItemSchema)
    .min(1, 'A quotation must contain at least one line item.')
    .max(200, 'A quotation may not have more than 200 line items.'),
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

  // Admin supervision comment — only meaningful when rol=Administracion;
  // silently ignored by the controller for all other roles.
  comentario_admin: z
    .string()
    .trim()
    .max(4000, 'comentario_admin must not exceed 4000 characters.')
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
