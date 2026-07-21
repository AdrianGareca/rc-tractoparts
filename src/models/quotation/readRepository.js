// =============================================================================
// src/models/quotation/readRepository.js
// Read operations on cotizaciones: full detail lookup, the paginated/filtered/
// sorted listing and its COUNT twin, the per-state summary, the Jefe's approval
// queue, and the RF06 duplicate check.
// =============================================================================

'use strict';

const { pool } = require('../../config/db');
const { BASE_JOINS, SORTABLE_COLUMNS } = require('./constants');
const { buildWhereClause } = require('./whereBuilder');

// ---------------------------------------------------------------------------
// findById — Full quotation detail including line items and approval metadata.
// ---------------------------------------------------------------------------
async function findById(id) {
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
}

// ---------------------------------------------------------------------------
// checkDuplicate — RF06: detect similar quotations within 30 days.
// ---------------------------------------------------------------------------
async function checkDuplicate(id_cliente, descripcion) {
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
}

// ---------------------------------------------------------------------------
// findAll — Paginated, filtered, and sorted listing.
//
// @param {Object} filters    - Filter criteria (see whereBuilder.js)
// @param {Object} pagination - { page: number, limit: number }
// @param {Object} sort       - { by: string, order: 'ASC'|'DESC' }
// @returns {Array<Object>}
// ---------------------------------------------------------------------------
async function findAll(filters = {}, pagination = {}, sort = {}) {
  const page   = Math.max(1, parseInt(pagination.page,  10) || 1);
  const limit  = Math.min(100, Math.max(1, parseInt(pagination.limit, 10) || 20));
  const offset = (page - 1) * limit;

  const sortColumn = SORTABLE_COLUMNS[sort.by] || 'c.creado_en';
  const sortOrder  = sort.order === 'ASC' ? 'ASC' : 'DESC';

  const { clause: whereClause, values: whereValues } = buildWhereClause(filters);

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
}

// ---------------------------------------------------------------------------
// countAll — COUNT(*) with the same WHERE as findAll.
// Run in parallel with findAll via Promise.all to avoid sequential latency.
// ---------------------------------------------------------------------------
async function countAll(filters = {}) {
  const { clause: whereClause, values: whereValues } = buildWhereClause(filters);

  const sql = `
      SELECT COUNT(*) AS total
      FROM cotizaciones c
      ${BASE_JOINS}
      ${whereClause}
    `;

  const [rows] = await pool.execute(sql, whereValues);
  return rows[0].total;
}

// ---------------------------------------------------------------------------
// findSummaryByState — Quotation counts grouped by estado.
// FIELD() enforces the canonical state-machine ordering in the result set.
// ---------------------------------------------------------------------------
async function findSummaryByState(id_ejecutivo = null) {
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
}

// ---------------------------------------------------------------------------
// findPendingApproval — Jefe's approval queue: all quotations that require a
// decision ('Pendiente', 'En revision', 'En espera'), ordered oldest-first so
// the backlog is cleared chronologically.
// ---------------------------------------------------------------------------
async function findPendingApproval() {
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
}

module.exports = {
  findById,
  checkDuplicate,
  findAll,
  countAll,
  findSummaryByState,
  findPendingApproval,
};
