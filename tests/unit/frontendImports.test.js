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

  // ── Que el archivo PARSEE ──────────────────────────────────────────────────
  // Sin build step nadie compila nada: un paréntesis sin cerrar no rompe ningún
  // test, rompe la pantalla en blanco del navegador. Pasó de verdad al extraer
  // shared/listSection.js — un reemplazo automático cerró un `content(` en el
  // backtick equivocado (los template literals anidados tienen backticks
  // adentro) y dejó dos paneles con un SyntaxError. Los tests seguían en verde
  // porque solo leían los archivos como texto.
  //
  // @babel/parser ya está instalado (viene con babel-jest) y entiende ESM, así
  // que el chequeo sale gratis y no hace falta lanzar un proceso por archivo.
  test.each(archivos.map((f) => [rel(f), f]))('%s — parsea como ES module', (_nombre, file) => {
    const { parse } = require('@babel/parser');
    const src = fs.readFileSync(file, 'utf8');

    try {
      parse(src, { sourceType: 'module', errorRecovery: false });
    } catch (err) {
      throw new Error(
        `${rel(file)} tiene un error de sintaxis en la línea ${err.loc?.line}: ${err.message}\n` +
        'En el navegador esto deja la pantalla en blanco sin más pista que la consola.'
      );
    }
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

  // ── Usado pero no importado ────────────────────────────────────────────────
  // Los tests de arriba comprueban que lo IMPORTADO exista. Falta el reverso:
  // que lo USADO esté importado. Esa mitad faltaba y dejó pasar un caso real —
  // cuatro paneles llamaban a mountPagination() sin importarlo, y el navegador
  // tiraba «mountPagination is not defined» al abrir cualquier listado.
  //
  // Se acota a los símbolos de public/js/shared/: son los que se comparten
  // entre archivos y, por lo tanto, los que se pueden olvidar al copiar código
  // de un panel a otro.
  describe('símbolos compartidos usados sin importar', () => {
    const SHARED = path.join(ROOT, 'shared');

    /** Nombres exportados por cada módulo de shared/. */
    const compartidos = new Set(
      fs.readdirSync(SHARED)
        .filter((f) => f.endsWith('.js'))
        .flatMap((f) => [...exportedNames(fs.readFileSync(path.join(SHARED, f), 'utf8'))])
    );

    /** Código sin comentarios ni literales: evita falsos positivos. */
    function soloCodigo(src) {
      return src
        .replace(/\/\*[\s\S]*?\*\//g, ' ')      // comentarios de bloque
        .replace(/^\s*\/\/.*$/gm, ' ')          // comentarios de línea
        // Re-exports (`export { escapeHtml as escText } from '…'`): son cañería
        // de módulos, no uso del símbolo. El nombre nunca entra al ámbito local,
        // así que exigir que esté importado sería un falso positivo.
        .replace(/export\s*\{[^}]*\}\s*from\s*['"][^'"]+['"]\s*;?/g, ' ')
        .replace(/`(?:\\.|[^`\\])*`/g, '``')    // template literals
        .replace(/'(?:\\.|[^'\\])*'/g, "''")    // comillas simples
        .replace(/"(?:\\.|[^"\\])*"/g, '""');   // comillas dobles
    }

    /** Nombres que el archivo importa, venga de donde venga. */
    function importados(src) {
      const nombres = new Set();
      for (const { clause } of parseImports(src)) {
        namedImports(clause).forEach((n) => nombres.add(n));
        const porDefecto = /^([A-Za-z0-9_$]+)\s*(,|$)/.exec(clause);
        if (porDefecto) nombres.add(porDefecto[1]);
      }
      return nombres;
    }

    /** Nombres declarados en el propio archivo. */
    function declarados(src) {
      const nombres = new Set();
      for (const m of src.matchAll(/(?:function|class)\s+([A-Za-z0-9_$]+)/g)) nombres.add(m[1]);
      for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z0-9_$]+)/g)) nombres.add(m[1]);
      return nombres;
    }

    test('hay símbolos compartidos que vigilar', () => {
      expect(compartidos.size).toBeGreaterThan(5);
    });

    test.each(archivos.map((f) => [rel(f), f]))('%s', (_nombre, file) => {
      // Los propios módulos de shared/ se exportan a sí mismos.
      if (path.dirname(file) === SHARED) return;

      const src     = fs.readFileSync(file, 'utf8');
      const codigo  = soloCodigo(src);
      const traidos = importados(src);
      const propios = declarados(src);

      const faltantes = [];
      for (const nombre of compartidos) {
        if (traidos.has(nombre) || propios.has(nombre)) continue;
        // Se usa como identificador de código (no como parte de otra palabra).
        if (new RegExp(`\\b${nombre}\\b`).test(codigo)) faltantes.push(nombre);
      }

      if (faltantes.length > 0) {
        throw new Error(
          `${rel(file)} usa [${faltantes.join(', ')}] pero no lo importa ni lo declara. ` +
          `En el navegador esto es un ReferenceError apenas se ejecute esa línea.`
        );
      }
    });
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
