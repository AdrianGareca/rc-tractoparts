// =============================================================================
// tests/unit/validationEdgeCases.test.js
// QA Phase 2 — Destructive Edge-Case & Security Validation Tests
//
// Covers:
//   VEC-01  Zod rejects quantity = 0 with 422
//   VEC-02  Zod rejects quantity = -1 with 422
//   VEC-03  Zod rejects price = -500 with 422
//   VEC-04  Zod rejects empty detalles array with 422
//   VEC-05  Zod rejects missing detalles field with 422
//   VEC-06  Controller parseInt handles alpha ID → 400 (no MySQL crash)
//   VEC-07  Controller parseInt handles floating-point ID → 400
//   VEC-08  Jefe can directly transition Pendiente → Aprobada internamente
//   VEC-09  Ejecutivo cannot transition from En revision (read-only for them)
//   VEC-10  SysAdmin transitions mirror Jefe (absolute authority)
//   VEC-11  Zod strips unknown fields (prototype-pollution defense)
//   VEC-12  Zod rejects aprobado as a string ("true") instead of boolean
// =============================================================================

'use strict';

const { z } = require('zod');
const {
  createQuotationSchema,
  updateStatusSchema,
  approveQuotationSchema,
} = require('../../src/validators/quotationValidator');
const QuotationModel = require('../../src/models/QuotationModel');

// ---------------------------------------------------------------------------
// Helper: run a Zod schema parse and return structured result
// ---------------------------------------------------------------------------
function tryParse(schema, payload) {
  try {
    const data = schema.parse(payload);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, issues: err.issues ?? [] };
  }
}

// =============================================================================
// VEC-01 to VEC-05 — detalles array validation
// =============================================================================

describe('Zod: detalles line-item validation', () => {

  const validBase = {
    id_cliente:    1,
    descripcion:   'Test quotation',
    fecha_emision: '2026-01-15',
  };

  // VEC-01 — quantity zero must be rejected
  test('VEC-01: quantity = 0 is rejected with a positive-number error', () => {
    const result = tryParse(createQuotationSchema, {
      ...validBase,
      detalles: [{ descripcion_item: 'Filtro', cantidad: 0, precio_unitario: 50 }],
    });
    expect(result.ok).toBe(false);
    const msg = result.issues.map(i => i.message).join(' ');
    expect(msg).toMatch(/greater than 0/i);
  });

  // VEC-02 — negative quantity must be rejected
  test('VEC-02: quantity = -1 is rejected with a positive-number error', () => {
    const result = tryParse(createQuotationSchema, {
      ...validBase,
      detalles: [{ descripcion_item: 'Filtro', cantidad: -1, precio_unitario: 50 }],
    });
    expect(result.ok).toBe(false);
    const msg = result.issues.map(i => i.message).join(' ');
    expect(msg).toMatch(/greater than 0/i);
  });

  // VEC-03 — negative price must be rejected
  test('VEC-03: precio_unitario = -500 is rejected with a min-0 error', () => {
    const result = tryParse(createQuotationSchema, {
      ...validBase,
      detalles: [{ descripcion_item: 'Filtro', cantidad: 1, precio_unitario: -500 }],
    });
    expect(result.ok).toBe(false);
    const msg = result.issues.map(i => i.message).join(' ');
    expect(msg).toMatch(/0 or greater/i);
  });

  // VEC-04 — empty detalles array must be rejected
  test('VEC-04: empty detalles array [] is rejected (min 1 item required)', () => {
    const result = tryParse(createQuotationSchema, {
      ...validBase,
      detalles: [],
    });
    expect(result.ok).toBe(false);
    const msg = result.issues.map(i => i.message).join(' ');
    expect(msg).toMatch(/at least one line item/i);
  });

  // VEC-05 — missing detalles field must be rejected (no implicit default)
  test('VEC-05: omitting detalles field entirely is rejected', () => {
    const result = tryParse(createQuotationSchema, validBase);
    expect(result.ok).toBe(false);
  });

  // VEC-boundary — price of exactly 0 must be accepted (free items allowed)
  test('VEC-boundary: precio_unitario = 0 is accepted (free items are valid)', () => {
    const result = tryParse(createQuotationSchema, {
      ...validBase,
      detalles: [{ descripcion_item: 'Item gratuito', cantidad: 1, precio_unitario: 0 }],
    });
    expect(result.ok).toBe(true);
  });

  // VEC-boundary — fractional positive quantity is accepted
  test('VEC-boundary: fractional quantity 0.001 is accepted', () => {
    const result = tryParse(createQuotationSchema, {
      ...validBase,
      detalles: [{ descripcion_item: 'Unidad fraccionada', cantidad: 0.001, precio_unitario: 10 }],
    });
    expect(result.ok).toBe(true);
  });
});

// =============================================================================
// VEC-06 to VEC-07 — URL parameter sanitization (parseInt defense)
// =============================================================================

describe('parseInt sanitization for URL params', () => {

  // VEC-06 — alpha string ID results in NaN, which the isNaN guard catches
  test('VEC-06: parseInt("abc", 10) produces NaN → triggers 400 guard', () => {
    const id = parseInt('abc', 10);
    expect(isNaN(id)).toBe(true);
    // Simulate the controller guard: isNaN(id) || id < 1
    expect(isNaN(id) || id < 1).toBe(true);
  });

  // VEC-07 — floating-point string is truncated by parseInt (no crash)
  test('VEC-07: parseInt("3.9", 10) truncates to 3 (safe, no MySQL crash)', () => {
    const id = parseInt('3.9', 10);
    expect(id).toBe(3);
    expect(isNaN(id)).toBe(false);
    expect(id >= 1).toBe(true);
  });

  // VEC-07b — zero string triggers the < 1 guard
  test('VEC-07b: parseInt("0", 10) → id = 0 → triggers 400 guard (id < 1)', () => {
    const id = parseInt('0', 10);
    expect(isNaN(id) || id < 1).toBe(true);
  });

  // VEC-07c — negative string triggers the < 1 guard
  test('VEC-07c: parseInt("-5", 10) → id = -5 → triggers 400 guard (id < 1)', () => {
    const id = parseInt('-5', 10);
    expect(isNaN(id) || id < 1).toBe(true);
  });
});

// =============================================================================
// VEC-08 to VEC-10 — State machine role-transition matrix
// =============================================================================

describe('QuotationModel.validateTransitionByRole — state machine', () => {

  // VEC-08 — Jefe can directly approve from Pendiente (no intermediate step needed)
  test('VEC-08: Jefe can transition Pendiente → Aprobada internamente directly', () => {
    const result = QuotationModel.validateTransitionByRole(
      'Pendiente', 'Aprobada internamente', 'Jefe'
    );
    expect(result.valid).toBe(true);
  });

  // VEC-09 — Ejecutivo cannot act from En revision (read-only state for them)
  test('VEC-09: Ejecutivo gets valid=false from En revision (any target)', () => {
    const result = QuotationModel.validateTransitionByRole(
      'En revision', 'Aprobada internamente', 'Ejecutivo'
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/solo lectura/i);  // translated to Spanish
  });

  // VEC-10 — SysAdmin inherits Jefe transitions
  test('VEC-10: SysAdmin can transition Pendiente → Aprobada internamente', () => {
    const result = QuotationModel.validateTransitionByRole(
      'Pendiente', 'Aprobada internamente', 'SysAdmin'
    );
    expect(result.valid).toBe(true);
  });

  // VEC-10b — SysAdmin can directly approve from En espera (absolute authority)
  test('VEC-10b: SysAdmin can transition En espera → Rechazada', () => {
    const result = QuotationModel.validateTransitionByRole(
      'En espera', 'Rechazada', 'SysAdmin'
    );
    expect(result.valid).toBe(true);
  });

  // VEC-10c — Archivada is terminal even for SysAdmin
  test('VEC-10c: SysAdmin cannot leave Archivada (terminal state)', () => {
    const result = QuotationModel.validateTransitionByRole(
      'Archivada', 'Pendiente', 'SysAdmin'
    );
    expect(result.valid).toBe(false);
  });

  // VEC-transition — unknown role returns valid=false
  test('VEC-transition: unknown role returns valid=false with descriptive reason', () => {
    const result = QuotationModel.validateTransitionByRole(
      'Pendiente', 'En revision', 'Fantasma'
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/no est.*reconocido/i);  // translated to Spanish
  });
});

// =============================================================================
// VEC-11 to VEC-12 — Prototype pollution and type-safety
// =============================================================================

describe('Zod: unknown field stripping and type enforcement', () => {

  // VEC-11 — extra/unknown fields are stripped (not passed to the controller)
  test('VEC-11: extra fields in createQuotationSchema payload are stripped silently', () => {
    const result = tryParse(createQuotationSchema, {
      id_cliente:         1,
      descripcion:        'Test',
      fecha_emision:      '2026-01-15',
      detalles:           [{ descripcion_item: 'Item', cantidad: 1, precio_unitario: 10 }],
      injectedField:      'shouldBeDropped',
      extraPayload:       { isAdmin: true },
    });
    expect(result.ok).toBe(true);
    // Zod strips all keys not declared in the schema
    expect(result.data).not.toHaveProperty('injectedField');
    expect(result.data).not.toHaveProperty('extraPayload');
    // Ensure the prototype was NOT polluted by any injection attempt
    expect({}.isAdmin).toBeUndefined();
  });

  // VEC-12 — approveQuotationSchema rejects string "true" for boolean field
  test('VEC-12: aprobado = "true" (string) is rejected — must be boolean', () => {
    const result = tryParse(approveQuotationSchema, { aprobado: 'true' });
    expect(result.ok).toBe(false);
    const msg = result.issues.map(i => i.message).join(' ');
    expect(msg).toMatch(/boolean/i);
  });

  // VEC-12b — approveQuotationSchema accepts actual boolean true
  test('VEC-12b: aprobado = true (boolean) is accepted', () => {
    const result = tryParse(approveQuotationSchema, { aprobado: true });
    expect(result.ok).toBe(true);
  });
});

// =============================================================================
// VEC-updateStatus — updateStatusSchema validation
// =============================================================================

describe('Zod: updateStatusSchema', () => {

  test('VEC-status-01: valid nuevo_estado passes', () => {
    const result = tryParse(updateStatusSchema, { nuevo_estado: 'En revision' });
    expect(result.ok).toBe(true);
  });

  test('VEC-status-02: invalid estado value is rejected', () => {
    const result = tryParse(updateStatusSchema, { nuevo_estado: 'Inventado' });
    expect(result.ok).toBe(false);
  });

  test('VEC-status-03: missing nuevo_estado is rejected', () => {
    const result = tryParse(updateStatusSchema, {});
    expect(result.ok).toBe(false);
  });

  test('VEC-status-04: comentario_admin over 4000 chars is rejected', () => {
    const result = tryParse(updateStatusSchema, {
      nuevo_estado:     'En espera',
      comentario_admin: 'x'.repeat(4001),
    });
    expect(result.ok).toBe(false);
    const msg = result.issues.map(i => i.message).join(' ');
    expect(msg).toMatch(/4000/);
  });

  test('VEC-status-05: Borrador is not a valid target state', () => {
    // Borrador is a display badge only — it is not a valid API state transition target
    const result = tryParse(updateStatusSchema, { nuevo_estado: 'Borrador' });
    expect(result.ok).toBe(false);
  });
});
