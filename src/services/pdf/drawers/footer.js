// =============================================================================
// src/services/pdf/drawers/footer.js
// Pie de pagina con los datos de contacto corporativos.
//
// Extraido de pdfService.js sin cambios de comportamiento.
// =============================================================================

'use strict';

const { C, PW, PH, MARGIN, CW } = require('../constants');

// ---------------------------------------------------------------------------
// drawFooter
// Fixed to the absolute bottom of each page.
// Corporate contact info block strictly right-aligned, as per verified specs.
//
// IMPORTANT: text is drawn below the normal content area (footerY ≈ 804 pt on
// A4).  PDFKit triggers an auto-page-break when doc.text() is called at a Y
// position past (page height − bottom margin).  We zero the bottom margin
// before drawing and restore it afterward so no phantom extra pages appear.
// ---------------------------------------------------------------------------
function drawFooter(doc, quotation) {
  const FOOTER_H = 38;
  const footerY  = PH - FOOTER_H;

  // Save and zero the bottom margin so text at absolute footer coordinates
  // (804–832 pt) cannot trigger PDFKit's auto-page-break logic.
  const savedBottomMargin = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;

  // Orange top accent stripe (3 pt)
  doc.rect(0, footerY - 3, PW, 3).fill(C.ORANGE);

  // Navy footer background
  doc.rect(0, footerY, PW, FOOTER_H).fill(C.NAVY);

  // Left: generation timestamp
  const generatedAt = new Date().toLocaleString('es-BO', {
    timeZone:  'America/La_Paz',
    dateStyle: 'long',
    timeStyle: 'short',
  });
  doc
    .font('Helvetica')
    .fontSize(6.5)
    .fillColor('#A0AEC0')
    .text(`Generado: ${generatedAt}`, MARGIN, footerY + 8, { lineBreak: false });

  // Centre: correlativo reference
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(C.WHITE)
    .text(quotation.numero_correlativo || '',
      0, footerY + 8, { width: PW, align: 'center', lineBreak: false });

  // Right: corporate contact block (verified specs)
  doc
    .font('Helvetica')
    .fontSize(6.5)
    .fillColor('#CBD5E0')
    .text('79855624 - 72182960  |  rctractoparts@gmail.com',
      MARGIN, footerY + 8,
      { width: CW, align: 'right', lineBreak: false });

  doc
    .font('Helvetica')
    .fontSize(5.5)
    .fillColor('#718096')
    .text(
      'Av. El Trompillo 2do Anillo, Edif. Torre Empresarial Los Laureles, Piso 9. Santa Cruz - Bolivia.',
      MARGIN, footerY + 19,
      { width: CW, align: 'right', lineBreak: false });

  doc
    .font('Helvetica')
    .fontSize(6)
    .fillColor('#718096')
    .text('Documento confidencial — RC Tractoparts',
      MARGIN, footerY + 28,
      { width: CW, align: 'right', lineBreak: false });

  // Restore the bottom margin so subsequent content flow is unaffected.
  doc.page.margins.bottom = savedBottomMargin;
}

// ---------------------------------------------------------------------------
// numerarPaginas
// Escribe «Página X de Y» en el pie de TODAS las páginas.
//
// POR QUÉ EN UNA PASADA APARTE
// El total no se sabe hasta que el documento está armado: cuando se dibuja la
// página 1 todavía no existe la 4. Por eso el documento se crea con
// `bufferPages: true` (ver pdfService.js), que le pide a PDFKit que retenga las
// páginas en memoria en vez de escribirlas al vuelo — y así se puede volver
// sobre cada una al final, ya con el total conocido.
//
// Sirve para notar que falta una hoja. La proforma se imprime, se escanea y se
// reenvía por WhatsApp, y en ese camino una página se queda atrás sin que nadie
// lo note: la hoja de condiciones, que va al final, es la primera candidata.
//
// Se llama DESPUÉS de todos los drawers y ANTES de doc.end().
// ---------------------------------------------------------------------------
function numerarPaginas(doc) {
  const rango = doc.bufferedPageRange();
  if (!rango || !rango.count) return;

  const footerY = PH - 38;

  for (let i = 0; i < rango.count; i++) {
    doc.switchToPage(rango.start + i);

    // Misma precaución que drawFooter: el texto va por debajo del área de
    // contenido y sin esto PDFKit abriría una página nueva para acomodarlo —
    // que a su vez necesitaría numeración, y así sin fin.
    const savedBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    doc
      .font('Helvetica')
      .fontSize(6)
      .fillColor('#A0AEC0')
      .text(`Página ${i + 1} de ${rango.count}`, MARGIN, footerY + 19,
        { lineBreak: false });

    doc.page.margins.bottom = savedBottomMargin;
  }

  doc.flushPages();
}

module.exports = { drawFooter, numerarPaginas };

