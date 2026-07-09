// =============================================================================
// src/server.js
// Application Entry Point
//
// Responsibilities:
//   1. Load environment variables
//   2. Test the database connection before accepting HTTP traffic
//   3. Start the HTTP server on the configured port
//   4. Handle graceful shutdown on SIGTERM / SIGINT (e.g. PM2 restart, Ctrl-C)
//
// This file is intentionally minimal — all Express configuration lives in app.js
// so that test suites can import app.js without triggering a port bind.
// =============================================================================

'use strict';

require('dotenv').config(); // Must be first — loads .env before any module reads process.env

const http                      = require('http');
const app                       = require('./app');              // Configured Express instance
const { pool, testConnection }  = require('./config/db');        // MySQL pool + startup validator
const { initSocket }            = require('./realtime/socketServer'); // Draft-lock realtime layer
const QuotationLockModel        = require('./models/QuotationLockModel');

const PORT = parseInt(process.env.PORT, 10) || 3000;

// ---------------------------------------------------------------------------
// startServer
// Validate DB connectivity, then start the HTTP listener.
// If the DB is unreachable, log the error and exit — there is no point accepting
// requests that will all fail at the data layer.
// ---------------------------------------------------------------------------
async function startServer() {
  try {
    // Verify that MySQL is reachable before opening the HTTP port
    await testConnection();

    // Self-healing: no Socket.IO connection can survive a process restart, so
    // any cotizacion_borrador_lock row still present at boot is necessarily
    // orphaned from a prior crash/deploy. Clear it before accepting traffic.
    try {
      await QuotationLockModel.releaseAll();
    } catch (lockErr) {
      console.warn('[Server] Failed to clear stale draft locks at boot (non-fatal):', lockErr.message);
    }

    // Express alone cannot serve WebSocket upgrades — wrap it in a raw HTTP
    // server so Socket.IO can share the same port for the draft-lock realtime layer.
    const httpServer = http.createServer(app);
    initSocket(httpServer);

    const server = httpServer.listen(PORT, () => {
      console.log('='.repeat(60));
      console.log(`[Server] ${process.env.APP_NAME || 'RC-Tractoparts-API'} running`);
      console.log(`[Server] Environment : ${process.env.NODE_ENV || 'development'}`);
      console.log(`[Server] Listening on: http://localhost:${PORT}`);
      console.log(`[Server] Health check: http://localhost:${PORT}/health`);
      console.log('='.repeat(60));
    });

    // -------------------------------------------------------------------------
    // Graceful shutdown handler
    // On SIGTERM (PM2 / Docker stop) or SIGINT (Ctrl-C), close the HTTP server
    // first (no new connections accepted), then drain the MySQL pool.
    // This ensures in-flight requests complete before the process exits.
    // -------------------------------------------------------------------------
    async function gracefulShutdown(signal) {
      console.log(`\n[Server] Received ${signal} — initiating graceful shutdown...`);

      server.close(async () => {
        console.log('[Server] HTTP server closed — no new connections accepted.');

        try {
          await pool.end(); // Drain all connections from the pool
          console.log('[DB] Connection pool drained and closed.');
        } catch (poolError) {
          console.error('[DB] Error closing pool:', poolError.message);
        }

        console.log('[Server] Shutdown complete. Exiting.');
        process.exit(0);
      });

      // Force exit if the graceful shutdown takes longer than 10 seconds
      setTimeout(() => {
        console.error('[Server] Forced exit after 10 s timeout.');
        process.exit(1);
      }, 10_000);
    }

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM')); // PM2, Docker, systemd
    process.on('SIGINT',  () => gracefulShutdown('SIGINT'));  // Ctrl-C in development

  } catch (error) {
    // Database connection failed — cannot start safely
    console.error('[Server] Startup aborted. Could not connect to database:', error.message);
    process.exit(1); // Non-zero exit code signals failure to process managers
  }
}

// Unhandled promise rejections that escape route handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled Promise Rejection at:', promise, 'Reason:', reason);
  // In production, consider process.exit(1) here to let PM2 restart the process
});

// Synchronous programming errors that escape all try/catch blocks. Logged so a
// process manager (PM2/systemd) can restart a poisoned process rather than
// letting it linger in an undefined state under concurrent load.
process.on('uncaughtException', (error) => {
  console.error('[Server] Uncaught Exception:', error);
  // Leave the process to the manager's restart policy; do not silently continue.
});

startServer();
