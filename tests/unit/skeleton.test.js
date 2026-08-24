// =============================================================================
// tests/unit/skeleton.test.js
// Los esqueletos de carga (public/js/shared/skeleton.js).
//
// QUÉ SE PROTEGE
// Un esqueleto no tiene lógica de negocio, así que lo que puede romperse es
// justamente lo que nadie mira: los atributos de accesibilidad. Si se pierde el
// aria-hidden de las barras, un lector de pantalla se pone a enumerar una
// docena de divs vacíos; si se pierde el aria-busy o el texto sólo-lectores,
// no anuncia nada y la persona no sabe que hay algo cargando.
//
// También se fija que el esqueleto tenga la MISMA cantidad de columnas que la
// tabla que va a reemplazar: si no coincide, al llegar los datos la página
// pega el salto que el esqueleto venía justamente a evitar.
// =============================================================================

'use strict';

import { tableSkeleton, cardsSkeleton } from '../../public/js/shared/skeleton.js';

const contar = (html, patron) => (html.match(patron) || []).length;

// ---------------------------------------------------------------------------
describe('tableSkeleton', () => {
  test('dibuja la cantidad de filas y columnas pedida', () => {
    const html = tableSkeleton({ filas: 4, columnas: 5 });

    // 4 filas de datos + 1 de cabecera
    expect(contar(html, /class="skeleton-row"/g)).toBe(4);
    expect(contar(html, /skeleton-row-head/g)).toBe(1);
    // (4 + 1) filas x 5 columnas
    expect(contar(html, /class="skeleton-cell"/g)).toBe(25);
  });

  test('tiene valores por defecto razonables', () => {
    const html = tableSkeleton();
    expect(contar(html, /class="skeleton-row"/g)).toBe(6);
    expect(contar(html, /class="skeleton-cell"/g)).toBe(42);   // (6+1) x 6
  });

  test('las barras no tienen todas el mismo ancho', () => {
    // Una grilla de barras idénticas se lee como "tabla cargando"; con anchos
    // desparejos se lee como texto, que es el efecto buscado.
    const html = tableSkeleton({ filas: 4, columnas: 4 });
    const anchos = new Set([...html.matchAll(/width:(\d+%)/g)].map((m) => m[1]));
    expect(anchos.size).toBeGreaterThan(2);
  });
});

// ---------------------------------------------------------------------------
describe('accesibilidad', () => {
  test.each([
    ['tableSkeleton', tableSkeleton()],
    ['cardsSkeleton', cardsSkeleton()],
  ])('%s anuncia que está cargando', (_n, html) => {
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toMatch(/<span class="sr-only">[^<]+…<\/span>/);
  });

  test.each([
    ['tableSkeleton', tableSkeleton()],
    ['cardsSkeleton', cardsSkeleton()],
  ])('%s esconde las barras decorativas del lector de pantalla', (_n, html) => {
    expect(html).toContain('aria-hidden="true"');
  });

  test('la etiqueta se puede personalizar por panel', () => {
    expect(tableSkeleton({ etiqueta: 'Cargando licitaciones' }))
      .toContain('Cargando licitaciones…');
    expect(cardsSkeleton({ etiqueta: 'Cargando indicadores' }))
      .toContain('Cargando indicadores…');
  });
});

// ---------------------------------------------------------------------------
describe('cardsSkeleton', () => {
  test('dibuja la cantidad de tarjetas pedida', () => {
    expect(contar(cardsSkeleton({ tarjetas: 3 }), /class="skeleton-card"/g)).toBe(3);
    expect(contar(cardsSkeleton(), /class="skeleton-card"/g)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// El detalle que hace que el esqueleto sirva de algo: si tiene menos columnas
// que la tabla real, al llegar los datos la página se reacomoda igual.
// ---------------------------------------------------------------------------
describe('los paneles piden la cantidad de columnas de SU tabla', () => {
  const fs   = require('fs');
  const path = require('path');
  const RAIZ = path.resolve(__dirname, '../../public/js/views/dashboard');

  const PANELES = [
    ['modules/allQuotationsTab.js', 10],
    ['modules/auditView.js',        7],
    ['modules/clientsView.js',      6],
    ['modules/licitacionesView.js', 7],
  ];

  test.each(PANELES)('%s usa %i columnas', (archivo, columnas) => {
    const src = fs.readFileSync(path.join(RAIZ, archivo), 'utf8');

    // Todas las llamadas del archivo declaran esa misma cantidad.
    const usadas = [...src.matchAll(/tableSkeleton\(\{\s*columnas:\s*(\d+)/g)]
      .map((m) => Number(m[1]));

    expect(usadas.length).toBeGreaterThan(0);
    expect([...new Set(usadas)]).toEqual([columnas]);
  });

  test('ningún panel quedó con el spinner viejo', () => {
    const archivos = fs.readdirSync(path.join(RAIZ, 'modules'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => path.join(RAIZ, 'modules', f))
      .concat(fs.readdirSync(path.join(RAIZ, 'strategies'))
        .filter((f) => f.endsWith('.js'))
        .map((f) => path.join(RAIZ, 'strategies', f)));

    const conSpinner = archivos
      .filter((f) => fs.readFileSync(f, 'utf8').includes('class="page-loading"'))
      .map((f) => path.basename(f));

    expect(conSpinner).toEqual([]);
  });
});
