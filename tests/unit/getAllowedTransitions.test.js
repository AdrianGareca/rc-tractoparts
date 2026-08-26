// =============================================================================
// tests/unit/getAllowedTransitions.test.js
// La lista de "a dónde puedo ir desde acá" para un rol, sin validar un
// destino puntual.
//
// EL BUG QUE ESTO CUBRE
// PUT /:id/estado devolvía `allowed_transitions` calculada sobre el estado
// VIEJO de la cotización (el que tenía ANTES de la transición que se acaba de
// hacer), no sobre el nuevo. La pantalla podía terminar ofreciendo un botón
// que iba a dar 403 al tocarlo. Encontrado en la ronda de estrés del
// 2026-08-25.
//
// getAllowedTransitions(estado, rol, canApproveQuotations) es el cálculo que
// reemplaza eso: se llama con el estado NUEVO, después de confirmada la
// escritura. Reproduce a propósito los dos casos especiales de
// validateTransitionByRole (el recorte de la llave del jefe y el bono de la
// delegación de aprobación) para que las dos listas nunca diverjan.
// =============================================================================

'use strict';

const { getAllowedTransitions } = require('../../src/models/quotation/stateMachine');

describe('getAllowedTransitions — pasa la matriz tal cual en el caso normal', () => {
  test('Ejecutivo desde Pendiente', () => {
    expect(getAllowedTransitions('Pendiente', 'Ejecutivo')).toEqual(['En revision', 'Archivada']);
  });

  test('un estado sin entrada en la matriz del rol da lista vacía (terminal)', () => {
    expect(getAllowedTransitions('Archivada', 'Ejecutivo')).toEqual([]);
  });

  test('un rol no reconocido da lista vacía en vez de romper', () => {
    expect(getAllowedTransitions('Pendiente', 'RolInventado')).toEqual([]);
  });
});

describe('getAllowedTransitions — el bug real: dos estados dan dos listas distintas', () => {
  test('Jefe desde Pendiente y Jefe desde "En revision" no son la misma lista', () => {
    const desdePendiente   = getAllowedTransitions('Pendiente', 'Jefe');
    const desdeEnRevision  = getAllowedTransitions('En revision', 'Jefe');

    expect(desdePendiente).not.toEqual(desdeEnRevision);
    // La combinación puntual que reprodujo el hallazgo: tras Pendiente -> 'En
    // revision', la lista para el estado nuevo YA NO debe ofrecer 'En
    // revision' como destino (no tiene sentido "transicionar a donde ya se
    // está" — y es señal de que efectivamente se recalculó sobre el estado
    // nuevo y no sobre el viejo).
    expect(desdeEnRevision).not.toContain('En revision');
    expect(desdePendiente).toContain('En revision');
  });
});

describe('getAllowedTransitions — la llave del jefe no se delega', () => {
  test('Jefe y SysAdmin ven "Pendiente" desde Confirmada (pueden reabrir)', () => {
    expect(getAllowedTransitions('Confirmada', 'Jefe')).toContain('Pendiente');
    expect(getAllowedTransitions('Confirmada', 'SysAdmin')).toContain('Pendiente');
  });

  test('un Ejecutivo delegado NO ve "Pendiente" desde Confirmada, aunque opere con la matriz de Jefe', () => {
    const lista = getAllowedTransitions('Confirmada', 'Ejecutivo', true);
    expect(lista).not.toContain('Pendiente');
    expect(lista).toContain('Archivada');
  });

  test('Administracion (sin la llave) tampoco la ve', () => {
    expect(getAllowedTransitions('Confirmada', 'Administracion')).not.toContain('Pendiente');
  });
});

describe('getAllowedTransitions — el bono de la delegación de aprobación', () => {
  test('Administracion normal no puede llegar a "Aprobada internamente"', () => {
    expect(getAllowedTransitions('Pendiente', 'Administracion')).not.toContain('Aprobada internamente');
  });

  test('Administracion CON la delegación sí la ve, sin perder el resto de su matriz', () => {
    const lista = getAllowedTransitions('Pendiente', 'Administracion', true);
    expect(lista).toContain('Aprobada internamente');
    expect(lista).toEqual(expect.arrayContaining(['En revision', 'En espera', 'Archivada']));
  });

  test('el bono no aparece fuera de los estados de origen válidos para aprobar', () => {
    // 'Enviada al cliente' no es un APPROVAL_SOURCE_STATE — aprobar desde ahí
    // no tiene sentido de negocio (ya se envió).
    expect(getAllowedTransitions('Enviada al cliente', 'Administracion', true)).not.toContain('Aprobada internamente');
  });
});
