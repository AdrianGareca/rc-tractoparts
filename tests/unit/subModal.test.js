// =============================================================================
// tests/unit/subModal.test.js
// El sub-modal siempre se anuncia con nombre.
//
// EL BUG QUE ORIGINÓ ESTO
// Cinco módulos creaban la ventana a mano con las mismas cuatro líneas, y sólo
// UNO ponía `aria-labelledby`. Los otros cuatro son diálogos que un lector de
// pantalla abre y anuncia sin decir de qué son: la persona escucha «diálogo» y
// tiene que explorar el contenido para saber si está registrando un cliente o
// mirando el detalle de una licitación.
//
// No lo nota nadie mirando la pantalla. Por eso llevaba así desde el principio,
// y por eso hace falta una prueba y no buena voluntad.
// =============================================================================

'use strict';

import fs from 'fs';
import path from 'path';
import { crearSubModal } from '../../public/js/shared/subModal.js';

/** DOM mínimo: sólo lo que usa crearSubModal. */
function fakeDom() {
  const creados = [];

  const nodo = () => {
    const el = {
      className: '',
      innerHTML: '',
      atributos: {},
      hijos: [],
      escuchas: {},
      setAttribute: (k, v) => { el.atributos[k] = v; },
      getAttribute: (k) => el.atributos[k],
      appendChild: (h) => el.hijos.push(h),
      remove: () => { el.removido = true; },
      addEventListener: (ev, fn) => { el.escuchas[ev] = fn; },
      querySelector: () => ({ addEventListener: () => {} }),
      removido: false,
    };
    creados.push(el);
    return el;
  };

  global.document = { createElement: nodo, body: nodo() };
  return { creados };
}

beforeEach(fakeDom);

// ---------------------------------------------------------------------------
describe('crearSubModal — accesibilidad', () => {
  test('declara los tres atributos de un diálogo', () => {
    const { overlay } = crearSubModal({ titulo: 'Nuevo cliente', cuerpo: '<p>x</p>' });

    expect(overlay.getAttribute('role')).toBe('dialog');
    expect(overlay.getAttribute('aria-modal')).toBe('true');
    expect(overlay.getAttribute('aria-labelledby')).toBeTruthy();
  });

  test('el aria-labelledby apunta a un id que EXISTE en el marcado', () => {
    // Un aria-labelledby que apunta a la nada es peor que no ponerlo: el lector
    // no anuncia nada y además nadie sospecha que falte.
    const { overlay } = crearSubModal({ titulo: 'Detalle', cuerpo: '' });
    const id = overlay.getAttribute('aria-labelledby');

    expect(overlay.innerHTML).toContain(`id="${id}"`);
  });

  test('dos sub-modales abiertos a la vez no comparten el id del título', () => {
    // Si lo compartieran, el segundo se anunciaría con el título del primero.
    const a = crearSubModal({ titulo: 'Uno', cuerpo: '' });
    const b = crearSubModal({ titulo: 'Dos', cuerpo: '' });

    expect(a.overlay.getAttribute('aria-labelledby'))
      .not.toBe(b.overlay.getAttribute('aria-labelledby'));
  });

  test('el título se escapa: no puede inyectar marcado', () => {
    const { overlay } = crearSubModal({ titulo: '<img src=x onerror=alert(1)>', cuerpo: '' });

    expect(overlay.innerHTML).not.toContain('<img src=x');
    expect(overlay.innerHTML).toContain('&lt;img');
  });
});

// ---------------------------------------------------------------------------
describe('crearSubModal — comportamiento', () => {
  test('el clic en el fondo cierra, el de adentro no', () => {
    const { overlay } = crearSubModal({ titulo: 'X', cuerpo: '' });

    // Clic que sube desde el contenido: el objetivo NO es el fondo.
    overlay.escuchas.click({ target: { distinto: true } });
    expect(overlay.removido).toBe(false);

    // Clic en el fondo mismo.
    overlay.escuchas.click({ target: overlay });
    expect(overlay.removido).toBe(true);
  });

  test('la variante ancha agrega su clase', () => {
    expect(crearSubModal({ titulo: 'X', cuerpo: '', ancho: true }).overlay.innerHTML)
      .toContain('sub-modal-wide');
    expect(crearSubModal({ titulo: 'X', cuerpo: '' }).overlay.innerHTML)
      .not.toContain('sub-modal-wide');
  });
});

// ---------------------------------------------------------------------------
describe('nadie vuelve a armar el sub-modal a mano', () => {
  const RAIZ = path.resolve(__dirname, '../../public/js');

  function listarJs(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      return e.isDirectory() ? listarJs(full) : (e.name.endsWith('.js') ? [full] : []);
    });
  }

  // Cinco al empezar. Cada uno que se migre baja este número.
  const TOPE = 5;

  test(`no hay más de ${TOPE} módulos creando el overlay a mano`, () => {
    const culpables = listarJs(RAIZ)
      .filter((f) => path.basename(f) !== 'subModal.js')
      .filter((f) => /className\s*=\s*'sub-modal-overlay'/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(RAIZ, f).split(path.sep).join('/'));

    if (culpables.length > TOPE) {
      throw new Error(
        `${culpables.length} módulos arman el sub-modal a mano y el tope es ${TOPE}:\n  ` +
        culpables.join('\n  ') +
        '\n\nUsá crearSubModal() de shared/subModal.js. Las copias a mano ya ' +
        'divergieron: sólo una de las cinco ponía aria-labelledby.'
      );
    }
  });
});
