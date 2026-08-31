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

  // POR QUÉ SE CUENTAN LOS <th> EN VEZ DE ESCRIBIR EL NÚMERO ACÁ
  // La primera versión de este bloque tenía la cantidad esperada escrita a
  // mano por panel: `['modules/clientsView.js', 6]`. Eso no verificaba nada —
  // pineaba el valor que el panel ya tenía. Y estaba MAL en los cuatro:
  // allQuotationsTab declaraba 10 sobre una tabla de 9, auditView 7 sobre 8,
  // clientsView 6 sobre 7 y licitacionesView 7 sobre 8. O sea que el test
  // pasaba en verde mientras la página seguía pegando exactamente el salto
  // que el esqueleto viene a evitar.
  //
  // Contando los <th> de la propia tabla, la verdad sale del código y no de
  // este archivo: si mañana alguien agrega una columna y se olvida del
  // esqueleto, esto falla solo. Encontrado en la auditoría del 2026-08-28.
  // Se recorre TODO el dashboard, no una lista escrita a mano: un panel nuevo
  // que nazca con el esqueleto mal queda cubierto sin que nadie lo agregue acá.
  function jsDelDashboard(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      return e.isDirectory() ? jsDelDashboard(full) : (e.name.endsWith('.js') ? [full] : []);
    });
  }

  // QUÉ SE PUEDE AFIRMAR LEYENDO EL CÓDIGO, Y QUÉ NO
  // No todo esqueleto reemplaza a UNA tabla. Hay dos formas que este test
  // sabe verificar, y dos que deliberadamente no toca:
  //
  //   ✔ Un archivo con UN esqueleto y UNA tabla: no hay ambigüedad posible.
  //     (allQuotationsTab, auditView, clientsView, licitacionesView, misMetricas)
  //   ✔ Un esqueleto seguido de cerca por su propia tabla: es el patrón de
  //     las strategies, que tienen dos paneles con tabla en el mismo archivo.
  //
  //   ✘ reportesView: sus cuatro esqueletos son marcadores genéricos de un
  //     panel entero —varias tarjetas con varias tablas—, no de una tabla
  //     puntual. Exigirle coincidencia sería inventar un descalce.
  //   ✘ clienteItemReport: arma su <thead> en tiempo de ejecución con
  //     buildEncabezadosHtml(vista, …); la cantidad de columnas depende de la
  //     vista elegida y no se puede contar leyendo el fuente.
  //
  // Un test que acusa en falso se termina ignorando, que es peor que no
  // tenerlo. Este prefiere callarse cuando no puede estar seguro.
  const SIN_TABLA_PROPIA = ['modules/reportesView.js', 'modules/clienteItemReport.js'];

  const CERCA = 40;   // líneas; las parejas reales están a 13-22, ver arriba

  /** Celdas de encabezado declaradas de forma literal en un bloque <thead>. */
  const columnasDe = (thead) => (thead.match(/<th[\s>]/g) || []).length;

  function paresDelArchivo(ruta) {
    const relativo = path.relative(RAIZ, ruta).split(path.sep).join('/');
    if (SIN_TABLA_PROPIA.includes(relativo)) return [];

    const src    = fs.readFileSync(ruta, 'utf8');
    const lineas = src.split('\n');

    const esqueletos = [];
    lineas.forEach((linea, i) => {
      const m = linea.match(/tableSkeleton\(\{\s*columnas:\s*(\d+)/);
      if (m) esqueletos.push({ linea: i + 1, pedidas: Number(m[1]), i });
    });
    if (esqueletos.length === 0) return [];

    const theads = [...src.matchAll(/<thead>[\s\S]*?<\/thead>/g)]
      .map((m) => m[0])
      .filter((t) => columnasDe(t) > 0);   // los dinámicos no se pueden contar

    return esqueletos.flatMap((e) => {
      // Forma 1 — un solo esqueleto y una sola tabla: se corresponden sí o sí.
      if (esqueletos.length === 1 && theads.length === 1) {
        return [{ archivo: relativo, linea: e.linea, pedidas: e.pedidas, reales: columnasDe(theads[0]) }];
      }
      // Forma 2 — la tabla propia del esqueleto está justo debajo.
      const cercano = lineas.slice(e.i, e.i + CERCA).join('\n').match(/<thead>[\s\S]*?<\/thead>/);
      if (cercano && columnasDe(cercano[0]) > 0) {
        return [{ archivo: relativo, linea: e.linea, pedidas: e.pedidas, reales: columnasDe(cercano[0]) }];
      }
      return [];
    });
  }

  const PARES = jsDelDashboard(RAIZ).flatMap(paresDelArchivo);

  test('hay paneles con esqueleto para revisar', () => {
    // Sin esto, un refactor que mueva o renombre los esqueletos dejaría los
    // test.each de abajo con cero casos: pasarían en verde sin mirar nada.
    expect(PARES.length).toBeGreaterThanOrEqual(7);
  });

  test.each(PARES.map((p) => [`${p.archivo}:${p.linea}`, p]))(
    '%s: el esqueleto coincide con su tabla',
    (_ubicacion, par) => {
      expect(par.pedidas).toBe(par.reales);
    }
  );

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
