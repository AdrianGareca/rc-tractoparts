// =============================================================================
// tests/unit/quotationTransitionsFront.test.js
// El módulo compartido de transiciones (public/js/shared/quotationTransitions.js)
// tiene que decir EXACTAMENTE lo mismo que la máquina de estados del servidor.
//
// POR QUÉ EXISTE ESTE ARCHIVO
// El selector de estados del dashboard ofrecía los 8 estados sin filtrar por rol.
// Elegir uno inválido no hacía nada visible: el servidor devolvía 403 y el
// usuario veía un error que no podía haber previsto. Filtrar la lista en el
// front resuelve eso, pero introduce el riesgo clásico de duplicar una regla de
// negocio: que las dos copias se separen con el tiempo.
//
// El bloque final recorre TODAS las combinaciones rol × estado × destino y exige
// que el front y el back coincidan en cada una. Si alguien toca una matriz y no
// la otra, este test lo dice con nombre y apellido.
//
// (Mismo criterio que quotationTotalsFront.test.js con la matemática del dinero.)
// =============================================================================

import {
  ROLE_TRANSITIONS as FRONT_MATRIX,
  allowedTransitions,
  isReopening as isReopeningFront,
  REOPEN_SOURCE_STATES as FRONT_REOPEN_SOURCES,
  REOPEN_TARGET_STATE as FRONT_REOPEN_TARGET,
} from '../../public/js/shared/quotationTransitions.js';

const {
  ROLE_TRANSITIONS: BACK_MATRIX,
  VALID_STATES,
  isReopening: isReopeningBack,
  REOPEN_SOURCE_STATES: BACK_REOPEN_SOURCES,
  REOPEN_TARGET_STATE: BACK_REOPEN_TARGET,
} = require('../../src/models/quotation/constants');

const { validateTransitionByRole } = require('../../src/models/quotation/stateMachine');

const ROLES = ['Ejecutivo', 'Administracion', 'Jefe', 'SysAdmin'];

// ---------------------------------------------------------------------------
describe('la matriz del front es copia fiel de la del back', () => {
  test('mismos roles', () => {
    expect(Object.keys(FRONT_MATRIX).sort()).toEqual(Object.keys(BACK_MATRIX).sort());
  });

  test.each(ROLES)('%s — mismos estados de origen y mismos destinos', (rol) => {
    expect(FRONT_MATRIX[rol]).toEqual(BACK_MATRIX[rol]);
  });

  test('mismas constantes de reapertura', () => {
    expect(FRONT_REOPEN_SOURCES).toEqual(BACK_REOPEN_SOURCES);
    expect(FRONT_REOPEN_TARGET).toBe(BACK_REOPEN_TARGET);
  });

  test.each(VALID_STATES)('isReopening coincide para el origen %s', (origen) => {
    for (const destino of VALID_STATES) {
      expect(isReopeningFront(origen, destino)).toBe(isReopeningBack(origen, destino));
    }
  });
});

// ---------------------------------------------------------------------------
// La garantía antidivergencia: para cada combinación posible, lo que el front
// le OFRECE al usuario tiene que ser exactamente lo que el back le ACEPTA.
// ---------------------------------------------------------------------------
describe('lo que ofrece el front es lo que acepta el back', () => {
  const escenarios = [];
  for (const rol of ROLES) {
    for (const delegado of [false, true]) {
      // La delegación sólo aplica al Ejecutivo; para el resto es ruido.
      if (delegado && rol !== 'Ejecutivo') continue;
      escenarios.push([rol, delegado]);
    }
  }

  test.each(escenarios)('%s (delegado=%s)', (rol, delegado) => {
    for (const origen of VALID_STATES) {
      const ofrecidos = allowedTransitions(rol, origen, delegado);

      for (const destino of VALID_STATES) {
        if (destino === origen) continue;   // el controller ya rebota esto con 422

        const backAcepta  = validateTransitionByRole(origen, destino, rol, delegado).valid;
        const frontOfrece = ofrecidos.includes(destino);

        if (backAcepta !== frontOfrece) {
          throw new Error(
            `Desincronización para ${rol}${delegado ? ' (delegado)' : ''}: ` +
            `'${origen}' → '${destino}' — el back ${backAcepta ? 'lo acepta' : 'lo rechaza'} ` +
            `pero el front ${frontOfrece ? 'lo ofrece' : 'no lo ofrece'}.`
          );
        }
      }
    }
  });

  test('un rol desconocido no ofrece nada (en vez de romper la pantalla)', () => {
    expect(allowedTransitions('Marketing', 'Pendiente')).toEqual([]);
  });

  test('desde Archivada no se ofrece nada a nadie', () => {
    for (const rol of ROLES) {
      expect(allowedTransitions(rol, 'Archivada')).toEqual([]);
    }
  });

  test('un estado inexistente no ofrece nada', () => {
    expect(allowedTransitions('Jefe', 'Borrador')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('la llave, vista desde el front', () => {
  test('el Jefe ve Pendiente entre sus opciones sobre una Confirmada', () => {
    expect(allowedTransitions('Jefe', 'Confirmada')).toContain('Pendiente');
  });

  test('el SysAdmin también', () => {
    expect(allowedTransitions('SysAdmin', 'Confirmada')).toContain('Pendiente');
  });

  test('el ejecutivo delegado ve archivar pero NO reabrir', () => {
    const opciones = allowedTransitions('Ejecutivo', 'Confirmada', true);
    expect(opciones).toContain('Archivada');
    expect(opciones).not.toContain('Pendiente');
  });
});
