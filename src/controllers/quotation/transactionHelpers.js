// =============================================================================
// src/controllers/quotation/transactionHelpers.js
// Transacción atómica con reintento ante deadlocks de InnoDB.
//
// Bajo carga concurrente real, muchos INSERT simultáneos que referencian las
// mismas filas padre (mismo id_cliente, misma fila del contador de correlativo)
// disparan un "Deadlock found when trying to get lock" (ER_LOCK_DEADLOCK)
// legítimo — es comportamiento normal de InnoDB bajo contención, no un bug de
// ordenamiento de locks. La propia guía de MySQL dice que el cliente debe
// reintentar la transacción entera. Sin este reintento, un usuario concurrente
// legítimo recibe un 500 opaco (reproducido con 20 creaciones simultáneas
// contra el mismo cliente).
//
// Extraído de QuotationController.createQuotation sin cambios de comportamiento.
// Cubierto por tests/unit/transactionHelpers.test.js.
// =============================================================================

'use strict';

const { pool } = require('../../config/db');

const MAX_DEADLOCK_RETRIES = 3;

/**
 * Corre `work` dentro de una transacción, reintentándola ante deadlocks.
 *
 * La conexión se libera SIEMPRE antes de devolver — incluido el camino feliz.
 * Eso es deliberado: lo que venga después (generar el PDF, auditar) usa el pool
 * compartido, y sostener la conexión de la transacción durante esos segundos
 * ocupaba un slot del pool por toda la duración del request. Al llegar a
 * DB_CONNECTION_LIMIT, cada conexión retenida terminaba esperando una conexión
 * que sólo podía salir de una de esas mismas conexiones retenidas: un
 * auto-bloqueo del pool que no se resuelve nunca.
 *
 * @param   {Function} work — (connection) => Promise<any>, ya dentro de la tx
 * @param   {Object}   opts
 *   maxRetries {number} — intentos totales ante deadlock (default 3)
 *   label      {string} — nombre para los logs
 * @returns {Promise<any>} lo que devuelva `work`
 */
async function withDeadlockRetry(work, { maxRetries = MAX_DEADLOCK_RETRIES, label = 'transaction' } = {}) {
  let connection;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();

      const result = await work(connection);

      await connection.commit();
      connection.release();
      connection = null;
      return result;
    } catch (txErr) {
      if (connection) {
        try { await connection.rollback(); } catch (rbErr) {
          console.error(`[${label}] Rollback error:`, rbErr.message);
        }
        connection.release();
        connection = null;
      }

      const isDeadlock = txErr.code === 'ER_LOCK_DEADLOCK';
      if (isDeadlock && attempt < maxRetries) {
        console.warn(
          `[${label}] Deadlock detected, retrying transaction ` +
          `(attempt ${attempt + 1}/${maxRetries})...`
        );
        continue;
      }
      throw txErr; // Reintentos agotados, o error que no es deadlock
    }
  }
}

module.exports = { withDeadlockRetry, MAX_DEADLOCK_RETRIES };
