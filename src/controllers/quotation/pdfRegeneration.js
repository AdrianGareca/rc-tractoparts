// =============================================================================
// src/controllers/quotation/pdfRegeneration.js
// Regeneración del PDF de una cotización (invariante de UN solo archivo).
//
// El mismo bloque estaba repetido en CUATRO lugares: createQuotation,
// updateQuotation, updateStatus y approveQuotation. Cada copia purgaba el PDF
// anterior, generaba el nuevo, guardaba la ruta y envolvía todo en un try/catch
// "no fatal" — con mensajes de log distintos y una de ellas sin purgar.
//
// INVARIANTE DE UN SOLO PDF: una cotización nunca debe poseer más de un archivo
// físico. Por eso se borra el anterior ANTES de generar el reemplazo.
//
// NO FATAL a propósito: un fallo al regenerar el PDF jamás debe deshacer un
// cambio de estado ya confirmado en la base.
//
// Cubierto por tests/unit/pdfRegeneration.test.js.
// =============================================================================

'use strict';

const QuotationModel = require('../../models/QuotationModel');
const pdfService     = require('../../services/pdfService');

/**
 * Purga el PDF anterior, genera el nuevo y guarda la ruta.
 *
 * @param   {Object} quotation — registro completo (findById), con .id, .pdf_ruta y .pdf_origen
 * @param   {Object} opts
 *   purge          {boolean} — borrar el archivo anterior primero (default true).
 *                              En una creación no hay nada que purgar.
 *   label          {string}  — contexto para el log si falla
 *   preserveManual {boolean} — si true y el PDF actual es de origen 'manual'
 *                              (subido a mano vía /:id/upload o /:id/pdf), NO
 *                              lo toca: ni lo purga ni genera un reemplazo.
 *                              Sólo lo pasa updateQuotation — ver el comentario
 *                              largo más abajo sobre por qué create/updateStatus/
 *                              approve NO lo pasan.
 * @returns {Promise<string|null>} la ruta nueva (o la manual sin tocar), o
 *                                 null si falló la regeneración (no fatal)
 */
async function regenerateQuotationPdf(quotation, { purge = true, label = 'PDF regeneration', preserveManual = false } = {}) {
  if (!quotation?.id) return null;

  // ── Invariante nuevo: un PDF MANUAL nunca se toca automáticamente ─────────
  // Antes de esta distinción, editar una cotización (PUT /:id) purgaba
  // SIEMPRE el pdf_ruta existente y lo reemplazaba por uno generado con
  // PDFKit — sin avisar, y sin importar si ese archivo lo había subido a
  // mano el ejecutivo. El Excel, en cambio, ya sobrevivía intacto a una
  // edición (updateQuotation nunca toca excel_ruta). Encontrado en la ronda
  // de estrés del 2026-08-26.
  //
  // SÓLO updateQuotation pasa preserveManual: true. createQuotation nunca
  // tiene un PDF previo que preservar (purge:false, recién creada).
  // updateStatus/approveQuotation SÍ deben seguir regenerando siempre,
  // incluso sobre un PDF manual: la tarjeta de ESTADO / el sello APROBADO
  // tienen que reflejar la transición de estado sin importar cómo se
  // originó el archivo anterior — ese comportamiento es intencional (ver los
  // comentarios en quotationStateController.js) y no es el bug que esto
  // arregla.
  if (preserveManual && quotation.pdf_ruta && quotation.pdf_origen === 'manual') {
    return quotation.pdf_ruta;
  }

  try {
    if (purge && quotation.pdf_ruta) {
      await pdfService.purgeQuotationPdf(quotation.pdf_ruta);
    }

    const nuevaRuta = await pdfService.generateQuotationPdf(quotation);
    await QuotationModel.updatePdfPath(quotation.id, nuevaRuta);

    // Se refleja en el objeto en memoria para que quien respondió con él ya
    // devuelva la ruta correcta sin volver a consultar la base.
    quotation.pdf_ruta = nuevaRuta;
    return nuevaRuta;
  } catch (pdfErr) {
    console.warn(`[${label}] PDF regeneration failed (non-fatal):`, pdfErr.message);
    return null;
  }
}

module.exports = { regenerateQuotationPdf };
