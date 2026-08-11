// =============================================================================
// src/controllers/quotation/quotationQueryController.js
// Operaciones de LECTURA de cotizaciones.
//
//   getQuotations      — GET /api/cotizaciones                  (todos los roles)
//   getPendingApproval — GET /api/cotizaciones/pendientes-aprobacion (Jefe)
//   getStateSummary    — GET /api/cotizaciones/resumen          (todos los roles)
//
// El parseo/validación de los query params vive en quotationFilters.js
// (función pura, cubierta por tests/unit/quotationFilters.test.js).
//
// Extraído de quotationController.js sin cambios de comportamiento.
// =============================================================================

'use strict';

const QuotationModel = require('../../models/QuotationModel');
const { parseQuotationFilters } = require('./quotationFilters');
// El bloque `pagination`, compartido: cuatro controladores lo armaban a mano
// y los cuatro habian quedado distintos.
const { construirPaginacion } = require('../../utils/paginacion');

const QuotationQueryController = {

  // ---------------------------------------------------------------------------
  // getQuotations — GET /api/cotizaciones  (All roles)
  // Full filter set + pagination + sort. See buildWhereClause in
  // src/models/quotation/whereBuilder.js for the complete list of accepted
  // query parameters.
  // ---------------------------------------------------------------------------
  async getQuotations(req, res) {
    try {
      const parsed = parseQuotationFilters(req.query);
      if (parsed.error) {
        return res.status(parsed.error.status).json({
          success: false,
          message: parsed.error.message,
        });
      }

      const { filters, pagination, sort } = parsed;
      const { page, limit } = pagination;

      // Fire data query and count query in parallel to halve round-trip latency
      const [rows, totalRecords] = await Promise.all([
        QuotationModel.findAll(filters, pagination, sort),
        QuotationModel.countAll(filters),
      ]);

      return res.status(200).json({
        success: true,
        data:    rows,
        pagination: construirPaginacion({ page, limit, totalRecords }),
      });
    } catch (error) {
      console.error('[QuotationController.getQuotations] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to retrieve quotations.' });
    }
  },

  // ---------------------------------------------------------------------------
  // getPendingApproval — GET /api/cotizaciones/pendientes-aprobacion  (Jefe)
  // The Jefe's approval queue: all quotations in 'Pendiente', 'En revision',
  // or 'En espera' states, ordered oldest-first (HU08 — all active states).
  // ---------------------------------------------------------------------------
  async getPendingApproval(req, res) {
    try {
      const rows = await QuotationModel.findPendingApproval();
      return res.status(200).json({ success: true, total: rows.length, data: rows });
    } catch (error) {
      console.error('[QuotationController.getPendingApproval] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to retrieve approval queue.' });
    }
  },

  // ---------------------------------------------------------------------------
  // getStateSummary — GET /api/cotizaciones/resumen  (All roles)
  // Ejecutivos see only their own counts; Jefe/Admin see all (or scoped by param).
  // ---------------------------------------------------------------------------
  async getStateSummary(req, res) {
    try {
      let id_ejecutivo = null;

      if (req.user.rol === 'Ejecutivo') {
        id_ejecutivo = req.user.id;  // Always scoped to self for Ejecutivo
      } else if (req.query.id_ejecutivo) {
        const parsed = parseInt(req.query.id_ejecutivo, 10);
        if (!isNaN(parsed) && parsed > 0) id_ejecutivo = parsed;
      }

      const summary = await QuotationModel.findSummaryByState(id_ejecutivo);

      // Always return all 8 states so the frontend never has to handle missing keys
      const totals = Object.fromEntries(
        QuotationModel.VALID_STATES.map((s) => [s, 0])
      );

      summary.forEach((row) => { totals[row.estado] = row.total; });

      const grandTotal = Object.values(totals).reduce((a, b) => a + b, 0);

      return res.status(200).json({ success: true, data: totals, grandTotal });
    } catch (error) {
      console.error('[QuotationController.getStateSummary] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to retrieve state summary.' });
    }
  },
};

module.exports = QuotationQueryController;
