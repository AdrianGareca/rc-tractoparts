// =============================================================================
// tests/unit/cssBundle.test.js
// Cuida la coherencia de la hoja de estilos dividida.
//
// Sin build step, nadie valida el CSS: un archivo nuevo que se olvidan de
// enlazar, o un <link> a un archivo borrado, no rompe ningún test — rompe el
// aspecto de la app en producción. Y el ORDEN de los <link> es la cascada: si
// responsive deja de ir último, o tokens deja de ir primero, los estilos se
// pisan entre sí de forma sutil y difícil de diagnosticar.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const CSS_DIR = path.resolve(__dirname, '../../public/css');

const enPublic = (f) => path.resolve(__dirname, '../../public', f);

/**
 * Las DOS pantallas de la aplicación: cargan el paquete completo y tienen que
 * cargarlo idéntico, porque el formulario de cotización se monta en las dos.
 */
const HTMLS_APP = ['index.html', 'dashboard.html'].map(enPublic);

/**
 * Páginas sueltas que enlazan sólo una PARTE del paquete.
 *
 * 404.html no monta la aplicación: es una tarjeta centrada con un botón, así
 * que enlaza cuatro archivos (tokens, base, auth, buttons) y no los doce. Se la
 * separa en vez de sumarla a HTMLS_APP porque el test de "las dos pantallas
 * enlazan lo mismo" la acusaría para siempre por una diferencia que es correcta.
 *
 * Pero NO queda afuera de las garantías que sí le corresponden: que sus
 * archivos existan en disco (si mañana alguien renombra auth.css, la página de
 * error salía sin estilo y ningún test se enteraba), que lleve el mismo
 * parámetro de versión, que arranque con tokens.css, que no tenga estilos
 * inline y que su lista sea un subconjunto del paquete en el mismo orden
 * relativo.
 */
const HTMLS_PARCIALES = ['404.html'].map(enPublic);

/** Todo HTML vigilado, complete o parcial. */
const HTMLS = [...HTMLS_APP, ...HTMLS_PARCIALES];

/**
 * El orden EXACTO en que la aplicación enlaza sus hojas.
 *
 * Está escrito a mano y no deducido del HTML a propósito: es el único modo de
 * que un reordenamiento accidental falle. Los tests de "tokens primero" y
 * "responsive último" fijaban las dos puntas y dejaban el medio libre — se
 * podían permutar los diez archivos centrales y los trece tests seguían en
 * verde mientras la interfaz se rompía, porque en CSS el orden ES lo que
 * decide qué regla gana cuando dos empatan en especificidad.
 *
 * Si este test falla, el cambio puede estar perfectamente bien: actualizá el
 * array A PROPÓSITO, mirando qué reglas pasan a pisar a cuáles.
 */
const ORDEN_ESPERADO = [
  'tokens.css',
  'base.css',
  'layout.css',
  'auth.css',
  'buttons.css',
  'forms.css',
  'components.css',
  'tables.css',
  'modals.css',
  'quotation-form.css',
  'proforma.css',
  'movimiento.css',
  'responsive.css',
];

/** Los href de CSS de un HTML, en orden de aparición. */
function linkedCss(html) {
  const src = fs.readFileSync(html, 'utf8');
  return [...src.matchAll(/<link\s+rel="stylesheet"\s+href="\/css\/([^"?]+)(?:\?[^"]*)?"/g)]
    .map((m) => m[1]);
}

const archivosEnDisco = fs.readdirSync(CSS_DIR).filter((f) => f.endsWith('.css')).sort();

describe('hoja de estilos dividida', () => {
  test('las dos pantallas de la app enlazan los mismos archivos y en el mismo orden', () => {
    const [a, b] = HTMLS_APP.map(linkedCss);
    expect(a).toEqual(b);
  });

  test('el orden COMPLETO de los <link> es el esperado, archivo por archivo', () => {
    for (const html of HTMLS_APP) {
      expect(linkedCss(html)).toEqual(ORDEN_ESPERADO);
    }
  });

  test('404.html enlaza un SUBCONJUNTO del paquete, en el mismo orden relativo', () => {
    // Subsecuencia, no igualdad: puede saltear archivos, pero no puede
    // invertirlos. Si auth.css cargara antes que base.css en la página de
    // error, la cascada de esa página no sería la misma que la del login y el
    // mismo marcado se vería distinto en cada una.
    for (const html of HTMLS_PARCIALES) {
      const suyos = linkedCss(html);
      expect(suyos.length).toBeGreaterThan(0);
      expect(suyos.filter((f) => !ORDEN_ESPERADO.includes(f))).toEqual([]);

      const posiciones = suyos.map((f) => ORDEN_ESPERADO.indexOf(f));
      expect(posiciones).toEqual([...posiciones].sort((x, y) => x - y));
    }
  });

  test('todo archivo enlazado existe en disco', () => {
    for (const html of HTMLS) {
      for (const f of linkedCss(html)) {
        expect(archivosEnDisco).toContain(f);
      }
    }
  });

  test('todo archivo en disco está enlazado (ninguno queda huérfano)', () => {
    const enlazados = new Set(linkedCss(HTMLS_APP[0]));
    expect(archivosEnDisco.filter((f) => !enlazados.has(f))).toEqual([]);
  });

  test('tokens.css va PRIMERO en todos los HTML: el resto consume sus variables', () => {
    for (const html of HTMLS) {
      expect(linkedCss(html)[0]).toBe('tokens.css');
    }
  });

  test('responsive.css va ÚLTIMO: sus media queries deben poder pisar', () => {
    const orden = linkedCss(HTMLS_APP[0]);
    expect(orden[orden.length - 1]).toBe('responsive.css');
  });

  test('todos los <link> llevan el mismo parámetro de versión (cache-busting)', () => {
    for (const html of HTMLS) {
      const src = fs.readFileSync(html, 'utf8');
      const versiones = new Set(
        [...src.matchAll(/href="\/css\/[^"?]+\?v=([^"]*)"/g)].map((m) => m[1])
      );
      expect(versiones.size).toBe(1);
    }
  });

  // ── El fallo que motiva este bloque ────────────────────────────────────────
  // El 2026-09-02 se sumó movimiento.css al paquete: quedó enlazado en los tres
  // HTML, los tests de arriba lo dieron por presente, y el archivo estaba
  // VACÍO. Se commiteó así cuatro veces seguidas. Nada falló: la hoja existía,
  // se servía con 200, y la aplicación simplemente no tenía ninguna de las
  // animaciones que se suponía que traía.
  //
  // Comprobar que un archivo EXISTE no comprueba que tenga algo adentro. El
  // umbral es deliberadamente bajo — no juzga si la hoja está completa, sólo
  // ataja el caso de que no llegara a escribirse.
  test('ninguna hoja enlazada está vacía', () => {
    const MINIMO = 200;   // bytes: menos que eso no es una hoja, es un accidente
    const flacas = [];

    for (const archivo of linkedCss(HTMLS_APP[0])) {
      const bytes = fs.statSync(enPublic(`css/${archivo}`)).size;
      if (bytes < MINIMO) flacas.push(`${archivo} — ${bytes} bytes`);
    }

    if (flacas.length > 0) {
      throw new Error(
        'Estas hojas están enlazadas pero prácticamente vacías:\n  ' +
        flacas.join('\n  ') +
        '\n\nEl navegador las pide, recibe un 200 y no aplica nada. No hay error ' +
        'en consola ni al desplegar: la interfaz simplemente no tiene lo que esa ' +
        'hoja debía traer. Ya pasó una vez con movimiento.css.'
      );
    }
  });

  test('ya no queda el styles.css monolítico', () => {
    expect(archivosEnDisco).not.toContain('styles.css');
  });
});

describe('contenido de la hoja de estilos', () => {
  const todo = archivosEnDisco
    .map((f) => fs.readFileSync(path.join(CSS_DIR, f), 'utf8'))
    .join('\n');

  test('las llaves están balanceadas en cada archivo', () => {
    for (const f of archivosEnDisco) {
      const src = fs.readFileSync(path.join(CSS_DIR, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');
      const abren  = (src.match(/\{/g) || []).length;
      const cierran = (src.match(/\}/g) || []).length;
      expect(`${f}: ${abren}/${cierran}`).toBe(`${f}: ${abren}/${abren}`);
    }
  });

  test('toda variable usada SIN fallback está definida en tokens.css', () => {
    // Una var() con fallback — var(--stat-accent, var(--clr-blue)) — es una API
    // de componente a propósito: el valor lo inyecta el JS con un style inline.
    // Una var() SIN fallback y sin definir, en cambio, resuelve a nada y la
    // propiedad se descarta en silencio: eso sí es un bug.
    const tokens = fs.readFileSync(path.join(CSS_DIR, 'tokens.css'), 'utf8');
    const definidas = new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));

    const sinFallback = [...todo.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)]
      .filter((m) => m[2] === ')')
      .map((m) => m[1]);

    expect([...new Set(sinFallback)].filter((v) => !definidas.has(v))).toEqual([]);
  });

  test('las variables con fallback apuntan a un token real', () => {
    const tokens = fs.readFileSync(path.join(CSS_DIR, 'tokens.css'), 'utf8');
    const definidas = new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));

    // El fallback en sí no puede depender de una variable inexistente.
    const fallbacks = [...todo.matchAll(/var\(\s*--[\w-]+\s*,\s*var\(\s*(--[\w-]+)/g)]
      .map((m) => m[1]);

    expect([...new Set(fallbacks)].filter((v) => !definidas.has(v))).toEqual([]);
  });

  test('ningún archivo usa @import (encadenaría las descargas)', () => {
    expect(todo).not.toMatch(/@import/);
  });
});

// ---------------------------------------------------------------------------
// LA CASCADA ENTRE UN MODIFICADOR Y SU CLASE BASE
//
// EL BUG QUE LA ORIGINÓ
// `.data-table-sm { font-size: .85rem }` vivía en components.css y
// `.data-table { font-size: .875rem }` en tables.css, que carga DESPUÉS. Las
// dos tienen la misma especificidad (0-1-0), así que el empate lo desempata el
// orden de carga: ganaba .data-table y el modificador NO HACÍA NADA. En
// `<table class="data-table data-table-sm">` la letra medía 14px en vez de
// 13.6px. Nadie lo notó nunca — la diferencia es de menos de medio píxel —, y
// eso es justamente lo peligroso: la regla estaba escrita, se leía como si
// funcionara, y no funcionaba.
//
// QUÉ VIGILA EXACTAMENTE
// Sólo los pares que cumplen las TRES condiciones a la vez:
//   1. el nombre de uno es el del otro más un sufijo (`data-table-sm` sobre
//      `data-table`) — o sea, es un modificador y no un elemento hijo;
//   2. los dos aparecen JUNTOS en un mismo class="" del HTML o de una plantilla
//      de JavaScript — o sea, de verdad compiten sobre un elemento real;
//   3. declaran alguna propiedad EN COMÚN — o sea, hay algo que pisar.
// Con las tres, que el modificador se declare antes que la base es un bug
// seguro: gana la base y el modificador se ignora.
//
// Sin las tres se llenaba de falsos positivos: `.sidebar-link` no modifica a
// `.sidebar` (es otro elemento), y `.btn` con `.mb-2` compiten a propósito —
// para eso existen las utilidades. Se probaron las versiones más amplias y
// acusaban una docena de pares legítimos; una guardia ruidosa se termina
// desactivando, y entonces no protege nada.
//
// Se miran sólo las reglas de nivel superior: lo que está dentro de un @media
// pisa A PROPÓSITO — para eso responsive.css va último — y acusarlo sería
// acusar el diseño mismo del paquete.
// ---------------------------------------------------------------------------
/** Reglas de nivel superior de un CSS: {sel, cuerpo}. Descarta las at-rules.
 *  Vive a nivel de archivo porque lo usan dos bloques: el de la cascada entre
 *  archivos y el de declaraciones repetidas dentro de uno solo. */
function reglasDeNivelSuperior(css) {
    const limpio = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const salida = [];
    let i = 0;
    let selector = '';

    while (i < limpio.length) {
      if (limpio[i] !== '{') { selector += limpio[i]; i += 1; continue; }

      let profundidad = 1;
      let j = i + 1;
      while (j < limpio.length && profundidad > 0) {
        if (limpio[j] === '{') profundidad += 1;
        else if (limpio[j] === '}') profundidad -= 1;
        j += 1;
      }
      const sel = selector.trim();
      if (!sel.startsWith('@')) salida.push({ sel, cuerpo: limpio.slice(i + 1, j - 1) });
      selector = '';
      i = j;
    }

    return salida;
}

// ---------------------------------------------------------------------------
describe('un modificador siempre se declara DESPUÉS de su clase base', () => {
  /** Todas las reglas del paquete, numeradas en el orden REAL de la cascada. */
  const reglas = [];
  linkedCss(HTMLS_APP[1]).forEach((archivo) => {
    const css = fs.readFileSync(path.join(CSS_DIR, archivo), 'utf8');
    for (const { sel, cuerpo } of reglasDeNivelSuperior(css)) {
      const propiedades = new Set(
        [...cuerpo.matchAll(/(^|;)\s*([a-z-]+)\s*:/g)].map((m) => m[2])
      );
      for (const uno of sel.split(',').map((s) => s.trim())) {
        // Sólo selectores de UNA sola clase: son los que empatan en
        // especificidad, y por lo tanto los únicos que decide el orden.
        if (/^\.[a-z0-9-]+$/i.test(uno)) {
          reglas.push({ archivo, clase: uno.slice(1), propiedades, n: reglas.length });
        }
      }
    }
  });

  /** Pares base→modificador que de verdad conviven en un mismo elemento. */
  function paresQueConviven() {
    const listar = (dir, exts) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return listar(p, exts);
      return exts.some((x) => e.name.endsWith(x)) ? [p] : [];
    });

    const RAIZ_PUBLIC = path.resolve(__dirname, '../../public');
    const archivos = [
      ...listar(path.join(RAIZ_PUBLIC, 'js'), ['.js']),
      ...listar(RAIZ_PUBLIC, ['.html']).filter((f) => !f.includes(`${path.sep}js${path.sep}`)),
    ];

    const pares = new Set();
    for (const archivo of archivos) {
      const texto = fs.readFileSync(archivo, 'utf8');
      // Se saltea `class="${loQueSea}"`: no se puede resolver acá y sería ruido.
      for (const m of texto.matchAll(/class="([^"$]*)"/g)) {
        const clases = [...new Set(m[1].trim().split(/\s+/).filter(Boolean))];
        for (const base of clases) {
          for (const modificador of clases) {
            if (modificador !== base && modificador.startsWith(`${base}-`)) {
              pares.add(`${base}|${modificador}`);
            }
          }
        }
      }
    }
    return [...pares].map((k) => k.split('|'));
  }

  const pares = paresQueConviven();

  test('la guardia encuentra pares que vigilar (si no, pasaría en vacío para siempre)', () => {
    // Ya pasó en este proyecto: un trinquete que leía 0 casos sobre 29 reales
    // quedaba verde para siempre. Si este número se desploma, lo que se rompió
    // es el lector de clases, no es que se haya limpiado el proyecto.
    expect(pares.length).toBeGreaterThan(15);
  });

  test('ningún modificador queda pisado por su propia clase base', () => {
    const culpables = [];

    for (const [base, modificador] of pares) {
      for (const rm of reglas.filter((r) => r.clase === modificador)) {
        for (const rb of reglas.filter((r) => r.clase === base && r.n > rm.n)) {
          const comunes = [...rb.propiedades].filter((p) => rm.propiedades.has(p));
          if (comunes.length === 0) continue;
          culpables.push(
            `.${modificador} (${rm.archivo}) se declara ANTES de .${base} (${rb.archivo}) ` +
            `y compiten por: ${comunes.join(', ')}`
          );
        }
      }
    }

    if (culpables.length > 0) {
      throw new Error(
        'Estos modificadores no hacen nada — su clase base los pisa:\n  ' +
        [...new Set(culpables)].join('\n  ') +
        '\n\nMisma especificidad (una clase contra una clase): desempata el orden ' +
        'de carga y gana el último. Mové la regla del modificador a un archivo ' +
        'que cargue DESPUÉS del de la base (ver ORDEN_ESPERADO), o más abajo ' +
        'dentro del mismo archivo.'
      );
    }
  });
});

// ---------------------------------------------------------------------------
// La misma clase declarada dos veces EN EL MISMO ARCHIVO.
//
// No es un error de sintaxis y el navegador no se queja: simplemente gana la
// última y las propiedades repetidas de la primera se descartan en silencio.
// El problema es lo que se lee: quien abre el archivo y encuentra la primera
// declaración cree estar viendo lo que se aplica, y no lo está.
//
// Pasó con `.pagination`: la paginación centrada original quedó arriba y el
// control estilo Gmail la volvió a declarar 36 líneas más abajo. De las seis
// propiedades de la primera sólo sobrevivían tres, y nadie lo sabía. Se
// fusionaron en una sola el 2026-08-28.
//
// Se permiten las declaraciones repetidas que NO comparten ninguna propiedad
// (a veces se agrupa por tema a propósito); lo que se prohíbe es que la
// segunda pise a la primera, que es cuando una de las dos miente.
// ---------------------------------------------------------------------------
describe('ninguna clase se declara dos veces en el mismo archivo', () => {
  const archivos = linkedCss(HTMLS_APP[1]);

  test.each(archivos)('%s', (archivo) => {
    const css   = fs.readFileSync(path.join(CSS_DIR, archivo), 'utf8');
    const vistas = new Map();   // clase → [Set(propiedades), …]
    const choques = [];

    for (const { sel, cuerpo } of reglasDeNivelSuperior(css)) {
      const propiedades = new Set(
        [...cuerpo.matchAll(/(^|;)\s*([a-z-]+)\s*:/g)].map((m) => m[2])
      );

      for (const uno of sel.split(',').map((s) => s.trim())) {
        // Sólo el selector de UNA clase sola: `.a .b` o `.a:hover` son otra
        // regla distinta, no una redeclaración de `.a`.
        if (!/^\.[a-z0-9-]+$/i.test(uno)) continue;

        const previas = vistas.get(uno) || [];
        for (const antes of previas) {
          const pisadas = [...propiedades].filter((p) => antes.has(p));
          if (pisadas.length > 0) {
            choques.push(`${uno} — la segunda declaración pisa: ${pisadas.join(', ')}`);
          }
        }
        vistas.set(uno, [...previas, propiedades]);
      }
    }

    if (choques.length > 0) {
      throw new Error(
        `${archivo} declara la misma clase dos veces y la segunda pisa a la primera:\n  ` +
        [...new Set(choques)].join('\n  ') +
        '\n\nFusionalas en una sola declaración con los valores que hoy ganan, ' +
        'así lo que se lee es lo que se aplica.'
      );
    }
  });
});

// ---------------------------------------------------------------------------
describe('los HTML no llevan estilos inline', () => {
  // Un style="" en el HTML se escapa de la hoja de estilos: no se puede
  // reutilizar, no responde a media queries y gana sobre cualquier regla
  // externa, así que el día que alguien intente re-estilar el componente desde
  // el CSS no va a entender por qué no pasa nada.
  test.each(HTMLS.map((h) => [path.basename(h), h]))('%s no tiene atributos style=', (_n, file) => {
    const src = fs.readFileSync(file, 'utf8');
    const inline = [...src.matchAll(/<(\w+)[^>]*\sstyle=/g)].map((m) => m[1]);

    expect(inline).toEqual([]);
  });
});
