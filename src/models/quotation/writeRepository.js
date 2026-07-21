// =============================================================================
// src/models/quotation/writeRepository.js
// Write operations on cotizaciones and cotizacion_detalles: header INSERT /
// UPDATE, line-item bulk INSERT / replacement, and the small single-column
// updates (pdf_ruta, excel_ruta, comentarios_admin).
//
// Every method taking a `connection` argument must be called inside a
// caller-managed transaction.
// =============================================================================

'use strict';

const { pool } = require('../../config/db');
const { calcularSubtotal } = require('../../utils/quotationTotals');

// ---------------------------------------------------------------------------
// create — Insert the cotizaciones header inside a caller-managed transaction.
// Initial state is 'Pendiente' — the only valid initial ENUM value in the DB.
// ---------------------------------------------------------------------------
async function create(connection, data) {
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
}

// ---------------------------------------------------------------------------
// createDetalles — Bulk INSERT line items inside a caller-managed transaction.
// ---------------------------------------------------------------------------
async function createDetalles(connection, id_cotizacion, detalles) {
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
}

// ---------------------------------------------------------------------------
// updateEditableHeader — Update the editable header fields of an existing
// quotation inside a caller-managed transaction. Used by the Executive edit
// flow (PUT /:id). Identity fields (numero_correlativo, id_ejecutivo, estado)
// and approval metadata are deliberately NOT touchable here.
// ---------------------------------------------------------------------------
async function updateEditableHeader(connection, id, data) {
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
}

// ---------------------------------------------------------------------------
// replaceDetalles — Atomically swap ALL line items of a quotation inside a
// caller-managed transaction: delete the existing rows, then bulk-insert the
// new set. Used by the Executive edit flow so a client who only wants 3 of 10
// items can have the others removed. Reuses createDetalles for the INSERT so
// sanitation/coercion rules stay in one place.
// ---------------------------------------------------------------------------
async function replaceDetalles(connection, id_cotizacion, detalles) {
  await connection.execute(
    'DELETE FROM cotizacion_detalles WHERE id_cotizacion = ?',
    [id_cotizacion]
  );
  if (detalles && detalles.length > 0) {
    await createDetalles(connection, id_cotizacion, detalles);
  }
}

// ---------------------------------------------------------------------------
// updatePdfPath — Persist the relative file path of the linked PDF.
// ---------------------------------------------------------------------------
async function updatePdfPath(id, pdfRuta) {
  const [result] = await pool.execute(
    'UPDATE cotizaciones SET pdf_ruta = ? WHERE id = ?',
    [pdfRuta, id]
  );
  return result.affectedRows > 0;
}

// ---------------------------------------------------------------------------
// updateExcelPath — Persist the relative file path of the linked Excel sheet.
// Pass null to clear an existing reference.
// @param {number}      id        - Quotation primary key
// @param {string|null} excelRuta - Relative path or null
// @returns {boolean}             - true if the row was updated
// ---------------------------------------------------------------------------
async function updateExcelPath(id, excelRuta) {
  const [result] = await pool.execute(
    'UPDATE cotizaciones SET excel_ruta = ? WHERE id = ?',
    [excelRuta || null, id]
  );
  return result.affectedRows > 0;
}

// ---------------------------------------------------------------------------
// updateComentarioAdmin — Persist the Administracion supervisor review comment.
// Called both standalone (PATCH endpoint) and together with a state transition.
// @param {number} id        - Quotation primary key
// @param {string} comment   - Comment text (null to clear)
// @returns {boolean}        - true if the row was updated
// ---------------------------------------------------------------------------
async function updateComentarioAdmin(id, comment) {
  const [result] = await pool.execute(
    'UPDATE cotizaciones SET comentarios_admin = ? WHERE id = ?',
    [comment || null, id]
  );
  return result.affectedRows > 0;
}

module.exports = {
  create,
  createDetalles,
  updateEditableHeader,
  replaceDetalles,
  updatePdfPath,
  updateExcelPath,
  updateComentarioAdmin,
};
