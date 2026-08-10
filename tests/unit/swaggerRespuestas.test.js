// =============================================================================
// tests/unit/swaggerRespuestas.test.js
// Las respuestas de error de la API se describen UNA vez.
//
// EL PROBLEMA MEDIDO
// De las 2982 líneas de src/routes, 2058 son comentarios de Swagger — el 69%.
// Y no había un solo $ref en todo el proyecto: cada endpoint repetía a mano el
// mismo bloque de error. «Token ausente o inválido.» estaba escrito 26 veces.
//
// LO QUE LO VUELVE UN PROBLEMA DE VERDAD, Y NO DE PROLIJIDAD
// Las copias ya se habían desincronizado:
//
//   «Error interno del servidor.»      22 veces
//   «Error interno del servidor»        4 veces  ← sin punto
//   «Token ausente o inválido.»        26 veces
//   «Token JWT ausente o inválido»      3 veces  ← otra redacción
//
// Es decir: la documentación que se publica describe el MISMO error de tres
// formas distintas según el endpoint que uno mire. Quien la lee no puede saber
// si son tres situaciones diferentes o la misma escrita por tres personas.
// Con un $ref no hay dónde desincronizarse.
//
// Este test fija tres cosas: que las respuestas compartidas existan, que los
// $ref apunten a algo real, y que no se haya perdido ningún endpoint en el
// camino — que es lo único irreversible de un cambio así.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const { swaggerSpec, RESPUESTAS_COMPARTIDAS } = require('../../src/config/swagger');

const RUTAS = path.resolve(__dirname, '../../src/routes');
const archivos = fs.readdirSync(RUTAS)
  .filter((f) => f.endsWith('.js'))
  .map((f) => path.join(RUTAS, f));

// ---------------------------------------------------------------------------
describe('las respuestas de error compartidas están definidas', () => {
  test('el spec expone components.responses', () => {
    expect(swaggerSpec.components?.responses).toBeDefined();
  });

  test.each(Object.keys(RESPUESTAS_COMPARTIDAS))('%s existe y describe algo', (nombre) => {
    const r = swaggerSpec.components.responses[nombre];
    expect(r).toBeDefined();
    expect(typeof r.description).toBe('string');
    expect(r.description.length).toBeGreaterThan(5);
  });
});

// ---------------------------------------------------------------------------
describe('ningún $ref apunta al vacío', () => {
  // Un $ref roto no rompe el servidor: Swagger UI muestra la respuesta en
  // blanco y sigue. Es el tipo de error que sólo se ve entrando a la página.
  test('todos los $ref del spec resuelven', () => {
    const rotos = [];

    const recorrer = (nodo, camino) => {
      if (!nodo || typeof nodo !== 'object') return;
      for (const [k, v] of Object.entries(nodo)) {
        if (k === '$ref' && typeof v === 'string') {
          // '#/components/responses/NoAutorizado' → ['components','responses','NoAutorizado']
          const partes = v.replace(/^#\//, '').split('/');
          let actual = swaggerSpec;
          for (const p of partes) actual = actual?.[p];
          if (actual === undefined) rotos.push(`${camino}: ${v}`);
        } else {
          recorrer(v, `${camino}.${k}`);
        }
      }
    };

    recorrer(swaggerSpec, 'spec');
    expect(rotos).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('las descripciones repetidas ya no se escriben a mano', () => {
  // Se listan las redacciones exactas que estaban duplicadas. Si alguna vuelve
  // a aparecer suelta en un archivo de rutas, es que alguien copió un bloque
  // en vez de referenciar la respuesta compartida — y ahí vuelve a empezar la
  // desincronización.
  const PROHIBIDAS = [
    'Token ausente o inválido',
    'Token JWT ausente o inválido',
    'Error interno del servidor',
    'Rol insuficiente',
  ];

  test.each(PROHIBIDAS)('«%s» no aparece suelta en src/routes', (frase) => {
    const culpables = [];

    for (const f of archivos) {
      fs.readFileSync(f, 'utf8').split('\n').forEach((linea, i) => {
        if (linea.includes(frase)) {
          culpables.push(`${path.basename(f)}:${i + 1}`);
        }
      });
    }

    if (culpables.length > 0) {
      throw new Error(
        `«${frase}» sigue escrita a mano en:\n  ${culpables.join('\n  ')}\n\n` +
        'Usá $ref: "#/components/responses/…" (ver src/config/swagger.js). ' +
        'Las copias a mano ya se habían desincronizado una vez: el mismo error ' +
        'estaba descrito con y sin punto final, y con dos redacciones distintas.'
      );
    }
  });
});

// ---------------------------------------------------------------------------
describe('no se perdió ningún endpoint', () => {
  // Lo único irreversible de este cambio sería borrar de más y dejar un
  // endpoint sin documentar. El número sale de contar los que hay hoy.
  const MINIMO_RUTAS = 37;   // 37 rutas, 53 operaciones al momento de escribirlo

  test(`el spec documenta al menos ${MINIMO_RUTAS} rutas`, () => {
    const rutas = Object.keys(swaggerSpec.paths ?? {});
    expect(rutas.length).toBeGreaterThanOrEqual(MINIMO_RUTAS);
  });

  test('cada ruta tiene al menos un método con respuestas', () => {
    const sinRespuestas = [];

    for (const [ruta, metodos] of Object.entries(swaggerSpec.paths ?? {})) {
      for (const [metodo, def] of Object.entries(metodos)) {
        if (!def.responses || Object.keys(def.responses).length === 0) {
          sinRespuestas.push(`${metodo.toUpperCase()} ${ruta}`);
        }
      }
    }

    expect(sinRespuestas).toEqual([]);
  });
});
