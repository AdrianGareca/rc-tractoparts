// =============================================================================
// src/services/pdf/drawers/terminos.js
// La hoja de CONDICIONES GENERALES DE LA OFERTA, al final de la proforma.
//
// POR QUÉ ES UNA HOJA APARTE
// Es una exigencia legal: la empresa debe entregar sus condiciones junto con
// cada oferta. Van en su propia página —no al pie de la última— para que se
// puedan leer, archivar y firmar sin competir por espacio con los totales.
//
// LA BANDA DE IDENTIFICACIÓN DE ARRIBA
// Una hoja de condiciones sin datos es un papel suelto: impresa junto a otras
// cotizaciones, nadie sabe a cuál pertenece. La banda repite el correlativo,
// el cliente y las fechas, igual que hacen las proformas de Finning en sus
// páginas de condiciones. Es lo que ata la hoja a SU cotización.
//
// EL TEXTO NO ESTÁ ACÁ
// Las 24 cláusulas viven en ../terminos.js, que es texto legal aprobado por la
// abogada. Este archivo sólo decide DÓNDE cae cada cosa.
//
// Cubierto por tests/unit/pdfTerminos.test.js (contenido) y
// tests/unit/pdfGeometriaTerminos.test.js (geometría).
// =============================================================================

'use strict';

const { C, PW, MARGIN, CW } = require('../constants');
const { CLAUSULAS, TITULO_TERMINOS, textoClausula } = require('../terminos');
const { normalizeEntidad } = require('../bankData');
const { drawLogoWatermark } = require('./watermark');
const { drawFooter } = require('./footer');

// Geometría de la hoja. Se exporta al final (GEOMETRIA) para que las pruebas
// midan con LOS MISMOS números que se dibujan: una prueba que repita estas
// constantes por su cuenta deja de vigilar el día que alguien las cambia acá.
const BANDA_H   = 30;    // alto de la banda de identificación
const COLUMNAS  = 1;
const CANAL     = 16;    // separación entre columnas (sin uso con una sola)
const SANGRIA   = 17;    // espacio del número «12.» a la izquierda del texto
const CUERPO_PT = 6.5;   // tamaño del texto de las cláusulas

// Separación vertical entre cláusulas.
//
// Es generosa a propósito. En una sola columna cada renglón mide 506 pt —unos
// 130 caracteres— y con letra de 6,5 pt eso es una línea larga y fina: lo que
// vuelve legible un bloque así no es el tamaño de la letra sino el aire que
// separa un punto del siguiente. Además reparte las 24 cláusulas por toda la
// hoja en vez de amontonarlas arriba y dejar media página en blanco.
const AIRE      = CUERPO_PT * 1.55;

const fecha = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-BO', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/La_Paz',
  });
};

// ---------------------------------------------------------------------------
// bandaIdentificacion — la franja gris con los datos de la cotización.
// ---------------------------------------------------------------------------
function bandaIdentificacion(doc, quotation, y) {
  doc.rect(MARGIN, y, CW, BANDA_H).fillAndStroke(C.LIGHT_GRAY, C.BORDER_GRAY);
  doc.rect(MARGIN, y, 3, BANDA_H).fill(C.ORANGE);

  const campos = [
    ['COTIZACIÓN N°', quotation.numero_correlativo || '—', 115],
    ['CLIENTE',       quotation.cliente_nombre     || '—', 205],
    ['EMISIÓN',       fecha(quotation.fecha_emision),       90],
    ['VÁLIDA HASTA',  fecha(quotation.fecha_validez),       90],
  ];

  let x = MARGIN + 12;
  for (const [rotulo, valor, ancho] of campos) {
    doc.font('Helvetica').fontSize(5.5).fillColor(C.MID_GRAY)
      .text(rotulo, x, y + 7, { width: ancho - 8, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(7).fillColor(C.NAVY)
      .text(String(valor), x, y + 15, { width: ancho - 8, lineBreak: false, ellipsis: true });
    x += ancho;
  }
  return y + BANDA_H + 12;
}

// ---------------------------------------------------------------------------
// tituloTerminos — el encabezado centrado con su línea naranja.
// ---------------------------------------------------------------------------
function tituloTerminos(doc, y) {
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.NAVY)
    .text(TITULO_TERMINOS, MARGIN, y, { width: CW, align: 'center', lineBreak: false });
  doc.moveTo(MARGIN, y + 15).lineTo(PW - MARGIN, y + 15)
    .lineWidth(1).strokeColor(C.ORANGE).stroke();
  return y + 24;
}

// ---------------------------------------------------------------------------
// medirClausulas — alto de cada cláusula ANTES de dibujar.
//
// Hace falta medir todo primero para repartir las cláusulas parejo entre las
// dos columnas. Sin esto, el llenado «hasta que no entre más» deja 23 en la
// primera columna y 1 en la segunda: entra igual, pero se ve roto.
// ---------------------------------------------------------------------------
function medirClausulas(doc, emisor, anchoTexto, aire) {
  return CLAUSULAS.map(([titulo, cuerpo]) => {
    const texto = textoClausula(cuerpo, emisor);
    doc.font('Helvetica-Bold').fontSize(CUERPO_PT);
    const sangriaTitulo = doc.widthOfString(`${titulo}. `);
    doc.font('Helvetica').fontSize(CUERPO_PT);
    const alto = doc.heightOfString(texto, { width: anchoTexto, indent: sangriaTitulo });
    return { titulo, texto, alto: alto + aire };
  });
}

// ---------------------------------------------------------------------------
// dibujarClausulas — las 24 cláusulas numeradas, repartidas en dos columnas.
//
// El alto se mide dos veces, a propósito y con papeles distintos:
//
//   - medirClausulas() lo estima ANTES de dibujar, y eso sirve sólo para
//     decidir por dónde parte la columna. Necesita conocer el total antes de
//     empezar, así que no hay alternativa a estimar.
//   - el avance vertical, en cambio, se toma de `doc.y`: PDFKit informa ahí
//     dónde terminó de escribir realmente.
//
// Hoy las dos cifras coinciden EXACTAMENTE en las 24 cláusulas (medido, no
// supuesto — lo comprueba pdfGeometriaTerminos.test.js contra PDFKit de
// verdad), porque heightOfString con `indent` es justo lo que PDFKit usa para
// el texto corrido. Usar `doc.y` igual es lo correcto: es la fuente, no una
// réplica, y no puede desincronizarse si mañana cambia la tipografía o el
// cuerpo.
// ---------------------------------------------------------------------------
function dibujarClausulas(doc, emisor, y) {
  const anchoColumna = (CW - (COLUMNAS - 1) * CANAL) / COLUMNAS;
  const anchoTexto   = anchoColumna - SANGRIA;
  const aire         = AIRE;

  const medidas  = medirClausulas(doc, emisor, anchoTexto, aire);
  const objetivo = medidas.reduce((s, m) => s + m.alto, 0) / COLUMNAS;

  let columna = 0, yColumna = y, acumulado = 0, yMaxima = y;

  medidas.forEach((m, i) => {
    if (columna < COLUMNAS - 1 && acumulado >= objetivo) {
      columna += 1; yColumna = y; acumulado = 0;
    }
    const x = MARGIN + columna * (anchoColumna + CANAL);

    doc.font('Helvetica-Bold').fontSize(CUERPO_PT).fillColor(C.MID_GRAY)
      .text(`${i + 1}.`, x, yColumna, { width: SANGRIA - 3, align: 'right', lineBreak: false });

    doc.font('Helvetica-Bold').fontSize(CUERPO_PT).fillColor(C.NAVY)
      .text(`${m.titulo}. `, x + SANGRIA, yColumna, { width: anchoTexto, continued: true });
    doc.font('Helvetica').fillColor(C.DARK_GRAY)
      .text(m.texto, { width: anchoTexto });

    const siguiente = doc.y + aire;
    acumulado += siguiente - yColumna;
    yColumna   = siguiente;
    if (yColumna > yMaxima) yMaxima = yColumna;
  });

  return yMaxima;
}

// ---------------------------------------------------------------------------
// drawTerminosPage — agrega la hoja completa al final del documento.
//
// Sigue la misma secuencia que los demás drawers cuando saltan de página
// (itemsTable, totals, observations): addPage → marca de agua → pie.
// ---------------------------------------------------------------------------
function drawTerminosPage(doc, quotation) {
  doc.addPage();
  drawLogoWatermark(doc);
  drawFooter(doc, quotation);

  const emisor = normalizeEntidad(quotation.entidad_emisora);
  let y = bandaIdentificacion(doc, quotation, MARGIN);
  y     = tituloTerminos(doc, y);
  return dibujarClausulas(doc, emisor, y);
}

const GEOMETRIA = Object.freeze({
  BANDA_H, COLUMNAS, CANAL, SANGRIA, CUERPO_PT, AIRE,
  anchoColumna: (ancho) => (ancho - (COLUMNAS - 1) * CANAL) / COLUMNAS,
  anchoTexto:   (ancho) => (ancho - (COLUMNAS - 1) * CANAL) / COLUMNAS - SANGRIA,
});

// medirClausulas se exporta para que la prueba compare SU resultado con lo que
// PDFKit dibuja de verdad. Si la prueba rehiciera la cuenta por su lado,
// estaría comparando dos estimaciones y no vigilaría nada.
module.exports = { drawTerminosPage, medirClausulas, GEOMETRIA };
