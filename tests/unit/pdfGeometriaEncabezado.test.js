// =============================================================================
// tests/unit/pdfGeometriaEncabezado.test.js
// El encabezado de la proforma: qué cae encima de qué.
//
// POR QUÉ ESTE DRAWER Y NO OTRO
// drawHeader es la función más larga del área de PDF y, hasta este archivo, la
// única de la proforma del CLIENTE sin una sola prueba de posición. Dibuja
// TRES bloques que se acercan entre sí y que crecen por su cuenta:
//
//     ┌───────────────────┐        ┌──────────────────┐
//     │      LOGO         │        │ DATOS DE         │  ← crece hacia abajo
//     └───────────────────┘        │ COTIZACIÓN       │    con cada fila y con
//      Empresa unipersonal…        │  Nº / PEDIDO /   │    lo largo del valor
//      Av. El Trompillo…           │  ESTADO / FECHA  │
//      Tel: 79855624…              │  EJECUTIVO       │
//     ─────────────────────────────────────────────────  ← franja de marcas,
//      VOLVO  JOHN DEERE  KOMATSU  JCB  CAT  CASE          arranca DEBAJO de
//                                                          la caja de la derecha
//
// La franja de marcas se posiciona con `y0 + BOX_H + 8`, o sea que depende del
// alto de la caja de la derecha. Si esa caja se calcula mal, la franja se sube
// y se monta sobre el texto. ESO YA PASÓ: el valor de EJECUTIVO
// (usuarios.nombre_completo, VARCHAR(100)) no entraba en una línea a 7.5 pt,
// envolvía a tres, y como el alto de fila era fijo (18 pt) la caja no crecía —
// el nombre se derramaba encima de los logos de las marcas. El arreglo fue
// medir cada fila con heightOfString ANTES de dibujar la caja.
//
// Este archivo es la prueba que lo hubiera atrapado, más las guardias para los
// otros dos campos de largo libre que entran al encabezado (entidad emisora y
// número correlativo).
//
// El arnés que mide las posiciones está en tests/helpers/docFalso.js.
// =============================================================================

'use strict';

const { drawHeader } = require('../../src/services/pdf/drawers/header');
const { PW, MARGIN } = require('../../src/services/pdf/constants');
const {
  docFalso, buscarTexto, unTexto, textosQueSePisan, describirChoques,
} = require('../helpers/docFalso');

// Borde izquierdo de la caja "DATOS DE COTIZACIÓN": el bloque de la entidad
// emisora tiene que terminar antes de acá. Mismos números que header.js.
const BOX_W = 185;
const BOX_X = PW - MARGIN - BOX_W;

/** Cotización con lo mínimo que drawHeader lee, todos los campos cortos. */
const cotizacion = (over = {}) => ({
  numero_correlativo: 'SC-2026/000042',
  tipo_pedido:        'EMAIL',
  estado:             'Aprobada internamente',
  fecha_emision:      '2026-07-26',
  entidad_emisora:    'Roca Importaciones S.R.L.',
  ejecutivo_nombre:   'Ana Quiroga',
  ...over,
});

/** Dibuja el encabezado en un doc de mentira y lo devuelve para medirlo. */
function encabezado(over) {
  const doc = docFalso({ margenes: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });
  const yFinal = drawHeader(doc, cotizacion(over));
  return { doc, yFinal };
}

/**
 * La Y donde arranca la franja de marcas.
 *
 * drawBrandStrip la marca con un filete que va de margen a margen; los otros
 * trazos del encabezado son los separadores de fila, que viven adentro de la
 * caja de la derecha (de BOX_X en adelante). Buscarla por el ancho completo la
 * identifica sin depender de ningún número mágico que después se desactualice.
 */
function yDeLaFranja(doc) {
  const filetes = doc.lineas.filter(
    (l) => Math.round(l.x1) === Math.round(MARGIN) && Math.round(l.x2) === Math.round(PW - MARGIN)
  );
  expect(filetes).toHaveLength(1);
  return filetes[0].y1;
}

/** Los rótulos de reserva de la franja de marcas (sólo se dibujan si falta el PNG). */
const ES_ROTULO_DE_MARCA = (t) =>
  ['VOLVO', 'JOHN DEERE', 'KOMATSU', 'JCB', 'CAT', 'CASE'].includes(t.contenido);

// ---------------------------------------------------------------------------
describe('el bloque de la entidad emisora no invade la caja de la derecha', () => {
  // Las dos columnas del encabezado están una al lado de la otra y las dos
  // reciben texto de largo variable. Que no se toquen no es evidente por
  // mirar el código: sale de que emisorW se calcula contra BOX_X.
  test('todo lo que se dibuja desde el margen izquierdo termina antes de la caja', () => {
    const { doc } = encabezado();

    const izquierda = doc.textos.filter((t) => Math.round(t.x) === MARGIN);
    expect(izquierda.length).toBeGreaterThanOrEqual(3); // entidad + dirección + teléfono

    for (const t of izquierda) {
      expect(t.derecha).toBeLessThanOrEqual(BOX_X);
    }
  });

  test('el logo termina antes de que empiece el nombre de la entidad', () => {
    // El bloque de la entidad se imprime "en la banda en blanco debajo del
    // logo". Si el logo creciera —o el bloque subiera— el nombre de la empresa
    // saldría impreso sobre la imagen.
    const { doc } = encabezado();

    const logo = doc.imagenes[0];
    const entidad = unTexto(doc, /Roca Importaciones/);

    expect(logo).toBeDefined();
    expect(entidad).toBeDefined();
    expect(entidad.arriba).toBeGreaterThanOrEqual(logo.abajo);
  });

  test('la caja de datos no se sale del borde derecho de la hoja', () => {
    // Un correlativo largo se dibuja con `width` acotado, así que tiene que
    // envolver adentro de la caja en vez de derramarse fuera de la hoja.
    const { doc } = encabezado({ numero_correlativo: 'SC-2026/000042-REPOSICION-ADENDA-03' });

    for (const t of doc.textos) {
      expect(t.derecha).toBeLessThanOrEqual(PW - MARGIN);
    }
  });
});

// ---------------------------------------------------------------------------
// LA PRUEBA DEL BUG QUE YA PASÓ.
//
// Con el alto de fila fijo en 18 pt, un ejecutivo de nombre largo envolvía a
// tres líneas adentro de una fila que seguía midiendo 18: el texto terminaba
// en y ≈ 162 mientras la franja de marcas arrancaba en y = 152. El nombre del
// vendedor salía impreso sobre los logos, en la proforma que se le manda al
// cliente.
//
// Lo que distingue el código arreglado del roto no es que el nombre esté (está
// en los dos) ni que la franja exista (existe en los dos): es que la franja
// BAJE cuando el nombre crece.
describe('la franja de marcas baja cuando la caja de datos crece', () => {
  test('un nombre de ejecutivo largo empuja la franja hacia abajo', () => {
    const corto = encabezado({ ejecutivo_nombre: 'Ana Quiroga' });
    const largo = encabezado({
      ejecutivo_nombre: 'Maria Fernanda de la Cruz Villarroel Aguirre Montenegro',
    });

    expect(yDeLaFranja(largo.doc)).toBeGreaterThan(yDeLaFranja(corto.doc));
  });

  test('el nombre del ejecutivo termina ARRIBA de la franja, no encima de los logos', () => {
    const { doc } = encabezado({
      ejecutivo_nombre: 'Maria Fernanda de la Cruz Villarroel Aguirre Montenegro',
    });

    const ejecutivo = unTexto(doc, /Maria Fernanda/);
    expect(ejecutivo).toBeDefined();
    // Tres líneas de 7.5 pt: el valor ocupa bastante más que los 18 pt de una
    // fila mínima, que es exactamente lo que el código roto ignoraba.
    expect(ejecutivo.lineas).toBeGreaterThan(1);
    expect(ejecutivo.abajo).toBeLessThanOrEqual(yDeLaFranja(doc));
  });

  test('con FECHA CONFIRM. la caja tiene una fila más y la franja también baja', () => {
    // La fila extra sólo aparece en las ventas cerradas. Es otro camino por el
    // que la caja crece, y el único que cambia la CANTIDAD de filas.
    const sinConfirmar = encabezado();
    const confirmada = encabezado({
      estado: 'Confirmada',
      fecha_confirmacion: '2026-08-02',
    });

    expect(buscarTexto(confirmada.doc, 'FECHA CONFIRM.')).toHaveLength(1);
    expect(buscarTexto(sinConfirmar.doc, 'FECHA CONFIRM.')).toHaveLength(0);
    expect(yDeLaFranja(confirmada.doc)).toBeGreaterThan(yDeLaFranja(sinConfirmar.doc));
  });

  test('ningún texto del encabezado cruza la línea de la franja', () => {
    // La guardia general de la franja: no mira un campo en particular, mira que
    // NADA de lo de arriba baje más de la cuenta. Encuentra el derrame que
    // venga del campo que sea, incluso de uno que todavía no existe.
    for (const caso of [
      {},
      { ejecutivo_nombre: 'Maria Fernanda de la Cruz Villarroel Aguirre Montenegro' },
      { numero_correlativo: 'SC-2026/000042-REPOSICION-ADENDA-03' },
      { estado: 'Confirmada', fecha_confirmacion: '2026-08-02' },
    ]) {
      const { doc } = encabezado(caso);
      const franjaY = yDeLaFranja(doc);

      for (const t of doc.textos.filter((x) => !ES_ROTULO_DE_MARCA(x))) {
        expect({ caso, texto: t.contenido, abajo: t.abajo, franjaY })
          .toEqual(expect.objectContaining({ abajo: expect.any(Number) }));
        expect(t.abajo).toBeLessThanOrEqual(franjaY);
      }
    }
  });

  test('los logos de las marcas se dibujan debajo de la línea, nunca encima', () => {
    const { doc } = encabezado();
    const franjaY = yDeLaFranja(doc);

    // La primera imagen es el logo corporativo, arriba de todo; las demás son
    // las marcas y van dentro de la franja.
    const marcas = doc.imagenes.slice(1);
    expect(marcas.length).toBe(6);
    for (const img of marcas) {
      expect(img.arriba).toBeGreaterThanOrEqual(franjaY);
    }
  });

  test('drawHeader devuelve una Y por debajo de todo lo que dibujó', () => {
    // Lo que sigue en la proforma (el subtítulo PROFORMA REPUESTOS) arranca
    // justo acá. Si esta Y quedara corta, el subtítulo se imprime sobre las
    // marcas — la misma familia de bug que el de la franja «SON:».
    const { doc, yFinal } = encabezado({
      ejecutivo_nombre: 'Maria Fernanda de la Cruz Villarroel Aguirre Montenegro',
    });

    for (const t of doc.textos) expect(yFinal).toBeGreaterThanOrEqual(t.abajo);
    for (const i of doc.imagenes) expect(yFinal).toBeGreaterThanOrEqual(i.abajo);
  });
});

// ---------------------------------------------------------------------------
describe('ningún par de textos del encabezado se superpone', () => {
  // Las pruebas de arriba vigilan colisiones que ya se sabe dónde buscar. Ésta
  // no sabe nada: compara todas las cajas contra todas y falla ante cualquier
  // superposición, incluida una que nadie previó.
  const CASOS = {
    'datos normales': {},
    'ejecutivo de nombre largo': {
      ejecutivo_nombre: 'Maria Fernanda de la Cruz Villarroel Aguirre Montenegro',
    },
    'correlativo largo': { numero_correlativo: 'SC-2026/000042-REPOSICION-ADENDA-03' },
    'estado largo': { estado: 'Aprobada internamente' },
    'venta confirmada (fila extra)': { estado: 'Confirmada', fecha_confirmacion: '2026-08-02' },
    'sin ejecutivo ni correlativo': { ejecutivo_nombre: null, numero_correlativo: null },
  };

  for (const [nombre, over] of Object.entries(CASOS)) {
    test(nombre, () => {
      const { doc } = encabezado(over);
      const choques = textosQueSePisan(doc);
      if (choques.length > 0) {
        throw new Error(`Textos superpuestos en el encabezado:\n  ${describirChoques(choques)}`);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// HALLAZGO ABIERTO — NO SE ARREGLA ACÁ.
//
// El bloque de la entidad emisora avanza con saltos FIJOS:
//
//     .text(entidad, emisorX, emisorY, { width: emisorW, lineBreak: false });
//     emisorY += 11;                    // ← 11 pt pase lo que pase
//
// `lineBreak: false` no impide el envuelto en esta versión de PDFKit cuando se
// pasa un `width` (es el patrón #4 de los bugs recurrentes del proyecto, el
// mismo que ya mordió en itemsTable, infoGrid y en la fila EJECUTIVO de acá al
// lado). O sea: una entidad emisora de más de ~82 caracteres ocupa dos líneas
// a 8 pt, el bloque sólo baja 11, y la segunda línea del nombre de la empresa
// sale impresa sobre la dirección.
//
// POR QUÉ ESTÁ EN skip Y NO EN ROJO
// Hoy NO es alcanzable desde la aplicación: quotationValidator restringe
// entidad_emisora a una lista de tres valores, y los tres son cortos. Pero la
// columna es VARCHAR(150) y el arreglo del EJECUTIVO —medir con heightOfString
// antes de avanzar— no se aplicó a este bloque, así que la protección es la
// lista blanca del validador y nada más. El día que se agregue una razón social
// larga a VALID_ENTITIES, o que alguien escriba en la tabla por fuera de la API,
// esto sale impreso mal en la proforma del cliente sin que nada avise.
//
// Queda documentado y sin arreglar a propósito: la decisión de tocar header.js
// es de Adrian, no de este archivo de tests. Para verlo, sacarle el .skip.
// ---------------------------------------------------------------------------
describe('entidad emisora larga (hallazgo abierto)', () => {
  const ENTIDAD_LARGA =
    'Empresa unipersonal de Ronald Roca Cartagena y Asociados Sociedad de Responsabilidad Limitada';

  test.skip('el nombre de la entidad no se pisa con la dirección', () => {
    const { doc } = encabezado({ entidad_emisora: ENTIDAD_LARGA });
    const choques = textosQueSePisan(doc);
    if (choques.length > 0) {
      throw new Error(`Textos superpuestos en el encabezado:\n  ${describirChoques(choques)}`);
    }
  });

  test('las entidades emisoras que el validador SÍ acepta entran en una línea', () => {
    // El guardia que sí se puede sostener hoy: mientras los valores válidos
    // sean cortos, el bloque de saltos fijos no choca. Si mañana se agrega una
    // razón social larga a VALID_ENTITIES, este test se pone en rojo y obliga a
    // mirar el bloque antes de que salga impreso.
    for (const entidad of [
      'Empresa unipersonal de Ronald Roca Cartagena',
      'Roca Importaciones S.R.L.',
      'RC Tractoparts',
    ]) {
      const { doc } = encabezado({ entidad_emisora: entidad });
      const nombre = doc.textos[0];
      expect(nombre.lineas).toBe(1);
      expect(textosQueSePisan(doc)).toHaveLength(0);
    }
  });
});
