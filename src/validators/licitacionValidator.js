// =============================================================================
// src/validators/licitacionValidator.js
// Licitación Validation Schemas (Zod)
//
// Espejo del patrón de quotationValidator.js. Aplicado ANTES del controller vía
// el factory validate() (src/validators/validate.js).
// =============================================================================

'use strict';

const { z } = require('zod');

const VALID_STATES = [
  'En preparacion',
  'Cotizando',
  'En evaluacion',
  'Presentada',
  'Adjudicada',
  'No adjudicada',
  'Archivada',
];

const VALID_CURRENCIES = ['BOB', 'USD'];

// Fecha opcional en formato YYYY-MM-DD; cadena vacía → null.
const optionalDate = z.preprocess(
  (v) => (v === '' || v === undefined ? null : v),
  z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato YYYY-MM-DD.')
    .nullable()
);

// ---------------------------------------------------------------------------
// licitacionShape — campos compartidos entre create y update.
// ---------------------------------------------------------------------------
const licitacionShape = {
  nombre: z
    .string({ required_error: 'El nombre es obligatorio.' })
    .trim()
    .min(1,   'El nombre no puede estar vacío.')
    .max(200, 'El nombre no puede exceder 200 caracteres.'),

  id_cliente: z
    .number({ required_error: 'id_cliente es obligatorio.', invalid_type_error: 'id_cliente debe ser un número.' })
    .int('id_cliente debe ser entero.')
    .positive('id_cliente debe ser un entero positivo.'),

  descripcion: z
    .string()
    .trim()
    .max(5000, 'La descripción no puede exceder 5000 caracteres.')
    .optional()
    .nullable(),

  presupuesto_referencial: z
    .number({ invalid_type_error: 'presupuesto_referencial debe ser un número.' })
    .min(0, 'presupuesto_referencial debe ser 0 o mayor.')
    .max(9999999999999.99, 'presupuesto_referencial es demasiado grande.')
    .optional()
    .nullable(),

  moneda: z
    .string()
    .toUpperCase()
    .refine((v) => VALID_CURRENCIES.includes(v), {
      message: `moneda debe ser una de: ${VALID_CURRENCIES.join(', ')}.`,
    })
    .default('BOB'),

  fecha_limite: optionalDate,
};

// ---------------------------------------------------------------------------
// createLicitacionSchema — POST /api/licitaciones
// id_responsable es opcional en el body: el controller usa req.user.id cuando
// el creador es rol Proyectos, o el enviado cuando es Jefe/SysAdmin.
// ---------------------------------------------------------------------------
const createLicitacionSchema = z.object({
  ...licitacionShape,
  id_responsable: z
    .number({ invalid_type_error: 'id_responsable debe ser un número.' })
    .int('id_responsable debe ser entero.')
    .positive('id_responsable debe ser un entero positivo.')
    .optional()
    .nullable(),
});

// ---------------------------------------------------------------------------
// updateLicitacionSchema — PUT /api/licitaciones/:id
// Mismo contrato de cabecera; el responsable no se reasigna por esta vía.
// ---------------------------------------------------------------------------
const updateLicitacionSchema = z.object(licitacionShape);

// ---------------------------------------------------------------------------
// updateLicitacionStatusSchema — PUT /api/licitaciones/:id/estado
// 'observacion' es obligatoria cuando el desenlace es 'No adjudicada' (la
// empresa necesita registrar por qué se perdió el concurso).
// ---------------------------------------------------------------------------
const updateLicitacionStatusSchema = z
  .object({
    nuevo_estado: z
      .string({ required_error: 'nuevo_estado es obligatorio.' })
      .refine((v) => VALID_STATES.includes(v), {
        message: `nuevo_estado debe ser uno de: [${VALID_STATES.join(', ')}].`,
      }),

    observacion: z
      .string()
      .trim()
      .max(2000, 'observacion no puede exceder 2000 caracteres.')
      .optional()
      .nullable(),
  })
  .refine(
    (data) => data.nuevo_estado !== 'No adjudicada' || (data.observacion && data.observacion.trim().length > 0),
    {
      message: 'Debe indicar el motivo (observacion) al marcar la licitación como No adjudicada.',
      path: ['observacion'],
    }
  );

module.exports = {
  createLicitacionSchema,
  updateLicitacionSchema,
  updateLicitacionStatusSchema,
};
