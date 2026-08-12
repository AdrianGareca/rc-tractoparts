// =============================================================================
// tests/unit/botonesConRotulo.test.js
// Ningún botón se dibuja vacío.
//
// EL BUG, QUE INTRODUJE YO
// El barrido de emojis les quitó el contenido a tres botones del detalle de
// licitación y no dejó nada en su lugar:
//
//   <button ... data-doc-download="…"></button>
//   <button ... data-doc-delete="…"></button>
//   <button ... data-gasto-delete="…"></button>
//
// En pantalla quedaban dos cuadraditos idénticos de unos diez píxeles, sin
// texto, sin ícono y sin forma de distinguirlos. El primero descarga el
// adjunto. El segundo lo BORRA, y la confirmación llega después de haber
// apretado. Quien quería descargar acertaba la mitad de las veces.
//
// POR QUÉ NINGÚN TEST LO VIO
// `proformaButtonsWired.test.js` verifica que todo botón dibujado tenga su
// manejador — y estos lo tenían. Funcionaban perfecto: el problema era que no
// se podía saber cuál era cuál. Un botón sin rótulo no está roto para el
// código, sólo para la persona.
//
// LA REGLA
// Un botón tiene que llevar texto, o al menos un aria-label si su contenido es
// puramente gráfico. Sin una de las dos cosas no hay forma de saber qué hace —
// ni mirándolo, ni con un lector de pantalla.
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

/** `<button …>contenido</button>` en una sola pieza. */
const BOTON = /<button\b([^>]*)>([\s\S]*?)<\/button>/g;

// ---------------------------------------------------------------------------
describe('todo botón dice qué hace', () => {
  test.each(archivos.map((f) => [rel(f), f]))('%s', (_n, file) => {
    const src = fs.readFileSync(file, 'utf8');
    const culpables = [];

    for (const m of src.matchAll(BOTON)) {
      const [completo, atributos, contenido] = m;

      // Contenido visible: se descartan los comentarios HTML y los espacios.
      // Una interpolación `${…}` cuenta como contenido: puede traer texto.
      const visible = contenido
        .replace(/<!--[\s\S]*?-->/g, '')
        .trim();

      if (visible.length > 0) continue;

      // Sin texto, un aria-label alcanza — pero sólo si de verdad está.
      if (/\baria-label\s*=\s*["'][^"']+["']/.test(atributos)) continue;

      culpables.push(completo.replace(/\s+/g, ' ').slice(0, 110));
    }

    if (culpables.length > 0) {
      throw new Error(
        `${rel(file)} dibuja ${culpables.length} botón(es) sin rótulo:\n  ` +
        culpables.join('\n  ') +
        '\n\nEn pantalla queda un cuadradito de unos diez píxeles, sin forma de ' +
        'saber qué hace. Ya pasó: el de descargar y el de ELIMINAR un adjunto ' +
        'quedaron idénticos. Poné texto, o un aria-label si el contenido es ' +
        'puramente gráfico.'
      );
    }
  });
});

// ---------------------------------------------------------------------------
describe('los tres que ya se rompieron no vuelven', () => {
  const detalle = fs.readFileSync(
    path.join(RAIZ, 'views', 'dashboard', 'modules', 'licitacion', 'detailModal.js'), 'utf8'
  );

  test.each([
    ['data-doc-download',  'descargar un adjunto'],
    ['data-doc-delete',    'eliminar un adjunto'],
    ['data-gasto-delete',  'eliminar un gasto'],
  ])('el botón de %s tiene texto', (marca, _que) => {
    const re = new RegExp(`<button[^>]*${marca}[^>]*>([\\s\\S]*?)</button>`);
    const m = re.exec(detalle);

    expect(m).not.toBeNull();
    expect(m[1].trim().length).toBeGreaterThan(0);
  });

  test('eliminar un adjunto NO se ve igual que descargarlo', () => {
    // Una acción destructiva no puede tener el mismo aspecto que la de al lado.
    const borrar = /<button([^>]*data-doc-delete[^>]*)>/.exec(detalle)?.[1] ?? '';
    const bajar  = /<button([^>]*data-doc-download[^>]*)>/.exec(detalle)?.[1] ?? '';

    expect(borrar).toMatch(/btn-danger/);
    expect(bajar).not.toMatch(/btn-danger/);
  });
});
