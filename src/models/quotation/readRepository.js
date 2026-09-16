// =============================================================================
// src/models/quotation/readRepository.js
// Read operations on cotizaciones: full detail lookup, the paginated/filtered/
// sorted listing and its COUNT twin, the per-state summary, the Jefe's approval
// queue, and the RF06 duplicate check.
// =============================================================================

'use strict';

const { pool } = require('../../config/db');
const { BASE_JOINS, SORTABLE_COLUMNS } = require('./constants');
const { buildWhereClause, necesitaClientes } = require('./whereBuilder');

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
        c.id_licitacion,
        c.estado_venta,
        c.estado_venta_detalle,
        c.fecha_proximo_seguimiento,
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

  // LIMIT and OFFSET are embedded as SQL literals (not bound params) because
  // mysql2 v3 prepared statements mistype them as DOUBLE, causing
  // "Incorrect arguments to mysqld_stmt_execute". Both values are
  // validated integers (Math.min / Math.max / parseInt) so this is safe.
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
        c.pdf_ruta   IS NOT NULL AS tiene_pdf,
        c.excel_ruta IS NOT NULL AS tiene_excel,
        c.id_licitacion,
        c.fecha_emision,
        c.fecha_validez,
        c.aprobado_por,
        ap.nombre_completo   AS aprobador_nombre,
        c.fecha_aprobacion,
        c.estado_venta,
        c.estado_venta_detalle,
        c.fecha_proximo_seguimiento,
        c.creado_en,
        c.actualizado_en
      FROM cotizaciones c
      ${BASE_JOINS}
      ${whereClause}
      ORDER BY ${sortColumn} ${sortOrder}
      LIMIT ${limit} OFFSET ${offset}
    `;

  const [rows] = await pool.execute(sql, whereValues);
  return rows;
}

// ---------------------------------------------------------------------------
// countAll — COUNT(*) with the same WHERE as findAll.
// Run in parallel with findAll via Promise.all to avoid sequential latency.
//
// POR QUE NO USA BASE_JOINS
// Antes unía clientes, usuarios y el aprobador para contar, aunque ningún
// filtro los mirara. Esas uniones no pueden cambiar el número: id_cliente e
// id_ejecutivo son NOT NULL con clave foránea (la fila del otro lado existe
// siempre) y el aprobador es un LEFT JOIN por clave primaria (nunca duplica).
// Pero sí cambian el costo: con 40.000 cotizaciones el conteo sin filtros
// tardaba ~360 ms y se paga en cada carga de «Todas las cotizaciones» y en el
// badge de «Cotizaciones del equipo» de cada ejecutivo. Sin las uniones, MySQL
// cuenta sobre un índice. Medido en la ronda de estrés del 2026-09-15.
//
// clientes sólo se une cuando un filtro lo necesita (q, razon_social, nit).
// ---------------------------------------------------------------------------
async function countAll(filters = {}) {
  const { clause: whereClause, values: whereValues } = buildWhereClause(filters);
  const joinClientes = necesitaClientes(filters) ? 'INNER JOIN clientes cl ON cl.id = c.id_cliente' : '';

  const sql = `
      SELECT COUNT(*) AS total
      FROM cotizaciones c
      ${joinClientes}
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
//
// PAGINADA desde la ronda de estrés del 2026-09-15. Antes devolvía la cola
// ENTERA en una respuesta: con 40.000 cotizaciones eran 11.630 filas y 3,7 MB
// que el navegador tenía que dibujar de una vez. Y la cola crece sola: una
// cotización que nadie archiva se queda en Pendiente para siempre (la base
// local ya tenía 97 de 152). Decisión de Adrian: paginarla como los demás
// listados.
//
// El orden lleva `c.id` como desempate: dos cotizaciones creadas en el mismo
// segundo tienen el mismo creado_en, y sin un segundo criterio MySQL puede
// devolverlas en distinto orden en cada página — una fila aparecería dos veces
// y otra nunca.
// ---------------------------------------------------------------------------
const ESTADOS_EN_COLA = "'Pendiente', 'En revision', 'En espera'";

// countPendingApproval — cuántas cotizaciones hay en la cola completa: el número
// que muestra el título «Cola de aprobación (N)», no el de la página.
async function countPendingApproval() {
  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS total FROM cotizaciones c WHERE c.estado IN (${ESTADOS_EN_COLA})`
  );
  return rows[0].total;
}

// findPendingApproval — una página de la cola, de la cotización más antigua a la
// más nueva. page y limit se sanean acá (limit entre 1 y 100, 50 por defecto).
async function findPendingApproval(pagination = {}) {
  const page   = Math.max(1, parseInt(pagination.page,  10) || 1);
  const limit  = Math.min(100, Math.max(1, parseInt(pagination.limit, 10) || 50));
  const offset = (page - 1) * limit;

  // LIMIT/OFFSET como literales enteros ya validados: mismo motivo que findAll.
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
      WHERE c.estado IN (${ESTADOS_EN_COLA})
      ORDER BY c.creado_en ASC, c.id ASC
      LIMIT ${limit} OFFSET ${offset}
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
  countPendingApproval,
};
