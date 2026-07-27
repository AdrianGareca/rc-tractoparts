// =============================================================================
// tests/unit/licitacionPermissions.test.js
// Red de seguridad de la matriz de permisos de licitaciones (lado cliente).
//
// Es lógica de AUTORIZACIÓN y no tenía ningún test. El backend revalida, así
// que una divergencia no abre un agujero de seguridad — pero sí produce el peor
// tipo de bug de UX: el usuario ve un botón, lo aprieta y recibe un 403 sin
// explicación. Y al revés, un botón que falta le bloquea trabajo legítimo.
// =============================================================================

'use strict';

jest.mock('../../public/js/services/authSession.js', () => ({
  __esModule: true,
  default: { getRole: jest.fn(), getUserId: jest.fn(), canApproveQuotations: jest.fn() },
}));

import {
  ESTADOS,
  TRANSITIONS,
  EDITABLE_STATES,
  GASTO_STATES,
  resolveActorType,
  allowedTransitions,
  canManageGastos,
  isEditable,
  showsGastos,
} from '../../public/js/views/dashboard/modules/licitacion/permissions.js';

const lic = (estado, id_responsable = 7) => ({ estado, id_responsable });

const jefe        = { role: 'Jefe',          userId: 1, canApprove: false };
const sysadmin    = { role: 'SysAdmin',      userId: 2, canApprove: false };
const responsable = { role: 'Proyectos',     userId: 7, canApprove: false };
const otroProy    = { role: 'Proyectos',     userId: 8, canApprove: false };
const delegado    = { role: 'Ejecutivo',     userId: 3, canApprove: true  };
const ejecutivo   = { role: 'Ejecutivo',     userId: 4, canApprove: false };
const admin       = { role: 'Administracion', userId: 5, canApprove: false };

describe('resolveActorType', () => {
  test('Jefe y SysAdmin son "jefe" en cualquier licitación', () => {
    expect(resolveActorType(lic('Cotizando'), jefe)).toBe('jefe');
    expect(resolveActorType(lic('Cotizando'), sysadmin)).toBe('jefe');
  });

  test('Proyectos es "responsable" SOLO en las suyas', () => {
    expect(resolveActorType(lic('Cotizando', 7), responsable)).toBe('responsable');
    expect(resolveActorType(lic('Cotizando', 7), otroProy)).toBeNull();
  });

  test('un Ejecutivo delegado es "delegado"', () => {
    expect(resolveActorType(lic('Cotizando'), delegado)).toBe('delegado');
  });

  test('un Ejecutivo SIN delegación es solo lectura', () => {
    expect(resolveActorType(lic('Cotizando'), ejecutivo)).toBeNull();
  });

  test('Administración es solo lectura para las transiciones', () => {
    expect(resolveActorType(lic('Cotizando'), admin)).toBeNull();
  });

  test('sin usuario es solo lectura', () => {
    expect(resolveActorType(lic('Cotizando'), undefined)).toBeNull();
    expect(resolveActorType(lic('Cotizando'), {})).toBeNull();
  });

  test('el privilegio de Jefe no depende de ser responsable', () => {
    expect(resolveActorType(lic('Cotizando', 999), jefe)).toBe('jefe');
  });
});

describe('allowedTransitions — responsable Proyectos', () => {
  test('puede mandar a Cotizando o archivar desde preparación', () => {
    expect(allowedTransitions(lic('En preparacion'), responsable))
      .toEqual(['Cotizando', 'Archivada']);
  });

  test('puede volver atrás desde Cotizando', () => {
    expect(allowedTransitions(lic('Cotizando'), responsable))
      .toContain('En preparacion');
  });

  test('decide el resultado desde Presentada', () => {
    expect(allowedTransitions(lic('Presentada'), responsable))
      .toEqual(['Adjudicada', 'No adjudicada']);
  });

  test('Archivada es terminal', () => {
    expect(allowedTransitions(lic('Archivada'), responsable)).toEqual([]);
  });
});

describe('allowedTransitions — ejecutivo delegado', () => {
  test('solo puede avanzar desde Cotizando, que es su handoff', () => {
    expect(allowedTransitions(lic('Cotizando'), delegado)).toEqual(['En evaluacion']);
  });

  test('no puede tocar una licitación en preparación', () => {
    expect(allowedTransitions(lic('En preparacion'), delegado)).toEqual([]);
  });

  test('NO puede adjudicar ni declarar perdida', () => {
    expect(allowedTransitions(lic('Presentada'), delegado)).toEqual([]);
  });

  test('un ejecutivo sin delegación no puede nada', () => {
    ESTADOS.forEach((e) => expect(allowedTransitions(lic(e), ejecutivo)).toEqual([]));
  });
});

describe('allowedTransitions — Jefe', () => {
  test('puede mover a casi cualquier estado desde los activos', () => {
    expect(allowedTransitions(lic('En preparacion'), jefe).length).toBe(6);
  });

  test('puede corregir una adjudicación equivocada', () => {
    expect(allowedTransitions(lic('Adjudicada'), jefe)).toContain('No adjudicada');
    expect(allowedTransitions(lic('No adjudicada'), jefe)).toContain('Adjudicada');
  });

  test('ni el Jefe puede desarchivar', () => {
    expect(allowedTransitions(lic('Archivada'), jefe)).toEqual([]);
  });
});

describe('allowedTransitions — invariantes de la matriz', () => {
  test('ningún actor puede transicionar al MISMO estado', () => {
    Object.entries(TRANSITIONS).forEach(([actor, matriz]) => {
      Object.entries(matriz).forEach(([desde, hacia]) => {
        expect(hacia).not.toContain(desde);
      });
    });
  });

  test('todos los destinos son estados válidos', () => {
    Object.values(TRANSITIONS).forEach((matriz) => {
      Object.values(matriz).forEach((hacia) => {
        hacia.forEach((e) => expect(ESTADOS).toContain(e));
      });
    });
  });

  test('las tres matrices cubren los 7 estados', () => {
    Object.values(TRANSITIONS).forEach((matriz) => {
      expect(Object.keys(matriz).sort()).toEqual([...ESTADOS].sort());
    });
  });

  test('el delegado nunca puede más que el responsable', () => {
    // El ejecutivo delegado colabora en el tramo comercial; no debe superar al
    // dueno de la licitacion en ningun estado.
    ESTADOS.forEach((e) => {
      TRANSITIONS.delegado[e].forEach((destino) => {
        expect(TRANSITIONS.responsable[e]).toContain(destino);
      });
    });
  });

  test('Archivada es terminal para todos', () => {
    Object.values(TRANSITIONS).forEach((m) => expect(m['Archivada']).toEqual([]));
  });

  test('un estado desconocido no rompe: devuelve lista vacía', () => {
    expect(allowedTransitions(lic('Estado Inventado'), jefe)).toEqual([]);
  });
});

describe('canManageGastos', () => {
  test('Administración SÍ puede, aunque sea solo lectura para el resto', () => {
    expect(canManageGastos(lic('Adjudicada'), admin)).toBe(true);
    expect(resolveActorType(lic('Adjudicada'), admin)).toBeNull();
  });

  test('Jefe y SysAdmin pueden', () => {
    expect(canManageGastos(lic('Adjudicada'), jefe)).toBe(true);
    expect(canManageGastos(lic('Adjudicada'), sysadmin)).toBe(true);
  });

  test('Proyectos solo en SUS licitaciones', () => {
    expect(canManageGastos(lic('Adjudicada', 7), responsable)).toBe(true);
    expect(canManageGastos(lic('Adjudicada', 7), otroProy)).toBe(false);
  });

  test('un ejecutivo, ni delegado, puede tocar gastos', () => {
    expect(canManageGastos(lic('Adjudicada'), delegado)).toBe(false);
    expect(canManageGastos(lic('Adjudicada'), ejecutivo)).toBe(false);
  });

  test('sin usuario no puede', () => {
    expect(canManageGastos(lic('Adjudicada'), undefined)).toBe(false);
  });
});

describe('isEditable / showsGastos', () => {
  test('la cabecera se edita en preparación y cotizando', () => {
    expect(isEditable(lic('En preparacion'))).toBe(true);
    expect(isEditable(lic('Cotizando'))).toBe(true);
  });

  test('una vez presentada ya no se edita', () => {
    ['En evaluacion', 'Presentada', 'Adjudicada', 'No adjudicada', 'Archivada']
      .forEach((e) => expect(isEditable(lic(e))).toBe(false));
  });

  test('los gastos aparecen recién tras adjudicar', () => {
    expect(showsGastos(lic('Adjudicada'))).toBe(true);
    expect(showsGastos(lic('Archivada'))).toBe(true);
    expect(showsGastos(lic('Presentada'))).toBe(false);
    expect(showsGastos(lic('Cotizando'))).toBe(false);
  });

  test('los estados editables y los de gastos no se solapan', () => {
    EDITABLE_STATES.forEach((e) => expect(GASTO_STATES).not.toContain(e));
  });
});
