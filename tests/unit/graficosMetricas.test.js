/**
 * @jest-environment jsdom
 */

// =============================================================================
// tests/unit/graficosMetricas.test.js
// Los gráficos de «Mis métricas»: que dibujen, que no crezcan, y que un fallo
// suyo no se lleve puesta la pantalla.
//
// POR QUÉ EXISTE
// Tres maneras concretas de romperse, las tres silenciosas:
//
//   1. EL LIENZO QUE CRECE SOLO. Asignar `canvas.height` reescribe el atributo
//      `height`. Si la altura se vuelve a leer de ahí en el cuadro siguiente,
//      se realimenta. Pasó en la página de prueba: con la animación corriendo,
//      un lienzo llegó a medir 590 millones de píxeles y estiró la página
//      entera. No hay error en consola — la página simplemente queda inusable.
//
//   2. QUE UN GRÁFICO SE LLEVE LAS MÉTRICAS. Un gráfico es un agregado: si no
//      se puede dibujar, quien entró a ver sus números tiene que verlos igual.
//
//   3. QUE EL COLOR DEJE DE SEGUIR AL TEMA. Los colores se leen de los tokens
//      al dibujar. Si un estado nuevo no está en el mapa, tiene que caer en
//      gris — no dejar el anillo entero sin dibujar.
//
// jsdom no tiene canvas 2D: se le pone un doble que REGISTRA cada llamada. No
// se comprueba que se vea bien —eso no se puede desde acá—, sino que se dibuje,
// con qué colores, y con qué dimensiones.
// =============================================================================

'use strict';

const ALTO_SERIE  = 170;
const ALTO_ANILLO = 150;

/** Registro de todo lo que se le pidió al contexto 2D. */
let llamadas = [];

function instalarCanvasFalso(anchoPorId = {}) {
  llamadas = [];

  window.HTMLCanvasElement.prototype.getContext = function () {
    const id = this.dataset.grafico || 'sin-id';
    const anotar = (fn) => (...args) => llamadas.push({ id, fn, args });
    return new Proxy({}, {
      get: (_, prop) => {
        if (prop === 'createLinearGradient') return () => ({ addColorStop() {} });
        if (prop === 'setTransform' || typeof prop === 'symbol') return () => {};
        return anotar(String(prop));
      },
      set: (_, prop, valor) => {
        llamadas.push({ id, fn: 'set:' + String(prop), args: [valor] });
        return true;
      },
    });
  };

  // jsdom no maqueta: getBoundingClientRect siempre da cero y sin un ancho el
  // dibujado se saltea entero. Se simula el que daría el navegador.
  window.Element.prototype.getBoundingClientRect = function () {
    const id = this.dataset && this.dataset.grafico;
    const w = anchoPorId[id] !== undefined ? anchoPorId[id] : 600;
    return { width: w, height: 170, top: 0, left: 0, right: w, bottom: 170, x: 0, y: 0, toJSON() {} };
  };

  window.devicePixelRatio = 1.5;
}

/** Espera a que terminen las animaciones basadas en requestAnimationFrame. */
const dejarAnimar = (ms = 1400) => new Promise((r) => setTimeout(r, ms));

const POR_MES = [
  { mes: '2026-01', emitidas: 18, cerradas: 7 },
  { mes: '2026-02', emitidas: 24, cerradas: 11 },
  { mes: '2026-03', emitidas: 31, cerradas: 14 },
  { mes: '2026-04', emitidas: 27, cerradas: 16 },
];

const POR_ESTADO = [
  { estado: 'Confirmada',         cantidad: 147 },
  { estado: 'Enviada al cliente', cantidad: 41 },
  { estado: 'Pendiente',          cantidad: 18 },
  { estado: 'Rechazada',          cantidad: 12 },
];

describe('gráficos de métricas', () => {
  let graficos;

  beforeEach(async () => {
    document.body.innerHTML = '';
    instalarCanvasFalso();
    jest.resetModules();
    graficos = await import('../../public/js/shared/graficos.js');
  });

  const nuevoCanvas = (id, alto) => {
    const c = document.createElement('canvas');
    c.dataset.grafico = id;
    c.setAttribute('height', String(alto));
    document.body.appendChild(c);
    return c;
  };

  // ── El bug que motivó este archivo ────────────────────────────────────────
  describe('el lienzo no puede crecer solo', () => {
    test('la serie mantiene su alto tras animar (170 x 1.5 = 255)', async () => {
      const c = nuevoCanvas('mes', ALTO_SERIE);
      graficos.serieTemporal(c, POR_MES.map((f) => ({ etiqueta: f.mes, valor: f.emitidas })));

      await dejarAnimar();

      expect(Number(c.getAttribute('height'))).toBe(Math.round(ALTO_SERIE * 1.5));
    });

    test('el anillo mantiene su alto tras animar (150 x 1.5 = 225)', async () => {
      const c = nuevoCanvas('estado', ALTO_ANILLO);
      graficos.anillo(c, POR_ESTADO.map((f) => ({
        etiqueta: f.estado, valor: f.cantidad, token: '--clr-green',
      })));

      await dejarAnimar();

      expect(Number(c.getAttribute('height'))).toBe(Math.round(ALTO_ANILLO * 1.5));
    });

    test('tampoco crece tras varios redibujados por cambio de tema', async () => {
      const c = nuevoCanvas('mes', ALTO_SERIE);
      graficos.serieTemporal(c, POR_MES.map((f) => ({ etiqueta: f.mes, valor: f.emitidas })));
      await dejarAnimar();

      const esperado = Math.round(ALTO_SERIE * 1.5);
      for (const tema of ['light', 'dark', 'light']) {
        document.documentElement.setAttribute('data-theme', tema);
        await new Promise((r) => setTimeout(r, 60));
      }

      expect(Number(c.getAttribute('height'))).toBe(esperado);
    });
  });

  // ── Que dibujen de verdad ─────────────────────────────────────────────────
  describe('dibujan lo que se les pide', () => {
    test('la serie traza una línea', async () => {
      const c = nuevoCanvas('mes', ALTO_SERIE);
      graficos.serieTemporal(c, POR_MES.map((f) => ({ etiqueta: f.mes, valor: f.emitidas })));
      await dejarAnimar();

      expect(llamadas.some((l) => l.id === 'mes' && l.fn === 'stroke')).toBe(true);
    });

    test('el anillo traza un arco por cada estado', async () => {
      const c = nuevoCanvas('estado', ALTO_ANILLO);
      graficos.anillo(c, POR_ESTADO.map((f) => ({
        etiqueta: f.estado, valor: f.cantidad, token: '--clr-green',
      })));
      await dejarAnimar();

      expect(llamadas.filter((l) => l.id === 'estado' && l.fn === 'arc').length)
        .toBeGreaterThanOrEqual(POR_ESTADO.length);
    });

    test('un solo punto no rompe la serie (hace falta un tramo para trazar)', async () => {
      const c = nuevoCanvas('mes', ALTO_SERIE);
      expect(() => graficos.serieTemporal(c, [{ etiqueta: '01', valor: 5 }])).not.toThrow();
    });

    test('sin datos, el anillo no explota', async () => {
      const c = nuevoCanvas('estado', ALTO_ANILLO);
      expect(() => graficos.anillo(c, [])).not.toThrow();
    });
  });

  // ── Los colores salen de los tokens ───────────────────────────────────────
  describe('el color no está escrito en el código', () => {
    test('no se usa ningún color hexadecimal al dibujar', async () => {
      const c = nuevoCanvas('mes', ALTO_SERIE);
      graficos.serieTemporal(c, POR_MES.map((f) => ({ etiqueta: f.mes, valor: f.emitidas })));
      await dejarAnimar();

      const colores = llamadas
        .filter((l) => l.fn === 'set:strokeStyle' || l.fn === 'set:fillStyle')
        .map((l) => String(l.args[0]));

      expect(colores.length).toBeGreaterThan(0);
      // En jsdom los tokens no resuelven, así que caen al respaldo — que es una
      // palabra clave de CSS a propósito, nunca un color escrito a mano.
      expect(colores.filter((c2) => /^#[0-9a-f]{3,6}$/i.test(c2))).toEqual([]);
    });
  });

  // ── Las cifras que suben ──────────────────────────────────────────────────
  describe('contarHasta', () => {
    test('termina exactamente en el valor pedido', async () => {
      const el = document.createElement('div');
      graficos.contarHasta(el, 692);
      await dejarAnimar(1000);
      expect(el.textContent.replace(/\D/g, '')).toBe('692');
    });

    test('respeta el formateador en cada paso, no sólo al final', async () => {
      const el = document.createElement('div');
      const vistos = [];
      graficos.contarHasta(el, 50, (v) => {
        vistos.push(el.textContent);
        return v.toFixed(1) + '%';
      });
      await dejarAnimar(1000);

      expect(el.textContent).toBe('50.0%');
      // Si el formato se aplicara sólo al final, el intermedio sería un número
      // crudo y el usuario vería la cifra cambiar de forma al terminar.
      expect(vistos.slice(1).every((t) => t.endsWith('%'))).toBe(true);
    });

    test('un valor no numérico no rompe nada', () => {
      const el = document.createElement('div');
      el.textContent = '—';
      expect(() => graficos.contarHasta(el, NaN)).not.toThrow();
      expect(el.textContent).toBe('—');
    });
  });
});
