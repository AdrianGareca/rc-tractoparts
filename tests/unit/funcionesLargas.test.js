// =============================================================================
// tests/unit/funcionesLargas.test.js
// Ninguna función puede crecer sin límite.
//
// POR QUÉ ESTE Y NO EL TAMAÑO DEL ARCHIVO
// Al medir el proyecto, el archivo más grande de src/ era quotationRoutes.js
// con 1074 líneas — y resultó ser una falsa alarma: dos tercios son comentarios
// de Swagger y su código real es normal. Un archivo largo se navega con el
// buscador y se parte cuando molesta.
//
// El problema de verdad estaba escondido: quotationStateController.js tenía 379
// líneas de código en apenas TRES funciones. Unas 126 líneas por función.
//
// Una función larga no se puede tener entera en la cabeza. No se puede probar
// por partes, no se puede reusar ninguna de sus mitades, y cada rama nueva se
// agrega adentro porque sacarla parece más riesgoso que dejarla — así que crece
// sola. Es la que nadie quiere tocar, y en este sistema la peor era updateStatus
// (295 líneas), por donde pasa CADA cambio de estado de CADA cotización.
//
// Mismo criterio que los otros trinquetes: puede bajar, nunca subir.
// =============================================================================

'use strict';

const fs     = require('fs');
const path   = require('path');
const parser = require('@babel/parser');

// Las DOS raíces de código de la aplicación.
//
// La primera versión de este trinquete miraba sólo `src/`, y era un punto ciego
// grave: al ampliarlo apareció que las CINCO funciones más largas del proyecto
// entero estaban en `public/js` —buildProformaHTML con 346 líneas encabezando—
// y que había 26 funciones de más de 80 líneas ahí sin vigilar.
//
// El backend no es más importante que el frontend por ser backend. Una función
// de trescientas líneas que arma HTML es igual de imposible de tener en la
// cabeza que una que valida una transición.
const RAICES = [
  path.resolve(__dirname, '../../src'),
  path.resolve(__dirname, '../../public/js'),
];

const PROYECTO = path.resolve(__dirname, '../..');

function listarJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? listarJs(full) : (e.name.endsWith('.js') ? [full] : []);
  });
}

// Ruta relativa al proyecto y no a la raíz de cada uno: con dos raíces, un
// 'modules/x.js' a secas no diría si es del navegador o del servidor.
const rel = (p) => path.relative(PROYECTO, p).split(path.sep).join('/');

/**
 * Cuántas líneas de CÓDIGO tiene un tramo — sin comentarios ni líneas en blanco.
 *
 * POR QUÉ NO SE CUENTAN LAS LÍNEAS TOTALES
 * La primera versión medía `end - start + 1`, y eso ponía a pelear dos cosas que
 * el proyecto quiere las dos: comentar denso, línea por línea, y mantener las
 * funciones cortas. Al comentar `validateTransitionByRole` como corresponde,
 * pasó de unas 80 líneas a 123 — sin que se agregara una sola instrucción.
 *
 * Con esa métrica, la forma más fácil de «arreglar» una función larga habría
 * sido borrarle los comentarios. Que es exactamente lo contrario de lo que hay
 * que hacer.
 *
 * Lo que hace difícil de leer una función es la cantidad de cosas que HACE, y
 * eso se mide en instrucciones. Un comentario no agrega carga: la quita.
 */
function contarCodigo(lineas, desde, hasta) {
  let n = 0;
  // `desde` y `hasta` vienen 1-indexados desde Babel; el arreglo es 0-indexado.
  for (let i = desde - 1; i < hasta && i < lineas.length; i++) {
    const t = lineas[i].trim();
    if (!t) continue;                                      // línea en blanco
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
    n += 1;
  }
  return n;
}

/** Toda función del archivo, con su nombre, su línea y cuánto código ocupa. */
function funcionesDe(file) {
  const src = fs.readFileSync(file, 'utf8');
  const lineas = src.split(String.fromCharCode(10));

  let ast;
  try {
    // 'unambiguous' deja que Babel decida entre módulo y script mirando el
    // contenido. Hace falta porque las dos raíces usan sistemas distintos:
    // `src/` es CommonJS (require) y `public/js` son módulos nativos (import).
    ast = parser.parse(src, { sourceType: 'unambiguous' });
  } catch {
    return [];   // un archivo que no parsea ya lo denuncia otro test
  }

  const encontradas = [];

  // Recorrido a mano en vez de @babel/traverse: es una dependencia menos y lo
  // único que hace falta es leer `loc`, no reescribir el árbol.
  const recorrer = (nodo) => {
    if (!nodo || typeof nodo !== 'object') return;
    if (Array.isArray(nodo)) { nodo.forEach(recorrer); return; }

    const esFuncion = /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|ClassMethod|ObjectMethod)$/
      .test(nodo.type || '');

    if (esFuncion && nodo.loc) {
      encontradas.push({
        nombre: nodo.id?.name || nodo.key?.name || '(anónima)',
        linea:  nodo.loc.start.line,
        largo:  contarCodigo(lineas, nodo.loc.start.line, nodo.loc.end.line),
      });
    }

    // `loc` se saltea: son objetos de posición, no hay funciones ahí adentro.
    for (const k in nodo) if (k !== 'loc') recorrer(nodo[k]);
  };

  recorrer(ast);
  return encontradas;
}

const todas = RAICES.flatMap(listarJs).flatMap((f) =>
  funcionesDe(f).map((fn) => ({ ...fn, archivo: rel(f) }))
);

// ---------------------------------------------------------------------------
describe('el tamaño de las funciones sólo puede bajar', () => {
  // La más larga que hay hoy. Al partir una, este número baja.
  const TOPE_MAXIMO = 269;

  // Cuántas pasan de 80 líneas — el umbral donde una función deja de entrar en
  // una pantalla y hay que hacer scroll para saber qué hace.
  const TOPE_GRANDES = 38;
  const UMBRAL_GRANDE = 80;

  test(`ninguna función pasa de ${TOPE_MAXIMO} líneas`, () => {
    const peor = todas.reduce((a, b) => (b.largo > a.largo ? b : a), { largo: 0 });

    if (peor.largo > TOPE_MAXIMO) {
      throw new Error(
        `${peor.archivo}:${peor.linea} — ${peor.nombre}() tiene ${peor.largo} líneas ` +
        `y el tope es ${TOPE_MAXIMO}.\n\n` +
        'Una función que no entra en la cabeza no se puede probar por partes ni ' +
        'reusar a medias, y cada rama nueva termina agregándose adentro porque ' +
        'sacarla parece más riesgoso. Partila antes de que crezca más.'
      );
    }
    expect(peor.largo).toBeLessThanOrEqual(TOPE_MAXIMO);
  });

  test(`no hay más de ${TOPE_GRANDES} funciones de más de ${UMBRAL_GRANDE} líneas`, () => {
    const grandes = todas.filter((f) => f.largo > UMBRAL_GRANDE);

    if (grandes.length > TOPE_GRANDES) {
      const lista = grandes
        .sort((a, b) => b.largo - a.largo)
        .slice(0, 10)
        .map((f) => `  ${String(f.largo).padStart(4)} ln  ${f.archivo}:${f.linea}  ${f.nombre}()`)
        .join('\n');

      throw new Error(
        `Hay ${grandes.length} funciones de más de ${UMBRAL_GRANDE} líneas y el tope es ` +
        `${TOPE_GRANDES}. Las más largas:\n${lista}`
      );
    }
    expect(grandes.length).toBeLessThanOrEqual(TOPE_GRANDES);
  });

  // Los dos de apretar. Sin ellos el trinquete deja de trinquetear.
  test('si la más larga se acortó, hay que bajar el tope', () => {
    const peor = todas.reduce((a, b) => (b.largo > a.largo ? b : a), { largo: 0 });

    if (peor.largo < TOPE_MAXIMO) {
      throw new Error(
        `La función más larga ahora tiene ${peor.largo} líneas (el tope decía ${TOPE_MAXIMO}). ` +
        `Bajá TOPE_MAXIMO a ${peor.largo}.`
      );
    }
  });

  test('si bajaron las grandes, hay que bajar el tope', () => {
    const grandes = todas.filter((f) => f.largo > UMBRAL_GRANDE).length;

    if (grandes < TOPE_GRANDES) {
      throw new Error(
        `Ahora hay ${grandes} funciones de más de ${UMBRAL_GRANDE} líneas ` +
        `(el tope decía ${TOPE_GRANDES}). Bajá TOPE_GRANDES a ${grandes}.`
      );
    }
  });
});

// ---------------------------------------------------------------------------
describe('el medidor mide algo', () => {
  // Un contador que devuelve cero pasaría todos los topes de arriba sin
  // vigilar nada. Ya pasó con el trinquete de colores: reportaba 0 sobre 29
  // reales y la prueba pasaba, porque cero es menor que veintinueve.
  test('encuentra funciones en src/', () => {
    expect(todas.length).toBeGreaterThan(100);
  });

  test('sabe el nombre y el archivo de una función conocida', () => {
    // Se busca por archivo Y nombre porque `validateTransitionByRole` existe
    // DOS veces: una para cotizaciones y otra para licitaciones. No es
    // duplicación — son dos máquinas de estados distintas, y la de licitaciones
    // tiene un eje más (isResponsable, el dueño de la licitación). El homónimo
    // es deliberado y está documentado como espejo en LicitacionModel.js.
    const conocida = todas.find(
      (f) => f.nombre === 'validateTransitionByRole'
          && f.archivo === 'src/models/quotation/stateMachine.js'
    );

    expect(conocida).toBeDefined();
    expect(conocida.largo).toBeGreaterThan(20);
  });
});
