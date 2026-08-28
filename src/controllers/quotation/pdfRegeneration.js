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
 * @param   {Object} quotation — registro completo (findById), con .id y .pdf_ruta
 * @param   {Object} opts
 *   purge {boolean} — borrar el archivo anterior primero (default true).
 *                     En una creación no hay nada que purgar.
 *   label {string}  — contexto para el log si falla
 * @returns {Promise<string|null>} la ruta nueva, o null si falló (no fatal)
 */
async function regenerateQuotationPdf(quotation, { purge = true, label = 'PDF regeneration' } = {}) {
  if (!quotation?.id) return null;

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
