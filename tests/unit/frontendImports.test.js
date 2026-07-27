// =============================================================================
// tests/unit/frontendImports.test.js
// Verifica estáticamente que TODOS los imports de public/js resuelven.
//
// El frontend son ES modules nativos sin bundler: nadie valida los imports en
// tiempo de build. Un archivo mal referenciado o un símbolo que dejó de
// exportarse no rompe ningún test — rompe la pantalla en el navegador, con un
// error de consola que sólo ve quien abra las devtools.
//
// Este test recorre los archivos, parsea sus `import` y comprueba dos cosas:
//   1. el archivo destino existe (rutas relativas, con la extensión .js);
//   2. cada símbolo nombrado está realmente exportado por ese archivo.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../public/js');

/** Lista recursiva de los .js bajo public/js. */
function listJsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return listJsFiles(full);
    return e.name.endsWith('.js') ? [full] : [];
  });
}

/** Sentencias import de un archivo: { clause, source }. */
function parseImports(src) {
  const out = [];
  const re = /import\s+([^;]*?)\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) out.push({ clause: m[1].trim(), source: m[2] });
  return out;
}

/** Nombres importados dentro de las llaves, resolviendo `x as y`. */
function namedImports(clause) {
  const m = /\{([^}]*)\}/.exec(clause);
  if (!m) return [];
  return m[1].split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.split(/\s+as\s+/)[0].trim());
}

/** Símbolos que un archivo exporta con nombre. */
function exportedNames(src) {
  const names = new Set();
  // export function x / export async function x / export class x
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|class)\s+([A-Za-z0-9_$]+)/g)) {
    names.add(m[1]);
  }
  // export const/let/var x
  for (const m of src.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/g)) {
    names.add(m[1]);
  }
  // export { a, b as c }
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => {
      const partes = s.split(/\s+as\s+/);
      names.add((partes[1] ?? partes[0]).trim());
    });
  }
  return names;
}

const archivos = listJsFiles(ROOT);
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

describe('imports del frontend', () => {
  test('hay archivos que revisar', () => {
    expect(archivos.length).toBeGreaterThan(10);
  });

  test.each(archivos.map((f) => [rel(f), f]))('%s — sus imports resuelven', (_nombre, file) => {
    const src = fs.readFileSync(file, 'utf8');
    const dir = path.dirname(file);

    for (const { clause, source } of parseImports(src)) {
      // Sólo se comprueban las rutas relativas: no hay imports de paquetes.
      if (!source.startsWith('.')) continue;

      const destino = path.resolve(dir, source);
      expect(fs.existsSync(destino)).toBe(true);

      const destSrc  = fs.readFileSync(destino, 'utf8');
      const exportados = exportedNames(destSrc);

      for (const nombre of namedImports(clause)) {
        if (!exportados.has(nombre)) {
          throw new Error(
            `${rel(file)} importa { ${nombre} } de '${source}', ` +
            `pero ${rel(destino)} no lo exporta. ` +
            `Exporta: [${[...exportados].sort().join(', ')}]`
          );
        }
      }

      // Un import por defecto exige que el destino tenga `export default`.
      const tieneDefault = /^[A-Za-z0-9_$]+\s*(,|$)/.test(clause);
      if (tieneDefault) {
        expect(destSrc).toMatch(/export\s+default/);
      }
    }
  });

  test('ningún import omite la extensión .js (los ES modules nativos la exigen)', () => {
    const fallas = [];
    for (const file of archivos) {
      for (const { source } of parseImports(fs.readFileSync(file, 'utf8'))) {
        if (source.startsWith('.') && !source.endsWith('.js')) {
          fallas.push(`${rel(file)} → '${source}'`);
        }
      }
    }
    expect(fallas).toEqual([]);
  });
});
