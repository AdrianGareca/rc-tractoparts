// =============================================================================
// tests/unit/marcasParecidas.test.js
// Reconocer la marca escrita en una planilla contra el catálogo real.
//
// POR QUÉ EL CATÁLOGO DE ABAJO ES EL DE PRODUCCIÓN
// Las reglas de parecido (prefijo, errores de tipeo) se prueban contra las 54
// marcas que había en producción el 2026-09-11, no contra tres inventadas.
// Es donde conviven CAT, Caterpillar, CAT - BRASIL, CAT - USA y CAT-REMAN, y
// marcas de tres letras (FAG, FAW, SKF…) a una letra de distancia entre sí:
// justo los casos donde una regla demasiado generosa sugeriría cualquier cosa.
// =============================================================================

'use strict';

import {
  normalizarMarca, distanciaEdicion, buscarMarcaExacta, marcasParecidas, resolverMarcas,
} from '../../public/js/views/quotationForm/marcasParecidas.js';

const CATALOGO = [
  [36, 'ABB'], [12, 'AGRALE'], [8, 'Alternativo'], [46, 'BOSCH'], [29, 'BOSCH REXROTH'],
  [42, 'CARRARO'], [6, 'Case'], [11, 'CAT'], [25, 'CAT - BRASIL'], [26, 'CAT - USA'],
  [51, 'CAT-REMAN'], [1, 'Caterpillar'], [38, 'CNH'], [16, 'CTP'], [5, 'Cummins'],
  [19, 'DEUTZ'], [15, 'DISA'], [41, 'DODGE'], [34, 'EURORICAMBI'], [13, 'FAG'],
  [18, 'FAST'], [49, 'FAW'], [30, 'FORD'], [14, 'GATES'], [44, 'GEARWRENCH'],
  [39, 'GHINASSI'], [28, 'HINO'], [23, 'HYUNDAI'], [17, 'ITR'], [7, 'JCB'],
  [3, 'John Deere'], [2, 'Komatsu'], [32, 'KOYO'], [22, 'KUBOTA'], [52, 'LOCTITE'],
  [47, 'LUK'], [20, 'MARCHETTI'], [50, 'MASTER'], [54, 'MASTER POWER'],
  [35, 'MEGADYNE ESAFLEX'], [43, 'MTW'], [21, 'NEW HOLLAND'], [10, 'OEM HIGH QUALITY'],
  [33, 'PARKER HAMM'], [24, 'RACOR'], [53, 'SAFRAMAX'], [37, 'SKF'], [40, 'TIMKEN'],
  [45, 'TOYOTA'], [27, 'VALVOLINE'], [31, 'VAPORMATIC'], [4, 'Volvo'], [9, 'Waukesha'],
  [48, 'WEICHAI'],
].map(([id, nombre]) => ({ id, nombre }));

const ids = (marcas) => marcas.map((m) => m.id);

describe('el catálogo de prueba es el de producción', () => {
  test('tiene las 54 marcas', () => {
    expect(CATALOGO).toHaveLength(54);
  });
});

describe('normalizarMarca', () => {
  test.each([
    ['CAT - BRASIL', 'CAT BRASIL'],
    ['cat-brasil',   'CAT BRASIL'],
    ['  CAT   USA ', 'CAT USA'],
    ['Caterpillar',  'CATERPILLAR'],
    ['Núñez',        'NUNEZ'],
    [null,           ''],
  ])('%s -> %s', (entrada, esperado) => {
    expect(normalizarMarca(entrada)).toBe(esperado);
  });
});

describe('distanciaEdicion', () => {
  test.each([
    ['CATERPILLER', 'CATERPILLAR', 1],
    ['KOMATZU',     'KOMATSU',     1],
    ['ABC',         'ABC',         0],
    ['',            'ABC',         3],
    ['FAG',         'FAW',         1],
  ])('%s / %s = %i', (a, b, esperado) => {
    expect(distanciaEdicion(a, b)).toBe(esperado);
  });
});

describe('buscarMarcaExacta — la marca que ES la escrita', () => {
  test('«CATERPILLAR» de la planilla real es Caterpillar', () => {
    expect(buscarMarcaExacta('CATERPILLAR', CATALOGO).id).toBe(1);
  });

  test('«CAT» es CAT y NO Caterpillar', () => {
    // La decisión de Adrian: el PDF imprime la marca como la eligió el
    // vendedor. Andrés escribe CAT y sus clientes reconocen CAT. Si esto
    // devolviera Caterpillar, su proforma saldría con otra marca.
    expect(buscarMarcaExacta('CAT', CATALOGO).id).toBe(11);
  });

  test.each([
    ['cat - usa', 26],
    ['CAT-USA',   26],
    ['CAT REMAN', 51],
    ['john deere', 3],
  ])('«%s» se reconoce aunque cambien mayúsculas o signos', (nombre, id) => {
    expect(buscarMarcaExacta(nombre, CATALOGO).id).toBe(id);
  });

  test.each([['HITACHI'], [''], ['   '], [null]])('«%s» no es ninguna', (nombre) => {
    expect(buscarMarcaExacta(nombre, CATALOGO)).toBeNull();
  });

  test('si dos entradas normalizan igual, gana la escrita literalmente', () => {
    const catalogo = [{ id: 1, nombre: 'CAT-REMAN' }, { id: 2, nombre: 'CAT REMAN' }];
    expect(buscarMarcaExacta('CAT REMAN', catalogo).id).toBe(2);
    expect(buscarMarcaExacta('cat-reman', catalogo).id).toBe(1);
  });
});

describe('marcasParecidas — «¿quisiste decir…?»', () => {
  test.each([
    ['CATERPILLER', 1],
    ['KOMATZU',     2],
    ['NEW HOLAND',  21],
    ['JOHN DERE',   3],
    ['ALTERNATIVA', 8],
    ['MASTER POWR', 54],
  ])('«%s» sugiere primero la marca %i', (nombre, primera) => {
    expect(marcasParecidas(nombre, CATALOGO)[0].id).toBe(primera);
  });

  test('una marca que no se parece a nada no sugiere nada', () => {
    expect(marcasParecidas('HITACHI', CATALOGO)).toEqual([]);
  });

  test('las marcas de tres letras no se sugieren entre sí', () => {
    // FAG, FAW y FAST son fabricantes distintos, a una o dos letras de
    // distancia. Sugerir FAG a quien escribe FAX sería ruido, no ayuda.
    expect(marcasParecidas('FAX', CATALOGO)).toEqual([]);
  });

  test('la idéntica no aparece como «parecida»', () => {
    expect(ids(marcasParecidas('Caterpillar', CATALOGO))).not.toContain(1);
  });

  test('devuelve como mucho las pedidas', () => {
    const catalogo = ['ABC1', 'ABC2', 'ABC3', 'ABC4', 'ABC5'].map((nombre, i) => ({ id: i, nombre }));
    expect(marcasParecidas('ABC', catalogo)).toHaveLength(3);
    expect(marcasParecidas('ABC', catalogo, 5)).toHaveLength(5);
  });
});

describe('resolverMarcas — la columna MARCA de la planilla al catálogo', () => {
  const pegados = [
    { descripcion_item: 'A', marca_texto: 'CATERPILLAR' },
    { descripcion_item: 'B', marca_texto: 'CAT' },
    { descripcion_item: 'C', marca_texto: 'HITACHI' },
    { descripcion_item: 'D', marca_texto: 'hitachi' },
    { descripcion_item: 'E', marca_texto: '' },
    { descripcion_item: 'F' },
  ];

  test('lo que se reconoce queda elegido, con la marca exacta del vendedor', () => {
    const { items } = resolverMarcas(pegados, CATALOGO);
    expect(items.map((i) => i.marca_id ?? null)).toEqual([1, 11, null, null, null, null]);
  });

  test('una marca desconocida se decide UNA vez para todas sus filas', () => {
    const { desconocidas } = resolverMarcas(pegados, CATALOGO);
    expect(desconocidas).toHaveLength(1);
    expect(desconocidas[0]).toMatchObject({ nombre: 'HITACHI', filas: [2, 3] });
  });

  test('una desconocida trae sus sugerencias', () => {
    const { desconocidas } = resolverMarcas([{ marca_texto: 'CATERPILLER' }], CATALOGO);
    expect(desconocidas[0].sugerencias[0].id).toBe(1);
  });

  test('respeta una marca que ya venía elegida', () => {
    const { items } = resolverMarcas([{ marca_id: 4, marca_texto: 'CAT' }], CATALOGO);
    expect(items[0].marca_id).toBe(4);
  });

  test('no modifica los ítems recibidos', () => {
    const original = [{ marca_texto: 'CAT' }];
    resolverMarcas(original, CATALOGO);
    expect(original[0].marca_id).toBeUndefined();
  });
});
