// =============================================================================
// tests/unit/visibilidadPorClase.test.js
// Un elemento se oculta SIEMPRE de la misma forma.
//
// EL BUG, QUE INTRODUJE YO
// Al migrar los estilos inline al CSS cambié varios `style="display:none"` por
// `class="hidden"`. Pero el JavaScript que los mostraba seguía usando
// `elemento.style.display = ''`.
//
// `.hidden` está declarada como `display: none !important` (public/css/base.css).
// Un estilo inline NUNCA le gana a un !important de clase, así que esos
// elementos quedaron ocultos para siempre — sin un solo error en consola.
//
// LO QUE ROMPIÓ, HASTA QUE UNA AUDITORÍA LO ENCONTRÓ
//
//   • El botón «Detalle» de la bitácora: primer clic sin efecto, segundo clic
//     cambiando el rótulo a «Ocultar» con la fila todavía invisible. El JSON
//     de cada evento quedó inaccesible desde la interfaz.
//   • El alta de «Origen del cliente»: la fila no aparecía, y el focus() sobre
//     un elemento oculto tampoco mueve el cursor. Consecuencia de negocio: el
//     catálogo de orígenes no crecía nunca, y el reporte «Clientes por origen»
//     quedaba permanentemente en «Sin clasificar».
//
// LA REGLA
// Si un elemento nace con `class="hidden"`, se muestra y se oculta con
// classList. Mezclar los dos mecanismos hace que el estado final dependa de
// cuál escribió último — y con !important de por medio, siempre gana la clase.
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
const rel = (p) => path.relative(RAIZ, p).split(path.sep).join('/');

// ---------------------------------------------------------------------------
describe('.hidden tiene !important — nadie puede pelearle con style.display', () => {
  test('la clase sigue siendo !important (si no, este test no protege nada)', () => {
    const base = fs.readFileSync(
      path.resolve(__dirname, '../../public/css/base.css'), 'utf8'
    );
    // Si alguien le saca el !important, la premisa de este archivo cambia y
    // conviene enterarse acá y no por una pantalla que dejó de andar.
    expect(base).toMatch(/\.hidden\s*\{[^}]*display:\s*none\s*!important/);
  });
});

// ---------------------------------------------------------------------------
describe('un archivo no mezcla los dos mecanismos de visibilidad', () => {
  test.each(archivos.map((f) => [rel(f), f]))('%s', (_n, file) => {
    const src = fs.readFileSync(file, 'utf8');

    // Ids de elementos que la plantilla dibuja YA con la clase .hidden.
    const ocultosPorClase = new Set();
    for (const m of src.matchAll(/<[^<>]*\bid="([^"]+)"[^<>]*\bclass="([^"]*)"[^<>]*>/g)) {
      if (/\bhidden\b/.test(m[2])) ocultosPorClase.add(m[1]);
    }
    for (const m of src.matchAll(/<[^<>]*\bclass="([^"]*)"[^<>]*\bid="([^"]+)"[^<>]*>/g)) {
      if (/\bhidden\b/.test(m[1])) ocultosPorClase.add(m[2]);
    }

    if (ocultosPorClase.size === 0) return;

    // ¿Alguna variable que se obtuvo con uno de esos ids toca style.display?
    const culpables = [];
    for (const id of ocultosPorClase) {
      // `const x = ...querySelector('#ese-id')` → nombre de la variable
      const decl = new RegExp(
        `(?:const|let|var)\\s+([A-Za-z0-9_$]+)\\s*=[^;]*['"\`]#${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`
      );
      const m = decl.exec(src);
      if (!m) continue;

      const usaStyle = new RegExp(`\\b${m[1]}\\.style\\.display\\s*=`);
      if (usaStyle.test(src)) culpables.push(`#${id} (variable ${m[1]})`);
    }

    if (culpables.length > 0) {
      throw new Error(
        `${rel(file)} dibuja estos elementos con class="hidden" pero los ` +
        `muestra/oculta con style.display:\n  ${culpables.join('\n  ')}\n\n` +
        '.hidden es `display: none !important`, así que el estilo inline no le ' +
        'gana: el elemento queda oculto para siempre, sin ningún error en ' +
        'consola. Usá classList.add/remove/toggle("hidden").'
      );
    }
  });
});

// ---------------------------------------------------------------------------
describe('los dos casos que ya se rompieron no vuelven', () => {
  // Se fijan por nombre porque son los que costó encontrar: ninguno daba error
  // y los dos rompían una función completa del producto.
  test.each([
    ['modules/auditView.js',   'audit-detail-row', 'el detalle de la bitácora'],
    ['modules/clientModal.js', 'nc-origen-new',    'el alta de origen de cliente'],
  ])('%s — %s se alterna con classList', (archivo, marca, _que) => {
    const src = fs.readFileSync(path.join(RAIZ, 'views', 'dashboard', archivo), 'utf8');

    expect(src).toContain(marca);
    // La prueba concreta: en ese archivo no queda ningún `.style.display =`.
    const sinComentarios = src
      .split(String.fromCharCode(10))
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join(String.fromCharCode(10));

    expect(sinComentarios).not.toMatch(/\.style\.display\s*=/);
  });
});
