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
  // id_licitacion es una columna OPCIONAL y NUEVA. Solo se incluye en el INSERT
  // cuando la cotización se vincula a una licitación, de modo que el alta normal
  // (cotización suelta) siga funcionando idéntica en una BD que aún no corrió
  // sql/upgrade_2026_licitaciones.sql (donde la columna todavía no existe).
  const extraCols   = [];
  const extraVals   = [];
  const extraParams = [];
  if (data.id_licitacion != null) {
    extraCols.push('id_licitacion');
    extraVals.push('?');
    extraParams.push(parseInt(data.id_licitacion, 10));
  }

  const sql = `
    INSERT INTO cotizaciones
      (numero_correlativo, id_cliente, id_ejecutivo, descripcion,
       monto_total, moneda, entidad_emisora, estado, observaciones, fecha_emision, fecha_validez,
       tipo_pedido, tiempo_entrega,
       solicitante_nombre, solicitante_no_solicitud, solicitante_area, solicitante_celular, solicitante_correo,
       equipo_marca, equipo_tipo, equipo_modelo, equipo_serie, equipo_motor,
       descuento_manual, forma_pago, mostrar_codigos${extraCols.length ? ', ' + extraCols.join(', ') : ''})
    VALUES
      (?, ?, ?, ?, ?, ?, ?, 'Pendiente', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${extraVals.length ? ', ' + extraVals.join(', ') : ''})
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
    ...extraParams,
  ]);

  return result.insertId;
}

// ---------------------------------------------------------------------------
// _idsFaltantes — de la lista `ids` (ya sin null/duplicados), cuáles NO
// existen en `tabla`. Una sola consulta con WHERE id IN (...) por tabla, no
// una por ítem. `tabla` siempre es un literal fijo llamado desde este mismo
// archivo ('productos' o 'marcas') — nunca entrada de usuario.
// ---------------------------------------------------------------------------
async function _idsFaltantes(connection, tabla, ids) {
  if (ids.length === 0) return new Set();

  const placeholders = ids.map(() => '?').join(', ');
  const [rows] = await connection.execute(
    `SELECT id FROM ${tabla} WHERE id IN (${placeholders})`,
    ids
  );
  const existentes = new Set(rows.map((r) => r.id));
  return new Set(ids.filter((id) => !existentes.has(id)));
}

// ---------------------------------------------------------------------------
// _verificarReferenciasDetalles — antes del INSERT, confirma que cada
// id_producto/marca_id que trae un ítem exista en su tabla respectiva.
//
// MISMO PATRÓN Y MISMA RAZÓN QUE clienteLinkGuard.js / licitacionLinkGuard.js
// Sin este control, un id_producto o marca_id inexistente llega directo al
// INSERT de cotizacion_detalles, viola su clave foránea, y sale como
// excepción sin capturar: un 500 genérico que no le dice al usuario cuál de
// los items (ni cuál campo) estaba mal. A diferencia de id_cliente/
// id_licitacion, este chequeo faltaba acá. Encontrado en la ronda de estrés
// del 2026-08-26.
//
// Una sola consulta por lote con WHERE id IN (...) para cada tabla — no una
// consulta por ítem — y corre en la MISMA conexión/transacción que el
// INSERT, así que ve el mismo estado consistente.
//
// @throws {Error} .code = 'INVALID_ITEM_REFERENCE', .status = 422, con un
//                 mensaje que nombra el ítem (1-based, como lo ve la
//                 pantalla) y el campo exacto — mismo estilo que los otros
//                 guardianes.
// ---------------------------------------------------------------------------
async function _verificarReferenciasDetalles(connection, detalles) {
  const idsProducto = [...new Set(
    detalles.filter((d) => d.id_producto != null).map((d) => Number(d.id_producto))
  )];
  const idsMarca = [...new Set(
    detalles.filter((d) => d.marca_id != null).map((d) => Number(d.marca_id))
  )];

  if (idsProducto.length === 0 && idsMarca.length === 0) return;

  const [faltantesProducto, faltantesMarca] = await Promise.all([
    _idsFaltantes(connection, 'productos', idsProducto),
    _idsFaltantes(connection, 'marcas', idsMarca),
  ]);

  if (faltantesProducto.size === 0 && faltantesMarca.size === 0) return;

  for (let i = 0; i < detalles.length; i++) {
    const item = detalles[i];
    if (item.id_producto != null && faltantesProducto.has(Number(item.id_producto))) {
      throw Object.assign(
        new Error(`Item #${i + 1}: el producto #${item.id_producto} (id_producto) no existe.`),
        { code: 'INVALID_ITEM_REFERENCE', status: 422 }
      );
    }
    if (item.marca_id != null && faltantesMarca.has(Number(item.marca_id))) {
      throw Object.assign(
        new Error(`Item #${i + 1}: la marca #${item.marca_id} (marca_id) no existe.`),
        { code: 'INVALID_ITEM_REFERENCE', status: 422 }
      );
    }
  }
}

// ---------------------------------------------------------------------------
// createDetalles — Bulk INSERT line items inside a caller-managed transaction.
// ---------------------------------------------------------------------------
async function createDetalles(connection, id_cotizacion, detalles) {
  if (!detalles || detalles.length === 0) return;

  // Se verifica ANTES del INSERT — ver _verificarReferenciasDetalles arriba.
  // replaceDetalles llama a esta misma función después de su DELETE, así que
  // el chequeo cubre updateQuotation también sin duplicar nada.
  await _verificarReferenciasDetalles(connection, detalles);

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
    // 'UNI' y no 'UND': la lista de unidades del formulario cambió el
    // 2026-09-01 y la unidad pasó de UND a UNI (ver UNIDADES_DE_MEDIDA en
    // public/js/views/quotationForm/lineItemsComponent.js). Este es sólo el
    // respaldo para un ítem que llegue sin unidad — el formulario siempre
    // manda una—, pero dejarlo en el código viejo metería un valor que ya no
    // está en el desplegable y partiría en dos el reporte de consumo por ítem,
    // que agrupa por unidad.
    const unidad = item.unidad
      ? String(item.unidad).trim().substring(0, 20) || 'UNI'
      : 'UNI';
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
  const baseSet = `
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
      mostrar_codigos          = ?`;

  const baseParams = [
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
  ];

  // id_licitacion se manda SIEMPRE, a diferencia de create(): acá `null` es un
  // valor válido y distinto de "no tocar la columna" — es como el Ejecutivo
  // desvincula la cotización de una licitación (elige "Sin licitación" en el
  // form y guarda). Omitir la columna cuando data.id_licitacion es null, como
  // hacía una versión anterior, dejaba el vínculo previo pegado para siempre.
  const licitacionParam = data.id_licitacion != null ? parseInt(data.id_licitacion, 10) : null;

  const [result] = await connection.execute(
    `UPDATE cotizaciones SET ${baseSet}, id_licitacion = ? WHERE id = ? AND estado = 'Pendiente'`,
    [...baseParams, licitacionParam, id]
  );
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

// Única columna que swapFilePath puede tocar hoy (el Excel subido a mano) —
// el nombre de columna se interpola directo en el SQL (no hay forma
// parametrizada de nombrar una columna), así que se restringe por las dudas
// de que algún refactor futuro le pase otra cosa. pdf_ruta salió de esta
// lista el 2026-08-28 junto con la subida manual de PDF (ver
// quotationPdfController.js) — el PDF siempre lo escribe updatePdfPath.
const SWAPPABLE_FILE_COLUMNS = new Set(['excel_ruta']);

// ---------------------------------------------------------------------------
// swapFilePath — lee la ruta ACTUAL de `column` bajo un lock de fila y la
// pisa con `newPath`, todo dentro de la transacción de quien llama. Devuelve
// la ruta que había ANTES del swap, para que el archivo viejo se borre.
//
// POR QUÉ HACE FALTA UN LOCK
// Dos subidas casi simultáneas a la MISMA cotización, sin esto, leen la
// columna ANTES de que la otra escriba su UPDATE: las dos ven el mismo valor
// viejo, las dos van a borrar ESE archivo, y el archivo que dejó la petición
// que "perdió la carrera" (su valor quedó pisado por el UPDATE de la otra)
// nunca se referencia ni se borra — queda huérfano para siempre. Confirmado
// con 5 subidas simultáneas a la misma cotización: 5×200, un solo archivo
// referenciado en la base, 4 huérfanos en disco.
//
// SELECT ... FOR UPDATE serializa a las dos peticiones: la segunda no lee
// hasta que la primera confirmó su commit, así que ve el valor que la
// primera ACABA de escribir (no el original) y borra el archivo correcto.
// Encontrado en la ronda de estrés del 2026-08-26.
//
// @param   {import('mysql2/promise').PoolConnection} connection — ya con una tx abierta (ver withDeadlockRetry)
// @param   {number} id
// @param   {'excel_ruta'} column
// @param   {string} newPath
// @returns {Promise<string|null>} la ruta que había antes del swap
// ---------------------------------------------------------------------------
async function swapFilePath(connection, id, column, newPath) {
  if (!SWAPPABLE_FILE_COLUMNS.has(column)) {
    throw new Error(`swapFilePath: columna no permitida "${column}".`);
  }

  const [rows] = await connection.execute(
    `SELECT ${column} AS ruta FROM cotizaciones WHERE id = ? FOR UPDATE`,
    [id]
  );
  const oldPath = rows[0]?.ruta ?? null;

  await connection.execute(
    `UPDATE cotizaciones SET ${column} = ? WHERE id = ?`,
    [newPath, id]
  );

  return oldPath;
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

// ---------------------------------------------------------------------------
// updateSeguimientoVenta — Persist the commercial follow-up fields.
// Independent of `estado` (the approval workflow): editable regardless of the
// quotation's current approval state, including Archivada/Rechazada.
// @param {number} id
// @param {Object} datos
// @param {string|null} datos.estado_venta               - one of the ENUM values or null
// @param {string|null} datos.estado_venta_detalle        - free text (required when 'Otro')
// @param {string|null} datos.fecha_proximo_seguimiento   - 'YYYY-MM-DD' or null
// @returns {boolean}  - true if the row was updated
// ---------------------------------------------------------------------------
async function updateSeguimientoVenta(id, { estado_venta, estado_venta_detalle, fecha_proximo_seguimiento }) {
  const [result] = await pool.execute(
    `UPDATE cotizaciones
        SET estado_venta = ?, estado_venta_detalle = ?, fecha_proximo_seguimiento = ?
      WHERE id = ?`,
    [estado_venta ?? null, estado_venta_detalle ?? null, fecha_proximo_seguimiento ?? null, id]
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
  swapFilePath,
  updateComentarioAdmin,
  updateSeguimientoVenta,
};
