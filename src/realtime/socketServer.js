// =============================================================================
// src/realtime/socketServer.js
// Socket.IO server — real-time layer for the "Nueva Cotización" draft lock.
//
// This is the ONLY real-time channel in the application. It exists purely to
// broadcast the GLOBAL "someone is drafting the next correlativo number"
// warning to every connected Ejecutivo/Administracion/Jefe/SysAdmin session,
// instantly, without polling.
//
// Lifecycle wired by src/server.js:
//   const server = http.createServer(app);
//   initSocket(server);
//   server.listen(PORT);
//
// Events (client → server):
//   'cotizacion:draft:join'  (ack) — reserve or inspect the current lock for
//                                    the running year. Sent when the "Nueva
//                                    Cotización" form mounts.
//   'cotizacion:draft:leave' (ack) — release this socket's own reservation
//                                    (submit succeeded / user cancelled).
//
// Events (server → client):
//   'cotizacion:draft:update' — broadcast to every OTHER connected client
//                                whenever the lock is acquired or released,
//                                so a form already open updates live.
// =============================================================================

'use strict';

const { Server }         = require('socket.io');
const jwt                = require('jsonwebtoken');
const UserModel          = require('../models/UserModel');
const QuotationLockModel = require('../models/QuotationLockModel');

const DRAFT_ROOM = 'cotizaciones-draft';

let io = null;

// Tracks which currently-connected sockets actually OWN a draft lock, so the
// disconnect/leave handlers can skip the DB round-trip for the common case
// of a socket that never acquired one (e.g. it opened the form while someone
// else already held the reservation).
const socketOwnsLock = new Set();

// ---------------------------------------------------------------------------
// _buildAllowedOrigins — mirrors the CORS allow-list logic in src/app.js so
// the Socket.IO handshake is governed by the exact same policy as the REST API.
// ---------------------------------------------------------------------------
function _buildAllowedOrigins() {
  const allowedOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (process.env.NODE_ENV !== 'production' || allowedOrigins.length === 0) {
    if (!allowedOrigins.includes('http://localhost:3000')) {
      allowedOrigins.push('http://localhost:3000');
    }
  }
  return allowedOrigins;
}

// ---------------------------------------------------------------------------
// _releaseIfOwner — release this socket's lock (if it holds one) and notify
// every other connected client. Shared by the explicit 'leave' event and the
// 'disconnect' event (tab close, refresh, crash, network drop).
// ---------------------------------------------------------------------------
async function _releaseIfOwner(socket) {
  if (!socketOwnsLock.has(socket.id)) return;
  socketOwnsLock.delete(socket.id);

  try {
    const released = await QuotationLockModel.releaseBySocketId(socket.id);
    if (released) {
      io.to(DRAFT_ROOM).emit('cotizacion:draft:update', { locked: false });
    }
  } catch (err) {
    console.error('[socketServer] Failed to release draft lock:', err.message);
  }
}

// ---------------------------------------------------------------------------
// initSocket — attach Socket.IO to the given HTTP server and wire all
// authentication + draft-lock event handling. Idempotent guard: returns the
// existing instance if already initialized (defensive; server.js calls this
// exactly once, but tests or future callers must never double-attach).
// ---------------------------------------------------------------------------
function initSocket(httpServer) {
  if (io) return io;

  const allowedOrigins = _buildAllowedOrigins();

  io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error('CORS: Origin not allowed.'));
      },
      credentials: true,
    },
  });

  // ── Authentication — every connecting socket must present a valid, current JWT ──
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required.'));

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      // Expired/invalid tokens are routine (not exceptional) — same silent
      // treatment as authMiddleware's outer catch.
      return next(new Error('Authentication failed.'));
    }

    try {
      const user = await UserModel.findById(payload.id);

      if (!user || !user.activo) return next(new Error('Session no longer valid.'));

      // Durable revocation parity with authMiddleware: a logged-out token
      // (token_version bumped) must not be able to open a live socket either.
      const currentVersion = await UserModel.getTokenVersion(payload.id);
      const tokenVersion   = payload.token_version ?? 0;
      if (currentVersion === null || tokenVersion !== currentVersion) {
        return next(new Error('Session has been ended.'));
      }

      socket.data.user = {
        id:               user.id,
        nombre_completo:  user.nombre_completo,
        rol:              user.rol,
      };
      next();
    } catch (dbErr) {
      // Unlike an expired token, a DB lookup failure here is unexpected and
      // worth surfacing — mirrors authMiddleware's non-fatal token_version warn.
      console.warn('[socketServer] Auth DB lookup failed, connection rejected (non-fatal):', dbErr.message);
      next(new Error('Authentication failed.'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(DRAFT_ROOM);

    // ── Reserve (or inspect) the current-year draft lock ──────────────────
    socket.on('cotizacion:draft:join', async (_payload, ack) => {
      try {
        const { id, nombre_completo } = socket.data.user;
        const result = await QuotationLockModel.acquireOrGet({
          idEjecutivo:     id,
          nombreEjecutivo: nombre_completo,
          socketId:        socket.id,
        });

        if (result.mine) {
          socketOwnsLock.add(socket.id);
          socket.to(DRAFT_ROOM).emit('cotizacion:draft:update', {
            locked:             true,
            numero_correlativo: result.numero_correlativo,
            ejecutivo:          result.ejecutivo,
          });
        }

        if (typeof ack === 'function') {
          ack({
            success:             true,
            mine:                result.mine,
            numero_correlativo:  result.numero_correlativo,
            ejecutivo:           result.ejecutivo,
          });
        }
      } catch (err) {
        console.error('[socketServer] draft:join failed:', err.message);
        if (typeof ack === 'function') {
          ack({ success: false, message: 'No se pudo reservar el número de cotización.' });
        }
      }
    });

    // ── Explicit release (form submitted successfully or cancelled/closed) ──
    socket.on('cotizacion:draft:leave', async (_payload, ack) => {
      await _releaseIfOwner(socket);
      if (typeof ack === 'function') ack({ success: true });
    });

    // ── Implicit release (tab closed, refresh, crash, connectivity loss) ───
    socket.on('disconnect', () => {
      _releaseIfOwner(socket);
    });
  });

  return io;
}

// ---------------------------------------------------------------------------
// getIO — accessor for other modules (e.g. quotationController) that need to
// broadcast after a REST action, such as clearing a stale lock post-commit.
// ---------------------------------------------------------------------------
function getIO() {
  return io;
}

// ---------------------------------------------------------------------------
// broadcastDraftReleased — notify all connected clients that the draft lock
// was cleared, without requiring the caller to hold a socket reference.
// Used by quotationController.createQuotation as a safety net after commit.
// ---------------------------------------------------------------------------
function broadcastDraftReleased() {
  if (io) io.to(DRAFT_ROOM).emit('cotizacion:draft:update', { locked: false });
}

module.exports = { initSocket, getIO, broadcastDraftReleased, DRAFT_ROOM };
