// =============================================================================
// src/config/db.js
// MySQL connection pool — Singleton pattern
// Uses mysql2/promise for async/await support throughout the application.
// All queries must be executed through this pool; no direct connections allowed.
// =============================================================================

'use strict';

require('dotenv').config(); // Load .env variables before reading process.env

const mysql = require('mysql2/promise'); // Promise-based MySQL driver

// ---------------------------------------------------------------------------
// Build pool configuration from environment variables
// ---------------------------------------------------------------------------
const poolConfig = {
  host:            process.env.DB_HOST            || 'localhost',
  port:            parseInt(process.env.DB_PORT, 10) || 3306,
  user:            process.env.DB_USER,
  password:        process.env.DB_PASSWORD,
  database:        process.env.NODE_ENV === 'test'
    ? process.env.DB_NAME_TEST  // Use the dedicated test database during automated tests
    : process.env.DB_NAME,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT, 10) || 10,
  queueLimit:      parseInt(process.env.DB_QUEUE_LIMIT, 10)      || 0,
  waitForConnections: true,  // Queue new requests when all connections are busy
  charset:         'utf8mb4', // Full Unicode support including emoji and special chars
  timezone:        '+00:00',  // Store and retrieve dates in UTC; the app layer handles local TZ
  decimalNumbers:  true,      // Return DECIMAL columns as JS numbers, not strings
  multipleStatements: false,  // Disable multiple statements per query to prevent SQL injection
  // Keep-alive prevents idle pooled sockets from being silently dropped by the
  // OS/MySQL wait_timeout during the low-traffic gaps of a ~10-user daily load,
  // which would otherwise surface as intermittent ECONNRESET/PROTOCOL errors.
  enableKeepAlive:       true,
  keepAliveInitialDelay: 10_000, // Start keep-alive probes after 10s idle
};

// ---------------------------------------------------------------------------
// Create the pool once (Singleton); it is shared across all modules via require()
// ---------------------------------------------------------------------------
const pool = mysql.createPool(poolConfig);

// ---------------------------------------------------------------------------
// testConnection
// Acquires one connection from the pool, runs a lightweight ping, then releases it.
// Called once at server startup to verify database reachability before accepting requests.
// ---------------------------------------------------------------------------
async function testConnection() {
  let connection; // Declared outside try so it can be released in finally

  try {
    connection = await pool.getConnection(); // Acquire a connection from the pool
    await connection.ping();                 // Lightweight round-trip to MySQL (no data returned)

    console.log(
      `[DB] Connected to MySQL — host: ${poolConfig.host}:${poolConfig.port}` +
      ` | database: ${poolConfig.database}`
    );
  } catch (error) {
    // Log a descriptive error and propagate; the server entry point will exit on failure
    console.error('[DB] Connection test failed:', error.message);
    throw error; // Let server.js handle the process exit
  } finally {
    if (connection) {
      connection.release(); // Always release back to the pool, even on error
    }
  }
}

// Export the pool (for queries) and testConnection (for startup validation)
module.exports = { pool, testConnection };
