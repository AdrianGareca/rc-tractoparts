// =============================================================================
// tests/unit/quotationReopen.test.js
// La "llave del jefe": reabrir una cotización YA CONFIRMADA.
//
// EL CASO DE NEGOCIO
// Una venta se cerró (estado 'Confirmada') y después el cliente pidió corregir
// datos. Hasta ahora el sistema era un callejón sin salida: desde 'Confirmada'
// lo único posible era archivar. La analogía que trajo el área comercial es la
// llave del jefe del supermercado — la caja se abre, pero queda constancia de
// quién la abrió y por qué.
//
// LO QUE SE PIN-EA ACÁ
//   1. Jefe y SysAdmin pueden 'Confirmada' → 'Pendiente' (vuelve a ser editable
//      por el ejecutivo dueño; no se inventa un estado nuevo).
//   2. NADIE MÁS puede — en particular un Ejecutivo con la delegación
//      can_approve_quotations, que para todo lo demás opera con la matriz del
//      Jefe. Reabrir una venta cerrada no se delega.
//   3. 'Archivada' sigue siendo terminal para todos. La llave abre la caja,
//      no resucita lo archivado.
//   4. Nada de lo que ya funcionaba se rompe.
// =============================================================================

'use strict';

const {
  validateTransitionByRole,
} = require('../../src/models/quotation/stateMachine');

const {
  isReopening,
  REOPEN_SOURCE_STATES,
  REOPEN_TARGET_STATE,
} = require('../../src/models/quotation/constants');

// ---------------------------------------------------------------------------
describe('isReopening — qué cuenta como reapertura', () => {
  test('Confirmada → Pendiente es una reapertura', () => {
    expect(isReopening('Confirmada', 'Pendiente')).toBe(true);
  });

  test('Aceptada → Pendiente también (es el alias legado de Confirmada)', () => {
    expect(isReopening('Aceptada', 'Pendiente')).toBe(true);
  });

  test('Confirmada → Archivada NO es una reapertura: es el cierre normal', () => {
    expect(isReopening('Confirmada', 'Archivada')).toBe(false);
  });

  test('Rechazada → Pendiente NO es una reapertura: eso es revertir un rechazo', () => {
    expect(isReopening('Rechazada', 'Pendiente')).toBe(false);
  });

  test('Enviada al cliente → Pendiente NO es una reapertura: es "solicitar cambios"', () => {
    expect(isReopening('Enviada al cliente', 'Pendiente')).toBe(false);
  });

  test('Archivada → Pendiente NO es una reapertura (y sigue prohibido)', () => {
    expect(isReopening('Archivada', 'Pendiente')).toBe(false);
  });

  test('las constantes describen exactamente ese par de estados', () => {
    expect(REOPEN_SOURCE_STATES).toEqual(['Confirmada', 'Aceptada']);
    expect(REOPEN_TARGET_STATE).toBe('Pendiente');
  });
});

// ---------------------------------------------------------------------------
describe('quién tiene la llave', () => {
  test.each(REOPEN_SOURCE_STATES)('el Jefe puede reabrir desde %s', (estado) => {
    const r = validateTransitionByRole(estado, 'Pendiente', 'Jefe');
    expect(r.valid).toBe(true);
  });

  test.each(REOPEN_SOURCE_STATES)('el SysAdmin puede reabrir desde %s', (estado) => {
    const r = validateTransitionByRole(estado, 'Pendiente', 'SysAdmin');
    expect(r.valid).toBe(true);
  });
});

describe('quién NO tiene la llave', () => {
  test('un Ejecutivo común no puede reabrir', () => {
    const r = validateTransitionByRole('Confirmada', 'Pendiente', 'Ejecutivo');
    expect(r.valid).toBe(false);
  });

  test('Administracion no puede reabrir', () => {
    const r = validateTransitionByRole('Confirmada', 'Pendiente', 'Administracion');
    expect(r.valid).toBe(false);
  });

  // El caso importante: la delegación (can_approve_quotations) hace que un
  // Ejecutivo opere con la matriz del Jefe. Si la llave se agregara a esa
  // matriz sin más, TODO ejecutivo delegado quedaría con poder para reabrir
  // ventas cerradas — que no es lo que pidió el negocio.
  test('un Ejecutivo CON delegación tampoco puede reabrir', () => {
    const r = validateTransitionByRole('Confirmada', 'Pendiente', 'Ejecutivo', true);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/Jefe|SysAdmin/);
  });

  test('al ejecutivo delegado NO se le ofrece Pendiente entre sus transiciones', () => {
    const r = validateTransitionByRole('Confirmada', 'Pendiente', 'Ejecutivo', true);
    expect(r.allowedTransitions).not.toContain('Pendiente');
    // …pero archivar, que sí le corresponde, se mantiene.
    expect(r.allowedTransitions).toContain('Archivada');
  });
});

// ---------------------------------------------------------------------------
describe('la llave no abre de más', () => {
  test.each(['Jefe', 'SysAdmin', 'Ejecutivo', 'Administracion'])(
    'Archivada sigue siendo terminal para %s',
    (rol) => {
      for (const destino of ['Pendiente', 'En revision', 'Confirmada', 'Aprobada internamente']) {
        expect(validateTransitionByRole('Archivada', destino, rol).valid).toBe(false);
      }
    }
  );

  test('el Jefe no puede saltar de Confirmada a un estado intermedio', () => {
    for (const destino of ['En revision', 'En espera', 'Aprobada internamente', 'Enviada al cliente', 'Rechazada']) {
      expect(validateTransitionByRole('Confirmada', destino, 'Jefe').valid).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
describe('sin regresiones en lo que ya andaba', () => {
  test('todos los roles siguen pudiendo archivar una Confirmada', () => {
    for (const rol of ['Ejecutivo', 'Administracion', 'Jefe', 'SysAdmin']) {
      expect(validateTransitionByRole('Confirmada', 'Archivada', rol).valid).toBe(true);
    }
  });

  test('el Jefe sigue pudiendo revertir un rechazo', () => {
    expect(validateTransitionByRole('Rechazada', 'Pendiente', 'Jefe').valid).toBe(true);
    expect(validateTransitionByRole('Rechazada', 'En revision', 'Jefe').valid).toBe(true);
  });

  test('el Jefe sigue pudiendo solicitar cambios sobre una enviada al cliente', () => {
    expect(validateTransitionByRole('Enviada al cliente', 'Pendiente', 'Jefe').valid).toBe(true);
  });

  test('la delegación sigue habilitando la aprobación interna', () => {
    const r = validateTransitionByRole('En revision', 'Aprobada internamente', 'Ejecutivo', true);
    expect(r.valid).toBe(true);
  });

  test('un rol desconocido sigue rebotando', () => {
    expect(validateTransitionByRole('Confirmada', 'Pendiente', 'Marketing').valid).toBe(false);
  });
});
