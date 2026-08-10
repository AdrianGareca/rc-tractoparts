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

const { ALTERNATIVA, contarEnFuente } = require('../helpers/emojiInterfaz');

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
  const TOPE = 23;

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
    // Colores de texto y espaciados sueltos — el grupo más repetido.
    'text-secondary', 'text-green', 'text-amber', 'text-orange', 'text-red',
    'text-blue', 'text-violet', 'text-center', 'm-0', 'ml-1',
    // Componentes que estaban escritos como estilo inline duplicado.
    'btn-excel', 'btn-add-inline', 'btn-add-inline-sm', 'btn-fila-entera',
    'drop-zone-excel', 'empty-icon', 'file-icon',
    // El formulario de cotización, migrado panel por panel.
    'label-opcional', 'correlativo-preview', 'correlativo-preview-label',
    'fg-doble', 'fg-doble-min', 'form-row-seccion', 'form-row-pie',
    'fg-casilla', 'casilla', 'label-casilla',
    'totals-discount-label', 'totals-discount-input',
    // La proforma en pantalla.
    'proforma-acciones-fila', 'revertir-rechazo', 'revertir-rechazo-title',
    'btn-orange', 'admin-review-panel', 'textarea-vertical', 'comentario-admin',
    'proforma-bloque-label', 'proforma-descuento', 'mt-04', 'mt-025', 'fst-italic',
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
  // Cero. La migración terminó: no queda ningún emoji en la interfaz, y lo que
  // sigue nombrándolos son los comentarios que explican por qué se fueron —que
  // no se cuentan, ver contarEnFuente().
  const TOPE = 0;

  const contar = () => archivos.reduce(
    (total, f) => total + contarEnFuente(fs.readFileSync(f, 'utf8')), 0
  );

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

// ---------------------------------------------------------------------------
// EL TRINQUETE DE LOS COLORES ESCRITOS A MANO
//
// Habia 81 colores hexadecimales sueltos en el JavaScript, y los seis mas
// frecuentes eran EXACTAMENTE tokens que ya existian en tokens.css:
//
//   #3B82F6 (11 veces) = --clr-blue        #F97316 (8) = --clr-orange
//   #10B981  (9)       = --clr-green       #8B5CF6 (6) = --clr-violet
//   #F59E0B  (8)       = --clr-amber       #EF4444 (5) = --clr-red
//
// POR QUE IMPORTA
// El proyecto esta migrando a la identidad de las proformas (azul marino y
// naranja). Un color escrito a mano NO SIGUE la paleta: se puede cambiar
// tokens.css entero y esos 81 lugares se quedan como estaban. Es la misma
// deuda que los estilos inline — el diseno clavado en el codigo — solo que mas
// dificil de ver, porque un hex no llama la atencion como un style="".
//
// Quedan 29: variantes que NO tienen token exacto (los verdes del boton de
// enviar, un par de azules mas oscuros). Reemplazarlos por el token mas
// parecido cambiaria el aspecto, asi que esperan a que se decida si merecen
// token propio o si el boton merece su clase.
// ---------------------------------------------------------------------------
describe('los colores escritos a mano sólo pueden disminuir', () => {
  const TOPE = 0;

  // Se arma con RegExp desde una CADENA y no como literal. La primera versión
  // usaba /#[0-9A-Fa-f]{6}/ y devolvía cero coincidencias: al escribir el
  // archivo, el  se convirtió en un carácter de retroceso real (0x08), que
  // es invisible al leer el código pero en la expresión exige un backspace
  // después del color. Un test que da cero y pasa es peor que uno que falla.
  const HEX = '#[0-9A-Fa-f]{6}';

  // Se arma desde String.fromCharCode y no como literal '\n' por la misma razón
  // que HEX es una cadena: al escribir este archivo con un script, la secuencia
  // de escape se resolvió una capa antes de lo esperado y el salto de línea
  // quedó DENTRO de la comilla, partiendo el literal en dos. Es el mismo tipo de
  // error que el retroceso invisible que ya rompió este archivo una vez.
  const SALTO = String.fromCharCode(10);

  // No se cuentan los comentarios, por el mismo motivo que en el trinquete de
  // los emoji: los que explican POR QUÉ se sacó un color necesitan nombrarlo
  // —«eran #065F46 y #1D4ED8, que son de tema claro»— y si contaran, el
  // trinquete no podría llegar nunca a cero y la documentación saldría
  // penalizada. Se mide lo que ve el usuario.
  const contar = () => archivos.reduce((total, f) => {
    const src = fs.readFileSync(f, 'utf8');
    return total + src.split(SALTO).reduce((n, linea) => {
      const t = linea.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return n;
      return n + (linea.match(new RegExp(HEX, 'g')) || []).length;
    }, 0);
  }, 0);

  test(`no hay más de ${TOPE} colores hex en public/js`, () => {
    const actual = contar();

    if (actual > TOPE) {
      throw new Error(
        `Hay ${actual} colores hexadecimales sueltos y el tope es ${TOPE}. ` +
        'Un color escrito a mano no sigue la paleta: se puede cambiar tokens.css ' +
        'entero y ese lugar se queda como estaba. Buscá el token equivalente en ' +
        'public/css/tokens.css y usá var(--clr-…).'
      );
    }
    expect(actual).toBeLessThanOrEqual(TOPE);
  });

  test('si bajaron, hay que bajar el tope', () => {
    const actual = contar();
    if (actual < TOPE) {
      throw new Error(`Ahora hay ${actual} colores hex (el tope decía ${TOPE}). Bajá TOPE a ${actual}.`);
    }
    expect(actual).toBe(TOPE);
  });

  // Los que ya se migraron no deben volver: todos tienen token exacto o una
  // clase propia, así que no hay excusa para escribirlos a mano.
  //
  // #16a34a y #15803d entraron después. Eran el verde del botón «Descargar
  // Excel» y el del «+» redondo, copiados a mano en cuatro archivos — y en un
  // quinto caso pintados ENCIMA de un botón que ya tenía class="btn-success",
  // que define ese mismo verde desde el token. El estilo inline le ganaba a la
  // clase que el propio elemento se estaba aplicando.
  test.each([
    '#3B82F6', '#10B981', '#F59E0B', '#F97316', '#8B5CF6', '#EF4444',
    '#16a34a', '#15803d',
  ])(
    '%s ya no aparece: tiene token propio',
    (hex) => {
      const culpables = archivos.filter((f) => {
        const src = fs.readFileSync(f, 'utf8');
        return src.includes(hex) || src.includes(hex.toLowerCase());
      }).map((f) => rel(f));

      expect(culpables).toEqual([]);
    }
  );
});
