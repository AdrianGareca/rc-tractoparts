// =============================================================================
// tests/unit/quotationFieldErrors.test.js
// Bug 3.1 — mapping backend/Zod field errors to the quotation form.
//
// The submit handler used to do `querySelector('#err-' + field)` directly. For a
// nested line-item path like `detalles.0.cantidad` that string is an INVALID CSS
// id selector (the '.' starts a class), so querySelector THREW — inside the catch
// block — aborting it before the general error alert was ever shown. Combined
// with the (now-fixed) lack of client-side item validation, the user saw the
// button re-enable with NO error message at all.
//
// These tests pin the pure mapping helpers: header fields resolve to their span
// id; nested/unknown paths resolve to null (→ surfaced in the general alert),
// and NOTHING ever produces an invalid selector or throws.
// =============================================================================

import { headerErrorElementId, mapFieldErrors } from '../../public/js/shared/quotationFieldErrors.js';

describe('headerErrorElementId', () => {
  test('maps known header fields to their #err-* span id', () => {
    expect(headerErrorElementId('id_cliente')).toBe('err-cliente');
    expect(headerErrorElementId('descripcion')).toBe('err-descripcion');
    expect(headerErrorElementId('fecha_emision')).toBe('err-fecha');
    expect(headerErrorElementId('fecha_validez')).toBe('err-validez');
  });

  test('returns null for nested line-item paths (no dedicated span, must NOT throw)', () => {
    expect(headerErrorElementId('detalles.0.cantidad')).toBeNull();
    expect(headerErrorElementId('detalles[0].precio_unitario')).toBeNull();
  });

  test('returns null for unknown / empty fields', () => {
    expect(headerErrorElementId('algo_raro')).toBeNull();
    expect(headerErrorElementId(undefined)).toBeNull();
    expect(headerErrorElementId(null)).toBeNull();
  });

  test('every returned id is a valid CSS id selector (no dots/brackets)', () => {
    const inputs = ['id_cliente', 'descripcion', 'fecha_emision', 'fecha_validez', 'detalles.0.cantidad'];
    for (const f of inputs) {
      const id = headerErrorElementId(f);
      if (id !== null) {
        // A selector-safe id: starts with a letter, only word chars / hyphens.
        // `#${id}` would never make querySelector throw.
        expect(id).toMatch(/^[a-zA-Z][\w-]*$/);
      }
    }
  });
});

describe('mapFieldErrors', () => {
  test('splits errors into per-field (header) and general (line-item / unknown)', () => {
    const { perField, general } = mapFieldErrors([
      { field: 'id_cliente',        message: 'Cliente requerido.' },
      { field: 'detalles.0.cantidad', message: 'La cantidad debe ser mayor a 0.' },
      { field: 'fecha_validez',     message: 'Fecha de validez inválida.' },
    ]);

    expect(perField).toEqual([
      { id: 'err-cliente', message: 'Cliente requerido.' },
      { id: 'err-validez', message: 'Fecha de validez inválida.' },
    ]);
    expect(general).toEqual(['La cantidad debe ser mayor a 0.']);
  });

  test('a line-item error still surfaces (in general) instead of being swallowed', () => {
    const { perField, general } = mapFieldErrors([
      { field: 'detalles.2.precio_unitario', message: 'El precio no puede ser negativo.' },
    ]);
    expect(perField).toEqual([]);
    expect(general).toEqual(['El precio no puede ser negativo.']);
  });

  test('tolerates non-array / empty / malformed input without throwing', () => {
    expect(mapFieldErrors(undefined)).toEqual({ perField: [], general: [] });
    expect(mapFieldErrors([])).toEqual({ perField: [], general: [] });
    expect(mapFieldErrors([{ message: 'sin field' }])).toEqual({ perField: [], general: ['sin field'] });
    expect(mapFieldErrors([{ field: 'x' }])).toEqual({ perField: [], general: [] }); // no message → dropped
  });
});
