// =============================================================================
// src/models/QuotationModel.js
// Data Access Layer — cotizaciones, cotizacion_detalles, cotizaciones_correlativo,
//                     cotizacion_historial_estados
//
// Sprint 1: generateCorrelativo (SELECT…FOR UPDATE), create, createDetalles,
//           findById, updatePdfPath, checkDuplicate
// Sprint 2 Step 1: findAll (paginated+filtered), countAll, findSummaryByState,
//                  findPendingApproval — all sharing _buildWhereClause
// Sprint 2 Step 2: Role-based state machine, validateForReview,
//                  validateTransitionByRole, updated updateStatus (role-aware),
//                  updated approve (boolean aprobado), logStateHistory,
//                  findStateHistory
// =============================================================================

'use strict';

const { pool } = require('../config/db');

// =============================================================================
// STATE MACHINE CONSTANTS
// =============================================================================

// ---------------------------------------------------------------------------
// All valid state values for the cotizaciones.estado ENUM column.
// Must mirror the ENUM definition in sql/init.sql exactly.
// 'Pendiente' is the canonical initial state and the DB column default.
// ---------------------------------------------------------------------------
const VALID_STATES = [
  'Pendiente',              // Initial state; quotation is being assembled by the Ejecutivo
  'En revision',            // Submitted; awaiting Jefe's internal approval decision
  'En espera',              // Decision suspended pending external supplier stock checks
  'Aprobada internamente',  // Approved by Jefe; ready to be sent to the client
  'Enviada al cliente',     // Formally delivered to the client
  'Aceptada',               // Client accepted the terms
  'Rechazada',              // Rejected — either internally or by the client
  'Archivada',              // Terminal state; no further transitions allowed
];

// ---------------------------------------------------------------------------
// ROLE_TRANSITIONS — the authoritative access-control matrix for state changes.
//
// Structure: role → estadoActual → allowedNextStates[]
//
// Business rules encoded here (Section 3.7.4 / HU08):
//   • Only 'Jefe' can transition from 'En revision' to approval/rejection states.
//   • 'Ejecutivo' cannot act on a quotation once it has been submitted ('En revision'
//     becomes read-only for them — they must wait for the Jefe's decision).
//   • 'Administracion' may pull back a submitted quotation ('En revision' → 'Pendiente')
//     but cannot approve or reject it.
//   • 'Pendiente' is the canonical initial state per the DB ENUM definition.
// ---------------------------------------------------------------------------
const ROLE_TRANSITIONS = {

  Ejecutivo: {
    Pendiente:               ['En revision', 'Archivada'],
    'En revision':           [],                                    // Read-only: wait for Jefe
    'En espera':             [],                                    // Read-only: Jefe suspended decision
    'Aprobada internamente': ['Enviada al cliente'],
    'Enviada al cliente':    ['Aceptada', 'Rechazada', 'Archivada'],
    Rechazada:               ['Pendiente', 'Archivada'],            // Reset to initial state for rework
    Aceptada:                ['Archivada'],
    Archivada:               [],
  },

  Administracion: {
    // Administracion can submit, place on hold, or cancel — but NOT approve or reject.
    // Approval authority belongs exclusively to the Jefe (business rule: role hierarchy).
    Pendiente:               ['En revision', 'En espera', 'Archivada'],
    'En revision':           ['En espera', 'Pendiente', 'Archivada'],   // Can hold or retract
    'En espera':             ['En revision', 'Pendiente', 'Archivada'], // Can resume or retract
    'Aprobada internamente': ['Archivada'],     // Read-only; can only archive
    'Enviada al cliente':    ['Archivada'],     // Read-only; can only archive
    Rechazada:               ['Pendiente', 'Archivada'],               // Allow rework cycle
    Aceptada:                ['Archivada'],
    Archivada:               [],
  },

  Jefe: {
    // Absolute commercial authority — can approve, reject, or hold from ANY state.
    // Pendiente can now be directly approved/rejected without requiring the
    // 'En revision' intermediate step (HU08 override fix).
    // 'Enviada al cliente' is reachable from ALL active states so the Jefe can
    // skip the 'Aprobada internamente' intermediate step when the quotation
    // can be sent to the client immediately (HU08 — direct send transition).
    Pendiente:               ['En revision', 'En espera', 'Aprobada internamente', 'Enviada al cliente', 'Rechazada', 'Archivada'],
    'En revision':           ['Aprobada internamente', 'Enviada al cliente', 'Rechazada', 'Pendiente', 'En espera', 'Archivada'],
    'En espera':             ['Aprobada internamente', 'Enviada al cliente', 'Rechazada', 'Pendiente', 'En revision', 'Archivada'],
    'Aprobada internamente': ['Aceptada', 'Enviada al cliente', 'Rechazada', 'Archivada'],
    // 'Pendiente' added: allows Jefe to request changes when the quote has already
    // been sent to the client (asynchronous internal delivery model — HU-CambioPostEnvio).
    'Enviada al cliente':    ['Aceptada', 'Rechazada', 'Pendiente', 'Archivada'],
    // Rechazada → can be reverted to Pendiente OR En revision by high-privilege roles
    // (HU-Revertir: allows re-injecting into the approval queue after sudden business changes)
    Rechazada:               ['Pendiente', 'En revision', 'Aprobada internamente', 'Archivada'],
    Aceptada:                ['Archivada'],
    Archivada:               [],
  },

  // SysAdmin — absolute system-wide authority, mirrors Jefe transitions and
  // additionally can fully reset any non-Archivada state back to Pendiente.
  SysAdmin: {
    Pendiente:               ['En revision', 'En espera', 'Aprobada internamente', 'Enviada al cliente', 'Rechazada', 'Archivada'],
    'En revision':           ['Aprobada internamente', 'Enviada al cliente', 'Rechazada', 'Pendiente', 'En espera', 'Archivada'],
    'En espera':             ['Aprobada internamente', 'Enviada al cliente', 'Rechazada', 'Pendiente', 'En revision', 'Archivada'],
    'Aprobada internamente': ['Aceptada', 'Enviada al cliente', 'Rechazada', 'Pendiente', 'Archivada'],
    'Enviada al cliente':    ['Aceptada', 'Rechazada', 'Pendiente', 'Archivada'],
    // Rechazada → can be reverted to Pendiente OR En revision
    Rechazada:               ['Pendiente', 'En revision', 'Aprobada internamente', 'Archivada'],
    Aceptada:                ['Archivada', 'Pendiente'],
    Archivada:               [],    // Terminal — even SysAdmin cannot un-archive
  },
};

// ---------------------------------------------------------------------------
// STATE_TRANSITIONS — flat fallback matrix (used only for reference / tests).
// ROLE_TRANSITIONS is always the authoritative source in the application.
// ---------------------------------------------------------------------------
const STATE_TRANSITIONS = {
  Pendiente:               ['En revision', 'Archivada'],
  'En revision':           ['Aprobada internamente', 'Rechazada', 'Pendiente', 'En espera', 'Archivada'],
  'En espera':             ['Aprobada internamente', 'Rechazada', 'Pendiente', 'Archivada'],
  'Aprobada internamente': ['Enviada al cliente', 'Archivada'],
  'Enviada al cliente':    ['Aceptada', 'Rechazada', 'Archivada'],
  Rechazada:               ['Pendiente', 'Archivada'],
  Aceptada:                ['Archivada'],
  Archivada:               [],
};

// Columns safe for ORDER BY — prevents injection via the sort_by query param
const SORTABLE_COLUMNS = {
  numero_correlativo: 'c.numero_correlativo',
  fecha_emision:      'c.fecha_emision',
  monto_total:        'c.monto_total',
  estado:             'c.estado',
  creado_en:          'c.creado_en',
  cliente_nombre:     'cl.razon_social',
  ejecutivo_nombre:   'u.nombre_completo',
};

// Mandatory fields checked before a quotation can be submitted for review
// (Section 4.3 — HU: Validación de borrador antes de enviar a revisión)
const REVIEW_REQUIRED_FIELDS = ['monto_total', 'fecha_validez'];

// =============================================================================
// PRIVATE HELPERS
// =============================================================================

// ---------------------------------------------------------------------------
// _buildWhereClause
// Constructs a parameterized WHERE clause from a filters object.
// Shared by findAll and countAll so filter logic is never duplicated.
//
// Accepted filter keys:
//   q            {string}   Full-text across correlativo + razon_social + NIT
//   razon_social {string}   Partial match on cl.razon_social
//   nit          {string}   Partial match on cl.nit
//   estado       {string}   Exact match against VALID_STATES
//   id_cliente   {number}   Exact client ID
//   id_ejecutivo {number}   Exact executive user ID
//   fecha_desde  {string}   Lower bound on fecha_emision (YYYY-MM-DD, inclusive)
//   fecha_hasta  {string}   Upper bound on fecha_emision (YYYY-MM-DD, inclusive)
//   moneda       {string}   'USD' | 'BOB'
//   tiene_pdf    {boolean}  true = only with PDF; false = only without PDF
// ---------------------------------------------------------------------------
function _buildWhereClause(filters = {}) {
  const conditions = [];
  const values     = [];

  if (filters.q && filters.q.trim()) {
    const like = `%${filters.q.trim()}%`;
    conditions.push('(c.numero_correlativo LIKE ? OR cl.razon_social LIKE ? OR cl.nit LIKE ?)');
    values.push(like, like, like);
  }

  if (filters.razon_social && filters.razon_social.trim()) {
    conditions.push('cl.razon_social LIKE ?');
    values.push(`%${filters.razon_social.trim()}%`);
  }

  if (filters.nit && filters.nit.trim()) {
    conditions.push('cl.nit LIKE ?');
    values.push(`%${filters.nit.trim()}%`);
  }

  if (filters.estado) {
    conditions.push('c.estado = ?');
    values.push(filters.estado);
  }

  if (filters.id_cliente) {
    conditions.push('c.id_cliente = ?');
    values.push(parseInt(filters.id_cliente, 10));
  }

  if (filters.id_ejecutivo) {
    conditions.push('c.id_ejecutivo = ?');
    values.push(parseInt(filters.id_ejecutivo, 10));
  }

  if (filters.fecha_desde) {
    conditions.push('c.fecha_emision >= ?');
    values.push(filters.fecha_desde);
  }

  if (filters.fecha_hasta) {
    conditions.push('c.fecha_emision <= ?');
    values.push(filters.fecha_hasta);
  }

  if (filters.moneda) {
    conditions.push('c.moneda = ?');
    values.push(filters.moneda.toUpperCase());
  }

  if (filters.tiene_pdf === true) {
    conditions.push('c.pdf_ruta IS NOT NULL');
  } else if (filters.tiene_pdf === false) {
    conditions.push('c.pdf_ruta IS NULL');
  }

  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    values,
  };
}

// Reusable JOIN block for all SELECT queries on cotizaciones
const BASE_JOINS = `
  INNER JOIN clientes cl ON cl.id = c.id_cliente
  INNER JOIN usuarios u  ON u.id  = c.id_ejecutivo
  LEFT  JOIN usuarios ap ON ap.id = c.aprobado_por
`;

// =============================================================================
// MODEL
// =============================================================================

const QuotationModel = {

  // ===========================================================================
  // SPRINT 1 — Core write operations (unchanged from Sprint 1)
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // generateCorrelativo
  // ATOMIC: must be called inside a caller-managed transaction.
  // Acquires a row-level exclusive lock (SELECT … FOR UPDATE) on the
  // cotizaciones_correlativo row for the current year, increments the counter,
  // and returns the formatted serial "COT-YYYY-NNNN".
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
  // create — Insert the cotizaciones header inside a caller-managed transaction.
  // Initial state is 'Pendiente' — the only valid initial ENUM value in the DB.
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
  // createDetalles — Bulk INSERT line items inside a caller-managed transaction.
  // ---------------------------------------------------------------------------
  async createDetalles(connection, id_cotizacion, detalles) {
    if (!detalles || detalles.length === 0) return;

    // 8 bound params per row: added codigo_parte for Part Number storage
    const placeholders = detalles.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');

    const values = detalles.flatMap((item) => {
      const subtotal = parseFloat(
        (parseFloat(item.cantidad) * parseFloat(item.precio_unitario)).toFixed(2)
      );
      // Truncate codigo to 50 chars max (mirrors VARCHAR(50) DB column)
      const codigoParte = item.codigo
        ? String(item.codigo).trim().substring(0, 50) || null
        : null;
      return [
        id_cotizacion,
        item.id_producto    || null,
        item.descripcion_item,
        parseFloat(item.cantidad),
        parseFloat(item.precio_unitario),
        subtotal,
        item.marca_id       || null,
        codigoParte,
      ];
    });

    await connection.execute(
      `INSERT INTO cotizacion_detalles
         (id_cotizacion, id_producto, descripcion_item, cantidad, precio_unitario, subtotal, marca_id, codigo_parte)
       VALUES ${placeholders}`,
      values
    );
  },

  // ---------------------------------------------------------------------------
  // findById — Full quotation detail including line items and approval metadata.
  // ---------------------------------------------------------------------------
  async findById(id) {
    const sqlHeader = `
      SELECT
        c.id,
        c.numero_correlativo,
        c.id_cliente,
        cl.razon_social    AS cliente_nombre,
        cl.nit             AS cliente_nit,
        c.id_ejecutivo,
        u.nombre_completo   AS ejecutivo_nombre,
        c.descripcion,
        c.monto_total,
        c.moneda,
        c.estado,
        c.pdf_ruta,
        c.observaciones,
        c.fecha_emision,
        c.fecha_validez,
        c.aprobado_por,
        ap.nombre_completo  AS aprobador_nombre,
        c.fecha_aprobacion,
        c.obs_aprobacion,
        c.comentarios_admin,
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
        d.codigo_parte,
        d.descripcion_item,
        d.cantidad,
        d.precio_unitario,
        d.subtotal,
        d.marca_id,
        m.nombre          AS marca_nombre
      FROM cotizacion_detalles d
      LEFT JOIN productos p ON p.id = d.id_producto
      LEFT JOIN marcas    m ON m.id = d.marca_id
      WHERE d.id_cotizacion = ?
      ORDER BY d.id ASC
    `;

    const [detallesRows] = await pool.execute(sqlDetalles, [id]);
    quotation.detalles = detallesRows;

    return quotation;
  },

  // ---------------------------------------------------------------------------
  // updatePdfPath — Persist the relative file path of the linked PDF.
  // ---------------------------------------------------------------------------
  async updatePdfPath(id, pdfRuta) {
    const [result] = await pool.execute(
      'UPDATE cotizaciones SET pdf_ruta = ? WHERE id = ?',
      [pdfRuta, id]
    );
    return result.affectedRows > 0;
  },

  // ---------------------------------------------------------------------------
  // updateComentarioAdmin — Persist the Administracion supervisor review comment.
  // Called both standalone (PATCH endpoint) and together with a state transition.
  // @param {number} id        - Quotation primary key
  // @param {string} comment   - Comment text (null to clear)
  // @returns {boolean}        - true if the row was updated
  // ---------------------------------------------------------------------------
  async updateComentarioAdmin(id, comment) {
    const [result] = await pool.execute(
      'UPDATE cotizaciones SET comentarios_admin = ? WHERE id = ?',
      [comment || null, id]
    );
    return result.affectedRows > 0;
  },

  // ---------------------------------------------------------------------------
  // checkDuplicate — RF06: detect similar quotations within 30 days.
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

  // ===========================================================================
  // SPRINT 2 STEP 1 — Advanced read operations (paginated, filtered, sorted)
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // findAll — Paginated, filtered, and sorted listing.
  //
  // @param {Object} filters    - Filter criteria (see _buildWhereClause)
  // @param {Object} pagination - { page: number, limit: number }
  // @param {Object} sort       - { by: string, order: 'ASC'|'DESC' }
  // @returns {Array<Object>}
  // ---------------------------------------------------------------------------
  async findAll(filters = {}, pagination = {}, sort = {}) {
    const page   = Math.max(1, parseInt(pagination.page,  10) || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(pagination.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const sortColumn = SORTABLE_COLUMNS[sort.by] || 'c.creado_en';
    const sortOrder  = sort.order === 'ASC' ? 'ASC' : 'DESC';

    const { clause: whereClause, values: whereValues } = _buildWhereClause(filters);

    const sql = `
      SELECT
        c.id,
        c.numero_correlativo,
        c.id_cliente,
        cl.razon_social     AS cliente_nombre,
        cl.nit              AS cliente_nit,
        c.id_ejecutivo,
        u.nombre_completo    AS ejecutivo_nombre,
        c.monto_total,
        c.moneda,
        c.estado,
        c.pdf_ruta IS NOT NULL AS tiene_pdf,
        c.fecha_emision,
        c.fecha_validez,
        c.aprobado_por,
        ap.nombre_completo   AS aprobador_nombre,
        c.fecha_aprobacion,
        c.creado_en,
        c.actualizado_en
      FROM cotizaciones c
      ${BASE_JOINS}
      ${whereClause}
      ORDER BY ${sortColumn} ${sortOrder}
      LIMIT ${limit} OFFSET ${offset}
    `;

    // LIMIT and OFFSET are embedded as SQL literals (not bound params) because
    // mysql2 v3 prepared statements mistype them as DOUBLE, causing
    // "Incorrect arguments to mysqld_stmt_execute". Both values are
    // validated integers (Math.min / Math.max / parseInt) so this is safe.
    const [rows] = await pool.execute(sql, whereValues);
    return rows;
  },

  // ---------------------------------------------------------------------------
  // countAll — COUNT(*) with the same WHERE as findAll.
  // Run in parallel with findAll via Promise.all to avoid sequential latency.
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
    return rows[0].total;
  },

  // ---------------------------------------------------------------------------
  // findSummaryByState — Quotation counts grouped by estado.
  // FIELD() enforces the canonical state-machine ordering in the result set.
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
        'Pendiente', 'En revision', 'En espera', 'Aprobada internamente',
        'Enviada al cliente', 'Aceptada', 'Rechazada', 'Archivada'
      )
    `;

    const [rows] = await pool.execute(sql, values);
    return rows;
  },

  // ---------------------------------------------------------------------------
  // findPendingApproval — Jefe's approval queue: all quotations that require a
  // decision ('Pendiente', 'En revision', 'En espera'), ordered oldest-first so
  // the backlog is cleared chronologically.
  // ---------------------------------------------------------------------------
  async findPendingApproval() {
    const sql = `
      SELECT
        c.id,
        c.numero_correlativo,
        c.estado,
        cl.razon_social    AS cliente_nombre,
        u.nombre_completo   AS ejecutivo_nombre,
        c.monto_total,
        c.moneda,
        c.fecha_emision,
        c.fecha_validez,
        c.creado_en
      FROM cotizaciones c
      INNER JOIN clientes cl ON cl.id = c.id_cliente
      INNER JOIN usuarios u  ON u.id  = c.id_ejecutivo
      WHERE c.estado IN ('Pendiente', 'En revision', 'En espera')
      ORDER BY c.creado_en ASC
    `;

    const [rows] = await pool.execute(sql);
    return rows;
  },

  // ===========================================================================
  // SPRINT 2 STEP 2 — State machine enforcement and approval workflow (HU08)
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // validateTransitionByRole (Section 3.7.4 — Permission Matrix)
  // Synchronous helper: looks up the role-based transition matrix and returns a
  // structured result object. The controller uses this before calling updateStatus
  // so it can return a specific HTTP 403 with an actionable error message.
  //
  // @param {string} estadoActual - Current state of the quotation
  // @param {string} nuevoEstado  - Target state requested by the caller
  // @param {string} rol          - Calling user's role name
  //
  // @returns {{ valid: boolean, reason?: string, allowedTransitions?: string[] }}
  // ---------------------------------------------------------------------------
  validateTransitionByRole(estadoActual, nuevoEstado, rol) {
    const roleMatrix = ROLE_TRANSITIONS[rol];

    // Rol desconocido — no debería llegar aquí si el middleware de autenticación está activo
    if (!roleMatrix) {
      return {
        valid:  false,
        reason: `El rol '${rol}' no está reconocido en la máquina de estados del sistema.`,
      };
    }

    const allowedFromState = roleMatrix[estadoActual] || [];

    if (!allowedFromState.includes(nuevoEstado)) {
      // Mensaje de error específico: distinguir "sin transiciones posibles" de "destino incorrecto"
      const reason = allowedFromState.length === 0
        ? `El rol '${rol}' no puede realizar ninguna transición desde el estado '${estadoActual}'. ` +
          `Este estado es de solo lectura para su rol.`
        : `El rol '${rol}' no puede transicionar desde '${estadoActual}' hacia '${nuevoEstado}'. ` +
          `Transiciones permitidas desde '${estadoActual}' para su rol: [${allowedFromState.join(', ')}].`;

      return {
        valid:              false,
        reason,
        allowedTransitions: allowedFromState,
      };
    }

    return { valid: true, allowedTransitions: allowedFromState };
  },

  // ---------------------------------------------------------------------------
  // validateForReview (Section 4.3 — Pre-submission checklist)
  // Validates that a quotation satisfies all mandatory conditions before it can
  // be transitioned to 'En revision'. Returns a (possibly empty) errors array.
  // An empty array means the quotation is ready; any errors block the transition.
  //
  // Checks:
  //   1. At least one line item exists in cotizacion_detalles
  //   2. monto_total is set (not NULL) — must be calculated before submission
  //   3. fecha_validez is set — client needs a validity window
  //
  // @param  {number} quotationId
  // @returns {Promise<Array<{ field: string, message: string }>>}
  // ---------------------------------------------------------------------------
  async validateForReview(quotationId) {
    const errors = [];

    // Check mandatory header fields in a single query
    const [headerRows] = await pool.execute(
      'SELECT monto_total, fecha_validez FROM cotizaciones WHERE id = ?',
      [quotationId]
    );

    if (!headerRows[0]) {
      return [{ field: 'id', message: 'Quotation not found.' }];
    }

    const { monto_total, fecha_validez } = headerRows[0];

    if (monto_total === null) {
      errors.push({
        field:   'monto_total',
        message: 'Total amount (monto_total) must be calculated and set before submitting for review.',
      });
    }

    if (!fecha_validez) {
      errors.push({
        field:   'fecha_validez',
        message: 'A validity date (fecha_validez) must be specified before submitting for review.',
      });
    }

    // Verify at least one line item exists
    const [countRows] = await pool.execute(
      'SELECT COUNT(*) AS total FROM cotizacion_detalles WHERE id_cotizacion = ?',
      [quotationId]
    );

    if (countRows[0].total === 0) {
      errors.push({
        field:   'detalles',
        message: 'The quotation must contain at least one line item before submission for review.',
      });
    }

    return errors;
  },

  // ---------------------------------------------------------------------------
  // updateStatus (Sprint 2 — role-aware)
  // Executes a state transition after role-based validation. The caller is
  // expected to have already called validateTransitionByRole and handled the
  // error response. This method validates again as defense-in-depth and uses
  // optimistic concurrency (AND estado = estadoActual) to prevent race conditions.
  //
  // @param {number}  id              - Quotation primary key
  // @param {string}  nuevoEstado     - Validated target state
  // @param {string}  estadoActual    - Current state (optimistic concurrency lock)
  // @param {string}  rol             - Calling user's role (for re-validation)
  // @param {string|null} comentarioAdmin - Optional admin comment to persist alongside the transition
  // @returns {boolean}               - true if the row was updated
  // ---------------------------------------------------------------------------
  async updateStatus(id, nuevoEstado, estadoActual, rol, comentarioAdmin = null) {
    // Defense-in-depth: re-validate the role-based transition inside the model
    const check = this.validateTransitionByRole(estadoActual, nuevoEstado, rol);

    if (!check.valid) {
      const err = new Error(check.reason);
      err.code  = 'FORBIDDEN_TRANSITION';         // Controller checks this code
      err.allowedTransitions = check.allowedTransitions || [];
      throw err;
    }

    // Optimistic concurrency: the WHERE clause includes the expected current state.
    // If another request changed the state between our findById and this UPDATE,
    // affectedRows = 0 and the controller returns a 409 Conflict.
    //
    // If comentarioAdmin is provided, persist it in the same atomic UPDATE so
    // the comment and the state change are never split across two writes.
    let sql, params;
    if (comentarioAdmin !== null && comentarioAdmin !== undefined) {
      sql    = 'UPDATE cotizaciones SET estado = ?, comentarios_admin = ? WHERE id = ? AND estado = ?';
      params = [nuevoEstado, String(comentarioAdmin).trim() || null, id, estadoActual];
    } else {
      sql    = 'UPDATE cotizaciones SET estado = ? WHERE id = ? AND estado = ?';
      params = [nuevoEstado, id, estadoActual];
    }

    const [result] = await pool.execute(sql, params);
    return result.affectedRows > 0;
  },

  // ---------------------------------------------------------------------------
  // approve (HU08 — Jefe / SysAdmin approval/rejection)
  // Dedicated method for the approval workflow. Records the decision, the
  // approver's identity, the timestamp, and the mandatory observation text.
  //
  // Jefe and SysAdmin hold ABSOLUTE authority: they can approve or reject from
  // ANY non-terminal state. The WHERE clause uses the caller-supplied
  // `currentState` for optimistic concurrency — it guarantees that two
  // concurrent requests for the same quotation cannot both succeed.
  //
  // @param {number}  id            - Quotation primary key
  // @param {number}  aprobadoPor   - User ID of the approver (from req.user.id)
  // @param {boolean} aprobado      - true = Aprobada internamente; false = Rechazada
  // @param {string}  observaciones - Justification text (mandatory on rejection)
  // @param {string}  currentState  - State read by the controller (optimistic lock)
  // @returns {boolean}             - true if the row was updated
  // ---------------------------------------------------------------------------
  async approve(id, aprobadoPor, aprobado, observaciones, currentState) {
    const nuevoEstado = aprobado
      ? 'Aprobada internamente'
      : 'Rechazada';

    // Use the caller-supplied currentState as the concurrency guard so that
    // any state (not only 'En revision') can be the source of an approval.
    const sql = `
      UPDATE cotizaciones
      SET
        estado           = ?,
        aprobado_por     = ?,
        fecha_aprobacion = NOW(),
        obs_aprobacion   = ?
      WHERE id = ? AND estado = ?
    `;

    const [result] = await pool.execute(sql, [
      nuevoEstado,
      aprobadoPor,
      observaciones || null,
      id,
      currentState,
    ]);

    return result.affectedRows > 0;
  },

  // ---------------------------------------------------------------------------
  // logStateHistory (Section 4.3 — Historial de estados)
  // Inserts one record into cotizacion_historial_estados whenever a state
  // transition occurs. This table is dedicated to the quotation lifecycle
  // and provides a cleaner timeline view than querying bitacora_auditoria.
  //
  // This method is fire-and-forget (errors are caught and logged; they must
  // never block the primary business operation).
  //
  // @param {Object} data
  //   id_cotizacion  {number}
  //   estado_anterior {string}
  //   estado_nuevo    {string}
  //   id_usuario      {number|null}
  //   nombre_usuario  {string|null}
  //   rol_usuario     {string|null}
  //   observacion     {string|null}
  //   ip_origen       {string|null}
  // ---------------------------------------------------------------------------
  async logStateHistory({
    id_cotizacion,
    estado_anterior,
    estado_nuevo,
    id_usuario    = null,
    nombre_usuario = null,
    rol_usuario   = null,
    observacion   = null,
    ip_origen     = null,
  }) {
    try {
      await pool.execute(
        `INSERT INTO cotizacion_historial_estados
           (id_cotizacion, estado_anterior, estado_nuevo, id_usuario,
            nombre_usuario, rol_usuario, observacion, ip_origen)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id_cotizacion,
          estado_anterior,
          estado_nuevo,
          id_usuario,
          nombre_usuario,
          rol_usuario,
          observacion,
          ip_origen,
        ]
      );
    } catch (err) {
      // Log internally but never propagate — history failure must not block transitions
      console.error(
        '[QuotationModel.logStateHistory] Failed to write history record:',
        err.message,
        { id_cotizacion, estado_anterior, estado_nuevo }
      );
    }
  },

  // ---------------------------------------------------------------------------
  // findStateHistory (Section 4.3 — GET /api/cotizaciones/:id/historial)
  // Returns the complete ordered timeline of state transitions for a quotation,
  // combining the dedicated history table with the creation event from the
  // audit log so the timeline starts at the moment of creation.
  //
  // @param  {number} quotationId
  // @returns {Promise<Array<Object>>}
  // ---------------------------------------------------------------------------
  async findStateHistory(quotationId) {
    // Primary source: dedicated history table (all state changes after creation)
    const sqlHistory = `
      SELECT
        h.id,
        h.estado_anterior,
        h.estado_nuevo,
        h.nombre_usuario,
        h.rol_usuario,
        h.observacion,
        h.ip_origen,
        h.creado_en,
        'transicion'         AS tipo_evento
      FROM cotizacion_historial_estados h
      WHERE h.id_cotizacion = ?
      ORDER BY h.creado_en ASC
    `;

    const [historyRows] = await pool.execute(sqlHistory, [quotationId]);

    // Enrich with the creation event from bitacora_auditoria so the
    // timeline's first entry is always the creation record
    const sqlCreation = `
      SELECT
        ba.id,
        NULL                 AS estado_anterior,
        'Pendiente'          AS estado_nuevo,
        ba.nombre_usuario,
        NULL                 AS rol_usuario,
        NULL                 AS observacion,
        ba.ip_origen,
        ba.creado_en,
        'creacion'           AS tipo_evento
      FROM bitacora_auditoria ba
      WHERE ba.entidad = 'cotizaciones'
        AND ba.id_entidad = ?
        AND ba.accion     = 'CREAR_COTIZACION'
        AND ba.resultado  = 'exito'
      LIMIT 1
    `;

    const [creationRows] = await pool.execute(sqlCreation, [quotationId]);

    // Merge: creation event first, then the state transitions in order
    return [...creationRows, ...historyRows];
  },

  // ===========================================================================
  // SPRINT 3 — Daily proformas, notification helpers, progress analytics
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // findProformasHoy — quotations whose fecha_emision equals the current server
  // date (CURDATE()). Used by the "Proformas del Día" executive widget.
  // Optionally scoped to a single executive.
  // ---------------------------------------------------------------------------
  async findProformasHoy(id_ejecutivo = null) {
    const values = [];
    let extraWhere = 'WHERE c.fecha_emision = CURDATE()';
    if (id_ejecutivo) {
      extraWhere += ' AND c.id_ejecutivo = ?';
      values.push(parseInt(id_ejecutivo, 10));
    }

    const sql = `
      SELECT
        c.id,
        c.numero_correlativo,
        cl.razon_social    AS cliente_nombre,
        u.nombre_completo   AS ejecutivo_nombre,
        c.monto_total,
        c.moneda,
        c.estado,
        c.fecha_emision,
        c.fecha_validez
      FROM cotizaciones c
      ${BASE_JOINS}
      ${extraWhere}
      ORDER BY c.creado_en DESC
    `;

    const [rows] = await pool.execute(sql, values);
    return rows;
  },

  // ---------------------------------------------------------------------------
  // findNotificacionesPendientes — Returns quotations that were sent back to
  // 'Pendiente' via a change-request from Administracion or Jefe, signalling
  // the assigned Ejecutivo that corrections are required.
  //
  // A "pending correction notification" is defined as: a history entry where
  // estado_nuevo = 'Pendiente' AND estado_anterior IS NOT NULL (i.e. not the
  // initial creation event) AND the quotation's current estado is still 'Pendiente'.
  // ---------------------------------------------------------------------------
  async findNotificacionesPendientes(id_ejecutivo) {
    const sql = `
      SELECT
        c.id                AS id_cotizacion,
        c.numero_correlativo,
        cl.razon_social     AS cliente_nombre,
        h.observacion,
        h.nombre_usuario    AS solicitado_por,
        h.rol_usuario       AS rol_solicitante,
        h.creado_en         AS fecha_solicitud
      FROM cotizacion_historial_estados h
      INNER JOIN cotizaciones c  ON c.id  = h.id_cotizacion
      INNER JOIN clientes    cl  ON cl.id = c.id_cliente
      WHERE h.estado_nuevo      = 'Pendiente'
        AND h.estado_anterior   IS NOT NULL
        AND h.estado_anterior   != 'Pendiente'
        AND c.estado            = 'Pendiente'
        AND c.id_ejecutivo      = ?
      ORDER BY h.creado_en DESC
    `;

    const [rows] = await pool.execute(sql, [parseInt(id_ejecutivo, 10)]);
    return rows;
  },

  // ---------------------------------------------------------------------------
  // getProgreso — Monthly analytics for Jefe / SysAdmin performance dashboard.
  // Returns three data sets in a single DB round-trip:
  //   1. total_mes_usd     — Sum of monto_total (USD) for the current month
  //   2. conversion_ratio  — COUNT(Aceptada) / (COUNT(Aceptada) + COUNT(Rechazada))
  //   3. por_ejecutivo     — Per-executive breakdown of all states this month
  // ---------------------------------------------------------------------------
  async getProgreso() {
    // Monthly volume (current month, USD only)
    const [volumenRows] = await pool.execute(`
      SELECT
        SUM(CASE WHEN moneda = 'USD' THEN monto_total ELSE 0 END) AS total_mes_usd,
        SUM(CASE WHEN moneda = 'BOB' THEN monto_total ELSE 0 END) AS total_mes_bob,
        COUNT(*)                                                   AS total_cotizaciones
      FROM cotizaciones
      WHERE MONTH(fecha_emision) = MONTH(CURDATE())
        AND YEAR(fecha_emision)  = YEAR(CURDATE())
    `);

    // Conversion ratio across all time (meaningful business metric)
    const [conversionRows] = await pool.execute(`
      SELECT
        SUM(CASE WHEN estado = 'Aceptada'  THEN 1 ELSE 0 END) AS total_aceptadas,
        SUM(CASE WHEN estado = 'Rechazada' THEN 1 ELSE 0 END) AS total_rechazadas
      FROM cotizaciones
      WHERE estado IN ('Aceptada', 'Rechazada')
    `);

    // Per-executive breakdown for the current month
    const [porEjecutivoRows] = await pool.execute(`
      SELECT
        u.nombre_completo                                              AS ejecutivo,
        COUNT(*)                                                       AS total,
        SUM(CASE WHEN c.estado = 'Aceptada'  THEN 1 ELSE 0 END)      AS aceptadas,
        SUM(CASE WHEN c.estado = 'Rechazada' THEN 1 ELSE 0 END)      AS rechazadas,
        SUM(CASE WHEN c.estado = 'Pendiente' THEN 1 ELSE 0 END)      AS pendientes,
        SUM(CASE WHEN c.estado = 'En revision' THEN 1 ELSE 0 END)    AS en_revision,
        SUM(CASE WHEN c.moneda = 'USD' THEN c.monto_total ELSE 0 END) AS volumen_usd
      FROM cotizaciones c
      INNER JOIN usuarios u ON u.id = c.id_ejecutivo
      WHERE MONTH(c.fecha_emision) = MONTH(CURDATE())
        AND YEAR(c.fecha_emision)  = YEAR(CURDATE())
      GROUP BY c.id_ejecutivo, u.nombre_completo
      ORDER BY volumen_usd DESC
    `);

    const vol        = volumenRows[0] || {};
    const conv       = conversionRows[0] || {};
    const aceptadas  = parseInt(conv.total_aceptadas  || 0, 10);
    const rechazadas = parseInt(conv.total_rechazadas || 0, 10);
    const total      = aceptadas + rechazadas;

    return {
      volumen: {
        total_mes_usd:      parseFloat(vol.total_mes_usd  || 0).toFixed(2),
        total_mes_bob:      parseFloat(vol.total_mes_bob  || 0).toFixed(2),
        total_cotizaciones: parseInt(vol.total_cotizaciones || 0, 10),
      },
      conversion: {
        total_aceptadas:  aceptadas,
        total_rechazadas: rechazadas,
        ratio_pct:        total > 0 ? ((aceptadas / total) * 100).toFixed(1) : '0.0',
      },
      por_ejecutivo: porEjecutivoRows,
    };
  },

  // ===========================================================================
  // Exported constants (used by controllers, routes, and tests)
  // ===========================================================================
  VALID_STATES,
  STATE_TRANSITIONS,
  ROLE_TRANSITIONS,
  SORTABLE_COLUMNS,
};

module.exports = QuotationModel;
