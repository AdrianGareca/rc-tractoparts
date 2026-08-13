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

/**
 * Un `doc` de PDFKit de mentira: acepta todas las llamadas encadenadas y anota
 * dónde se dibujó cada texto. Es todo lo que hace falta para medir posiciones.
 */
function docFalso() {
  const textos = [];
  const doc = {
    textos,
    _y: 0,
    font:        () => doc,
    fontSize:    () => doc,
    fillColor:   () => doc,
    strokeColor: () => doc,
    lineWidth:   () => doc,
    moveTo:      () => doc,
    lineTo:      () => doc,
    stroke:      () => doc,
    rect:        () => doc,
    fill:        () => doc,
    addPage:     () => doc,
    image:       () => doc,
    text: (contenido, x, y) => {
      textos.push({ contenido: String(contenido), x, y });
      return doc;
    },
    get y() { return doc._y; },
  };
  return doc;
}

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
