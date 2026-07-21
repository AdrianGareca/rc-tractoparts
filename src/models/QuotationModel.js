// =============================================================================
// src/models/QuotationModel.js
// Data Access Layer — cotizaciones, cotizacion_detalles, cotizaciones_correlativo,
//                     cotizacion_historial_estados
//
// This file is now a thin FACADE. The implementation lives in src/models/quotation/,
// split by responsibility:
//
//   constants.js                — VALID_STATES, ROLE_TRANSITIONS, STATE_TRANSITIONS,
//                                 APPROVAL_SOURCE_STATES, SORTABLE_COLUMNS, BASE_JOINS
//   whereBuilder.js             — parameterized WHERE construction for findAll/countAll
//   correlativoRepository.js    — formatCorrelativo, peekNextCorrelativo, generateCorrelativo
//   writeRepository.js          — create, createDetalles, updateEditableHeader,
//                                 replaceDetalles, updatePdfPath, updateExcelPath,
//                                 updateComentarioAdmin
//   readRepository.js           — findById, checkDuplicate, findAll, countAll,
//                                 findSummaryByState, findPendingApproval
//   stateMachine.js             — validateTransitionByRole, validateForReview,
//                                 updateStatus, approve, logStateHistory, findStateHistory
//   notificationRepository.js   — findNotificacionesPendientes, insertNotificacion,
//                                 findNotificacionesEjecutivo, markNotificacionesLeidas
//   analyticsRepository.js      — getProgreso, getAdvancedReports
//
// The exported surface (every method name and all five constants) is unchanged,
// so every existing `require('../models/QuotationModel')` call site keeps working.
// =============================================================================

'use strict';

const constants               = require('./quotation/constants');
const correlativoRepository   = require('./quotation/correlativoRepository');
const writeRepository         = require('./quotation/writeRepository');
const readRepository          = require('./quotation/readRepository');
const stateMachine            = require('./quotation/stateMachine');
const notificationRepository  = require('./quotation/notificationRepository');
const analyticsRepository     = require('./quotation/analyticsRepository');

const QuotationModel = {

  // ── Correlativos (serial numbers) ─────────────────────────────────────────
  ...correlativoRepository,

  // ── Writes: header, line items, file paths, admin comment ────────────────
  ...writeRepository,

  // ── Reads: detail, listing, counts, summaries, duplicate check ───────────
  ...readRepository,

  // ── State machine, approval workflow, state history ──────────────────────
  ...stateMachine,

  // ── Notifications ────────────────────────────────────────────────────────
  ...notificationRepository,

  // ── Reporting / business intelligence ────────────────────────────────────
  ...analyticsRepository,

  // ── Exported constants (used by controllers, routes, and tests) ──────────
  VALID_STATES:           constants.VALID_STATES,
  STATE_TRANSITIONS:      constants.STATE_TRANSITIONS,
  ROLE_TRANSITIONS:       constants.ROLE_TRANSITIONS,
  APPROVAL_SOURCE_STATES: constants.APPROVAL_SOURCE_STATES,
  SORTABLE_COLUMNS:       constants.SORTABLE_COLUMNS,
};

module.exports = QuotationModel;
