// =============================================================================
// tests/unit/pagination.test.js
// El control de paginación compartido (public/js/shared/pagination.js).
//
// QUÉ REEMPLAZÓ
// Cuatro paneles tenían la misma función renderPagination copiada, idéntica
// salvo el prefijo de los id. Mostraba «Página 3 de 122» con Anterior y
// Siguiente: para llegar a la página 122 había que hacer 119 clics, así que en
// la práctica los registros viejos eran inalcanzables.
//
// LO QUE SE PIN-EA
//   • La aritmética del rango. Es la parte que se rompe en silencio: un
//     off-by-one en «101–150 de 6.058» nadie lo denuncia, simplemente el número
//     queda mal para siempre.
//   • Los bordes: primera página, última, cero resultados, una sola página.
//   • Que destroy() saque los listeners de document. Sin eso cada recarga de la
//     tabla apila un par más sobre un menú que ya no existe.
//
// Corre sobre un DOM mínimo hecho a mano: el proyecto no tiene jsdom, y para
// verificar HTML generado + wiring de eventos alcanza con esto.
// =============================================================================

'use strict';

import { mountPagination, ETIQUETAS_FECHA, ETIQUETAS_ALFABETICAS } from '../../public/js/shared/pagination.js';

// ---------------------------------------------------------------------------
// DOM mínimo. Sólo lo que el módulo usa: innerHTML, querySelector,
// addEventListener y los atributos de los botones.
// ---------------------------------------------------------------------------
function crearEntorno() {
  const listeners = { document: [] };

  const nodoDesde = (html) => {
    // Parser burdo pero suficiente: se extraen los elementos con data-pag y sus
    // atributos, que es todo lo que las aserciones necesitan.
    const nodos = {};
    for (const m of html.matchAll(/<(button|select)([^>]*?)data-pag="([\w-]+)"([^>]*)>/g)) {
      const attrs = m[2] + m[4];
      nodos[m[3]] = {
        tag: m[1],
        disabled: /\bdisabled\b/.test(attrs),
        _handlers: {},
        value: (/value="(\d+)"[^>]*selected/.exec(html) || [])[1],
        addEventListener(evt, fn) { (this._handlers[evt] ||= []).push(fn); },
        setAttribute(k, v) { this[k] = v; },
        getAttribute(k) { return this[k]; },
        focus() { this.focused = true; },
        click(extra = {}) {
          (this._handlers.click || []).forEach((fn) =>
            fn({ stopPropagation() {}, target: this, ...extra }));
        },
        change(valor) {
          (this._handlers.change || []).forEach((fn) => fn({ target: { value: valor } }));
        },
      };
    }
    // El panel del menú es un div, no un button.
    if (/data-pag="menu-panel"/.test(html)) {
      nodos['menu-panel'] = { hidden: true, _handlers: {}, addEventListener() {} };
    }
    return nodos;
  };

  let nodos = {};
  const contenedor = {
    get innerHTML() { return this._html || ''; },
    set innerHTML(v) { this._html = v; nodos = nodoDesde(v); },
    querySelector(sel) {
      const m = /\[data-pag="([\w-]+)"\]/.exec(sel);
      return m ? (nodos[m[1]] ?? null) : null;
    },
  };

  global.document = {
    addEventListener(evt, fn) { listeners.document.push([evt, fn]); },
    removeEventListener(evt, fn) {
      const i = listeners.document.findIndex(([e, f]) => e === evt && f === fn);
      if (i >= 0) listeners.document.splice(i, 1);
    },
  };

  return { contenedor, listeners, nodos: () => nodos };
}

const montar = (paginacion, opciones = {}) => {
  const env = crearEntorno();
  const destroy = mountPagination(env.contenedor, paginacion, { onChange: () => {}, ...opciones });
  return { ...env, destroy, html: env.contenedor.innerHTML };
};

// ===========================================================================
describe('el rango que se muestra', () => {
  test('primera página: 1-20 de 6058', () => {
    const { html } = montar({ page: 1, limit: 20, totalRecords: 6058, totalPages: 303 });
    expect(html).toContain('1–20 de 6.058');
  });

  test('página intermedia: 101-150 de 6058', () => {
    const { html } = montar({ page: 3, limit: 50, totalRecords: 6058, totalPages: 122 });
    expect(html).toContain('101–150 de 6.058');
  });

  // El borde clásico: la última página casi nunca está completa, y mostrar
  // «6.051–6.100» cuando sólo hay 6.058 es el error que nadie reporta.
  test('la última página no miente sobre el tope', () => {
    const { html } = montar({ page: 122, limit: 50, totalRecords: 6058, totalPages: 122 });
    expect(html).toContain('6.051–6.058 de 6.058');
  });

  test('sin resultados no inventa un «1–0 de 0»', () => {
    const { html } = montar({ page: 1, limit: 20, totalRecords: 0, totalPages: 1 });
    expect(html).toContain('Sin resultados');
    expect(html).not.toContain('1–0');
  });

  test('un solo registro', () => {
    const { html } = montar({ page: 1, limit: 20, totalRecords: 1, totalPages: 1 });
    expect(html).toContain('1–1 de 1');
  });

  test('los miles se separan como se escriben en Bolivia', () => {
    const { html } = montar({ page: 1, limit: 20, totalRecords: 6058, totalPages: 303 });
    expect(html).toContain('6.058');
    expect(html).not.toContain('6,058');
  });
});

// ===========================================================================
describe('qué se puede hacer desde cada página', () => {
  test('en la primera, no se puede retroceder ni «ir al principio»', () => {
    const { nodos } = montar({ page: 1, limit: 20, totalRecords: 100, totalPages: 5 });
    expect(nodos().prev.disabled).toBe(true);
    expect(nodos().first.disabled).toBe(true);
    expect(nodos().next.disabled).toBe(false);
    expect(nodos().last.disabled).toBe(false);
  });

  test('en la última, al revés', () => {
    const { nodos } = montar({ page: 5, limit: 20, totalRecords: 100, totalPages: 5 });
    expect(nodos().next.disabled).toBe(true);
    expect(nodos().last.disabled).toBe(true);
    expect(nodos().prev.disabled).toBe(false);
  });

  test('con una sola página, el control igual se muestra', () => {
    // Antes desaparecía (`if (totalPages <= 1) return`), así que la pantalla no
    // decía cuántos registros había y el pie saltaba de existir a no existir.
    const { html, nodos } = montar({ page: 1, limit: 20, totalRecords: 7, totalPages: 1 });
    expect(html).toContain('1–7 de 7');
    expect(nodos().prev.disabled).toBe(true);
    expect(nodos().next.disabled).toBe(true);
  });
});

// ===========================================================================
describe('la navegación avisa a quién corresponde', () => {
  const espiar = (paginacion) => {
    const llamadas = [];
    const env = crearEntorno();
    mountPagination(env.contenedor, paginacion, { onChange: (v) => llamadas.push(v) });
    return { nodos: () => env.nodos(), llamadas };
  };

  test('siguiente avanza una página', () => {
    const { nodos, llamadas } = espiar({ page: 3, limit: 50, totalRecords: 6058, totalPages: 122 });
    nodos().next.click();
    expect(llamadas).toEqual([{ page: 4, limit: 50 }]);
  });

  test('anterior retrocede una', () => {
    const { nodos, llamadas } = espiar({ page: 3, limit: 50, totalRecords: 6058, totalPages: 122 });
    nodos().prev.click();
    expect(llamadas).toEqual([{ page: 2, limit: 50 }]);
  });

  // El motivo de todo el pedido: llegar al final sin 119 clics.
  test('«ir al final» salta a la última página de una', () => {
    const { nodos, llamadas } = espiar({ page: 3, limit: 50, totalRecords: 6058, totalPages: 122 });
    nodos().last.click();
    expect(llamadas).toEqual([{ page: 122, limit: 50 }]);
  });

  test('«ir al principio» vuelve a la 1', () => {
    const { nodos, llamadas } = espiar({ page: 87, limit: 50, totalRecords: 6058, totalPages: 122 });
    nodos().first.click();
    expect(llamadas).toEqual([{ page: 1, limit: 50 }]);
  });

  test('cambiar las filas por página vuelve a la 1', () => {
    // Quedarse en la página 87 con otro tamaño deja al usuario en un punto del
    // listado que no tiene nada que ver con el que estaba mirando.
    const { nodos, llamadas } = espiar({ page: 87, limit: 20, totalRecords: 6058, totalPages: 303 });
    nodos().size.change('100');
    expect(llamadas).toEqual([{ page: 1, limit: 100 }]);
  });

  test('nunca pide una página fuera de rango', () => {
    const { nodos, llamadas } = espiar({ page: 1, limit: 20, totalRecords: 100, totalPages: 5 });
    nodos().prev.click();     // está deshabilitado, pero si se dispara igual…
    expect(llamadas[0].page).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
describe('el menú desplegable', () => {
  test('arranca cerrado y se abre al hacer clic', () => {
    const { nodos } = montar({ page: 2, limit: 20, totalRecords: 100, totalPages: 5 });
    expect(nodos()['menu-panel'].hidden).toBe(true);

    nodos().menu.click();
    expect(nodos()['menu-panel'].hidden).toBe(false);
    expect(nodos().menu.getAttribute('aria-expanded')).toBe('true');
  });

  test('se cierra al elegir una opción', () => {
    const { nodos } = montar({ page: 2, limit: 20, totalRecords: 100, totalPages: 5 });
    nodos().menu.click();
    nodos().last.click();
    expect(nodos()['menu-panel'].hidden).toBe(true);
  });

  test('sin resultados el botón queda deshabilitado', () => {
    const { nodos } = montar({ page: 1, limit: 20, totalRecords: 0, totalPages: 1 });
    expect(nodos().menu.disabled).toBe(true);
  });
});

// ===========================================================================
describe('las etiquetas se adaptan al orden de cada listado', () => {
  test('un listado por fecha habla de nuevas y antiguas, como Gmail', () => {
    const { html } = montar({ page: 2, limit: 20, totalRecords: 100, totalPages: 5 },
      { etiquetas: ETIQUETAS_FECHA });
    expect(html).toContain('Más nuevas');
    expect(html).toContain('Más antiguas');
  });

  // En clientes se ordena por razón social: decir «más antiguas» sería mentira.
  test('un listado alfabético no habla de fechas', () => {
    const { html } = montar({ page: 2, limit: 20, totalRecords: 100, totalPages: 5 },
      { etiquetas: ETIQUETAS_ALFABETICAS });
    expect(html).toContain('A–Z');
    expect(html).not.toContain('Más antiguas');
  });

  test('sin etiquetas explícitas usa textos neutros', () => {
    const { html } = montar({ page: 2, limit: 20, totalRecords: 100, totalPages: 5 });
    expect(html).toContain('Ir al principio');
    expect(html).toContain('Ir al final');
  });
});

// ===========================================================================
describe('limpieza', () => {
  test('destroy() saca los listeners que puso en document', () => {
    const { listeners, destroy } = montar({ page: 1, limit: 20, totalRecords: 100, totalPages: 5 });
    expect(listeners.document.length).toBe(2);   // click afuera + Escape

    destroy();
    expect(listeners.document.length).toBe(0);
  });

  test('montar y desmontar muchas veces no acumula nada', () => {
    const env = crearEntorno();
    for (let i = 0; i < 20; i++) {
      const d = mountPagination(env.contenedor,
        { page: 1, limit: 20, totalRecords: 100, totalPages: 5 }, { onChange: () => {} });
      d();
    }
    expect(env.listeners.document.length).toBe(0);
  });

  test('sin contenedor no explota', () => {
    expect(() => mountPagination(null, { page: 1, limit: 20, totalRecords: 0, totalPages: 1 })).not.toThrow();
  });
});

// ===========================================================================
describe('los cuatro paneles usan el control compartido', () => {
  const fs   = require('fs');
  const path = require('path');
  const RAIZ = path.resolve(__dirname, '../../public/js/views/dashboard/modules');

  const PANELES = ['allQuotationsTab.js', 'auditView.js', 'clientsView.js', 'licitacionesView.js'];

  // El tablero del Ejecutivo no vive en modules/ sino en strategies/, y tenia
  // su propia paginacion: un texto «Mostrando N ... M en total» sin forma de
  // pasar de pagina, porque traia todo de una sola vez.
  const ESTRATEGIAS = path.resolve(__dirname, '../../public/js/views/dashboard/strategies');
  const ejecutivo = () => fs.readFileSync(path.join(ESTRATEGIAS, 'executiveStrategy.js'), 'utf8');

  describe('el tablero del Ejecutivo', () => {
    test('usa el control compartido y lo importa de verdad', () => {
      const src = ejecutivo();
      expect(src).toMatch(/\bmountPagination\s*\(/);
      expect(src).toMatch(IMPORT_REAL);
    });

    test('lo pone ARRIBA de la tabla', () => {
      const src = ejecutivo();
      const pos  = src.search(/id="pagination-footer"/);
      const tabla = src.search(/id="quotations-section"/);
      expect(pos).toBeLessThan(tabla);
      expect(src).toMatch(/class="card-toolbar" id="pagination-footer"/);
    });

    // EL BUG DE FONDO. Pedia limit=200 con un comentario que decia «espeja el
    // tope de la API»; el tope real es 100 (MAX_LIMIT en quotationFilters.js),
    // asi que el servidor recortaba en silencio y a partir de la cotizacion 101
    // el ejecutivo no veia nada. Con 105 en produccion ya faltaban.
    test('ya no pide un limite mayor al que el servidor acepta', () => {
      const { MAX_LIMIT } = require('../../src/controllers/quotation/quotationFilters');
      const src = ejecutivo();

      const pedidos = [...src.matchAll(/limit:\s*['"]?(\d+)/g)].map((m) => Number(m[1]));
      for (const n of pedidos) {
        expect(n).toBeLessThanOrEqual(MAX_LIMIT);
      }
    });

    test('separa las solapas en el SERVIDOR, no partiendo un array en memoria', () => {
      const src = ejecutivo();
      expect(src).toContain('excluir_ejecutivo');
      expect(src).toContain('id_ejecutivo');
      // El filtrado en memoria que dejaba de funcionar pasado el tope.
      expect(src).not.toMatch(/filter\(\(r\) => Number\(r\.id_ejecutivo\)/);
    });

    test('cada solapa recuerda su propia pagina', () => {
      // Cambiar de solapa no debe dejarte en la pagina 7 de una lista que
      // recien empezas a mirar.
      expect(ejecutivo()).toMatch(/#pagPorScope/);
    });

    test('desmonta el control cuando no hay resultados', () => {
      expect(ejecutivo()).toMatch(/#destroyPag\?\.\(\)/);
    });
  });

  // OJO con la forma de esta aserción. La primera versión era
  // `expect(src).toContain('shared/pagination.js')`, y pasaba en verde con los
  // cuatro paneles ROTOS: el comentario que documenta el módulo contiene esa
  // misma cadena, así que la aserción se cumplía sin que existiera el import.
  // El navegador tiraba «mountPagination is not defined» y el test decía OK.
  // Por eso ahora se exige una SENTENCIA import de verdad.
  const IMPORT_REAL = /^import\s*\{[^}]*\bmountPagination\b[^}]*\}\s*from\s*['"][^'"]*shared\/pagination\.js['"]/m;

  test.each(PANELES)('%s importa mountPagination de verdad', (archivo) => {
    const src = fs.readFileSync(path.join(RAIZ, archivo), 'utf8');

    expect(src).toMatch(/\bmountPagination\s*\(/);   // lo usa
    expect(src).toMatch(IMPORT_REAL);                // y lo importa
  });

  test.each(PANELES)('%s importa las etiquetas que usa', (archivo) => {
    const src = fs.readFileSync(path.join(RAIZ, archivo), 'utf8');

    // Qué constante de etiquetas usa este panel…
    const usadas = [...src.matchAll(/etiquetas:\s*(ETIQUETAS_\w+)/g)].map((m) => m[1]);
    expect(usadas.length).toBeGreaterThan(0);

    // …y que esté entre las llaves del import.
    const linea = IMPORT_REAL.exec(src)?.[0] ?? '';
    for (const nombre of new Set(usadas)) {
      expect(linea).toContain(nombre);
    }
  });

  test.each(PANELES)('%s no dejó la paginación copiada a mano', (archivo) => {
    const src = fs.readFileSync(path.join(RAIZ, archivo), 'utf8');
    expect(src).not.toContain('‹ Anterior');
    expect(src).not.toContain('Siguiente ›');
  });

  // Vaciar el pie sin desmontar dejaba vivos los listeners de document.
  test.each(PANELES)('%s desmonta el control al vaciar la barra', (archivo) => {
    const src = fs.readFileSync(path.join(RAIZ, archivo), 'utf8');
    expect(src).toContain('clearPagination');
    expect(src).not.toMatch(/pagination'\)\.innerHTML = ''/);
  });

  // ── Posición: ARRIBA de la tabla ──────────────────────────────────────────
  // Con 50 filas en pantalla, tener el control al pie obligaba a bajar toda la
  // tabla para cambiar de página y volver a subir para leer el resultado. Es la
  // razón por la que Gmail lo pone arriba, y una decisión fácil de revertir sin
  // querer al tocar el markup de un panel.
  test.each(PANELES)('%s tiene la paginación ANTES de la tabla', (archivo) => {
    const src = fs.readFileSync(path.join(RAIZ, archivo), 'utf8');

    const posPaginacion = src.search(/id="[\w-]+-pagination"/);
    const posResultados = src.search(/id="[\w-]+-results"/);

    expect(posPaginacion).toBeGreaterThan(-1);
    expect(posResultados).toBeGreaterThan(-1);
    expect(posPaginacion).toBeLessThan(posResultados);
  });

  test.each(PANELES)('%s usa card-toolbar, no card-footer, para la paginación', (archivo) => {
    const src = fs.readFileSync(path.join(RAIZ, archivo), 'utf8');
    expect(src).toMatch(/class="card-toolbar" id="[\w-]+-pagination"/);
    expect(src).not.toMatch(/class="card-footer" id="[\w-]+-pagination"/);
  });
});
