// =============================================================================
// scripts/migrate-excel-ruta.js
// One-shot migration: adds the optional excel_ruta column to cotizaciones.
//
// Run once:
//   node scripts/migrate-excel-ruta.js
//
// Idempotent — safe to re-run; the script checks whether the column already
// exists before issuing the ALTER and exits cleanly either way.
// =============================================================================

'use strict';

require('dotenv').config();
const { pool } = require('../src/config/db');

async function migrate() {
  const connection = await pool.getConnection();
  try {
    // ------------------------------------------------------------------
    // 1. Check if the column already exists (information_schema query).
    // ------------------------------------------------------------------
    const [rows] = await connection.execute(
      `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME   = 'cotizaciones'
         AND COLUMN_NAME  = 'excel_ruta'
       LIMIT 1`
    );

    if (rows.length > 0) {
      console.log('[migrate-excel-ruta] Column excel_ruta already exists — nothing to do.');
      return;
    }

    // ------------------------------------------------------------------
    // 2. Add the column right after pdf_ruta.
    // ------------------------------------------------------------------
    await connection.execute(
      `ALTER TABLE cotizaciones
       ADD COLUMN excel_ruta VARCHAR(255) NULL DEFAULT NULL
       AFTER pdf_ruta`
    );

    console.log('[migrate-excel-ruta] ✓ Column excel_ruta (VARCHAR 255, NULL) added to cotizaciones after pdf_ruta.');
  } finally {
    connection.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('[migrate-excel-ruta] Migration failed:', err.message);
  process.exit(1);
});
