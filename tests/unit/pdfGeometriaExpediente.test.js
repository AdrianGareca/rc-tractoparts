// =============================================================================
// tests/unit/pdfGeometriaExpediente.test.js
// El expediente de licitación: qué cae encima de qué.
//
// POR QUÉ ESTE DOCUMENTO
// renderExpediente era el generador PEOR cubierto del sistema: su única prueba
// (pdfIdentidad.test.js) verifica que el buffer empiece con «%PDF-» y que el
// fuente mencione los colores de la casa. Un expediente con las cinco secciones
// impresas una encima de otra pasa esa prueba exactamente igual de bien que uno
// correcto — es el MISMO agujero por el que se coló el bug de la franja «SON:»
// en la proforma del cliente (ver tests/unit/pdfBloqueDeCierre.test.js).
//
// LA ZONA DELICADA, IDENTIFICADA DE ANTEMANO
// La sección «1. Datos de la licitación» dibuja su marco así:
//
//     const boxTop = y;              // ← Y capturada ANTES de dibujar nada
//     ... y = kvRow(doc, y, ...) x6  // ← el contenido puede saltar de página
//     doc.roundedRect(MARGIN, boxTop, CW, y - boxTop + 2, 3)   // ← al final
//
// Es la misma forma del bug que ya llegó al cliente: una coordenada capturada
// arriba y usada abajo, con contenido de largo libre en el medio. Si alguna
// kvRow dispara el salto de página de ensureSpace(), `y` vuelve al principio de
// la página siguiente y `y - boxTop` deja de describir el alto del contenido.
// Los tests de más abajo miden exactamente eso: que el marco ENVUELVA lo que
// dice enmarcar, en vez de confiar en que la resta dé bien.
//
// El arnés que anota las posiciones está en tests/helpers/docFalso.js.
// =============================================================================

'use strict';

const { renderExpediente } = require('../../src/services/licitacionPdfService');
const { docFalso, textosQueSePisan, describirChoques } = require('../helpers/docFalso');

// Misma geometría que declara licitacionPdfService.js. Se repite acá a
// propósito: el servicio no la exporta, y una copia que se desactualice hace
// fallar el test (ruidoso) en vez de dejar pasar un PDF roto (silencioso).
const PW = 595.28, PH = 841.89, MARGIN = 40;
const CW = PW - MARGIN * 2;

// El filete gris del pie se dibuja acá; nada del contenido puede bajar de esta
// línea sin quedar impreso sobre el pie de página.
const Y_FILETE_PIE = PH - MARGIN - 12;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Una licitación con lo mínimo que renderExpediente lee. */
const licitacion = (over = {}) => ({
  id: 1,
  codigo: 'LIC-2026-014',
  nombre: 'Provisión de repuestos para la flota municipal',
  estado: 'Cotizando',
  moneda: 'BOB',
  cliente_nombre: 'Gobierno Autónomo Municipal de Santa Cruz',
  cliente_nit: '1023456029',
  responsable_nombre: 'Ana Quiroga',
  fecha_limite: '2026-09-30',
  presupuesto_referencial: 480000,
  total_comprometido: 312500.5,
  total_gastos: 41200.75,
  descripcion: 'Repuestos originales para tractores y motoniveladoras.',
  cotizaciones: [],
  gastos: [],
  documentos: [],
  ...over,
});

const cotizaciones = (n) =>
  Array.from({ length: n }, (_, i) => ({
    numero_correlativo: `SC-2026/${String(i + 1).padStart(6, '0')}`,
    estado: 'Enviada al cliente',
    monto_total: 12500 + i * 137.25,
    moneda: 'BOB',
    ejecutivo_nombre: 'Ana Quiroga',
  }));

const gastos = (n) =>
  Array.from({ length: n }, (_, i) => ({
    concepto: `Boleta de garantía de seriedad de propuesta, cuota ${i + 1}`,
    monto: 850 + i * 11,
    moneda: 'BOB',
    nombre_usuario: 'Ronald Roca',
    creado_en: '2026-08-14',
  }));

const documentos = (n) =>
  Array.from({ length: n }, (_, i) => ({
    nombre_original: `pliego-de-condiciones-parte-${i + 1}.pdf`,
    tamano_bytes: 240_000 + i * 1024,
    nombre_usuario: 'Ronald Roca',
    creado_en: '2026-08-10',
  }));

/** Dibuja el expediente en un doc de mentira y lo devuelve para medirlo. */
function expediente(over) {
  // createDoc() usa margen 40 en los cuatro lados; el arnés tiene que declarar
  // los mismos o cualquier cuenta que mire doc.page.margins mediría otra hoja.
  const doc = docFalso({ margenes: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });
  renderExpediente(doc, licitacion(over));
  return doc;
}

// ---------------------------------------------------------------------------
// Separar el pie del contenido.
//
// El pie se dibuja al final, en una pasada aparte por todas las páginas, así
// que alcanza con encontrar dónde arranca esa pasada: todo lo anterior es
// contenido. Se prefiere el corte por índice y no por coordenada porque un
// texto del cuerpo que se DERRAME sobre el pie tiene que seguir contando como
// contenido — si se filtrara por «está abajo de todo», el derrame se
// autoexcluiría y el test que lo busca nunca fallaría.
// ---------------------------------------------------------------------------
function partirEnCuerpoYPie(doc) {
  const i = doc.textos.findIndex((t) => t.contenido.startsWith('RC Tractoparts —'));
  expect(i).toBeGreaterThan(0);

  const pie = doc.textos.slice(i);
  // Dos textos por página (la leyenda y «Pág. N de M»). Si mañana el pie suma
  // un tercero, esta cuenta se rompe y obliga a revisar el corte en vez de
  // dejar que medio pie pase por contenido y ensucie todas las mediciones.
  expect(pie).toHaveLength(doc.paginas * 2);

  return { cuerpo: doc.textos.slice(0, i), pie };
}

// ---------------------------------------------------------------------------
describe('las cinco secciones no se pisan entre sí', () => {
  // No mira una colisión concreta: compara todas las cajas contra todas. Es la
  // guardia que hubiera atrapado el bug de la proforma sin saber de antemano
  // dónde iba a aparecer.
  const CASOS = {
    'licitación típica': {},
    'las tres tablas vacías': { cotizaciones: [], gastos: [], documentos: [] },
    'sin descripción ni observaciones': { descripcion: null, observaciones_resultado: null },
    'con todo cargado': {
      cotizaciones: cotizaciones(3),
      gastos: gastos(3),
      documentos: documentos(3),
      observaciones_resultado: 'Se presentó la propuesta en plazo. Falta el acta de apertura.',
    },
    'resultado en pérdida (banner rojo)': {
      total_comprometido: 10000, total_gastos: 45000,
      cotizaciones: cotizaciones(2), gastos: gastos(4),
    },
    'con nota de moneda excluida': {
      tiene_cotizaciones_otra_moneda: true,
      tiene_gastos_otra_moneda: true,
      cotizaciones: cotizaciones(2),
      gastos: gastos(2),
    },
    'nombre de licitación en el máximo del validador (200 car.)': {
      nombre: 'Adquisición de repuestos originales y alternativos para la flota de maquinaria '
        + 'pesada del municipio, incluyendo tractores, motoniveladoras, retroexcavadoras y '
        + 'volquetas, primera convocatoria pública nacional',
    },
    'muchas filas (obliga salto de página)': {
      cotizaciones: cotizaciones(20),
      gastos: gastos(20),
      documentos: documentos(20),
    },
  };

  for (const [nombre, over] of Object.entries(CASOS)) {
    test(nombre, () => {
      const doc = expediente(over);
      const choques = textosQueSePisan(doc);
      if (choques.length > 0) {
        throw new Error(`Textos superpuestos en el expediente:\n  ${describirChoques(choques)}`);
      }
    });
  }
});

// ---------------------------------------------------------------------------
describe('el pie de página no se monta sobre el contenido', () => {
  const CASOS = {
    'licitación típica': {},
    'tablas vacías': { cotizaciones: [], gastos: [], documentos: [] },
    // Los tres largos que fuerzan salto: hay que probar que el corte cae ARRIBA
    // del pie en todas las páginas, no sólo en la última.
    'muchas cotizaciones': { cotizaciones: cotizaciones(45) },
    'muchos gastos': { gastos: gastos(45) },
    'muchos documentos': { documentos: documentos(45) },
    'los tres a la vez': {
      cotizaciones: cotizaciones(25), gastos: gastos(25), documentos: documentos(25),
    },
  };

  for (const [nombre, over] of Object.entries(CASOS)) {
    test(nombre, () => {
      const doc = expediente(over);
      const { cuerpo } = partirEnCuerpoYPie(doc);

      const derrames = cuerpo
        .filter((t) => t.abajo > Y_FILETE_PIE)
        .map((t) => `«${t.contenido.slice(0, 40)}» (pág. ${t.pagina + 1}) baja hasta `
          + `${t.abajo.toFixed(1)}, el filete del pie está en ${Y_FILETE_PIE.toFixed(1)}`);

      if (derrames.length > 0) {
        throw new Error(`Contenido impreso sobre el pie de página:\n  ${derrames.join('\n  ')}`);
      }
    });
  }

  test('el pie se repite en TODAS las páginas, no sólo en la primera', () => {
    // Si el bucle del pie se quedara corto, las páginas del medio saldrían sin
    // numerar y nadie lo notaría hasta imprimir el expediente.
    const doc = expediente({ cotizaciones: cotizaciones(25), gastos: gastos(25) });
    expect(doc.paginas).toBeGreaterThan(1);

    const { pie } = partirEnCuerpoYPie(doc);
    const paginasConPie = new Set(pie.map((t) => t.pagina));
    expect(paginasConPie.size).toBe(doc.paginas);
  });
});

// ---------------------------------------------------------------------------
// EL MARCO DE «DATOS DE LA LICITACIÓN».
//
// El punto delicado del archivo: el rectángulo se dibuja al final con una Y
// capturada al principio. Lo que hay que verificar no es que el marco EXISTA
// (existe siempre) sino que ENVUELVA lo que enmarca.
// ---------------------------------------------------------------------------
describe('el marco de «Datos de la licitación» envuelve a su contenido', () => {
  /**
   * El marco de la caja de datos, distinguido del resto de los rectángulos
   * redondeados del documento por su geometría: ocupa el ancho completo del
   * contenido y arranca en el margen izquierdo. Las tarjetas del resumen
   * económico son más angostas, la píldora de estado usa radio 8.5 y el banner
   * de ganancia/pérdida mide 34 pt de alto fijo.
   */
  function marcoDeDatos(doc) {
    const candidatos = doc.formas.filter(
      (f) => f.tipo === 'roundedRect'
        && Math.round(f.izquierda) === MARGIN
        && Math.round(f.ancho) === Math.round(CW)
        && f.radio === 3
    );
    expect(candidatos).toHaveLength(1);
    return candidatos[0];
  }

  /**
   * Los textos de la sección 1: los que van entre su título y el de la sección
   * 2. Se recortan por índice y no por coordenada porque justamente lo que se
   * está buscando es contenido que quedó FUERA de donde se lo espera.
   */
  function contenidoDeLaCaja(doc) {
    const desde = doc.textos.findIndex((t) => t.contenido === 'DATOS DE LA LICITACIÓN');
    const hasta = doc.textos.findIndex((t) => t.contenido === 'RESUMEN ECONÓMICO');
    expect(desde).toBeGreaterThanOrEqual(0);
    expect(hasta).toBeGreaterThan(desde);
    // +1 para saltear el propio título de sección, que va ARRIBA del marco.
    return doc.textos.slice(desde + 1, hasta);
  }

  const CASOS = {
    'campos cortos': {},
    'sin descripción ni observaciones (cuatro filas)': {
      descripcion: null, observaciones_resultado: null,
    },
    'con descripción y observaciones (seis filas)': {
      descripcion: 'Provisión de repuestos originales para tractores agrícolas, '
        + 'motoniveladoras y retroexcavadoras de la flota municipal.',
      observaciones_resultado: 'Adjudicada parcialmente: sólo los ítems 1 al 7.',
    },
    'convocante con razón social larga': {
      cliente_nombre: 'Gobierno Autónomo Municipal de Santa Cruz de la Sierra — '
        + 'Dirección de Mantenimiento de Maquinaria Pesada y Equipo Caminero',
    },
  };

  for (const [nombre, over] of Object.entries(CASOS)) {
    test(nombre, () => {
      const doc = expediente(over);
      const marco = marcoDeDatos(doc);
      const dentro = contenidoDeLaCaja(doc);

      expect(dentro.length).toBeGreaterThanOrEqual(8); // 4 filas × (rótulo + valor)

      for (const t of dentro) {
        // Mismo marco, misma página: un marco dibujado en otra hoja no enmarca
        // nada, por más que los números den.
        expect({ texto: t.contenido, pagMarco: marco.pagina, pagTexto: t.pagina })
          .toEqual(expect.objectContaining({ pagTexto: marco.pagina }));
        expect(t.arriba).toBeGreaterThanOrEqual(marco.arriba);
        expect(t.abajo).toBeLessThanOrEqual(marco.abajo);
        expect(t.izquierda).toBeGreaterThanOrEqual(marco.izquierda);
        expect(t.derecha).toBeLessThanOrEqual(marco.derecha);
      }
    });
  }

  test('el marco crece cuando la caja suma filas', () => {
    // Que envuelva con cuatro filas no dice nada si el alto fuera constante:
    // lo que distingue un marco calculado de uno fijo es que ACOMPAÑE al
    // contenido. Descripción y observaciones son las dos filas opcionales.
    const minima = marcoDeDatos(expediente({ descripcion: null, observaciones_resultado: null }));
    const completa = marcoDeDatos(expediente({
      descripcion: 'Repuestos originales para la flota municipal.',
      observaciones_resultado: 'Adjudicada parcialmente.',
    }));

    expect(completa.alto).toBeGreaterThan(minima.alto);
  });

  test('la sección 2 arranca por debajo del marco, no adentro', () => {
    const doc = expediente({
      descripcion: 'Repuestos originales para la flota municipal.',
      observaciones_resultado: 'Adjudicada parcialmente: sólo los ítems 1 al 7.',
    });
    const marco = marcoDeDatos(doc);
    const titulo2 = doc.textos.find((t) => t.contenido === 'RESUMEN ECONÓMICO');

    expect(titulo2).toBeDefined();
    expect(titulo2.arriba).toBeGreaterThanOrEqual(marco.abajo);
  });
});

// ---------------------------------------------------------------------------
// HALLAZGO ABIERTO — BUG REAL, NO SE ARREGLA ACÁ.
//
// Cuando el contenido de la caja de datos NO entra en la página, kvRow llama a
// ensureSpace(), que hace doc.addPage() y devuelve y = MARGIN + 6. A partir de
// ahí `boxTop` (capturado en la página anterior) y `y` (ya en la página nueva)
// pertenecen a hojas distintas, y la línea final
//
//     doc.roundedRect(MARGIN, boxTop, CW, y - boxTop + 2, 3)
//
// dibuja UN SOLO marco, en la página nueva, arrancando en la Y que tenía la
// página vieja. Es exactamente el patrón del bug que ya llegó al cliente: una
// coordenada capturada arriba y usada abajo, con contenido de largo libre en el
// medio.
//
// LOS DOS SÍNTOMAS, MEDIDOS
//   a) MARCO QUE CORTA EL TEXTO. Con la descripción de abajo (~2500 car.): la
//      página 1 se queda SIN marco, y en la página 2 el marco se dibuja de
//      y = 244,0 a y = 754,0 mientras la descripción de esa misma página va de
//      y = 47,0 a y = 749,0. O sea: el borde superior del recuadro pasa por
//      encima del renglón que está a 244 pt y las ~17 líneas de arriba quedan
//      fuera de la caja que supuestamente las contiene.
//   b) MARCO DE ALTO NEGATIVO. Si el salto lo dispara una fila CORTA (por
//      ejemplo «Observaciones») justo después de que la descripción dejó `y`
//      cerca del corte, el contenido de la página nueva termina MÁS ARRIBA que
//      boxTop y `y - boxTop` sale negativo. Reproducido con una descripción de
//      269 palabras / 2848 caracteres y observaciones_resultado corto:
//      alto = -180,3 pt.
//
// CÓMO REPRODUCIRLO EN LA APP
// Crear una licitación con una descripción larga —el validador acepta hasta
// 5000 caracteres (src/validators/licitacionValidator.js, `descripcion.max(5000)`)
// y la columna es TEXT— y descargar su expediente. Con ~1800 caracteres ya
// alcanza: las cuatro filas fijas dejan `y` en ~306 pt y ensureSpace corta en
// 777,9 pt, así que una fila de más de ~470 pt de alto salta de página.
//
// POR QUÉ ESTÁ EN skip Y NO EN ROJO
// Arreglarlo obliga a tocar src/services/licitacionPdfService.js —hay que
// dibujar un marco por página, o mover el marco a un dibujante que sepa de
// saltos— y esta tanda de trabajo es sólo de tests. La decisión es de Adrian.
// Para verlos, sacarles el .skip.
// ---------------------------------------------------------------------------
describe('caja de datos que no entra en una página (hallazgo abierto)', () => {
  // ~2500 caracteres, la mitad de lo que acepta el validador.
  const DESCRIPCION_LARGA = Array.from(
    { length: 60 },
    (_, i) => `Ítem ${i + 1}: repuesto original de línea con provisión certificada por fábrica.`
  ).join(' ');

  // La que dispara el síntoma (b): la descripción deja `y` justo antes del
  // corte y es la fila CORTA de observaciones la que salta de página.
  const DESCRIPCION_AL_FILO = Array.from({ length: 269 }, (_, i) => `palabra${i}`).join(' ');

  /** Todos los marcos de la caja de datos que se hayan dibujado. */
  const marcosDeDatos = (doc) => doc.formas.filter(
    (f) => f.tipo === 'roundedRect'
      && Math.round(f.izquierda) === MARGIN
      && Math.round(f.ancho) === Math.round(CW)
      && f.radio === 3
  );

  test('la descripción larga efectivamente parte la caja en dos páginas', () => {
    // El guardia de los propios hallazgos: si mañana cambia el alto de fila o
    // el corte de ensureSpace y este caso deja de saltar de página, los skip de
    // abajo estarían protegiendo un escenario que ya no existe.
    const doc = expediente({ descripcion: DESCRIPCION_LARGA });
    expect(doc.paginas).toBeGreaterThan(1);
  });

  test('(a) el marco sigue envolviendo a la descripción cuando la caja salta de página', () => {
    const doc = expediente({ descripcion: DESCRIPCION_LARGA });
    const marcos = marcosDeDatos(doc);

    // Un marco por cada página que la caja ocupe: hoy se dibuja uno solo, y en
    // la página equivocada.
    expect(marcos.length).toBeGreaterThanOrEqual(2);

    const descripcion = doc.textos.find((t) => t.contenido.startsWith('Ítem 1:'));
    const suMarco = marcos.find((m) => m.pagina === descripcion.pagina);
    expect(suMarco).toBeDefined();
    expect(descripcion.arriba).toBeGreaterThanOrEqual(suMarco.arriba);
    expect(descripcion.abajo).toBeLessThanOrEqual(suMarco.abajo);
  });

  test('(b) el marco nunca se dibuja con alto negativo', () => {
    // Un rectángulo de alto negativo no es «un poco desalineado»: se dibuja
    // hacia ARRIBA desde boxTop, o sea encima de la sección anterior.
    const doc = expediente({
      descripcion: DESCRIPCION_AL_FILO,
      observaciones_resultado: 'Adjudicada parcialmente.',
    });

    for (const m of marcosDeDatos(doc)) {
      expect(m.alto).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
describe('nada se sale de la hoja', () => {
  test('todo lo dibujado entra entre los márgenes laterales', () => {
    const doc = expediente({
      cotizaciones: cotizaciones(6),
      gastos: gastos(6),
      documentos: documentos(6),
      observaciones_resultado: 'Adjudicada parcialmente: sólo los ítems 1 al 7 del pliego.',
    });

    for (const t of doc.textos) {
      // La franja de marcas usa el margen de la proforma (36 pt, de
      // pdf/constants.js) y no el 40 local del expediente: la cota es el borde
      // de la hoja, no el margen, para no convertir esa diferencia histórica en
      // un falso positivo.
      expect(t.izquierda).toBeGreaterThanOrEqual(0);
      expect(t.derecha).toBeLessThanOrEqual(PW);
    }
  });

  test('las tablas vacías imprimen su leyenda y no una fila fantasma', () => {
    const doc = expediente({ cotizaciones: [], gastos: [], documentos: [] });

    for (const leyenda of [
      'Sin cotizaciones vinculadas.',
      'Sin gastos registrados.',
      'Sin documentos adjuntos.',
    ]) {
      expect(doc.textos.filter((t) => t.contenido === leyenda)).toHaveLength(1);
    }

    // Con las tres tablas vacías el expediente tiene que entrar en una hoja: si
    // se fuera a dos, algo está reservando alto que no usa.
    expect(doc.paginas).toBe(1);
  });
});
