// =============================================================================
// tests/unit/utilidadesFlexCoherentes.test.js
// Una clase que sólo funciona dentro de un contenedor flex exige que el
// contenedor lo sea.
//
// EL BUG QUE LO ORIGINÓ
// La fila para agregar un origen de cliente estaba declarada así:
//
//     <div id="nc-origen-new" class="hidden gap-1 mt-1">
//
// `gap` NO HACE NADA en un elemento de display:block. Al revelar la fila, el
// campo de texto —que es width:100%— ocupaba el ancho entero y los botones
// "Guardar" y "✕" caían debajo, pegados. La fila que tenía que verse como una
// línea se veía como tres cosas apiladas.
//
// De dónde salió: el elemento nacía con `style="display:none"` y el JavaScript
// lo mostraba con `style.display = 'flex'`. Al migrar los estilos inline a la
// clase `.hidden`, el `display:none` quedó bien cubierto —.hidden es
// `display:none !important`— pero el `flex` del otro lado se perdió en el
// camino. Nadie lo notó porque el elemento arranca oculto: hay que apretar el
// "+" para verlo, y recién ahí se nota.
//
// POR QUÉ UNA GUARDIA Y NO UN ARREGLO PUNTUAL
// El mismo descuido cabe en cualquier elemento que arranque oculto: no se ve al
// abrir la pantalla, así que no se revisa. Este test recorre TODO el HTML y todo
// el JavaScript que arma HTML, y busca el patrón entero.
//
// Es la misma forma que el resto de las guardias del proyecto: no vigila una
// función, vigila una propiedad de todo el código.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '../..');

/** Las utilidades que sólo tienen efecto dentro de un contenedor flex o grid. */
const EXIGEN_CONTENEDOR = [
  'gap-1', 'gap-2', 'gap-3',
  'items-center', 'items-end',
  'justify-between', 'justify-end',
];

/** Las clases que efectivamente crean ese contenedor. */
const LO_CREAN = ['flex', 'inline-flex', 'grid', 'inline-flex-gap'];

/**
 * Clases del proyecto que YA traen display:flex en su propia regla de CSS.
 * Un elemento con una de éstas no necesita declarar `flex` además.
 *
 * Se listan a mano y no se deducen del CSS a propósito: la lista corta y
 * explícita se lee de un vistazo, y cada agregado obliga a mirar la regla y
 * confirmar que de verdad trae el display.
 */
const YA_SON_FLEX = [
  'card-header', 'card-footer', 'modal-actions', 'sub-modal-header',
  'client-search-group', 'item-marca-grupo', 'lista-item-compacto',
  'filter-bar', 'stat-card', 'topbar', 'sidebar-user', 'auth-logo-icon',
  'input-password-wrapper', 'btn', 'form-row', 'acciones-fila',
];

function listarArchivos(dir, extensiones) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return listarArchivos(full, extensiones);
    return extensiones.some((x) => e.name.endsWith(x)) ? [full] : [];
  });
}

const archivos = [
  ...listarArchivos(path.join(RAIZ, 'public/js'), ['.js']),
  ...listarArchivos(path.join(RAIZ, 'public'), ['.html']).filter((f) => !f.includes(`${path.sep}js${path.sep}`)),
];

const rel = (p) => path.relative(RAIZ, p).split(path.sep).join('/');

/**
 * Todos los `class="…"` del archivo, con su línea.
 * Cubre tanto el HTML suelto como las plantillas de JavaScript, que usan
 * exactamente la misma sintaxis dentro de la cadena.
 */
function clasesDe(archivo) {
  const lineas = fs.readFileSync(archivo, 'utf8').split(String.fromCharCode(10));
  const encontradas = [];

  lineas.forEach((linea, i) => {
    // Se salta la interpolación: `class="${claseCalculada}"` no se puede leer
    // acá y acusarla sería un falso positivo en cada tabla del sistema.
    const re = /class="([^"$]*)"/g;
    let m;
    while ((m = re.exec(linea)) !== null) {
      encontradas.push({ clases: m[1].trim().split(/\s+/).filter(Boolean), linea: i + 1 });
    }
  });

  return encontradas;
}

// ---------------------------------------------------------------------------
describe('gap y items-* exigen un contenedor que los aplique', () => {
  test('ningún elemento los usa sin ser flex ni grid', () => {
    const culpables = [];

    for (const archivo of archivos) {
      for (const { clases, linea } of clasesDe(archivo)) {
        const usaUtilidad = clases.some((c) => EXIGEN_CONTENEDOR.includes(c));
        if (!usaUtilidad) continue;

        const esContenedor = clases.some((c) => LO_CREAN.includes(c) || YA_SON_FLEX.includes(c));
        if (esContenedor) continue;

        culpables.push(`${rel(archivo)}:${linea}  class="${clases.join(' ')}"`);
      }
    }

    if (culpables.length > 0) {
      throw new Error(
        `Estos elementos usan una utilidad de flex sin ser un contenedor flex:\n  ` +
        culpables.join('\n  ') +
        `\n\ngap y items-* NO HACEN NADA en display:block. Agregá la clase 'flex' ` +
        `(o 'grid'), o sumá la clase del elemento a YA_SON_FLEX si su propia regla ` +
        `de CSS ya trae el display.\n\n` +
        `Es especialmente fácil de pasar por alto en un elemento que arranca ` +
        `oculto: no se ve al abrir la pantalla y nadie lo revisa hasta que un ` +
        `usuario aprieta el botón que lo revela.`
      );
    }
  });
});

// ---------------------------------------------------------------------------
describe('la guardia mira algo', () => {
  test('encuentra elementos con estas utilidades', () => {
    // Si el lector de clases devolviera vacío, el test de arriba pasaría para
    // siempre sin vigilar nada. Ya pasó en este proyecto con el trinquete de
    // colores: reportaba 0 sobre 29 reales y la prueba pasaba igual.
    const total = archivos
      .flatMap(clasesDe)
      .filter(({ clases }) => clases.some((c) => EXIGEN_CONTENEDOR.includes(c)))
      .length;

    expect(total).toBeGreaterThan(10);
  });

  test('detectaría el caso que originó la guardia', () => {
    // El class exacto que tenía la fila de origen nuevo antes del arreglo.
    const clases = ['hidden', 'gap-1', 'mt-1'];

    const usaUtilidad  = clases.some((c) => EXIGEN_CONTENEDOR.includes(c));
    const esContenedor = clases.some((c) => LO_CREAN.includes(c) || YA_SON_FLEX.includes(c));

    expect(usaUtilidad).toBe(true);
    expect(esContenedor).toBe(false);   // o sea: se lo acusaría, que es lo correcto
  });
});
