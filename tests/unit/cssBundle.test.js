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
const HTMLS   = ['index.html', 'dashboard.html']
  .map((f) => path.resolve(__dirname, '../../public', f));

/** Los href de CSS de un HTML, en orden de aparición. */
function linkedCss(html) {
  const src = fs.readFileSync(html, 'utf8');
  return [...src.matchAll(/<link\s+rel="stylesheet"\s+href="\/css\/([^"?]+)(?:\?[^"]*)?"/g)]
    .map((m) => m[1]);
}

const archivosEnDisco = fs.readdirSync(CSS_DIR).filter((f) => f.endsWith('.css')).sort();

describe('hoja de estilos dividida', () => {
  test('los dos HTML enlazan exactamente los mismos archivos y en el mismo orden', () => {
    const [a, b] = HTMLS.map(linkedCss);
    expect(a).toEqual(b);
  });

  test('todo archivo enlazado existe en disco', () => {
    for (const html of HTMLS) {
      for (const f of linkedCss(html)) {
        expect(archivosEnDisco).toContain(f);
      }
    }
  });

  test('todo archivo en disco está enlazado (ninguno queda huérfano)', () => {
    const enlazados = new Set(linkedCss(HTMLS[0]));
    expect(archivosEnDisco.filter((f) => !enlazados.has(f))).toEqual([]);
  });

  test('tokens.css va PRIMERO: el resto consume sus variables', () => {
    expect(linkedCss(HTMLS[0])[0]).toBe('tokens.css');
  });

  test('responsive.css va ÚLTIMO: sus media queries deben poder pisar', () => {
    const orden = linkedCss(HTMLS[0]);
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
