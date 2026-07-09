// =============================================================================
// public/js/services/socketClient.js
// Thin Socket.IO connection helper for the realtime draft-lock feature.
//
// The Socket.IO SERVER automatically serves its own browser client at
// /socket.io/socket.io.esm.min.js — no bundler and no separate npm package
// are needed on the frontend, consistent with the rest of this project
// (plain ES modules, no build step).
// =============================================================================

import AuthSession from './authSession.js';

let ioPromise = null;

function loadIo() {
  if (!ioPromise) {
    ioPromise = import('/socket.io/socket.io.esm.min.js').then((mod) => mod.io);
  }
  return ioPromise;
}

/**
 * Opens a new authenticated Socket.IO connection using the current session's
 * JWT. Resolves with the connected socket, or rejects if the handshake fails
 * (expired session, server unreachable, etc). Callers are responsible for
 * calling socket.disconnect() when done — connections are not pooled/shared.
 */
export async function connectSocket() {
  const io    = await loadIo();
  const token = AuthSession.getToken();

  return new Promise((resolve, reject) => {
    // reconnection is intentionally disabled: the draft lock is keyed to this
    // exact socket.id server-side. A silent auto-reconnect would issue a NEW
    // socket.id, leaving the caller's #hasDraftLock flag stale (the server
    // already released the old lock on disconnect, but nothing would re-join
    // under the new id). Degrading to "no live warning" on a dropped
    // connection is safer than presenting state that has quietly gone stale.
    const socket = io({ auth: { token }, reconnection: false });

    const onConnect = () => { cleanup(); resolve(socket); };
    const onError   = (err) => { cleanup(); socket.disconnect(); reject(err); };
    const cleanup   = () => {
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
    };

    socket.on('connect', onConnect);
    socket.on('connect_error', onError);
  });
}
