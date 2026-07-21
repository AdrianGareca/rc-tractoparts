// =============================================================================
// src/models/quotation/correlativoRepository.js
// Serial-number (correlativo) generation for cotizaciones_correlativo.
//
// Three entry points sharing one formatter so the preview, the atomic
// generator, and the draft-lock reservation can never drift into inconsistent
// serial formats.
// =============================================================================

'use strict';

const { pool } = require('../../config/db');

// ---------------------------------------------------------------------------
// formatCorrelativo
// Format: "SC-YYYY/NNNNNN" (6-digit zero-padded), matching the historical
// Excel numbering series the company used before this system existed.
// ---------------------------------------------------------------------------
function formatCorrelativo(anio, nextNumber) {
  return `SC-${anio}/${String(nextNumber).padStart(6, '0')}`;
}

// ---------------------------------------------------------------------------
// peekNextCorrelativo
// READ-ONLY preview of what the next serial number will look like.
// NOT guaranteed to be the actual next value under concurrency — it is
// purely informational, displayed to the user before they submit the form.
// No lock is acquired; no row is modified.
// ---------------------------------------------------------------------------
async function peekNextCorrelativo() {
  const currentYear = new Date().getFullYear();
  const [rows] = await pool.execute(
    'SELECT ultimo_nro FROM cotizaciones_correlativo WHERE anio = ?',
    [currentYear]
  );
  const nextNumber = rows.length === 0 ? 1 : rows[0].ultimo_nro + 1;
  return formatCorrelativo(currentYear, nextNumber);
}

// ---------------------------------------------------------------------------
// generateCorrelativo
// ATOMIC: must be called inside a caller-managed transaction.
// Acquires a row-level exclusive lock (SELECT … FOR UPDATE) on the
// cotizaciones_correlativo row for the current year, increments the counter,
// and returns the formatted serial "SC-YYYY/NNNNNN".
// ---------------------------------------------------------------------------
async function generateCorrelativo(connection) {
  const currentYear = new Date().getFullYear();

  const [rows] = await connection.execute(
    'SELECT ultimo_nro FROM cotizaciones_correlativo WHERE anio = ? FOR UPDATE',
    [currentYear]
  );

  let nextNumber;

  if (rows.length === 0) {
    await connection.execute(
      'INSERT INTO cotizaciones_correlativo (anio, ultimo_nro) VALUES (?, 1)',
      [currentYear]
    );
    nextNumber = 1;
  } else {
    nextNumber = rows[0].ultimo_nro + 1;
    await connection.execute(
      'UPDATE cotizaciones_correlativo SET ultimo_nro = ? WHERE anio = ?',
      [nextNumber, currentYear]
    );
  }

  return formatCorrelativo(currentYear, nextNumber);
}

module.exports = {
  formatCorrelativo,
  peekNextCorrelativo,
  generateCorrelativo,
};
