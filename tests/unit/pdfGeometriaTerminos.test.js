// =============================================================================
// tests/unit/pdfGeometriaTerminos.test.js
// DÓNDE cae cada cosa en la hoja de Condiciones Generales.
//
// POR QUÉ EXISTE
// El contenido lo cubre pdfTerminos.test.js y que la hoja exista lo cubre
// pdfGenerate.test.js contando páginas. Lo que ninguno de los dos ve es si el
// texto se pisa, se sale del margen o se mete debajo del pie: un PDF con todo
// superpuesto pasa esas pruebas igual de bien que uno perfecto. Ese fue
// exactamente el bug que llegó al cliente y que originó tests/helpers/docFalso.js.
//
// Acá se dibuja contra un doc de mentira que ANOTA las coordenadas, y se
// comprueban las relaciones entre ellas.
// =============================================================================

'use strict';

const {
  docFalso, buscarTexto, textosQueSePisan, describirChoques, alturaUsada,
} = require('../helpers/docFalso');

const {
  drawTerminosPage, medirClausulas, GEOMETRIA,
} = require('../../src/services/pdf/drawers/terminos');
const { numerarPaginas } = require('../../src/services/pdf/drawers/footer');
const { PW, PH, MARGIN } = require('../../src/services/pdf/constants');

const ALTO_PIE      = 41;             // franja naranja (3) + bloque navy (38)
const TECHO_DEL_PIE = PH - ALTO_PIE;

const cotizacion = (over = {}) => ({
  numero_correlativo: 'SC-2026/000731',
  cliente_nombre:     'CONSTRUCTORA BOLIVIANA S.R.L.',
  entidad_emisora:    'Roca Importaciones S.R.L.',
  fecha_emision:      '2026-09-08',
  fecha_validez:      '2026-09-11',
  estado:             'Enviada al cliente',
  ...over,
});

/** Dibuja la hoja y devuelve el doc anotado. */
function dibujar(over) {
  const doc = docFalso({
    margenes: { top: MARGIN, bottom: MARGIN + 45, left: MARGIN, right: MARGIN },
  });
  drawTerminosPage(doc, cotizacion(over));
  return doc;
}

/** Los números de cláusula («1.», «2.», …) marcan el borde de cada columna. */
const numerosDeClausula = (doc) =>
  doc.textos.filter((t) => /^\d+\.$/.test(t.contenido.trim()));

describe('la hoja de condiciones ocupa una sola página', () => {
  test('agrega exactamente una página', () => {
    // docFalso arranca en 1; drawTerminosPage debe llevarla a 2 y no más.
    expect(dibujar().paginas).toBe(2);
  });

  test('todo el contenido cae en la página nueva, no en la anterior', () => {
    const doc = dibujar();
    expect(doc.textos.filter((t) => t.pagina === 0)).toHaveLength(0);
  });
});

describe('nada se pisa ni se sale de la hoja', () => {
  test('ningún texto se superpone con otro', () => {
    const choques = textosQueSePisan(dibujar());

    if (choques.length) {
      throw new Error(
        `Hay ${choques.length} texto(s) superpuesto(s) en la hoja de condiciones:\n  ` +
        describirChoques(choques) + '\n\n' +
        'Un PDF con texto encima de otro se genera sin error y se ve roto sólo ' +
        'al imprimirlo. Suele venir de que una columna crece más de lo previsto.'
      );
    }
  });

  test('ningún texto se sale de los márgenes laterales', () => {
    const doc = dibujar();
    const fuera = doc.textos.filter(
      (t) => t.izquierda < MARGIN - 1 || t.derecha > PW - MARGIN + 1
    );

    if (fuera.length) {
      throw new Error(
        'Estos textos se salen del área imprimible:\n  ' +
        fuera
          .map((t) => `«${t.contenido.slice(0, 40)}» va de ${t.izquierda.toFixed(1)} a ${t.derecha.toFixed(1)}`)
          .join('\n  ') +
        `\n\nEl área imprimible va de ${MARGIN} a ${(PW - MARGIN).toFixed(1)} pt.`
      );
    }
  });

  test('las cláusulas terminan por encima del pie', () => {
    const doc = dibujar();
    // Sólo el cuerpo: el pie dibuja a propósito por debajo de este techo, con
    // la maniobra del margen inferior que documenta footer.js.
    const cuerpo  = doc.textos.filter((t) => t.pagina === 1 && t.y < TECHO_DEL_PIE);
    const masBajo = Math.max(...cuerpo.map((t) => t.abajo));

    if (masBajo > TECHO_DEL_PIE) {
      throw new Error(
        `El texto de las condiciones llega hasta ${masBajo.toFixed(1)} pt y el pie ` +
        `empieza en ${TECHO_DEL_PIE.toFixed(1)} pt.\n\n` +
        'Además de verse mal, escribir por debajo de ese punto hace que PDFKit ' +
        'abra una página nueva sola: la hoja de condiciones se parte en dos.'
      );
    }
  });
});

describe('las dos columnas se reparten el texto', () => {
  test('se dibujan las 24 cláusulas en dos columnas', () => {
    const numeros = numerosDeClausula(dibujar());
    expect(numeros).toHaveLength(24);

    const columnas = [...new Set(numeros.map((t) => Math.round(t.x)))];
    expect(columnas).toHaveLength(2);
  });

  test('ninguna columna se lleva casi todo', () => {
    const numeros    = numerosDeClausula(dibujar());
    const izquierda  = Math.min(...numeros.map((t) => Math.round(t.x)));
    const cuantosIzq = numeros.filter((t) => Math.round(t.x) === izquierda).length;

    // El reparto es por ALTURA, no por cantidad, así que no tienen por qué ser
    // 12 y 12 — pero un 23/1 significa que el balanceo dejó de funcionar.
    if (cuantosIzq < 8 || cuantosIzq > 16) {
      throw new Error(
        `La columna izquierda se quedó con ${cuantosIzq} de 24 cláusulas.\n\n` +
        'El reparto se hace midiendo todo antes de dibujar (medirClausulas) y ' +
        'cortando a la mitad de la altura total. Un reparto tan desparejo ' +
        'sugiere que esa medición dejó de reflejar lo que se dibuja.'
      );
    }
  });
});

describe('la banda de identificación ata la hoja a su cotización', () => {
  test.each([
    ['el correlativo', 'SC-2026/000731'],
    ['el cliente',     'CONSTRUCTORA BOLIVIANA S.R.L.'],
    ['el título',      'CONDICIONES GENERALES DE LA OFERTA'],
  ])('imprime %s', (_nombre, esperado) => {
    expect(buscarTexto(dibujar(), esperado).length).toBeGreaterThan(0);
  });

  test('la banda va arriba del todo, antes de las cláusulas', () => {
    const doc = dibujar();
    // El correlativo se imprime DOS veces: en la banda de arriba y en el pie.
    // Hay que quedarse con el de la banda, no con el primero que aparezca —
    // el pie se dibuja antes, así que el primero es el de abajo del todo.
    const correlativo = buscarTexto(doc, 'SC-2026/000731')
      .filter((t) => t.y < TECHO_DEL_PIE)
      .sort((a, b) => a.y - b.y)[0];
    const primera = buscarTexto(doc, 'Vigencia de la Oferta')[0];

    expect(correlativo).toBeDefined();
    expect(primera).toBeDefined();
    expect(correlativo.abajo).toBeLessThanOrEqual(primera.arriba);
  });

  test('sin fechas no explota: muestra una raya', () => {
    const doc = dibujar({ fecha_emision: null, fecha_validez: 'no es una fecha' });
    expect(buscarTexto(doc, '—').length).toBeGreaterThan(0);
  });
});

describe('el nombre del emisor sale en las cláusulas', () => {
  test.each([
    ['Roca Importaciones S.R.L.',                    'ROCA IMPORTACIONES S.R.L.'],
    ['Empresa unipersonal de Ronald Roca Cartagena', 'EMPRESA UNIPERSONAL DE RONALD ROCA CARTAGENA'],
  ])('con %s imprime %s', (entidad, esperado) => {
    const doc = dibujar({ entidad_emisora: entidad });
    expect(buscarTexto(doc, esperado).length).toBeGreaterThan(0);
  });

  test('no queda ningún marcador sin reemplazar', () => {
    expect(buscarTexto(dibujar(), '{EMISOR}')).toHaveLength(0);
  });
});

describe('no hay bloque de firmas', () => {
  test('la hoja no pide firmar nada', () => {
    // Se sacó a pedido: las condiciones se entregan como información, no como
    // un documento a suscribir. Si alguien lo reintroduce, esto lo dice.
    // \b delante de «firma» es obligatorio: sin él, la palabra CONfirmación —
    // que aparece en la cláusula de Disponibilidad — hace saltar la prueba.
    const firmas = dibujar().textos.filter(
      (t) => /\bfirma|\bfirmar\b|aceptaci[oó]n cliente|suscrib/i.test(t.contenido)
    );
    expect(firmas.map((t) => t.contenido)).toEqual([]);
  });
});

describe('la numeración de páginas', () => {
  test('escribe «Página X de Y» una vez por página', () => {
    const doc = docFalso();
    doc.addPage();
    doc.addPage();                    // 3 páginas en total
    numerarPaginas(doc);

    expect(buscarTexto(doc, /^Página \d+ de \d+$/).map((t) => t.contenido)).toEqual([
      'Página 1 de 3', 'Página 2 de 3', 'Página 3 de 3',
    ]);
  });

  test('cada número cae en SU página', () => {
    const doc = docFalso();
    doc.addPage();
    numerarPaginas(doc);

    buscarTexto(doc, /^Página/).forEach((t, i) => {
      expect(t.pagina).toBe(i);
    });
  });

  test('con un documento de una sola página dice «de 1»', () => {
    const doc = docFalso();
    numerarPaginas(doc);
    expect(buscarTexto(doc, 'Página 1 de 1')).toHaveLength(1);
  });
});

describe('la altura usada deja sitio al pie', () => {
  test('el contenido no invade el borde inferior de la hoja', () => {
    // El pie dibuja dentro de su franja a propósito; lo que no puede pasar es
    // que las cláusulas lleguen hasta el borde de papel.
    expect(alturaUsada(dibujar(), { pagina: 1 })).toBeLessThan(PH);
  });
});

// =============================================================================
// Contra PDFKit DE VERDAD
//
// Todo lo de arriba corre sobre docFalso, que es un MODELO tipográfico: sirve
// para las relaciones (esto va encima de aquello) pero sus números no son los
// del papel. Lo de acá abajo usa PDFKit real, con sus métricas de fuente, para
// la única cifra que tiene que ser exacta.
// =============================================================================

describe('la altura estimada coincide con la que PDFKit dibuja', () => {
  // POR QUÉ IMPORTA
  // El reparto en dos columnas se decide ANTES de dibujar, con una estimación
  // (medirClausulas). El avance vertical, en cambio, sale de doc.y. Si las dos
  // cifras se separaran, el corte de columna caería donde no corresponde: una
  // columna se pasaría de largo y el texto terminaría metiéndose debajo del pie
  // —o abriendo una segunda hoja de condiciones— sin ningún error de por medio.
  //
  // Hoy coinciden al punto porque heightOfString con `indent` es exactamente lo
  // que PDFKit aplica al texto corrido. Esta prueba vigila que siga siendo así
  // si cambia la tipografía, el cuerpo o la versión de la librería.
  const PDFDocument = require('pdfkit');
  const { CW } = require('../../src/services/pdf/constants');
  const { CLAUSULAS, textoClausula } = require('../../src/services/pdf/terminos');

  // Los MISMOS valores que usa el dibujante, no una copia: si allá cambian,
  // acá cambian solos y la prueba sigue midiendo lo que de verdad se imprime.
  const { CUERPO_PT: CUERPO, AIRE, anchoTexto: calcularAncho } = GEOMETRIA;
  const anchoTexto = calcularAncho(CW);

  /**
   * Compara, cláusula por cláusula, lo que estimó el DIBUJANTE contra lo que
   * PDFKit dibuja de verdad.
   *
   * La estimación sale de medirClausulas(), la función real del drawer — no de
   * una cuenta rehecha acá. Esa diferencia es la prueba: rehacerla convertiría
   * esto en dos estimaciones comparándose entre sí, que es lo que pasaba antes
   * y hacía que la prueba pasara aun con la medición del drawer rota.
   */
  function medirDeVerdad() {
    const doc = new PDFDocument({
      size: 'A4', autoFirstPage: true,
      margins: { top: MARGIN, bottom: MARGIN + 45, left: MARGIN, right: MARGIN },
    });
    // Un sumidero que tira todo. NO se usa 'NUL' ni '/dev/null': en Windows
    // createWriteStream('NUL') crea un ARCHIVO llamado NUL en el repositorio,
    // que además es un nombre reservado y cuesta borrar.
    doc.pipe(new (require('stream').Writable)({ write(_c, _e, cb) { cb(); } }));

    const emisor    = 'Roca Importaciones S.R.L.';
    const estimadas = medirClausulas(doc, emisor, anchoTexto, AIRE);

    return estimadas.map((m) => {
      const y0 = 100;
      doc.font('Helvetica-Bold').fontSize(CUERPO)
        .text(`${m.titulo}. `, MARGIN, y0, { width: anchoTexto, continued: true });
      doc.font('Helvetica').text(m.texto, { width: anchoTexto });

      // m.alto ya trae el aire sumado; se descuenta para comparar sólo el texto.
      return { titulo: m.titulo, estimado: m.alto - AIRE, real: doc.y - y0 };
    });
  }

  test('ninguna cláusula se dibuja más alta de lo estimado', () => {
    const desvios = medirDeVerdad()
      .map((m) => ({ ...m, dif: m.real - m.estimado }))
      .filter((m) => m.dif > AIRE);

    if (desvios.length) {
      throw new Error(
        `Estas cláusulas se dibujan más altas de lo que se estimó, y por más de ` +
        `los ${AIRE.toFixed(2)} pt de aire que hay entre una y otra:\n  ` +
        desvios.map((d) => `${d.titulo}: estimado ${d.estimado.toFixed(1)}, real ${d.real.toFixed(1)} (+${d.dif.toFixed(1)})`)
          .join('\n  ') + '\n\n' +
        'El reparto en dos columnas usa la estimación, así que el corte cae ' +
        'donde no corresponde: la columna se pasa de largo y el texto se mete ' +
        'debajo del pie o abre una segunda hoja de condiciones.'
      );
    }
  });

  test('la estimación tampoco se pasa: no deja huecos', () => {
    // Sobrestimar no rompe nada visible, pero desbalancea las columnas y
    // desperdicia hoja. Se admite hasta un renglón de diferencia.
    const RENGLON = CUERPO * 1.35;
    const sobras = medirDeVerdad().filter((m) => m.estimado - m.real > RENGLON);
    expect(sobras.map((s) => s.titulo)).toEqual([]);
  });
});
