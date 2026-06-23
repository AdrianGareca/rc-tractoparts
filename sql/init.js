// =============================================================================
// sql/init.js
// Database bootstrap helper — executes the raw sql/init.sql master script.
//
// Why this file exists:
//   `npm run db:init` previously did `require('./sql/init').run()`, which tried
//   to `require()` a raw .sql file — Node cannot parse SQL as a module, so the
//   script always crashed. This helper runs the SQL cleanly using the project's
//   existing MySQL driver (mysql2/promise).
//
// Notes on the connection:
//   sql/init.sql is self-contained: it issues DROP DATABASE / CREATE DATABASE /
//   USE on its own. Therefore the bootstrap connection must NOT pre-select a
//   database, and it MUST enable `multipleStatements` so the whole script runs
//   in a single round-trip. This is a one-shot admin connection, opened and
//   closed here — it deliberately does not reuse the shared application pool
//   (src/config/db.js), which is locked to a single database with
//   multipleStatements disabled for safety.
//
// Usage:
//   npm run db:init           # via package.json
//   node sql/init.js          # directly
// =============================================================================

'use strict';

require('dotenv').config(); // Load .env variables before reading process.env

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise'); // Same driver the rest of the app uses

const SQL_FILE = path.join(__dirname, 'init.sql');

// ---------------------------------------------------------------------------
// run
// Reads sql/init.sql and executes it against the configured MySQL server.
// Returns nothing; throws on any failure so callers can handle the exit code.
// ---------------------------------------------------------------------------
async function run() {
  const sql = fs.readFileSync(SQL_FILE, 'utf8');

  // Admin connection: no database selected (the script creates it), with
  // multipleStatements enabled so the full master script runs at once.
  const connection = await mysql.createConnection({
    host:               process.env.DB_HOST            || 'localhost',
    port:               parseInt(process.env.DB_PORT, 10) || 3306,
    user:               process.env.DB_USER,
    password:           process.env.DB_PASSWORD,
    multipleStatements: true,
    charset:            'utf8mb4',
  });

  try {
    console.log(`[db:init] Executing ${path.basename(SQL_FILE)} ...`);
    await connection.query(sql);
    console.log('[db:init] Database initialized successfully.');
  } finally {
    await connection.end(); // Always close the one-shot connection
  }
}

// Run immediately when invoked directly (node sql/init.js); export for reuse.
if (require.main === module) {
  run().catch((err) => {
    console.error('[db:init] Initialization failed:', err.message);
    process.exit(1);
  });
}

module.exports = { run };
