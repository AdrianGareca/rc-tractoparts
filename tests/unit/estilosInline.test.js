// =============================================================================
// tests/unit/estilosInline.test.js
// Vigila la migración de los estilos inline al CSS.
//
// POR QUÉ IMPORTA MÁS QUE LA PROLIJIDAD
// Un atributo style="" GANA sobre cualquier regla de la hoja de estilos. Con
// 274 de ellos repartidos por el JavaScript, cambiar el aspecto de la
// aplicación era imposible desde el CSS: había que ir archivo por archivo del
// código. La deuda no era estética, era que el diseño estaba clavado.
//
// Este archivo hace dos cosas:
//
//   1. Un TRINQUETE: el número de estilos inline puede bajar, nunca subir. No
//      exige terminar la migración de una, pero impide que se desande.
//
//   2. Atrapa el bug que la propia migración introdujo: un <tag> con DOS
//      atributos class=. El navegador se queda con el primero y descarta el
//      segundo EN SILENCIO — la clase nueva simplemente no se aplica y nadie
//      se entera hasta que alguien nota que un campo quedó angosto.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '../../public/js');

function listarJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? listarJs(full) : (e.name.endsWith('.js') ? [full] : []);
  });
}

const archivos = listarJs(RAIZ);
const rel = (p) => path.relative(RAIZ, p).replace(/\\/g, '/');

// Etiqueta de apertura HTML dentro de un template literal.
const TAG = /<[a-zA-Z][^<>]*>/gs;
const CLS = /\sclass="([^"]*)"/g;

// ---------------------------------------------------------------------------
describe('un elemento nunca lleva dos atributos class', () => {
  test.each(archivos.map((f) => [rel(f), f]))('%s', (_n, file) => {
    const src = fs.readFileSync(file, 'utf8');
    const culpables = [];

    for (const m of src.matchAll(TAG)) {
      const clases = [...m[0].matchAll(CLS)];
      if (clases.length > 1) {
        culpables.push(m[0].slice(0, 90).replace(/\s+/g, ' '));
      }
    }

    if (culpables.length > 0) {
      throw new Error(
        `${rel(file)} tiene ${culpables.length} elemento(s) con dos class=:\n  ` +
        culpables.join('\n  ') +
        '\n\nEl navegador se queda con el PRIMERO y descarta el resto en silencio: ' +
        'la clase nueva no se aplica y no hay error en consola.'
      );
    }
  });
});

// ---------------------------------------------------------------------------
// EL TRINQUETE
//
// El número sale de contar los que quedan hoy. Al bajar uno, se baja también
// este número — el test lo recuerda con un mensaje explícito.
//
// La alternativa (exigir cero) obligaría a migrar los 213 restantes de una sola
// vez, y algunos son legítimos: anchos calculados en tiempo de ejecución, o el
// `--stat-accent` que cada tarjeta inyecta con su propio color.
// ---------------------------------------------------------------------------
describe('los estilos inline sólo pueden disminuir', () => {
  const TOPE = 211;

  const contar = () => archivos.reduce((total, f) => {
    const src = fs.readFileSync(f, 'utf8');
    return total + (src.match(/style="/g) || []).length;
  }, 0);

  test(`no hay más de ${TOPE} estilos inline en public/js`, () => {
    const actual = contar();

    if (actual > TOPE) {
      throw new Error(
        `Hay ${actual} estilos inline y el tope es ${TOPE}. ` +
        'Un style="" gana sobre el CSS: cada uno que se agrega es una parte de ' +
        'la interfaz que deja de poder rediseñarse desde la hoja de estilos. ' +
        'Poné la regla en public/css/ y usá una clase.'
      );
    }
    expect(actual).toBeLessThanOrEqual(TOPE);
  });

  test('si bajaron, hay que bajar el tope', () => {
    const actual = contar();

    // No es un capricho: un trinquete que no se aprieta deja de trinquetear.
    // Si esto falla, cambiá TOPE por el número que dice el mensaje.
    if (actual < TOPE) {
      throw new Error(
        `Ahora hay ${actual} estilos inline (el tope decía ${TOPE}). ` +
        `Bajá TOPE a ${actual} en este archivo para conservar lo ganado.`
      );
    }
    expect(actual).toBe(TOPE);
  });
});

// ---------------------------------------------------------------------------
describe('las clases nuevas existen en el CSS', () => {
  const CSS = fs.readdirSync(path.resolve(__dirname, '../../public/css'))
    .filter((f) => f.endsWith('.css'))
    .map((f) => fs.readFileSync(path.resolve(__dirname, '../../public/css', f), 'utf8'))
    .join('\n');

  // Las que salieron de la migración. Una clase que se usa y no existe deja el
  // elemento sin estilo, y eso no rompe nada: sólo se ve mal.
  test.each([
    'modal-actions', 'filter-action', 'fc-narrow', 'fc-medium', 'fc-wide',
    'mb-1', 'mb-2', 'mt-1', 'mt-2', 'mt-3', 'gap-2', 'flex-wrap', 'justify-end',
  ])('.%s está definida', (clase) => {
    expect(CSS).toMatch(new RegExp(`\\.${clase}\\s*[,{]`));
  });
});

// ---------------------------------------------------------------------------
// EL TRINQUETE DE LOS EMOJI
//
// Habia 129 emoji en la interfaz. Es el tic visual mas reconocible del software
// generado: ningun sistema de gestion que use una empresa le pone un emoji al
// titulo de una seccion o a un boton.
//
// Se sacaron primero los de encabezados (reemplazados por el filete naranja que
// el PDF ya dibuja) y los de botones (sin reemplazo: un boton bien rotulado no
// necesita ninguno). Quedan los de estados vacios y mensajes, que se migran
// despues.
//
// Mismo criterio que arriba: pueden bajar, nunca subir.
// ---------------------------------------------------------------------------
describe('los emoji de la interfaz sólo pueden disminuir', () => {
  const TOPE = 70;

  // Los que efectivamente aparecen en la interfaz. Se listan de forma explícita
  // en vez de usar un rango Unicode: los rangos también atrapan símbolos
  // tipográficos legítimos (flechas, guiones largos) y darían falsos positivos.
  const EMOJI = [
    '📦', '📅', '📊', '🔑', '📋', '📑', '🏢', '🔓', '💾', '⏸', '✅', '❌',
    '↩', '🔄', '🏆', '🟢', '📄', '⬇', '🔎', '💬', '👤', '🚜', '📈', '⚠️',
    '✏️', '🗑', '➕', '🔍', '📌', '🕐',
  ];

  const contar = () => archivos.reduce((total, f) => {
    const src = fs.readFileSync(f, 'utf8');
    return total + EMOJI.reduce((n, e) => n + src.split(e).length - 1, 0);
  }, 0);

  test(`no hay más de ${TOPE} emoji en public/js`, () => {
    const actual = contar();

    if (actual > TOPE) {
      throw new Error(
        `Hay ${actual} emoji y el tope es ${TOPE}. Un emoji en un título o en un ` +
        'botón es el rasgo más reconocible del software generado, y le compite la ' +
        'atención a la palabra que sí importa. Para una sección, el filete naranja ' +
        'de .card-header lo reemplaza solo; un botón bien rotulado no necesita nada.'
      );
    }
    expect(actual).toBeLessThanOrEqual(TOPE);
  });

  test('si bajaron, hay que bajar el tope', () => {
    const actual = contar();
    if (actual < TOPE) {
      throw new Error(`Ahora hay ${actual} emoji (el tope decía ${TOPE}). Bajá TOPE a ${actual}.`);
    }
    expect(actual).toBe(TOPE);
  });

  // Ningún emoji lleva metacaracteres de expresión regular, así que se
  // concatenan directo — escaparlos sólo agregaría ruido y una fuente de error.
  const ALTERNATIVA = EMOJI.join('|');

  // Los dos lugares ya migrados no deben recaer.
  test('ningún encabezado vuelve a empezar con un emoji', () => {
    const patron = new RegExp(`<h[1-6][^>]*>\\s*(?:${ALTERNATIVA})`);

    const culpables = archivos
      .filter((f) => patron.test(fs.readFileSync(f, 'utf8')))
      .map((f) => rel(f));

    expect(culpables).toEqual([]);
  });

  test('ningún botón vuelve a empezar con un emoji', () => {
    const patron = new RegExp(`<button\\b[^>]*>\\s*(?:${ALTERNATIVA})`);

    const culpables = archivos
      .filter((f) => patron.test(fs.readFileSync(f, 'utf8')))
      .map((f) => rel(f));

    expect(culpables).toEqual([]);
  });
});
