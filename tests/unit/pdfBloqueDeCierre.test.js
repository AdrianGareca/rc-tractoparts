// =============================================================================
// tests/unit/pdfBloqueDeCierre.test.js
// Nada se imprime encima de otra cosa en el cierre de la proforma.
//
// EL BUG
// Al partir drawTotalsAndConditions en cuatro funciones se perdió UNA línea:
//
//     y += SON_H + 8;
//
// que era lo que bajaba el cursor después de dibujar la franja «SON:» con el
// importe en letras. Sin ella, dibujarLineaSon devolvía la MISMA y que había
// recibido, y las dos columnas de abajo —CONDICIONES DE LA OFERTA y la caja del
// TOTAL— arrancaban justo encima de esa franja.
//
// El resultado en el PDF que se le manda al cliente:
//
//     SON: CINCUENTA MIL CON 00/100 BOLIVIANOS
//     CONDICIONES DE LA OFERTA
//     ^^^^ los dos textos impresos uno sobre el otro, ilegibles
//
// POR QUÉ NINGUNA PRUEBA LO VIO
// Las que había verifican que el PDF SE GENERA y que contiene los textos
// esperados. Los dos textos estaban — solo que en el mismo lugar. Un PDF con
// todo superpuesto pasa igual de bien esas pruebas que uno perfecto.
//
// Lo que faltaba probar no es el contenido: es la GEOMETRÍA. Cada bloque tiene
// que devolver una posición mayor que la que recibió, o el siguiente lo pisa.
// =============================================================================

'use strict';

const {
  drawTotalsAndConditions,
  dibujarLineaSon,
  calcularImportes,
} = require('../../src/services/pdf/drawers/totals');

const { MARGIN } = require('../../src/services/pdf/constants');
const { docFalso } = require('../helpers/docFalso');

// El arnés que mide posiciones vive en tests/helpers/docFalso.js. Nació acá
// adentro y protegía sólo este drawer; está afuera para que lo usen todos los
// demás (encabezado, reporte, expediente) sin que cada uno se haga su copia y
// las copias se desincronicen.

const COTIZACION = {
  moneda: 'BOB',
  monto_total: 50000,
  descuento_manual: null,
  fecha_validez: '2026-09-06',
  entidad_emisora: 'unipersonal',
  detalles: [
    { cantidad: 1, precio_unitario: 50000, subtotal: 50000, descripcion_item: 'Repuesto' },
  ],
};

const START_Y = 300;

// ---------------------------------------------------------------------------
describe('cada bloque deja lugar al siguiente', () => {
  test('la franja SON devuelve una posición MÁS ABAJO de la que recibió', () => {
    // La prueba directa del bug. Si devuelve lo mismo, lo que siga se imprime
    // encima.
    const doc = docFalso();
    const importes = calcularImportes(COTIZACION, COTIZACION.detalles);

    const yDespues = dibujarLineaSon(doc, COTIZACION, START_Y, importes.displayTotal);

    expect(yDespues).toBeGreaterThan(START_Y);
  });

  test('y deja al menos el alto de la franja, no un pixel', () => {
    // Devolver `y + 1` también pasaría el test de arriba y seguiría superponiendo:
    // la franja mide 20 puntos de alto.
    const doc = docFalso();
    const importes = calcularImportes(COTIZACION, COTIZACION.detalles);

    const yDespues = dibujarLineaSon(doc, COTIZACION, START_Y, importes.displayTotal);

    expect(yDespues - START_Y).toBeGreaterThanOrEqual(20);
  });
});

// ---------------------------------------------------------------------------
describe('el importe en letras no se pisa con las condiciones', () => {
  test('están en renglones distintos', () => {
    const doc = docFalso();
    drawTotalsAndConditions(doc, COTIZACION, START_Y);

    const son = doc.textos.find((t) => t.contenido.startsWith('SON'));
    const condiciones = doc.textos.find((t) => t.contenido.includes('CONDICIONES DE LA OFERTA'));

    expect(son).toBeDefined();
    expect(condiciones).toBeDefined();

    // El caso exacto que se vio en el PDF: los dos a la misma altura.
    expect(condiciones.y).toBeGreaterThan(son.y);
  });

  test('tampoco con el subtotal de la columna derecha', () => {
    const doc = docFalso();
    drawTotalsAndConditions(doc, COTIZACION, START_Y);

    const son = doc.textos.find((t) => t.contenido.startsWith('SON'));
    const subtotal = doc.textos.find((t) => t.contenido === 'Subtotal:');

    expect(subtotal).toBeDefined();
    expect(subtotal.y).toBeGreaterThan(son.y);
  });

  test('ningún par de textos comparte exactamente la misma posición', () => {
    // La guardia general: dos textos en el mismo (x, y) es siempre un error de
    // maquetado. Encuentra superposiciones que nadie previó, no solo la que ya
    // pasó.
    const doc = docFalso();
    drawTotalsAndConditions(doc, COTIZACION, START_Y);

    const vistos = new Map();
    const choques = [];

    for (const t of doc.textos) {
      const clave = `${Math.round(t.x)},${Math.round(t.y)}`;
      if (vistos.has(clave)) {
        choques.push(`«${vistos.get(clave)}» y «${t.contenido}» en ${clave}`);
      }
      vistos.set(clave, t.contenido);
    }

    if (choques.length > 0) {
      throw new Error('Textos superpuestos en el PDF:\n  ' + choques.join('\n  '));
    }
  });
});

// ---------------------------------------------------------------------------
// BUG REAL: "CONDICIONES DE LA OFERTA" avanzaba `ly += 12` fijo por fila sin
// importar cuántas líneas ocupó el valor. Un tiempo_entrega largo (dentro del
// límite normal del validador, no un caso extremo) envolvía a varias líneas y
// la continuación se pisaba con la fila de abajo ("Forma de pago"). Encontrado
// en la ronda de estrés del 2026-08-26.
describe('un tiempo_entrega largo no se pisa con la fila de abajo', () => {
  const COTIZACION_ENTREGA_LARGA = {
    ...COTIZACION,
    tiempo_entrega: 'Sujeto a disponibilidad de stock del proveedor en el exterior, '
      + 'con un plazo estimado que puede variar según la fecha de importación y '
      + 'los tiempos aduaneros vigentes al momento del despacho',
  };

  test('ningún par de textos comparte exactamente la misma posición', () => {
    const doc = docFalso();
    drawTotalsAndConditions(doc, COTIZACION_ENTREGA_LARGA, START_Y);

    const vistos = new Map();
    const choques = [];
    for (const t of doc.textos) {
      const clave = `${Math.round(t.x)},${Math.round(t.y)}`;
      if (vistos.has(clave)) {
        choques.push(`«${vistos.get(clave)}» y «${t.contenido}» en ${clave}`);
      }
      vistos.set(clave, t.contenido);
    }

    if (choques.length > 0) {
      throw new Error('Textos superpuestos en el PDF:\n  ' + choques.join('\n  '));
    }
  });

  test('el salto a "Forma de pago:" crece con la cantidad de líneas, no queda fijo en 12pt', () => {
    // La prueba que de verdad distingue el bug: el mock de heightOfString sólo
    // anota DÓNDE EMPIEZA cada .text(), nunca cuántas líneas ocupa — así que
    // "formaPago.y > entrega.y" pasaría igual con el código viejo (salto fijo
    // de 12pt) o con el nuevo (salto según el contenido). Lo que hace falta
    // comparar es CUÁNTO salta: con una descripción que envuelve a varias
    // líneas, tiene que ser bastante más que el salto fijo de 12pt que usaba
    // el código roto.
    const doc = docFalso();
    drawTotalsAndConditions(doc, COTIZACION_ENTREGA_LARGA, START_Y);

    const entrega = doc.textos.find((t) => t.contenido === 'Tiempo de entrega:');
    const formaPago = doc.textos.find((t) => t.contenido === 'Forma de pago:');

    expect(entrega).toBeDefined();
    expect(formaPago).toBeDefined();
    expect(formaPago.y - entrega.y).toBeGreaterThan(24);
  });
});

// ---------------------------------------------------------------------------
describe('el bloque completo termina más abajo de donde empezó', () => {
  test('devuelve la posición donde puede seguir el pie', () => {
    const doc = docFalso();
    const yFinal = drawTotalsAndConditions(doc, COTIZACION, START_Y);

    // Si devolviera algo por encima del inicio, el pie de página se imprimiría
    // sobre el bloque de totales.
    expect(yFinal).toBeGreaterThan(START_Y);
  });

  test('todo lo dibujado queda dentro del ancho de la hoja', () => {
    const doc = docFalso();
    drawTotalsAndConditions(doc, COTIZACION, START_Y);

    for (const t of doc.textos) {
      expect(t.x).toBeGreaterThanOrEqual(MARGIN - 1);
    }
  });
});
