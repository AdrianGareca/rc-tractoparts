// =============================================================================
// src/models/QuotationLockModel.js
// Data Access Layer — cotizacion_borrador_lock
//
// Implements the GLOBAL "draft in progress" soft reservation described in the
// realtime concurrency feature: when an Ejecutivo opens the "Nueva Cotización"
// form, the next correlativo number is reserved and tagged with their identity
// so any other Ejecutivo who opens the form at the same time sees a live
// warning instead of silently drafting a colliding number.
//
// The lock is GLOBAL (keyed by calendar year, not by client/session) — exactly
// one row can exist per `anio`, so two executives can never both "own" the
// next number for the same year at the same time.
//
// This table is a UX safety net, not the source of truth for uniqueness: the
// actual correlativo allocation remains protected by the SELECT...FOR UPDATE
// lock in QuotationModel.generateCorrelativo, which runs regardless of whether
// the caller ever went through this soft-lock flow.
// =============================================================================

'use strict';

const { pool }        = require('../config/db');
const QuotationModel  = require('./QuotationModel');

const QuotationLockModel = {

  // ---------------------------------------------------------------------------
  // acquireOrGet
  // Atomically reserves the next correlativo for the current year on behalf of
  // `socketId`, UNLESS another socket already holds it — in which case the
  // existing reservation is returned untouched (mine: false).
  //
  // @param {Object} params
  //   idEjecutivo     {number} - req.user.id equivalent for the socket owner
  //   nombreEjecutivo {string} - display name (nombre_completo) for the banner
  //   socketId        {string} - Socket.IO socket.id; the release key
  // @returns {{ mine: boolean, numero_correlativo: string, ejecutivo: { id, nombre } }}
  // ---------------------------------------------------------------------------
  async acquireOrGet({ idEjecutivo, nombreEjecutivo, socketId }) {
    const anio = new Date().getFullYear();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [lockRows] = await connection.execute(
        `SELECT numero_correlativo, id_ejecutivo, nombre_ejecutivo, socket_id
           FROM cotizacion_borrador_lock
          WHERE anio = ?
            FOR UPDATE`,
        [anio]
      );

      if (lockRows.length > 0) {
        await connection.commit();
        const existing = lockRows[0];

        // A duplicate 'join' from the SAME socket that already owns this
        // reservation (e.g. a fast double-mount) must be idempotent — it is
        // NOT "someone else" drafting, it is this caller re-confirming its
        // own lock. Reporting mine:false here would show a user their own
        // name in the "someone else is drafting" warning.
        const isSelf = existing.socket_id === socketId;

        return {
          mine:               isSelf,
          numero_correlativo: existing.numero_correlativo,
          ejecutivo:          { id: existing.id_ejecutivo, nombre: existing.nombre_ejecutivo },
        };
      }

      const [counterRows] = await connection.execute(
        'SELECT ultimo_nro FROM cotizaciones_correlativo WHERE anio = ?',
        [anio]
      );
      const nextNumber        = counterRows.length === 0 ? 1 : counterRows[0].ultimo_nro + 1;
      const numeroCorrelativo = QuotationModel.formatCorrelativo(anio, nextNumber);

      await connection.execute(
        `INSERT INTO cotizacion_borrador_lock
           (anio, numero_correlativo, id_ejecutivo, nombre_ejecutivo, socket_id)
         VALUES (?, ?, ?, ?, ?)`,
        [anio, numeroCorrelativo, idEjecutivo, nombreEjecutivo, socketId]
      );

      await connection.commit();

      return {
        mine:               true,
        numero_correlativo: numeroCorrelativo,
        ejecutivo:          { id: idEjecutivo, nombre: nombreEjecutivo },
      };
    } catch (err) {
      try { await connection.rollback(); } catch (_) { /* connection already dead */ }
      throw err;
    } finally {
      connection.release();
    }
  },

  // ---------------------------------------------------------------------------
  // releaseBySocketId
  // Releases whichever lock row (any year) is owned by this exact socket.
  // Used both on explicit "leave" (submit/cancel/close) and on Socket.IO
  // 'disconnect' (tab closed, crash, network drop) — ownership is enforced by
  // matching socket_id, so a socket can never release someone else's lock.
  // ---------------------------------------------------------------------------
  async releaseBySocketId(socketId) {
    const [result] = await pool.execute(
      'DELETE FROM cotizacion_borrador_lock WHERE socket_id = ?',
      [socketId]
    );
    return result.affectedRows > 0;
  },

  // ---------------------------------------------------------------------------
  // releaseByNumeroCorrelativo
  // Safety net called after a quotation is actually committed: clears the
  // reservation for that exact serial (if still present) so a dropped/late
  // "leave" event from the client can never leave a phantom lock behind.
  // Matching by serial (not just "current year") avoids clobbering a
  // different reservation that may have been created for the same year in
  // the meantime (e.g. a caller that bypassed the socket flow entirely).
  // ---------------------------------------------------------------------------
  async releaseByNumeroCorrelativo(numeroCorrelativo) {
    const [result] = await pool.execute(
      'DELETE FROM cotizacion_borrador_lock WHERE numero_correlativo = ?',
      [numeroCorrelativo]
    );
    return result.affectedRows > 0;
  },

  // ---------------------------------------------------------------------------
  // releaseAll
  // Clears every reservation. Called once at server startup: no Socket.IO
  // connection can survive a process restart, so any row still present at
  // boot is necessarily orphaned (self-healing after a crash/deploy).
  // ---------------------------------------------------------------------------
  async releaseAll() {
    await pool.execute('DELETE FROM cotizacion_borrador_lock');
  },
};

module.exports = QuotationLockModel;
