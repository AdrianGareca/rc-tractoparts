// =============================================================================
// src/models/QuotationModel.js
// Data Access Layer — cotizaciones, cotizacion_detalles, cotizaciones_correlativo
//
// Sprint 1: generateCorrelativo, create, createDetalles, findById,
//           updateStatus, approve, updatePdfPath, checkDuplicate
// Sprint 2: findAll (paginated + sorted), countAll, findSummaryByState
//           All read methods share _buildWhereClause to keep filter logic DRY.
// =============================================================================

'use strict';

const { pool } = require('../config/db');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// All valid quotation states (Section 3.6.2 — state machine)
const VALID_STATES = [
  'Pendiente',
  'En revision',
  'Aprobada internamente',
  'Enviada al cliente',
  'Aceptada',
  'Rechazada',
  'Archivada',
];

// State-transition matrix: maps each state to the states reachable from it
const STATE_TRANSITIONS = {
  'Pendiente':             ['En revision', 'Archivada'],
  'En revision':           ['Aprobada internamente', 'Rechazada', 'Pendiente', 'Archivada'],
  'Aprobada internamente': ['Enviada al cliente', 'Archivada'],
  'Enviada al cliente':    ['Aceptada', 'Rechazada', 'Archivada'],
  'Aceptada':              ['Archivada'],
  'Rechazada':             ['Pendiente', 'Archivada'],
  'Archivada':             [],
};

// Columns that are safe to use in ORDER BY — prevents SQL injection via sort param
const SORTABLE_COLUMNS = {
  numero_correlativo: 'c.numero_correlativo',
  fecha_emision:      'c.fecha_emision',
  monto_total:        'c.monto_total',
  estado:             'c.estado',
  creado_en:          'c.creado_en',
  cliente_nombre:     'cl.razon_social',
  ejecutivo_nombre:   'u.nombre_completo',
};

// ---------------------------------------------------------------------------
// _buildWhereClause (private helper)
// Constructs the WHERE clause string and bound-values array from a filters
// object. Used by both findAll and countAll so the logic never diverges.
//
// Accepted filter keys:
//   q            {string}  - Full-text search: correlativo, razon_social, NIT
//   razon_social {string}  - Partial match on cl.razon_social only
//   nit          {string}  - Partial match on cl.nit only
//   estado       {string}  - Exact match against VALID_STATES
//   id_cliente   {number}  - Exact client ID
//   id_ejecutivo {number}  - Exact executive user ID
//   fecha_desde  {string}  - Lower bound on fecha_emision (YYYY-MM-DD inclusive)
//   fecha_hasta  {string}  - Upper bound on fecha_emision (YYYY-MM-DD inclusive)
//   moneda       {string}  - 'USD' or 'BOB'
//   tiene_pdf    {boolean} - true = only records with pdf_ruta; false = only without
//
// @param   {Object} filters
// @returns {{ clause: string, values: Array }}
// ---------------------------------------------------------------------------
function _buildWhereClause(filters = {}) {
  const conditions = []; // SQL fragment strings, each with "?" placeholders
  const values     = []; // Bound parameters in the same order as placeholders

  // Full-text search across correlativo, client name, and client NIT
  if (filters.q && filters.q.trim()) {
    const like = `%${filters.q.trim()}%`;
    conditions.push('(c.numero_correlativo LIKE ? OR cl.razon_social LIKE ? OR cl.nit LIKE ?)');
    values.push(like, like, like); // Three binds for three columns
  }

  // Partial match on client name only (used by the autocomplete endpoint)
  if (filters.razon_social && filters.razon_social.trim()) {
    conditions.push('cl.razon_social LIKE ?');
    values.push(`%${filters.razon_social.trim()}%`);
  }

  // Partial match on NIT only (useful when the user knows the tax ID)
  if (filters.nit && filters.nit.trim()) {
    conditions.push('cl.nit LIKE ?');
    values.push(`%${filters.nit.trim()}%`);
  }

  // Exact state match (controller validates against VALID_STATES before reaching here)
  if (filters.estado) {
    conditions.push('c.estado = ?');
    values.push(filters.estado);
  }

  // Filter by specific client ID (used from the client detail view)
  if (filters.id_cliente) {
    conditions.push('c.id_cliente = ?');
    values.push(parseInt(filters.id_cliente, 10));
  }

  // Filter by executive (Jefe can see all; Ejecutivo sees own records — enforced in controller)
  if (filters.id_ejecutivo) {
    conditions.push('c.id_ejecutivo = ?');
    values.push(parseInt(filters.id_ejecutivo, 10));
  }

  // Date range — both bounds are inclusive
  if (filters.fecha_desde) {
    conditions.push('c.fecha_emision >= ?');
    values.push(filters.fecha_desde); // YYYY-MM-DD string; MySQL DATE comparison
  }

  if (filters.fecha_hasta) {
    conditions.push('c.fecha_emision <= ?');
    values.push(filters.fecha_hasta);
  }

  // Currency filter
  if (filters.moneda) {
    conditions.push('c.moneda = ?');
    values.push(filters.moneda.toUpperCase());
  }

  // PDF attachment presence filter
  if (filters.tiene_pdf === true) {
    conditions.push('c.pdf_ruta IS NOT NULL'); // Has a linked PDF
  } else if (filters.tiene_pdf === false) {
    conditions.push('c.pdf_ruta IS NULL');    // Missing PDF — useful for admin review
  }

  const clause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  return { clause, values };
}

// ---------------------------------------------------------------------------
// The JOIN fragment reused in both findAll and countAll
// ---------------------------------------------------------------------------
const BASE_JOINS = `
  INNER JOIN clientes cl ON cl.id = c.id_cliente
  INNER JOIN usuarios u  ON u.id  = c.id_ejecutivo
  LEFT  JOIN usuarios ap ON ap.id = c.aprobado_por
`;

// ---------------------------------------------------------------------------
// QuotationModel
// ---------------------------------------------------------------------------
const QuotationModel = {

  // ==========================================================================
  // SPRINT 1 — Write operations (unchanged)
  // ==========================================================================

  // ---------------------------------------------------------------------------
  // generateCorrelativo
  // ATOMIC: SELECT ... FOR UPDATE inside a caller-managed transaction.
  // Returns the next formatted serial, e.g. "COT-2026-0042".
  // ---------------------------------------------------------------------------
  async generateCorrelativo(connection) {
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

    return `COT-${currentYear}-${String(nextNumber).padStart(4, '0')}`;
  },

  // ---------------------------------------------------------------------------
  // create — Insert quotation header inside a transaction
  // ---------------------------------------------------------------------------
  async create(connection, data) {
    const sql = `
      INSERT INTO cotizaciones
        (numero_correlativo, id_cliente, id_ejecutivo, descripcion,
         monto_total, moneda, estado, observaciones, fecha_emision, fecha_validez)
      VALUES
        (?, ?, ?, ?, ?, ?, 'Pendiente', ?, ?, ?)
    `;

    const [result] = await connection.execute(sql, [
      data.numero_correlativo,
      data.id_cliente,
      data.id_ejecutivo,
      data.descripcion,
      data.monto_total   || null,
      data.moneda        || 'USD',
      data.observaciones || null,
      data.fecha_emision,
      data.fecha_validez || null,
    ]);

    return result.insertId;
  },

  // ---------------------------------------------------------------------------
  // createDetalles — Bulk-insert line items inside a transaction
  // ---------------------------------------------------------------------------
  async createDetalles(connection, id_cotizacion, detalles) {
    if (!detalles || detalles.length === 0) return;

    const placeholders = detalles.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');

    const values = detalles.flatMap((item) => {
      const subtotal = parseFloat(
        (parseFloat(item.cantidad) * parseFloat(item.precio_unitario)).toFixed(2)
      );
      return [
        id_cotizacion,
        item.id_producto    || null,
        item.descripcion_item,
        parseFloat(item.cantidad),
        parseFloat(item.precio_unitario),
        subtotal,
      ];
    });

    await connection.execute(
      `INSERT INTO cotizacion_detalles
         (id_cotizacion, id_producto, descripcion_item, cantidad, precio_unitario, subtotal)
       VALUES ${placeholders}`,
      values
    );
  },

  // ---------------------------------------------------------------------------
  // findById — Full quotation detail with line items
  // ---------------------------------------------------------------------------
  async findById(id) {
    const sqlHeader = `
      SELECT
        c.id,
        c.numero_correlativo,
        c.id_cliente,
        cl.razon_social   AS cliente_nombre,
        cl.nit            AS cliente_nit,
        c.id_ejecutivo,
        u.nombre_completo  AS ejecutivo_nombre,
        c.descripcion,
        c.monto_total,
        c.moneda,
        c.estado,
        c.pdf_ruta,
        c.observaciones,
        c.fecha_emision,
        c.fecha_validez,
        c.aprobado_por,
        ap.nombre_completo AS aprobador_nombre,
        c.fecha_aprobacion,
        c.obs_aprobacion,
        c.creado_en,
        c.actualizado_en
      FROM cotizaciones c
      ${BASE_JOINS}
      WHERE c.id = ?
      LIMIT 1
    `;

    const [headerRows] = await pool.execute(sqlHeader, [id]);
    if (!headerRows[0]) return null;

    const quotation = headerRows[0];

    const sqlDetalles = `
      SELECT
        d.id,
        d.id_producto,
        p.codigo          AS producto_codigo,
        d.descripcion_item,
        d.cantidad,
        d.precio_unitario,
        d.subtotal
      FROM cotizacion_detalles d
      LEFT JOIN productos p ON p.id = d.id_producto
      WHERE d.id_cotizacion = ?
      ORDER BY d.id ASC
    `;

    const [detallesRows] = await pool.execute(sqlDetalles, [id]);
    quotation.detalles = detallesRows;

    return quotation;
  },

  // ---------------------------------------------------------------------------
  // updateStatus — State machine transition with optimistic concurrency check
  // ---------------------------------------------------------------------------
  async updateStatus(id, nuevoEstado, estadoActual) {
    const allowedTransitions = STATE_TRANSITIONS[estadoActual] || [];

    if (!allowedTransitions.includes(nuevoEstado)) {
      throw new Error(
        `Invalid state transition: '${estadoActual}' → '${nuevoEstado}'. ` +
        `Allowed from '${estadoActual}': [${allowedTransitions.join(', ')}]`
      );
    }

    const [result] = await pool.execute(
      'UPDATE cotizaciones SET estado = ? WHERE id = ? AND estado = ?',
      [nuevoEstado, id, estadoActual]
    );

    return result.affectedRows > 0;
  },

  // ---------------------------------------------------------------------------
  // approve — Jefe approval/rejection of a quotation in "En revision"
  // ---------------------------------------------------------------------------
  async approve(id, aprobadoPor, decision, obsAprobacion) {
    const nuevoEstado = decision === 'aprobada'
      ? 'Aprobada internamente'
      : 'Rechazada';

    const [result] = await pool.execute(
      `UPDATE cotizaciones
       SET estado = ?, aprobado_por = ?, fecha_aprobacion = NOW(), obs_aprobacion = ?
       WHERE id = ? AND estado = 'En revision'`,
      [nuevoEstado, aprobadoPor, obsAprobacion || null, id]
    );

    return result.affectedRows > 0;
  },

  // ---------------------------------------------------------------------------
  // updatePdfPath — Persist the stored PDF's relative path
  // ---------------------------------------------------------------------------
  async updatePdfPath(id, pdfRuta) {
    const [result] = await pool.execute(
      'UPDATE cotizaciones SET pdf_ruta = ? WHERE id = ?',
      [pdfRuta, id]
    );
    return result.affectedRows > 0;
  },

  // ---------------------------------------------------------------------------
  // checkDuplicate — Detect similar quotations within 30 days (RF06)
  // ---------------------------------------------------------------------------
  async checkDuplicate(id_cliente, descripcion) {
    const descSnippet = descripcion.substring(0, 50);

    const [rows] = await pool.execute(
      `SELECT id, numero_correlativo, fecha_emision, estado
       FROM cotizaciones
       WHERE id_cliente = ?
         AND descripcion  LIKE ?
         AND fecha_emision >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       LIMIT 5`,
      [id_cliente, `%${descSnippet}%`]
    );

    return rows;
  },

  // ==========================================================================
  // SPRINT 2 — Advanced read operations
  // ==========================================================================

  // ---------------------------------------------------------------------------
  // findAll (Sprint 2 — paginated, filtered, sorted)
  //
  // Returns one page of quotation summary rows. Does NOT return line items —
  // those are fetched on demand via findById to keep list queries fast.
  //
  // @param {Object} filters   - Filter criteria (see _buildWhereClause above)
  // @param {Object} pagination
  //   @param {number} pagination.page    - 1-based page number (default 1)
  //   @param {number} pagination.limit   - Rows per page (default 20, max 100)
  // @param {Object} sort
  //   @param {string} sort.by    - Column key from SORTABLE_COLUMNS (default 'creado_en')
  //   @param {string} sort.order - 'ASC' | 'DESC' (default 'DESC')
  //
  // @returns {Array<Object>} - Summary row array for the requested page
  // ---------------------------------------------------------------------------
  async findAll(filters = {}, pagination = {}, sort = {}) {
    // --- Resolve pagination parameters ---
    const page  = Math.max(1, parseInt(pagination.page,  10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(pagination.limit, 10) || 20));
    const offset = (page - 1) * limit; // 0-based row offset for MySQL LIMIT ? OFFSET ?

    // --- Resolve sort parameters ---
    // Default: most recently created quotations appear first
    const sortColumn = SORTABLE_COLUMNS[sort.by] || 'c.creado_en';
    const sortOrder  = sort.order === 'ASC' ? 'ASC' : 'DESC';

    // --- Build the shared WHERE clause ---
    const { clause: whereClause, values: whereValues } = _buildWhereClause(filters);

    const sql = `
      SELECT
        c.id,
        c.numero_correlativo,
        c.id_cliente,
        cl.razon_social    AS cliente_nombre,
        cl.nit             AS cliente_nit,
        c.id_ejecutivo,
        u.nombre_completo   AS ejecutivo_nombre,
        c.monto_total,
        c.moneda,
        c.estado,
        c.pdf_ruta         IS NOT NULL AS tiene_pdf,
        c.fecha_emision,
        c.fecha_validez,
        c.aprobado_por,
        ap.nombre_completo  AS aprobador_nombre,
        c.fecha_aprobacion,
        c.creado_en,
        c.actualizado_en
      FROM cotizaciones c
      ${BASE_JOINS}
      ${whereClause}
      ORDER BY ${sortColumn} ${sortOrder}
      LIMIT ? OFFSET ?
    `;

    // Append LIMIT and OFFSET at the end of the values array
    const queryValues = [...whereValues, limit, offset];

    const [rows] = await pool.execute(sql, queryValues);
    return rows;
  },

  // ---------------------------------------------------------------------------
  // countAll (Sprint 2)
  // Runs an identical WHERE clause to findAll but only counts matching rows.
  // Used by the controller to calculate total pages and totalRecords.
  //
  // IMPORTANT: always call this in parallel with findAll via Promise.all — never
  // sequentially — to avoid doubling the query latency on every list request.
  //
  // @param   {Object} filters - Same filter object passed to findAll
  // @returns {number}         - Total number of matching rows (ignoring pagination)
  // ---------------------------------------------------------------------------
  async countAll(filters = {}) {
    const { clause: whereClause, values: whereValues } = _buildWhereClause(filters);

    const sql = `
      SELECT COUNT(*) AS total
      FROM cotizaciones c
      ${BASE_JOINS}
      ${whereClause}
    `;

    const [rows] = await pool.execute(sql, whereValues);
    return rows[0].total; // Single integer
  },

  // ---------------------------------------------------------------------------
  // findSummaryByState (Sprint 2)
  // Returns a count of quotations grouped by estado.
  // Used by the Jefe dashboard (HU10) and by the list page's sidebar counters.
  //
  // @param   {number|null} id_ejecutivo - If provided, scopes the count to one executive
  // @returns {Array<{ estado: string, total: number }>}
  // ---------------------------------------------------------------------------
  async findSummaryByState(id_ejecutivo = null) {
    const values = [];
    let whereClause = '';

    if (id_ejecutivo) {
      whereClause = 'WHERE c.id_ejecutivo = ?';
      values.push(parseInt(id_ejecutivo, 10));
    }

    const sql = `
      SELECT
        c.estado,
        COUNT(*) AS total
      FROM cotizaciones c
      ${whereClause}
      GROUP BY c.estado
      ORDER BY FIELD(
        c.estado,
        'Pendiente',
        'En revision',
        'Aprobada internamente',
        'Enviada al cliente',
        'Aceptada',
        'Rechazada',
        'Archivada'
      )
    `;

    const [rows] = await pool.execute(sql, values);
    return rows;
  },

  // ---------------------------------------------------------------------------
  // findPendingApproval (Sprint 2)
  // Returns all quotations currently in "En revision" — the Jefe's approval queue.
  // Ordered oldest-first so the Jefe clears the backlog chronologically.
  //
  // @returns {Array<Object>}
  // ---------------------------------------------------------------------------
  async findPendingApproval() {
    const sql = `
      SELECT
        c.id,
        c.numero_correlativo,
        cl.razon_social   AS cliente_nombre,
        u.nombre_completo  AS ejecutivo_nombre,
        c.monto_total,
        c.moneda,
        c.fecha_emision,
        c.creado_en
      FROM cotizaciones c
      INNER JOIN clientes cl ON cl.id = c.id_cliente
      INNER JOIN usuarios u  ON u.id  = c.id_ejecutivo
      WHERE c.estado = 'En revision'
      ORDER BY c.creado_en ASC
    `;

    const [rows] = await pool.execute(sql);
    return rows;
  },

  // ===========================================================================
  // SPRINT 2 EXTENSION — STATE MACHINE & APPROVAL PERSISTENCE
  // ===========================================================================

  /**
   * Obtiene el estado actual y los datos mínimos de control de una cotización.
   * @param {number} id - ID de la cotización
   * @returns {Promise<Object|null>}
   */
  async getStateInfo(id) {
    const query = `
      SELECT id, numero_correlativo, estado, id_ejecutivo, monto_total 
      FROM cotizaciones 
      WHERE id = ?
    `;
    const [rows] = await pool.execute(query, [id]);
    return rows.length > 0 ? rows[0] : null;
  },

  /**
   * Actualiza el estado de una cotización de forma directa dentro de una conexión/transacción.
   * @param {Object} connection - Conexión del pool (para asegurar transacciones atómicas)
   * @param {number} id - ID de la cotización
   * @param {string} nuevoEstado - El nuevo estado de la máquina de estados
   */
  async updateStatusInTransaction(connection, id, nuevoEstado) {
    const query = 'UPDATE cotizaciones SET estado = ?, actualizado_en = NOW() WHERE id = ?';
    await connection.execute(query, [nuevoEstado, id]);
  },

  /**
   * Inserta un registro inmutable en la tabla de historial de aprobaciones (HU08).
   * @param {Object} connection - Conexión activa para asegurar atomicidad
   * @param {Object} data - Datos del flujo de aprobación
   */
  async insertApprovalHistory(connection, { id_cotizacion, id_jefe, accion, observaciones }) {
    const query = `
      INSERT INTO historial_aprobaciones (
        id_cotizacion, 
        id_jefe, 
        accion, 
        fecha_aprobacion, 
        observaciones
      ) VALUES (?, ?, ?, NOW(), ?)
    `;
    await connection.execute(query, [
      id_cotizacion,
      id_jefe,
      accion,
      observaciones || null
    ]);
  },

  // Export constants so controllers and tests can reference them without
  // importing from a separate constants file
  VALID_STATES,
  STATE_TRANSITIONS,
  SORTABLE_COLUMNS,
};

module.exports = QuotationModel;