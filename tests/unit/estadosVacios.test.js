// =============================================================================
// tests/unit/estadosVacios.test.js
// El panel que no tiene nada que mostrar.
//
// POR QUÉ ESTE ES EL PEOR LUGAR PARA UN EMOJI
// El estado vacío era `.empty-state-icon { font-size: 2.5rem; opacity: .5 }` con
// un emoji adentro: un 📋 gigante y desvaído flotando sobre el panel. Es el tic
// visual más reconocible del software generado, y aparece justo cuando la
// persona no encontró lo que buscaba — el momento en que menos ganas tiene de
// que le hablen con dibujitos.
//
// Además el emoji es multicolor por definición: no hereda el color del texto,
// no se apaga con el resto del estado vacío, y se dibuja distinto en cada
// sistema operativo. La barra lateral ya resolvió esto con SVG monocromo que usa
// `currentColor` (ver shared/icons.js); acá se usa el mismo lenguaje.
//
// EL OTRO PROBLEMA QUE ARREGLA
// El marcado del estado vacío estaba escrito TRES veces: en listSection.js y a
// mano en las dos estrategias. Las copias a mano ya se habían desincronizado
// (ninguna de las dos pasa por escapeHtml). Un estado vacío es una sola idea y
// tiene que tener un solo dueño.
// =============================================================================

'use strict';

import fs from 'fs';
import path from 'path';
import { createListSection } from '../../public/js/shared/listSection.js';
import { stateIcon, EMPTY_ICONS } from '../../public/js/shared/icons.js';

const RAIZ = path.resolve(__dirname, '../../public/js');

function listarJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? listarJs(full) : (e.name.endsWith('.js') ? [full] : []);
  });
}
const archivos = listarJs(RAIZ);
const rel = (p) => path.relative(RAIZ, p).split(path.sep).join('/');

/** Un contenedor mínimo: alcanza con innerHTML para lo que se verifica acá. */
const fakeEl = () => ({ innerHTML: '' });

// ---------------------------------------------------------------------------
describe('el estado vacío dibuja un ícono de trazo, no un emoji', () => {
  test('empty() emite un <svg> que hereda el color del texto', () => {
    const resultsEl = fakeEl();
    const seccion = createListSection({ resultsEl, paginationEl: fakeEl(), columnas: 5 });

    seccion.empty({ icono: 'cotizaciones', titulo: 'Sin resultados', texto: 'Probá con otro filtro.' });

    expect(resultsEl.innerHTML).toMatch(/<svg/);
    expect(resultsEl.innerHTML).toMatch(/currentColor/);
    expect(resultsEl.innerHTML).toContain('Sin resultados');
    expect(resultsEl.innerHTML).toContain('Probá con otro filtro.');
  });

  test('el ícono es decorativo para un lector de pantalla', () => {
    // El título y el texto ya dicen qué pasa. Un lector que además anuncie el
    // dibujo repite la misma información con otras palabras.
    const resultsEl = fakeEl();
    createListSection({ resultsEl, paginationEl: fakeEl(), columnas: 3 })
      .empty({ icono: 'busqueda', titulo: 'Sin resultados' });

    expect(resultsEl.innerHTML).toMatch(/aria-hidden="true"/);
  });

  test('sigue escapando el texto que le pasa el panel', () => {
    const resultsEl = fakeEl();
    createListSection({ resultsEl, paginationEl: fakeEl(), columnas: 3 })
      .empty({ icono: 'busqueda', titulo: '<img src=x onerror=alert(1)>', texto: 'a & b' });

    expect(resultsEl.innerHTML).not.toContain('<img');
    expect(resultsEl.innerHTML).toContain('&amp;');
  });

  test('un nombre desconocido no rompe el panel', () => {
    // Vale más un estado vacío sin dibujo que una excepción que deja el panel
    // colgado mostrando el esqueleto para siempre.
    const resultsEl = fakeEl();
    expect(() => {
      createListSection({ resultsEl, paginationEl: fakeEl(), columnas: 3 })
        .empty({ icono: 'no-existe', titulo: 'Sin resultados' });
    }).not.toThrow();

    expect(resultsEl.innerHTML).toContain('Sin resultados');
    expect(stateIcon('no-existe')).toBe('');
  });
});

// ---------------------------------------------------------------------------
describe('el estado vacío tiene un solo dueño', () => {
  // Las copias a mano son las que se desincronizan: cuando se agregó escapeHtml
  // al componente compartido, las dos de las estrategias se quedaron sin él.
  test('sólo listSection.js escribe el marcado de .empty-state-icon', () => {
    const culpables = archivos
      .filter((f) => rel(f) !== 'shared/listSection.js')
      .filter((f) => /class="empty-state-icon"/.test(fs.readFileSync(f, 'utf8')))
      .map(rel);

    if (culpables.length > 0) {
      throw new Error(
        `Estos archivos dibujan el estado vacío a mano en vez de usar el ` +
        `componente compartido:\n  ${culpables.join('\n  ')}\n\n` +
        'Un estado vacío es una sola idea: usá seccion.empty({ icono, titulo, texto }) ' +
        'o emptyState({ ... }) de shared/listSection.js. Las copias a mano se ' +
        'desincronizan — las dos que había ya se habían quedado sin escapeHtml.'
      );
    }
  });
});

// ---------------------------------------------------------------------------
describe('todos los íconos que se piden existen', () => {
  // Un nombre mal escrito no rompe nada: deja el estado vacío sin dibujo y no
  // avisa. Es exactamente el tipo de error que nadie nota hasta la demo.
  const pedidos = new Set();
  for (const f of archivos) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/icono:\s*'([^']+)'/g)) pedidos.add(m[1]);
  }

  test('hay al menos un panel pidiendo ícono', () => {
    expect(pedidos.size).toBeGreaterThan(0);
  });

  test('cada nombre pedido está definido en EMPTY_ICONS', () => {
    const faltantes = [...pedidos].filter((n) => !(n in EMPTY_ICONS));
    expect(faltantes).toEqual([]);
  });
});
