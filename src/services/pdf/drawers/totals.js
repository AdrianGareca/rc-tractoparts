// =============================================================================
// src/services/pdf/drawers/totals.js
// Linea SON en letras, condiciones de la oferta, datos bancarios y total.
//
// Extraido de pdfService.js sin cambios de comportamiento.
// =============================================================================

'use strict';

const { C, PW, PH, MARGIN, CW } = require('../constants');
const { fmtPrice, formatDate, sanitizeUnsupportedGlyphs } = require('../format');
const { numberToWordsES } = require('../numberToWords');
// El redondeo monetario compartido: la MISMA cuenta que usa el servidor para
// guardar los subtotales, y que el navegador para la vista previa en vivo.
const { redondearCentavos } = require('../../../utils/quotationTotals');
const { resolveBankData } = require('../bankData');
const { drawLogoWatermark } = require('./watermark');
const { drawFooter } = require('./footer');

// ---------------------------------------------------------------------------
// EL BLOQUE DE CIERRE DE LA PROFORMA
//
// Era UNA funcion de 184 lineas. Se partio por sus costuras reales, que son las
// que ya estaban marcadas con comentarios adentro: los importes, la linea SON,
// la columna izquierda y la columna derecha.
//
// Las dos columnas arrancan en la MISMA `y` y bajan por su cuenta —una devuelve
// `ly` y la otra `ry`—, y el bloque termina donde termina la mas larga. Por eso
// cada una devuelve su altura final en vez de recibir una referencia: son
// independientes, y tratarlas como tales es lo que permite leerlas por separado.
// ---------------------------------------------------------------------------

/**
 * Los tres numeros que se imprimen: subtotal, descuento y total.
 *
 * @returns {{ computedTotal: number, discount: number, hasDiscount: boolean, displayTotal: number }}
 */
function calcularImportes(quotation, detalles) {

  // Subtotal = sum of line-item subtotals. Prices are already tax-inclusive,
  // so there is NO added IVA row: the subtotal equals the total unless a manual
  // cash discount applies.
  //
  // El redondeo NO es cosmetico: sumar catorce valores de dos decimales en punto
  // flotante deja residuo, y a veces cae para abajo (199.99999999999997 en lugar
  // de 200). Ese residuo llegaba al importe en letras y lo partia en 199 mas 100
  // centavos, asi que el PDF decia un numero arriba y otro abajo.
  // Ver tests/unit/importeEnLetras.test.js.
  const computedTotal = redondearCentavos(
    detalles.reduce((s, item) => s + parseFloat(item.subtotal || 0), 0)
  );

  // Manual cash discount (descuento_manual) — an absolute amount subtracted
  // directly from the subtotal, mirroring the server-side monto_total math.
  const discount    = quotation.descuento_manual != null ? parseFloat(quotation.descuento_manual) : 0;
  const hasDiscount = detalles.length > 0 && discount > 0;

  // La resta vuelve a introducir error binario, asi que se redondea otra vez:
  // es la ultima cuenta antes de que el numero se imprima y se diga en letras.
  const displayTotal = detalles.length > 0
    ? Math.max(0, redondearCentavos(computedTotal - discount))
    : redondearCentavos(parseFloat(quotation.monto_total || 0));

  const currencyLabel = quotation.moneda === 'BOB' ? 'BOLIVIANOS' : 'DÓLARES AMERICANOS';
  const totalWords    = numberToWordsES(displayTotal);

  return { computedTotal, discount, hasDiscount, displayTotal };
}

/**
 * La linea SON: el importe en letras, a todo el ancho.
 * Es el renglon con peso legal de la proforma boliviana.
 * @returns {number} la `y` donde sigue el bloque de abajo
 */
function dibujarLineaSon(doc, quotation, y, displayTotal) {
  const currencyLabel = quotation.moneda === 'BOB' ? 'BOLIVIANOS' : 'DOLARES AMERICANOS';
  const totalWords    = numberToWordsES(displayTotal);
  const sonText        = `${totalWords} ${currencyLabel}`;
  const SON_LABEL_H    = 20; // alto "de una linea" — el que tenia esta franja antes del fix

  // ── SON: line ─────────────────────────────────────────────────────────────
  // Alto medido ANTES de dibujar el rectangulo de fondo: con un total de
  // varios millones, numberToWordsES devuelve una frase larga que a este
  // ancho (CW - 36) envuelve a mas de una linea. `lineBreak:false` no evita
  // el ajuste de linea en esta version de PDFKit cuando hay un `width`
  // explicito (mismo patron ya arreglado en header.js / itemsTable.js — ver
  // rc-tractoparts-recurring-bug-patterns, patron #4). Antes la caja tenia un
  // alto fijo (SON_H=20) y el importe en letras se salia de sus bordes.
  // Hallazgo de la ronda de estres del 2026-08-27.
  const sonTextW = CW - 36;
  doc.font('Helvetica-Bold').fontSize(7.5);
  const sonTextH = doc.heightOfString(sonText, { width: sonTextW });
  const SON_H    = Math.max(SON_LABEL_H, sonTextH + 8);

  doc.rect(MARGIN, y, CW, SON_H).fill('#FFF3E0');
  doc
    .moveTo(MARGIN, y)
    .lineTo(PW - MARGIN, y)
    .lineWidth(0.6)
    .strokeColor(C.ORANGE)
    .stroke();
  doc
    .moveTo(MARGIN, y + SON_H)
    .lineTo(PW - MARGIN, y + SON_H)
    .lineWidth(0.6)
    .strokeColor(C.ORANGE)
    .stroke();

  doc
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .fillColor(C.NAVY)
    .text('SON:', MARGIN + 6, y + (SON_LABEL_H - 7.5) / 2, { lineBreak: false });
  doc
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .fillColor(C.DARK_GRAY)
    // Sin lineBreak:false: el importe en letras envuelve dentro de su propio
    // ancho (sonTextW, el mismo que se midio arriba) en vez de salirse de la
    // caja de fondo — SON_H ya se calculo para que las lineas de mas entren.
    .text(sonText, MARGIN + 30, y + (SON_LABEL_H - 7.5) / 2, { width: sonTextW });

  // Se DEVUELVE la y ya avanzada: el alto REAL de la franja SON mas el aire
  // que la separa del bloque de abajo.
  //
  // Esta linea se perdio al partir la funcion original y el efecto fue grave:
  // sin ella las dos columnas arrancaban en la MISMA y que la franja SON, y el
  // importe en letras quedaba impreso ENCIMA de "CONDICIONES DE LA OFERTA" —
  // los dos textos superpuestos e ilegibles, en el PDF que se le manda al
  // cliente. Lo vigila tests/unit/pdfBloqueDeCierre.test.js.
  return y + SON_H + 8;
}

/**
 * Columna izquierda: condiciones de la oferta y datos bancarios.
 * @returns {number} la `y` a la que llego esta columna
 */
function dibujarCondicionesYBanco(doc, quotation, y, LEFT_W) {
  let ly = y;

  doc
    .font('Helvetica-Bold')
    .fontSize(7)
    .fillColor(C.NAVY)
    .text('CONDICIONES DE LA OFERTA', MARGIN + 4, ly + 5,
      { width: LEFT_W - 10, lineBreak: false });
  doc
    .moveTo(MARGIN, ly + 15)
    .lineTo(MARGIN + LEFT_W, ly + 15)
    .lineWidth(0.6)
    .strokeColor(C.BORDER_GRAY)
    .stroke();
  ly += 18;

  const validezStr = quotation.fecha_validez
    ? `HASTA EL ${formatDate(quotation.fecha_validez)}`
    : '15 DÍAS CALENDARIO';
  // Use per-quotation tiempo_entrega if provided, else fall back to default.
  // sanitizeUnsupportedGlyphs: campo libre editable por el usuario — ver el
  // comentario en pdf/format.js sobre ₩/₹ saliendo como © / ¹ sin aviso.
  const entregaStr = sanitizeUnsupportedGlyphs(quotation.tiempo_entrega) || '25 DÍAS CALENDARIO';

  // Forma de pago: use the per-quotation value (forma_pago) when supplied,
  // otherwise fall back to the historical default advance-payment condition.
  const formaPagoStr = sanitizeUnsupportedGlyphs(quotation.forma_pago && String(quotation.forma_pago).trim())
    || '60% ANTICIPO Y SALDO CONTRA ENTREGA';

  const condiciones = [
    ['Tiempo de entrega:', entregaStr],
    ['Forma de pago:',     formaPagoStr],
    ['Validez de oferta:', validezStr],
  ];

  // Alto de cada fila, medido ANTES de dibujar: un tiempo_entrega largo
  // (hasta 100 caracteres, dentro del límite normal del validador — no hace
  // falta un caso extremo) no entraba en una línea a este ancho y se
  // derramaba sobre la fila de abajo. `lineBreak:false` no lo evita en esta
  // versión de PDFKit (ver rc-tractoparts-recurring-bug-patterns, patrón
  // #4). Encontrado en la ronda de estrés del 2026-08-26.
  const CONDICION_VAL_W = LEFT_W - 88;
  doc.font('Helvetica').fontSize(7);
  condiciones.forEach(([lbl, val]) => {
    const rowH = Math.max(12, doc.heightOfString(String(val), { width: CONDICION_VAL_W }) + 4);
    doc
      .font('Helvetica-Bold')
      .fontSize(7)
      .fillColor(C.MID_GRAY)
      .text(lbl, MARGIN + 4, ly + 2, { width: 78, lineBreak: false });
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(C.DARK_GRAY)
      .text(val, MARGIN + 84, ly + 2, { width: CONDICION_VAL_W });
    ly += rowH;
  });

  ly += 4;

  // LEFT COLUMN ── DATOS BANCARIOS ───────────────────────────────────────────
  doc
    .font('Helvetica-Bold')
    .fontSize(7)
    .fillColor(C.NAVY)
    .text('DATOS BANCARIOS', MARGIN + 4, ly + 5,
      { width: LEFT_W - 10, lineBreak: false });
  doc
    .moveTo(MARGIN, ly + 15)
    .lineTo(MARGIN + LEFT_W, ly + 15)
    .lineWidth(0.6)
    .strokeColor(C.BORDER_GRAY)
    .stroke();
  ly += 18;

  // Dynamic per issuing entity (ENTIDAD EMISORA): the unipersonal entity prints
  // its personal account; the S.R.L. entity prints the corporate account.
  const banco = resolveBankData(quotation);
  const bancoData = [
    ['Beneficiario:', banco.beneficiario],
    ['Entidad:',      banco.banco],
    ['Cuenta Cte:',   banco.cuenta],
  ];

  bancoData.forEach(([lbl, val]) => {
    doc
      .font('Helvetica-Bold')
      .fontSize(7)
      .fillColor(C.MID_GRAY)
      .text(lbl, MARGIN + 4, ly + 2, { width: 60, lineBreak: false });
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(C.DARK_GRAY)
      .text(val, MARGIN + 66, ly + 2,
        { width: LEFT_W - 70, lineBreak: false });
    ly += 12;
  });

  return ly;
}

/**
 * Columna derecha: subtotal, descuento y la caja del TOTAL.
 * @returns {number} la `y` a la que llego esta columna
 */
function dibujarCajaDeTotales(doc, quotation, y, geo, importes, detalles) {
  const { RIGHT_X, RIGHT_W } = geo;
  const { computedTotal, discount, hasDiscount, displayTotal } = importes;
  let ry = y;

  // Subtotal row (only if there are line items)
  if (detalles.length > 0) {
    doc.rect(RIGHT_X, ry, RIGHT_W, 18).fill(C.LIGHT_GRAY);
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(C.MID_GRAY)
      .text('Subtotal:', RIGHT_X + 6, ry + 5,
        { width: RIGHT_W / 2 - 6, lineBreak: false });
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(C.DARK_GRAY)
      .text(fmtPrice(computedTotal, quotation.moneda),
        RIGHT_X + RIGHT_W / 2, ry + 5,
        { width: RIGHT_W / 2 - 4, align: 'right', lineBreak: false });
    ry += 18;
  }

  // Manual discount row (only when a positive descuento_manual is set). Shown
  // as a negative amount in orange so it reads clearly as a deduction that
  // subtracts from the subtotal to yield the TOTAL below.
  if (hasDiscount) {
    doc.rect(RIGHT_X, ry, RIGHT_W, 18).fill(C.WHITE);
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(C.MID_GRAY)
      .text('Descuento:', RIGHT_X + 6, ry + 5,
        { width: RIGHT_W / 2 - 6, lineBreak: false });
    doc
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .fillColor(C.ORANGE)
      .text(`- ${fmtPrice(discount, quotation.moneda)}`,
        RIGHT_X + RIGHT_W / 2, ry + 5,
        { width: RIGHT_W / 2 - 4, align: 'right', lineBreak: false });
    ry += 18;
  }

  // Grand total — navy box with orange value text
  const TBOX_H = 28;
  doc.rect(RIGHT_X, ry, RIGHT_W, TBOX_H).fill(C.NAVY);
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(C.WHITE)
    .text('TOTAL:', RIGHT_X + 8, ry + (TBOX_H - 9) / 2, { lineBreak: false });
  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(C.ORANGE)
    .text(fmtPrice(displayTotal, quotation.moneda),
      RIGHT_X + 8, ry + (TBOX_H - 12) / 2,
      { width: RIGHT_W - 16, align: 'right', lineBreak: false });
  ry += TBOX_H + 4;

  // Currency denomination note
  doc
    .font('Helvetica')
    .fontSize(6.5)
    .fillColor(C.MID_GRAY)
    .text(
      quotation.moneda === 'BOB'
        ? 'Valores en Bolivianos (BOB).'
        : 'Valores en Dólares Americanos (USD).',
      RIGHT_X, ry,
      { width: RIGHT_W, align: 'right', lineBreak: false });

  return ry;
}

// ---------------------------------------------------------------------------
// drawTotalsAndConditions
// Linea SON a todo el ancho, y debajo un bloque de dos columnas:
//   Izquierda (~55 % de CW): CONDICIONES DE LA OFERTA + DATOS BANCARIOS
//   Derecha   (~45 % de CW): subtotal, descuento y la caja del TOTAL
// ---------------------------------------------------------------------------
function drawTotalsAndConditions(doc, quotation, startY) {
  // Page-break guard: the SON line + conditions/bank/total block needs
  // ~150 pt. If the items table ended too low, PDFKit's auto page-break
  // would fire mid-block on a doc.text() call — scattering labels onto a
  // phantom page while the rects/lines stay behind. Start the whole block
  // on a fresh page instead.
  if (startY > PH - 240) {
    doc.addPage();
    drawLogoWatermark(doc);
    drawFooter(doc, quotation);
    startY = MARGIN;
  }

  const detalles = Array.isArray(quotation.detalles) ? quotation.detalles : [];
  const importes = calcularImportes(quotation, detalles);

  let y = startY + 6;
  y = dibujarLineaSon(doc, quotation, y, importes.displayTotal);

  // La geometria de las dos columnas. Se calcula aca y no adentro de cada una
  // porque las dos tienen que coincidir: el ancho de la izquierda define donde
  // empieza la derecha.
  const LEFT_W  = CW * 0.55;       // ~ 287.8 pt
  const RIGHT_W = CW - LEFT_W - 6; // ~ 229.5 pt
  const RIGHT_X = MARGIN + LEFT_W + 6;

  const ly = dibujarCondicionesYBanco(doc, quotation, y, LEFT_W);
  const ry = dibujarCajaDeTotales(doc, quotation, y, { RIGHT_X, RIGHT_W }, importes, detalles);

  // El bloque termina donde termina la columna mas larga.
  return Math.max(ly, ry + 12) + 8;
}

// Las tres piezas internas se exportan ADEMAS de la principal para poder medir
// la geometria por separado: que cada bloque devuelva una posicion mas abajo de
// la que recibio es justo lo que fallo cuando esta funcion se partio, y desde
// afuera solo se ve el PDF terminado.
module.exports = {
  drawTotalsAndConditions,
  calcularImportes,
  dibujarLineaSon,
  dibujarCondicionesYBanco,
  dibujarCajaDeTotales,
};
