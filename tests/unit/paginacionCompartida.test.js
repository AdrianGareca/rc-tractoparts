// =============================================================================
// tests/unit/paginacionCompartida.test.js
// El bloque `pagination` es el mismo en toda la API.
//
// EL PROBLEMA QUE DESTAPÓ
// Cuatro controladores lo armaban a mano y los cuatro habían quedado distintos.
// El peor: clientController no mandaba `hasNext` ni `hasPrev`, mientras los
// otros tres sí. No rompía la pantalla —el control del navegador sólo lee
// `totalPages`— pero deja un contrato de API que la documentación describe
// igual para todos y el código cumple de tres formas.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const { construirPaginacion } = require('../../src/utils/paginacion');

const RAIZ = path.resolve(__dirname, '../../src');

function listarJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? listarJs(full) : (e.name.endsWith('.js') ? [full] : []);
  });
}
const archivos = listarJs(RAIZ);
const rel = (p) => path.relative(RAIZ, p).split(path.sep).join('/');

// ---------------------------------------------------------------------------
describe('construirPaginacion — la aritmética', () => {
  test('una página exacta', () => {
    expect(construirPaginacion({ page: 1, limit: 10, totalRecords: 10 }))
      .toEqual({ page: 1, limit: 10, totalRecords: 10, totalPages: 1, hasNext: false, hasPrev: false });
  });

  test('una página parcial cuenta igual', () => {
    // 25 registros de a 10 son tres páginas, la última con cinco.
    const p = construirPaginacion({ page: 1, limit: 10, totalRecords: 25 });
    expect(p.totalPages).toBe(3);
    expect(p.hasNext).toBe(true);
  });

  test('la última página no ofrece siguiente', () => {
    const p = construirPaginacion({ page: 3, limit: 10, totalRecords: 25 });
    expect(p.hasNext).toBe(false);
    expect(p.hasPrev).toBe(true);
  });

  test('sin registros sigue siendo «página 1 de 1»', () => {
    // Decir «página 1 de 0» confunde, y el control del navegador dibujaría un
    // rango imposible.
    const p = construirPaginacion({ page: 1, limit: 20, totalRecords: 0 });
    expect(p.totalPages).toBe(1);
    expect(p.hasNext).toBe(false);
    expect(p.hasPrev).toBe(false);
  });

  test.each([
    [0,    'un limit en cero produciría Infinity en la división'],
    [-5,   'un limit negativo'],
    [null, 'un limit ausente'],
  ])('un limit inválido (%s) no rompe — %s', (limit) => {
    const p = construirPaginacion({ page: 1, limit, totalRecords: 50 });
    expect(Number.isFinite(p.totalPages)).toBe(true);
    expect(p.totalPages).toBeGreaterThanOrEqual(1);
  });

  test('una página menor a 1 se normaliza', () => {
    expect(construirPaginacion({ page: 0, limit: 10, totalRecords: 50 }).page).toBe(1);
    expect(construirPaginacion({ page: -3, limit: 10, totalRecords: 50 }).page).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe('las dos fórmulas de hasNext que había eran equivalentes', () => {
  // Se comprueba en vez de afirmarlo: la que usaba reportesController era
  // `page * limit < totalRecords` y la de los otros dos `page < totalPages`.
  // Dan lo mismo para toda entrada válida — pero eso era suerte, no diseño.
  test('coinciden en todo el rango probado', () => {
    const distintos = [];

    for (const total of [0, 1, 9, 10, 11, 25, 100, 101]) {
      for (const limit of [1, 10, 20, 50]) {
        const totalPages = Math.max(1, Math.ceil(total / limit));
        for (let page = 1; page <= totalPages + 1; page++) {
          const vieja = page * limit < total;
          const nueva = construirPaginacion({ page, limit, totalRecords: total }).hasNext;
          if (vieja !== nueva) distintos.push({ total, limit, page, vieja, nueva });
        }
      }
    }

    expect(distintos).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('nadie vuelve a calcular las páginas a mano', () => {
  const TOPE = 0;

  const contar = () => archivos.reduce((total, f) => {
    if (rel(f) === 'utils/paginacion.js') return total;

    const src = fs.readFileSync(f, 'utf8');
    return total + src.split(String.fromCharCode(10)).reduce((n, linea) => {
      const t = linea.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return n;
      return n + (/Math\.ceil\(\s*total(Records)?\s*\//.test(t) ? 1 : 0);
    }, 0);
  }, 0);

  test(`no hay más de ${TOPE} cálculos de totalPages a mano`, () => {
    const actual = contar();

    if (actual > TOPE) {
      throw new Error(
        `Hay ${actual} cálculos de totalPages escritos a mano y el tope es ${TOPE}.\n\n` +
        'Usá construirPaginacion({ page, limit, totalRecords }) de ' +
        'src/utils/paginacion.js. Las copias a mano ya divergieron una vez: uno ' +
        'de los cuatro controladores no mandaba hasNext ni hasPrev.'
      );
    }
  });
});
