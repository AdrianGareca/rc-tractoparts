// =============================================================================
// tests/unit/whereBuilderClientes.test.js
// countAll une `clientes` SOLO si algún filtro lo necesita.
//
// POR QUÉ EXISTE
// Desde la ronda de estrés del 2026-09-15, countAll ya no arrastra las uniones
// de BASE_JOINS: con 40.000 cotizaciones contar sin filtros bajó de ~400 ms a
// ~35 ms. La decisión de unir `clientes` la toma necesitaClientes(), que lleva
// su propia lista de los filtros que miran `cl.*`.
//
// El riesgo es que esa lista quede atrás: alguien agrega en buildWhereClause
// un filtro nuevo sobre `cl.` y no lo suma a necesitaClientes. No sería un
// número equivocado en silencio —MySQL respondería «Unknown column»— pero el
// listado de cotizaciones entero daría 500 en cuanto se use el filtro.
//
// Este guardia prueba cada filtro que buildWhereClause lee y exige que las dos
// funciones coincidan. Y para que no pase por alto un filtro nuevo, la lista
// de filtros se saca del propio código fuente.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');
const { buildWhereClause, necesitaClientes } = require('../../src/models/quotation/whereBuilder');

// Un valor válido para cada filtro que acepta buildWhereClause.
const UN_VALOR = {
  q:                 'minera',
  razon_social:      'Andina',
  nit:               '1234',
  estado:            'Pendiente',
  id_cliente:        3,
  id_ejecutivo:      7,
  excluir_ejecutivo: 7,
  id_licitacion:     2,
  fecha_desde:       '2026-01-01',
  fecha_hasta:       '2026-12-31',
  moneda:            'USD',
  tiene_pdf:         true,
};

describe('necesitaClientes coincide con buildWhereClause', () => {
  test('la tabla de esta prueba cubre todos los filtros del constructor', () => {
    const fuente = fs.readFileSync(
      path.join(__dirname, '../../src/models/quotation/whereBuilder.js'), 'utf8');
    const deBuildWhere = fuente.slice(0, fuente.indexOf('function necesitaClientes'));
    const leidos = new Set([...deBuildWhere.matchAll(/filters\.(\w+)/g)].map((m) => m[1]));

    const faltan = [...leidos].filter((f) => !(f in UN_VALOR));
    if (faltan.length) {
      throw new Error(
        `buildWhereClause lee filtros que esta prueba no cubre: ${faltan.join(', ')}.\n` +
        'Agregalos a UN_VALOR. Si alguno mira columnas de clientes (cl.*), ' +
        'también hay que sumarlo a necesitaClientes().'
      );
    }
    expect(leidos.size).toBeGreaterThan(0);
  });

  test.each(Object.entries(UN_VALOR))('filtro %s', (clave, valor) => {
    const filtros = { [clave]: valor };
    const { clause } = buildWhereClause(filtros);

    expect(clause).not.toBe('');   // el valor de prueba activa el filtro de verdad
    expect(necesitaClientes(filtros)).toBe(/\bcl\./.test(clause));
  });

  test('un texto de búsqueda en blanco no activa la unión', () => {
    const filtros = { q: '   ', razon_social: '', nit: ' ' };
    expect(buildWhereClause(filtros).clause).toBe('');
    expect(necesitaClientes(filtros)).toBe(false);
  });
});
