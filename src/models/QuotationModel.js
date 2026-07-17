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
const { calcularSubtotal } = require('../utils/quotationTotals');

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
  'Confirmada',             // Client confirmed the terms (formerly 'Aceptada')
  'Aceptada',               // LEGACY alias of 'Confirmada' — tolerated so pre-migration
                            // records and their transitions never crash the state machine.
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
    'Enviada al cliente':    ['Confirmada', 'Rechazada', 'Archivada'],
    Rechazada:               ['Pendiente', 'Archivada'],            // Reset to initial state for rework
    Confirmada:              ['Archivada'],
    Aceptada:                ['Archivada'],                         // LEGACY alias of 'Confirmada'
    Archivada:               [],
  },

  Administracion: {
    // Administracion can submit, place on hold, or cancel — but NOT approve or reject.
    // Approval authority belongs exclusively to the Jefe (business rule: role hierarchy).
    // Post-approval, however, Administracion DOES drive the commercial lifecycle
    // forward: once a quotation is 'Aprobada internamente' it may be sent to the
    // client and then marked accepted/rejected. These are delivery/outcome steps,
    // not approval decisions, so they do not breach the Jefe's exclusive approval
    // authority. This unblocks the linear flow
    // Pendiente → Aprobada internamente → Enviada al cliente → Confirmada.
    Pendiente:               ['En revision', 'En espera', 'Archivada'],
    'En revision':           ['En espera', 'Pendiente', 'Archivada'],   // Can hold or retract
    'En espera':             ['En revision', 'Pendiente', 'Archivada'], // Can resume or retract
    'Aprobada internamente': ['Enviada al cliente', 'Pendiente', 'Archivada'], // Forward to client, request changes, or archive
    'Enviada al cliente':    ['Confirmada', 'Rechazada', 'Archivada'],  // Record client outcome
    Rechazada:               ['Pendiente', 'Archivada'],               // Allow rework cycle
    Confirmada:              ['Archivada'],
    Aceptada:                ['Archivada'],                            // LEGACY alias of 'Confirmada'
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
    // 'En espera' and 'Pendiente' added: allows Jefe to suspend or request changes on
    // a fully-approved quotation before it is sent to the client (HU-CambioPostAprobacion).
    'Aprobada internamente': ['Confirmada', 'Enviada al cliente', 'Rechazada', 'En espera', 'Pendiente', 'Archivada'],
    // 'Pendiente' added: allows Jefe to request changes when the quote has already
    // been sent to the client (asynchronous internal delivery model — HU-CambioPostEnvio).
    // 'En espera' added: Jefe may suspend a delivered quotation while waiting for
    // client confirmation or external factors (HU-EsperaPostEnvio).
    'Enviada al cliente':    ['Confirmada', 'Rechazada', 'Pendiente', 'En espera', 'Archivada'],
    // Rechazada → can be reverted to Pendiente OR En revision by high-privilege roles
    // (HU-Revertir: allows re-injecting into the approval queue after sudden business changes)
    Rechazada:               ['Pendiente', 'En revision', 'Aprobada internamente', 'Archivada'],
    Confirmada:              ['Archivada'],
    Aceptada:                ['Archivada'],                            // LEGACY alias of 'Confirmada'
    Archivada:               [],
  },

  // SysAdmin — absolute system-wide authority, mirrors Jefe transitions and
  // additionally can fully reset any non-Archivada state back to Pendiente.
  SysAdmin: {
    Pendiente:               ['En revision', 'En espera', 'Aprobada internamente', 'Enviada al cliente', 'Rechazada', 'Archivada'],
    'En revision':           ['Aprobada internamente', 'Enviada al cliente', 'Rechazada', 'Pendiente', 'En espera', 'Archivada'],
    'En espera':             ['Aprobada internamente', 'Enviada al cliente', 'Rechazada', 'Pendiente', 'En revision', 'Archivada'],
    'Aprobada internamente': ['Confirmada', 'Enviada al cliente', 'Rechazada', 'Pendiente', 'Archivada'],
    'Enviada al cliente':    ['Confirmada', 'Rechazada', 'Pendiente', 'Archivada'],
    // Rechazada → can be reverted to Pendiente OR En revision
    Rechazada:               ['Pendiente', 'En revision', 'Aprobada internamente', 'Archivada'],
    Confirmada:              ['Archivada', 'Pendiente'],
    Aceptada:                ['Archivada', 'Pendiente'],              // LEGACY alias of 'Confirmada'
    Archivada:               [],    // Terminal — even SysAdmin cannot un-archive
  },
};

// ---------------------------------------------------------------------------
// APPROVAL_SOURCE_STATES — the only quotation states from which an approval
// or rejection decision (nuevoEstado === 'Aprobada internamente'/'Rechazada'
// via the dedicated /:id/aprobar endpoint) may legally be made. Shared between
// validateTransitionByRole (below) and QuotationStateController.approveQuotation
// so both entry points enforce the exact same source-state guard.
// ---------------------------------------------------------------------------
const APPROVAL_SOURCE_STATES = ['Pendiente', 'En revision', 'En espera'];

// ---------------------------------------------------------------------------
// STATE_TRANSITIONS — flat fallback matrix (used only for reference / tests).
// ROLE_TRANSITIONS is always the authoritative source in the application.
// ---------------------------------------------------------------------------
const STATE_TRANSITIONS = {
  Pendiente:               ['En revision', 'Archivada'],
  'En revision':           ['Aprobada internamente', 'Rechazada', 'Pendiente', 'En espera', 'Archivada'],
  'En espera':             ['Aprobada internamente', 'Rechazada', 'Pendiente', 'Archivada'],
  'Aprobada internamente': ['Enviada al cliente', 'Archivada'],
  'Enviada al cliente':    ['Confirmada', 'Rechazada', 'Archivada'],
  Rechazada:               ['Pendiente', 'Archivada'],
  Confirmada:              ['Archivada'],
  Aceptada:                ['Archivada'],   // LEGACY alias of 'Confirmada'
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
  // formatCorrelativo
  // Shared formatter so the preview, the atomic generator, and the draft-lock
  // reservation can never drift into inconsistent serial formats.
  // Format: "SC-YYYY/NNNNNN" (6-digit zero-padded), matching the historical
  // Excel numbering series the company used before this system existed.
  // ---------------------------------------------------------------------------
  formatCorrelativo(anio, nextNumber) {
    return `SC-${anio}/${String(nextNumber).padStart(6, '0')}`;
  },

  // ---------------------------------------------------------------------------
  // peekNextCorrelativo
  // READ-ONLY preview of what the next serial number will look like.
  // NOT guaranteed to be the actual next value under concurrency — it is
  // purely informational, displayed to the user before they submit the form.
  // No lock is acquired; no row is modified.
  // ---------------------------------------------------------------------------
  async peekNextCorrelativo() {
    const currentYear = new Date().getFullYear();
    const [rows] = await pool.execute(
      'SELECT ultimo_nro FROM cotizaciones_correlativo WHERE anio = ?',
      [currentYear]
    );
    const nextNumber = rows.length === 0 ? 1 : rows[0].ultimo_nro + 1;
    return this.formatCorrelativo(currentYear, nextNumber);
  },

  // ---------------------------------------------------------------------------
  // generateCorrelativo
  // ATOMIC: must be called inside a caller-managed transaction.
  // Acquires a row-level exclusive lock (SELECT … FOR UPDATE) on the
  // cotizaciones_correlativo row for the current year, increments the counter,
  // and returns the formatted serial "SC-YYYY/NNNNNN".
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

    return this.formatCorrelativo(currentYear, nextNumber);
  },

  // ---------------------------------------------------------------------------
  // create — Insert the cotizaciones header inside a caller-managed transaction.
  // Initial state is 'Pendiente' — the only valid initial ENUM value in the DB.
  // ---------------------------------------------------------------------------
  async create(connection, data) {
    const sql = `
      INSERT INTO cotizaciones
        (numero_correlativo, id_cliente, id_ejecutivo, descripcion,
         monto_total, moneda, entidad_emisora, estado, observaciones, fecha_emision, fecha_validez,
         tipo_pedido, tiempo_entrega,
         solicitante_nombre, solicitante_no_solicitud, solicitante_area, solicitante_celular, solicitante_correo,
         equipo_marca, equipo_tipo, equipo_modelo, equipo_serie, equipo_motor,
         descuento_manual, forma_pago, mostrar_codigos)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, 'Pendiente', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await connection.execute(sql, [
      data.numero_correlativo,
      data.id_cliente,
      data.id_ejecutivo,
      data.descripcion,
      data.monto_total              ?? null,
      data.moneda                   || 'BOB',
      data.entidad_emisora          || 'Empresa unipersonal de Ronald Roca Cartagena',
      data.observaciones            || null,
      data.fecha_emision,
      data.fecha_validez            || null,
      data.tipo_pedido              || null,
      data.tiempo_entrega           || null,
      data.solicitante_nombre       || null,
      data.solicitante_no_solicitud || null,
      data.solicitante_area         || null,
      data.solicitante_celular      || null,
      data.solicitante_correo       || null,
      data.equipo_marca             || null,
      data.equipo_tipo              || null,
      data.equipo_modelo            || null,
      data.equipo_serie             || null,
      data.equipo_motor             || null,
      data.descuento_manual         ?? null,
      data.forma_pago               || null,
      data.mostrar_codigos          != null ? (data.mostrar_codigos ? 1 : 0) : 1,
    ]);

    return result.insertId;
  },

  // ---------------------------------------------------------------------------
  // createDetalles — Bulk INSERT line items inside a caller-managed transaction.
  // ---------------------------------------------------------------------------
  async createDetalles(connection, id_cotizacion, detalles) {
    if (!detalles || detalles.length === 0) return;

    // 11 bound params per row
    const placeholders = detalles.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');

    const values = detalles.flatMap((item) => {
      const subtotal = calcularSubtotal(parseFloat(item.cantidad), parseFloat(item.precio_unitario));
      // Truncate codigo to 50 chars max (mirrors VARCHAR(50) DB column)
      const codigoParte = item.codigo
        ? String(item.codigo).trim().substring(0, 50) || null
        : null;
      const codigoAlt = item.codigo_alternativo
        ? String(item.codigo_alternativo).trim().substring(0, 100) || null
        : null;
      const unidad = item.unidad
        ? String(item.unidad).trim().substring(0, 20) || 'UND'
        : 'UND';
      const tiempoEntrega = item.tiempo_entrega
        ? String(item.tiempo_entrega).trim().substring(0, 100) || null
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
        codigoAlt,
        unidad,
        tiempoEntrega,
      ];
    });

    await connection.execute(
      `INSERT INTO cotizacion_detalles
         (id_cotizacion, id_producto, descripcion_item, cantidad, precio_unitario, subtotal,
          marca_id, codigo_parte, codigo_alternativo, unidad, tiempo_entrega)
       VALUES ${placeholders}`,
      values
    );
  },

  // ---------------------------------------------------------------------------
  // updateEditableHeader — Update the editable header fields of an existing
  // quotation inside a caller-managed transaction. Used by the Executive edit
  // flow (PUT /:id). Identity fields (numero_correlativo, id_ejecutivo, estado)
  // and approval metadata are deliberately NOT touchable here.
  // ---------------------------------------------------------------------------
  async updateEditableHeader(connection, id, data) {
    const sql = `
      UPDATE cotizaciones SET
        id_cliente               = ?,
        descripcion              = ?,
        monto_total              = ?,
        moneda                   = ?,
        entidad_emisora          = ?,
        observaciones            = ?,
        fecha_emision            = ?,
        fecha_validez            = ?,
        tipo_pedido              = ?,
        tiempo_entrega           = ?,
        solicitante_nombre       = ?,
        solicitante_no_solicitud = ?,
        solicitante_area         = ?,
        solicitante_celular      = ?,
        solicitante_correo       = ?,
        equipo_marca             = ?,
        equipo_tipo              = ?,
        equipo_modelo            = ?,
        equipo_serie             = ?,
        equipo_motor             = ?,
        descuento_manual         = ?,
        forma_pago               = ?,
        mostrar_codigos          = ?
      WHERE id = ? AND estado = 'Pendiente'
    `;

    const [result] = await connection.execute(sql, [
      data.id_cliente,
      data.descripcion,
      data.monto_total              ?? null,
      data.moneda                   || 'BOB',
      data.entidad_emisora          || 'Empresa unipersonal de Ronald Roca Cartagena',
      data.observaciones            || null,
      data.fecha_emision,
      data.fecha_validez            || null,
      data.tipo_pedido              || null,
      data.tiempo_entrega           || null,
      data.solicitante_nombre       || null,
      data.solicitante_no_solicitud || null,
      data.solicitante_area         || null,
      data.solicitante_celular      || null,
      data.solicitante_correo       || null,
      data.equipo_marca             || null,
      data.equipo_tipo              || null,
      data.equipo_modelo            || null,
      data.equipo_serie             || null,
      data.equipo_motor             || null,
      data.descuento_manual         ?? null,
      data.forma_pago               || null,
      data.mostrar_codigos          != null ? (data.mostrar_codigos ? 1 : 0) : 1,
      id,
    ]);

    return result.affectedRows > 0;
  },

  // ---------------------------------------------------------------------------
  // replaceDetalles — Atomically swap ALL line items of a quotation inside a
  // caller-managed transaction: delete the existing rows, then bulk-insert the
  // new set. Used by the Executive edit flow so a client who only wants 3 of 10
  // items can have the others removed. Reuses createDetalles for the INSERT so
  // sanitation/coercion rules stay in one place.
  // ---------------------------------------------------------------------------
  async replaceDetalles(connection, id_cotizacion, detalles) {
    await connection.execute(
      'DELETE FROM cotizacion_detalles WHERE id_cotizacion = ?',
      [id_cotizacion]
    );
    if (detalles && detalles.length > 0) {
      await this.createDetalles(connection, id_cotizacion, detalles);
    }
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
        cl.telefono        AS cliente_tel,
        cl.direccion       AS cliente_dir,
        cl.ciudad          AS cliente_ciudad,
        c.id_ejecutivo,
        u.nombre_completo   AS ejecutivo_nombre,
        c.descripcion,
        c.monto_total,
        c.moneda,
        c.entidad_emisora,
        c.estado,
        c.pdf_ruta,
        c.excel_ruta,
        c.tipo_pedido,
        c.tiempo_entrega,
        c.observaciones,
        c.fecha_emision,
        c.fecha_validez,
        c.aprobado_por,
        ap.nombre_completo  AS aprobador_nombre,
        c.fecha_aprobacion,
        c.fecha_confirmacion,
        c.obs_aprobacion,
        c.comentarios_admin,
        c.solicitante_nombre       AS nombre_sol,
        c.solicitante_no_solicitud AS nro_solicitud,
        c.solicitante_area         AS area_sol,
        c.solicitante_celular      AS celular_sol,
        c.solicitante_correo       AS correo_sol,
        c.equipo_marca,
        c.equipo_tipo,
        c.equipo_modelo,
        c.equipo_serie,
        c.equipo_motor,
        c.descuento_manual,
        c.forma_pago,
        c.mostrar_codigos,
        c.creado_en,
        c.actualizado_en
      FROM cotizaciones c
      ${BASE_JOINS}
      WHERE c.id = ?
      LIMIT 1
    `;

    // Graceful degradation: if excel_ruta is absent on a legacy DB, retry
    // with NULL so downstream code (PDF/Excel button rendering) degrades
    // cleanly instead of crashing the entire detail view.
    let headerRows;
    try {
      [headerRows] = await pool.execute(sqlHeader, [id]);
    } catch (err) {
      // Graceful degradation for legacy databases that predate one or more
      // optional columns. Rewrite each missing column to a NULL alias and retry
      // so the detail view never crashes on a schema that is behind the code.
      const msg = err.message || '';
      let fallbackSql = sqlHeader;
      let patched = false;
      if (msg.includes("Unknown column 'c.excel_ruta'")) {
        console.warn('[QuotationModel.findById] excel_ruta column missing — retrying without it.');
        fallbackSql = fallbackSql.replace('        c.excel_ruta,\n', '        NULL AS excel_ruta,\n');
        patched = true;
      }
      if (msg.includes("Unknown column 'c.entidad_emisora'")) {
        console.warn('[QuotationModel.findById] entidad_emisora column missing — retrying with default.');
        fallbackSql = fallbackSql.replace('        c.entidad_emisora,\n', "        'Empresa unipersonal de Ronald Roca Cartagena' AS entidad_emisora,\n");
        patched = true;
      }
      if (msg.includes("Unknown column 'c.fecha_confirmacion'")) {
        console.warn('[QuotationModel.findById] fecha_confirmacion column missing — retrying with NULL. ' +
          'Run the ALTER TABLE upgrade in sql/upgrade_2026_fecha_confirmacion.sql to fix this permanently.');
        fallbackSql = fallbackSql.replace('        c.fecha_confirmacion,\n', '        NULL AS fecha_confirmacion,\n');
        patched = true;
      }
      if (msg.includes("Unknown column 'c.descuento_manual'")) {
        console.warn('[QuotationModel.findById] descuento_manual column missing — retrying with NULL.');
        fallbackSql = fallbackSql.replace('        c.descuento_manual,\n', '        NULL AS descuento_manual,\n');
        patched = true;
      }
      if (msg.includes("Unknown column 'c.forma_pago'")) {
        console.warn('[QuotationModel.findById] forma_pago column missing — retrying with NULL.');
        fallbackSql = fallbackSql.replace('        c.forma_pago,\n', '        NULL AS forma_pago,\n');
        patched = true;
      }
      if (msg.includes("Unknown column 'c.mostrar_codigos'")) {
        console.warn('[QuotationModel.findById] mostrar_codigos column missing — retrying with 1.');
        fallbackSql = fallbackSql.replace('        c.mostrar_codigos,\n', '        1 AS mostrar_codigos,\n');
        patched = true;
      }
      if (msg.includes("Unknown column 'c.solicitante_nombre'")) {
        console.warn('[QuotationModel.findById] solicitante_nombre column missing — retrying with NULL.');
        fallbackSql = fallbackSql.replace('        c.solicitante_nombre       AS nombre_sol,\n', '        NULL AS nombre_sol,\n');
        patched = true;
      }
      if (patched) {
        [headerRows] = await pool.execute(fallbackSql, [id]);
      } else {
        throw err;
      }
    }

    if (!headerRows[0]) return null;
    const quotation = headerRows[0];

    // Attach the DATOS BANCARIOS for this quotation's issuing entity so the PDF
    // service can print the correct account dynamically (dynamic bank data).
    // Isolated + self-degrading: if the cuentas_bancarias table does not yet
    // exist on this environment, the fields are left undefined and pdfService
    // falls back to its built-in BANK_ACCOUNTS map. The legacy 'RC Tractoparts'
    // value is mapped to the primary unipersonal entity so old rows resolve too.
    try {
      const entidadLookup = (quotation.entidad_emisora && String(quotation.entidad_emisora).trim()) === 'RC Tractoparts'
        ? 'Empresa unipersonal de Ronald Roca Cartagena'
        : quotation.entidad_emisora;
      const [bankRows] = await pool.execute(
        `SELECT beneficiario, banco, numero_cuenta
           FROM cuentas_bancarias
          WHERE entidad_emisora = ?
          LIMIT 1`,
        [entidadLookup]
      );
      if (bankRows[0]) {
        quotation.banco_beneficiario = bankRows[0].beneficiario;
        quotation.banco_nombre       = bankRows[0].banco;
        quotation.banco_cuenta       = bankRows[0].numero_cuenta;
      }
    } catch (bankErr) {
      // Non-fatal: table missing on a legacy DB, or any lookup failure. The PDF
      // service degrades gracefully to its built-in per-entity bank map.
      if (!/doesn't exist|Unknown table|no such table/i.test(bankErr.message || '')) {
        console.warn('[QuotationModel.findById] Bank data lookup failed (non-fatal):', bankErr.message);
      }
    }

    const sqlDetalles = `
      SELECT
        d.id,
        d.id_producto,
        p.codigo          AS producto_codigo,
        d.codigo_parte,
        d.codigo_alternativo,
        d.unidad,
        d.tiempo_entrega,
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
  // updateExcelPath — Persist the relative file path of the linked Excel sheet.
  // Pass null to clear an existing reference.
  // @param {number}      id        - Quotation primary key
  // @param {string|null} excelRuta - Relative path or null
  // @returns {boolean}             - true if the row was updated
  // ---------------------------------------------------------------------------
  async updateExcelPath(id, excelRuta) {
    const [result] = await pool.execute(
      'UPDATE cotizaciones SET excel_ruta = ? WHERE id = ?',
      [excelRuta || null, id]
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
    // Escape LIKE metacharacters so user-supplied text (e.g. "50% off", "item_1")
    // does not silently expand into a wildcard and produce false positives.
    const escapeLike = (s) => s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    const descSnippet = escapeLike(descripcion.substring(0, 50));
    const [rows] = await pool.execute(
      `SELECT id, numero_correlativo, fecha_emision, estado
       FROM cotizaciones
       WHERE id_cliente = ?
         AND descripcion  LIKE ? ESCAPE '\\\\'
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

    // Primary query: includes excel_ruta column (present in all up-to-date schemas).
    // If the column does not yet exist on a legacy staging database that has not
    // been migrated, MySQL throws "Unknown column 'c.excel_ruta' in 'field list'".
    // The catch block detects this specific error and retries with a fallback query
    // that omits the column, mapping tiene_excel to a constant FALSE so callers
    // receive a consistent row shape. Run the ALTER TABLE migration in init.sql to
    // permanently resolve the issue on any affected database instance.
    const buildSql = (includeExcel) => `
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
        c.pdf_ruta   IS NOT NULL AS tiene_pdf,
        ${includeExcel
          ? 'c.excel_ruta IS NOT NULL AS tiene_excel,'
          : 'FALSE                    AS tiene_excel,'}
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
    try {
      const [rows] = await pool.execute(buildSql(true), whereValues);
      return rows;
    } catch (err) {
      // Graceful degradation: if the column is absent on a legacy DB, retry
      // without it so the rest of the application continues to function.
      if (err.message && err.message.includes("Unknown column 'c.excel_ruta'")) {
        console.warn('[QuotationModel.findAll] excel_ruta column missing — retrying without it. ' +
          'Run the ALTER TABLE migration in init.sql to fix this permanently.');
        const [rows] = await pool.execute(buildSql(false), whereValues);
        return rows;
      }
      throw err;
    }
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
        'Enviada al cliente', 'Confirmada', 'Aceptada', 'Rechazada', 'Archivada'
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
  // @param {string}  estadoActual          - Current state of the quotation
  // @param {string}  nuevoEstado           - Target state requested by the caller
  // @param {string}  rol                   - Calling user's role name
  // @param {boolean} canApproveQuotations  - Delegación de Funciones flag for the
  //                                          calling user (usuarios.can_approve_quotations).
  //                                          Defaults to false so all existing
  //                                          callers keep their exact behavior.
  //
  // @returns {{ valid: boolean, reason?: string, allowedTransitions?: string[] }}
  // ---------------------------------------------------------------------------
  validateTransitionByRole(estadoActual, nuevoEstado, rol, canApproveQuotations = false) {
    // ── Delegación de Funciones AMPLIADA ────────────────────────────────────
    // An Ejecutivo holding the can_approve_quotations flag operates the FULL
    // quotation lifecycle with the Jefe's transition matrix (aprobar, enviar,
    // confirmar, solicitar cambios, en espera, rechazar). They remain an
    // 'Ejecutivo' everywhere else — user management, audit logs and every other
    // route enforce the base role via middleware and never consult this matrix.
    // The flag is re-read fresh from the DB by the controller on every call, so
    // revoking it takes effect immediately without waiting for JWT expiry.
    const effectiveRol = (rol === 'Ejecutivo' && canApproveQuotations === true) ? 'Jefe' : rol;
    const roleMatrix = ROLE_TRANSITIONS[effectiveRol];

    // Rol desconocido — no debería llegar aquí si el middleware de autenticación está activo
    if (!roleMatrix) {
      return {
        valid:  false,
        reason: `El rol '${rol}' no está reconocido en la máquina de estados del sistema.`,
      };
    }

    const allowedFromState = roleMatrix[estadoActual] || [];

    // ── Dynamic Function Delegation (Delegación de Funciones) ──────────────────
    // A transition to 'Aprobada internamente' is authorized when the caller is a
    // Jefe (id_rol 3) or SysAdmin (superuser) — OR any user holding the delegated
    // can_approve_quotations flag — provided the source state is one of the
    // legitimate pre-approval states. Administracion is intentionally EXCLUDED
    // here: per ROLE_TRANSITIONS.Administracion above, approval authority
    // belongs exclusively to the Jefe unless explicitly delegated via the flag
    // (an Administracion user without the flag must not be able to approve).
    // This is strictly ADDITIVE: it only ever GRANTS the single
    // 'Aprobada internamente' target and never removes a transition the base
    // role already had, so the audited core lifecycle is preserved.
    const isDelegatedApproval =
      nuevoEstado === 'Aprobada internamente' &&
      APPROVAL_SOURCE_STATES.includes(estadoActual) &&
      (rol === 'Jefe' || rol === 'SysAdmin' || canApproveQuotations === true);

    if (isDelegatedApproval) {
      return {
        valid:              true,
        allowedTransitions: Array.from(new Set([...allowedFromState, 'Aprobada internamente'])),
      };
    }

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
  // @param {boolean} canApproveQuotations - Delegación de Funciones flag (forwarded to the guard)
  // @returns {boolean}               - true if the row was updated
  // ---------------------------------------------------------------------------
  async updateStatus(id, nuevoEstado, estadoActual, rol, comentarioAdmin = null, canApproveQuotations = false, aprobadoPor = null) {
    // Defense-in-depth: re-validate the role-based transition inside the model
    const check = this.validateTransitionByRole(estadoActual, nuevoEstado, rol, canApproveQuotations);

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
    // Build the SET clause dynamically so a single atomic UPDATE can carry the
    // state change, the optional admin comment, and the sale-closure timestamp.
    const setClauses = ['estado = ?'];
    const params     = [nuevoEstado];

    if (comentarioAdmin !== null && comentarioAdmin !== undefined) {
      setClauses.push('comentarios_admin = ?');
      params.push(String(comentarioAdmin).trim() || null);
    }

    // Sale-closure timestamp: stamp the EXACT moment the quotation becomes
    // 'Confirmada' (venta cerrada). 'Aceptada' is the legacy alias of the same
    // terminal outcome, handled defensively. 'Confirmada' is near-terminal (only
    // → 'Archivada'), so this is written exactly once and never overwritten.
    if (nuevoEstado === 'Confirmada' || nuevoEstado === 'Aceptada') {
      setClauses.push('fecha_confirmacion = NOW()');
    }

    // Approval traceability: when the target is 'Aprobada internamente' and the
    // controller supplied the acting user's id, record WHO approved and WHEN —
    // exactly like the dedicated POST /:id/aprobar endpoint does. This closes
    // the metadata gap for approvals executed through this generic transition
    // route (delegated executives, or a Jefe using the state endpoint directly).
    if (nuevoEstado === 'Aprobada internamente' && aprobadoPor != null) {
      setClauses.push('aprobado_por = ?', 'fecha_aprobacion = NOW()');
      params.push(aprobadoPor);
    }

    const sql = `UPDATE cotizaciones SET ${setClauses.join(', ')} WHERE id = ? AND estado = ?`;
    params.push(id, estadoActual);

    const [result] = await pool.execute(sql, params);
    return result.affectedRows > 0;
  },

  // ---------------------------------------------------------------------------
  // approve (HU08 — Jefe / SysAdmin approval/rejection)
  // Dedicated method for the approval workflow. Records the decision, the
  // approver's identity, the timestamp, and the mandatory observation text.
  //
  // The caller (QuotationStateController.approveQuotation) validates that
  // `currentState` is one of APPROVAL_SOURCE_STATES before invoking this
  // method — this function itself enforces no state restriction. The WHERE
  // clause uses the caller-supplied `currentState` for optimistic concurrency
  // — it guarantees that two concurrent requests for the same quotation
  // cannot both succeed.
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
  // insertNotificacion — Writes a targeted notification into the `notificaciones`
  // table. Called after Jefe approves ('Aprobada internamente') or sends the
  // quotation to the client ('Enviada al cliente'). Non-fatal: callers wrap in
  // try/catch so an INSERT failure never rolls back the main state transition.
  //
  // @param {Object} params
  //   id_usuario     {number}  — Recipient Ejecutivo's user ID
  //   id_cotizacion  {number}  — Quotation primary key
  //   tipo           {string}  — 'aprobacion' | 'envio_cliente'
  //   mensaje        {string}  — Human-readable message for the Ejecutivo
  // ---------------------------------------------------------------------------
  async insertNotificacion({ id_usuario, id_cotizacion, tipo, mensaje }) {
    await pool.execute(
      `INSERT INTO notificaciones (id_usuario, id_cotizacion, tipo, mensaje)
       VALUES (?, ?, ?, ?)`,
      [
        parseInt(id_usuario,    10),
        parseInt(id_cotizacion, 10),
        tipo,
        String(mensaje).substring(0, 1000), // cap to prevent runaway payloads
      ]
    );
  },

  // ---------------------------------------------------------------------------
  // findNotificacionesEjecutivo — Returns all unread notifications from the
  // `notificaciones` table that target the given Ejecutivo. Shapes each row to
  // match the field names expected by getNotificaciones / notificationsView.js
  // so the frontend can render both correction and approval alerts uniformly.
  // ---------------------------------------------------------------------------
  async findNotificacionesEjecutivo(id_ejecutivo) {
    const sql = `
      SELECT
        n.id                AS notificacion_id,
        n.tipo,
        n.mensaje           AS observacion,
        n.creado_en         AS fecha_solicitud,
        c.id                AS id_cotizacion,
        c.numero_correlativo,
        cl.razon_social     AS cliente_nombre,
        u.nombre_completo   AS solicitado_por,
        u.nombre_completo   AS rol_solicitante
      FROM notificaciones n
      INNER JOIN cotizaciones c  ON c.id  = n.id_cotizacion
      INNER JOIN clientes    cl  ON cl.id = c.id_cliente
      INNER JOIN usuarios    u   ON u.id  = c.id_ejecutivo
      WHERE n.id_usuario = ?
        AND n.leida      = 0
      ORDER BY n.creado_en DESC
    `;

    const [rows] = await pool.execute(sql, [parseInt(id_ejecutivo, 10)]);
    return rows;
  },

  // ---------------------------------------------------------------------------
  // markNotificacionesLeidas — Marks all unread notifications for a given
  // Ejecutivo as read. Called when the Ejecutivo opens the notification modal
  // so the badge count resets after they have acknowledged the alerts.
  // ---------------------------------------------------------------------------
  async markNotificacionesLeidas(id_ejecutivo) {
    await pool.execute(
      `UPDATE notificaciones SET leida = 1
       WHERE id_usuario = ? AND leida = 0`,
      [parseInt(id_ejecutivo, 10)]
    );
  },

  // ---------------------------------------------------------------------------
  // getProgreso — Analytics for the Jefe / Administracion / SysAdmin dashboard,
  // scoped to a [fechaDesde, fechaHasta] date range (inclusive).
  // Returns three data sets in a single DB round-trip:
  //   1. total_mes_usd     — Sum of monto_total (USD) within the range
  //   2. conversion_ratio  — COUNT(Confirmada) / (COUNT(Confirmada) + COUNT(Rechazada))
  //   3. por_ejecutivo     — Per-executive breakdown of all states in the range
  //
  // @param {string} fechaDesde — 'YYYY-MM-DD' inclusive lower bound
  // @param {string} fechaHasta — 'YYYY-MM-DD' inclusive upper bound
  // ---------------------------------------------------------------------------
  async getProgreso(fechaDesde, fechaHasta) {
    // fecha_emision is a DATE column, so BETWEEN is an inclusive [desde, hasta]
    // range. The controller always resolves a concrete range (defaulting to the
    // current month) so every query here filters by the same window.
    const rangeParams = [fechaDesde, fechaHasta];

    // Volume within the selected range
    const [volumenRows] = await pool.execute(`
      SELECT
        SUM(CASE WHEN moneda = 'USD' THEN monto_total ELSE 0 END) AS total_mes_usd,
        SUM(CASE WHEN moneda = 'BOB' THEN monto_total ELSE 0 END) AS total_mes_bob,
        COUNT(*)                                                   AS total_cotizaciones
      FROM cotizaciones
      WHERE fecha_emision BETWEEN ? AND ?
    `, rangeParams);

    // Conversion ratio within the selected range.
    // Counts both 'Confirmada' (current) and legacy 'Aceptada' rows.
    const [conversionRows] = await pool.execute(`
      SELECT
        SUM(CASE WHEN estado IN ('Confirmada', 'Aceptada') THEN 1 ELSE 0 END) AS total_aceptadas,
        SUM(CASE WHEN estado = 'Rechazada' THEN 1 ELSE 0 END) AS total_rechazadas
      FROM cotizaciones
      WHERE estado IN ('Confirmada', 'Aceptada', 'Rechazada')
        AND fecha_emision BETWEEN ? AND ?
    `, rangeParams);

    // Per-executive breakdown within the selected range
    const [porEjecutivoRows] = await pool.execute(`
      SELECT
        u.nombre_completo                                              AS ejecutivo,
        COUNT(*)                                                       AS total,
        SUM(CASE WHEN c.estado IN ('Confirmada', 'Aceptada') THEN 1 ELSE 0 END) AS aceptadas,
        SUM(CASE WHEN c.estado = 'Rechazada' THEN 1 ELSE 0 END)      AS rechazadas,
        SUM(CASE WHEN c.estado = 'Pendiente' THEN 1 ELSE 0 END)      AS pendientes,
        SUM(CASE WHEN c.estado = 'En revision' THEN 1 ELSE 0 END)    AS en_revision,
        SUM(CASE WHEN c.moneda = 'USD' THEN c.monto_total ELSE 0 END) AS volumen_usd
      FROM cotizaciones c
      INNER JOIN usuarios u ON u.id = c.id_ejecutivo
      WHERE c.fecha_emision BETWEEN ? AND ?
      GROUP BY c.id_ejecutivo, u.nombre_completo
      ORDER BY volumen_usd DESC
    `, rangeParams);

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
  // getAdvancedReports — Deep business intelligence metrics (HU-BI01)
  //
  // Returns two analytics datasets shaped for the frontend BI dashboard:
  //   • top_clientes     — Top 10 clients ranked by accepted/sent revenue
  //   • leaderboard      — Per-executive leaderboard (all-time)
  //
  // Row-Level Security:
  //   When ejecutivoId is supplied (non-null), ALL queries are filtered to
  //   that specific ejecutivo only — no aggregate company-wide data leaks to
  //   executives. Managers (null ejecutivoId) receive the full company view.
  //
  // @param {number|null} ejecutivoId — Pass req.user.id for Ejecutivo role,
  //                                    null for Jefe / Administracion / SysAdmin.
  // @param {string|null} fechaDesde  — Optional 'YYYY-MM-DD' inclusive lower bound.
  // @param {string|null} fechaHasta  — Optional 'YYYY-MM-DD' inclusive upper bound.
  //                                    The range applies only when BOTH are set.
  // ===========================================================================
  async getAdvancedReports(ejecutivoId = null, fechaDesde = null, fechaHasta = null) {
    const isEjecutivo = ejecutivoId != null;
    const hasRange    = fechaDesde != null && fechaHasta != null;

    // Build the shared dynamic filters (executive row-level isolation + an
    // optional [fechaDesde, fechaHasta] range) as reusable clause/param pairs.
    // The date range is only applied when BOTH bounds are present, so the
    // executive personal dashboard (no dates) keeps its all-time behaviour.
    const buildFilters = () => {
      const clauses = [];
      const params  = [];
      if (isEjecutivo) { clauses.push('c.id_ejecutivo = ?');            params.push(ejecutivoId); }
      if (hasRange)    { clauses.push('c.fecha_emision BETWEEN ? AND ?'); params.push(fechaDesde, fechaHasta); }
      return { clauses, params };
    };

    // ── Top 10 Clients ──────────────────────────────────────────────────────
    // For Jefe/Admin: company-wide, all executives.
    // For Ejecutivo: restricted to their own accepted/sent quotations.
    const tc      = buildFilters();
    const tcExtra = tc.clauses.length ? ' AND ' + tc.clauses.join(' AND ') : '';
    const topClientesSql = `
        SELECT
          cl.razon_social                               AS cliente,
          cl.nit                                        AS nit,
          COUNT(c.id)                                   AS proformas_emitidas,
          SUM(CASE WHEN c.moneda = 'USD' THEN c.monto_total ELSE 0 END) AS total_usd,
          SUM(CASE WHEN c.moneda = 'BOB' THEN c.monto_total ELSE 0 END) AS total_bob
        FROM cotizaciones c
        INNER JOIN clientes cl ON cl.id = c.id_cliente
        WHERE c.estado IN ('Confirmada', 'Aceptada', 'Enviada al cliente')${tcExtra}
        GROUP BY c.id_cliente, cl.razon_social, cl.nit
        ORDER BY total_usd DESC
        LIMIT 10`;
    const [topClientesRows] = await pool.execute(topClientesSql, tc.params);

    // ── Executive Leaderboard ───────────────────────────────────────────────
    // Aggregates over the range: total created, total approved by Jefe, revenue.
    // When the caller is an Ejecutivo, the leaderboard is scoped to themselves
    // (returns a single-row personal summary rather than a company leaderboard).
    const lb      = buildFilters();
    const lbWhere = lb.clauses.length ? 'WHERE ' + lb.clauses.join(' AND ') : '';
    const leaderboardSql = `
        SELECT
          u.nombre_completo                                                AS ejecutivo,
          COUNT(c.id)                                                      AS total_creadas,
          SUM(CASE WHEN c.estado IN ('Aprobada internamente',
                                     'Enviada al cliente',
                                     'Confirmada',
                                     'Aceptada')         THEN 1 ELSE 0 END) AS total_aprobadas,
          SUM(CASE WHEN c.moneda = 'USD' THEN c.monto_total ELSE 0 END)   AS total_usd,
          SUM(CASE WHEN c.moneda = 'BOB' THEN c.monto_total ELSE 0 END)   AS total_bob
        FROM cotizaciones c
        INNER JOIN usuarios u ON u.id = c.id_ejecutivo
        ${lbWhere}
        GROUP BY c.id_ejecutivo, u.nombre_completo
        ORDER BY total_usd DESC`;
    const [leaderboardRows] = await pool.execute(leaderboardSql, lb.params);

    // Post-process leaderboard: compute approval rate safely (avoid / 0)
    const leaderboard = leaderboardRows.map((row) => {
      const creadas    = parseInt(row.total_creadas   || 0, 10);
      const aprobadas  = parseInt(row.total_aprobadas || 0, 10);
      const tasa       = creadas > 0 ? ((aprobadas / creadas) * 100).toFixed(1) : '0.0';
      return {
        ejecutivo:      row.ejecutivo,
        total_creadas:  creadas,
        total_aprobadas: aprobadas,
        tasa_aprobacion: tasa,
        total_usd:      parseFloat(row.total_usd || 0).toFixed(2),
        total_bob:      parseFloat(row.total_bob || 0).toFixed(2),
      };
    });

    // ── Clientes por Origen ─────────────────────────────────────────────────
    // Manager-only breakdown (never computed for the Ejecutivo's personal
    // report — "solo sus cotizaciones y nada más" per business rule): how many
    // active clients fall into each origen_cliente bucket, and the revenue
    // (within the selected date range, if any) attributed to each bucket.
    // total_clientes counts ALL active clients regardless of date range (it's
    // a client-attribute snapshot, not a period metric); total_usd/total_bob
    // stay period-scoped like the rest of the report.
    let clientesPorOrigen = [];
    if (!isEjecutivo) {
      const origenDateClause = hasRange ? 'AND c.fecha_emision BETWEEN ? AND ?' : '';
      const origenParams     = hasRange ? [fechaDesde, fechaHasta] : [];
      const origenSql = `
          SELECT
            COALESCE(oc.nombre, 'Sin clasificar')                         AS origen,
            COUNT(DISTINCT cl.id)                                         AS total_clientes,
            SUM(CASE WHEN c.moneda = 'USD' THEN c.monto_total ELSE 0 END) AS total_usd,
            SUM(CASE WHEN c.moneda = 'BOB' THEN c.monto_total ELSE 0 END) AS total_bob
          FROM clientes cl
          LEFT JOIN origenes_cliente oc ON oc.id = cl.id_origen_cliente
          LEFT JOIN cotizaciones c
                 ON c.id_cliente = cl.id
                AND c.estado IN ('Confirmada', 'Aceptada', 'Enviada al cliente')
                ${origenDateClause}
          WHERE cl.activo = 1
          GROUP BY oc.id, origen
          ORDER BY total_clientes DESC`;
      const [origenRows] = await pool.execute(origenSql, origenParams);
      clientesPorOrigen = origenRows.map((r) => ({
        origen:         r.origen,
        total_clientes: parseInt(r.total_clientes || 0, 10),
        total_usd:      parseFloat(r.total_usd || 0).toFixed(2),
        total_bob:      parseFloat(r.total_bob || 0).toFixed(2),
      }));
    }

    return {
      top_clientes: topClientesRows.map((r) => ({
        cliente:           r.cliente,
        nit:               r.nit ?? '—',
        proformas_emitidas: parseInt(r.proformas_emitidas || 0, 10),
        total_usd:         parseFloat(r.total_usd || 0).toFixed(2),
        total_bob:         parseFloat(r.total_bob || 0).toFixed(2),
      })),
      leaderboard,
      clientes_por_origen: clientesPorOrigen,
    };
  },

  // ===========================================================================
  // Exported constants (used by controllers, routes, and tests)
  // ===========================================================================
  VALID_STATES,
  STATE_TRANSITIONS,
  ROLE_TRANSITIONS,
  APPROVAL_SOURCE_STATES,
  SORTABLE_COLUMNS,
};

module.exports = QuotationModel;
