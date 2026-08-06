// =============================================================================
// tests/unit/tokensDefinidos.test.js
// Toda variable CSS que el JavaScript usa tiene que existir en la hoja de estilos.
//
// EL BUG QUE ENCONTRÓ ESTE TEST
// Tres lugares usaban `var(--bg-secondary)`, un token que NUNCA se definió:
//
//   proformaTemplate.js   background: var(--bg-secondary,#f8f9fa)
//   notificationsView.js  background: var(--bg-secondary)
//
// Los dos primeros «funcionaban» porque tenían el hex de respaldo — es decir,
// el panel de comentarios del Administrador se pintaba SIEMPRE de gris claro,
// también en los temas oscuros, donde queda una tarjeta casi blanca en medio
// de una pantalla oscura. El tercero no tenía respaldo: `var()` de una variable
// inexistente es un valor inválido, así que la notificación se quedaba
// directamente SIN FONDO.
//
// Ninguno de los tres daba error. Ni en consola, ni al construir, ni en los
// tests — un token mal escrito no se queja, sólo pinta mal. Por eso hace falta
// mirarlo desde afuera.
//
// El nombre correcto era --bg-raised, que ya existía y sí cambia con el tema.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const RAIZ_JS  = path.resolve(__dirname, '../../public/js');
const RAIZ_CSS = path.resolve(__dirname, '../../public/css');

function listar(dir, ext) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? listar(full, ext) : (e.name.endsWith(ext) ? [full] : []);
  });
}

const rel = (p) => path.relative(RAIZ_JS, p).split(path.sep).join('/');

// Todo el CSS junto: un token puede declararse en cualquier hoja.
const CSS = listar(RAIZ_CSS, '.css')
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n');

/** Los nombres declarados, en cualquier bloque (:root, [data-theme], @media). */
const DECLARADOS = new Set(
  [...CSS.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1])
);

// Algunos tokens no se declaran en la hoja de estilos porque su valor sólo se
// conoce al dibujar: --stat-accent lo pone cada tarjeta de indicador con su
// propio color, en el style del elemento. Se cuentan como declarados si algún
// archivo del JavaScript los ASIGNA, no sólo si los lee.
for (const f of listar(RAIZ_JS, '.js')) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*[^;"'`]/g)) {
    DECLARADOS.add(m[1]);
  }
}

// ---------------------------------------------------------------------------
describe('los tokens que usa el JavaScript existen en el CSS', () => {
  // Se recogen con el archivo y la línea para que el mensaje diga dónde mirar.
  const usos = [];
  for (const f of listar(RAIZ_JS, '.js')) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((linea, i) => {
      for (const m of linea.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
        usos.push({ token: m[1], donde: `${rel(f)}:${i + 1}` });
      }
    });
  }

  test('hay tokens en uso (si no, el test no está mirando nada)', () => {
    expect(usos.length).toBeGreaterThan(0);
  });

  test('ninguno apunta a una variable inexistente', () => {
    const huerfanos = usos.filter((u) => !DECLARADOS.has(u.token));

    if (huerfanos.length > 0) {
      const detalle = huerfanos
        .map((u) => `  ${u.token}  —  ${u.donde}`)
        .join('\n');

      throw new Error(
        `Estos tokens no están declarados en public/css/:\n${detalle}\n\n` +
        'Un var() de una variable inexistente no da ningún error: si hay valor ' +
        'de respaldo se usa ese —y entonces el color deja de seguir al tema—, y ' +
        'si no lo hay la propiedad entera se descarta y el elemento se queda sin ' +
        'fondo, sin borde o sin color. Revisá el nombre en public/css/tokens.css.'
      );
    }
  });
});

// ---------------------------------------------------------------------------
describe('los tokens que usa el propio CSS existen', () => {
  test('ninguna hoja apunta a una variable inexistente', () => {
    const usados = new Set(
      [...CSS.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)].map((m) => m[1])
    );

    const huerfanos = [...usados].filter((t) => !DECLARADOS.has(t));

    expect(huerfanos).toEqual([]);
  });
});
