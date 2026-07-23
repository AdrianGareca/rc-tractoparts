// =============================================================================
// src/models/LicitacionModel.js
// Data Access Layer — licitaciones, licitacion_historial_estados,
//                     licitaciones_correlativo
//
// Espejo del patrón de QuotationModel pero para la entidad paraguas
// "licitación" (1 licitación → N cotizaciones). El rol Proyectos es el
// responsable/dueño; el ejecutivo comercial delegado (Ejecutivo con
// can_approve_quotations=1) participa de la decisión conjunta; Jefe/SysAdmin
// pueden intervenir siempre. La matriz de transiciones vive aquí.
//
// LAYERING: solo este modelo ejecuta SQL sobre las tablas de licitaciones.
// =============================================================================

'use strict';

const { pool } = require('../config/db');

// ---------------------------------------------------------------------------
// VALID_STATES — debe reflejar EXACTAMENTE el ENUM de licitaciones.estado en
// sql/init.sql. 'En preparacion' es el estado inicial y el default de la columna.
// ---------------------------------------------------------------------------
const VALID_STATES = [
  'En preparacion',   // Proyectos arma la licitación (aún no se cotiza)
  'Cotizando',        // Pasada al ejecutivo comercial: arma/ajusta cotizaciones vinculadas
  'En evaluacion',    // Proyectos + ejecutivo revisan si entra en presupuesto
  'Presentada',       // Se presentó formalmente al concurso
  'Adjudicada',       // Ganada
  'No adjudicada',    // Perdida
  'Archivada',        // Terminal — sin más transiciones
];

// Monedas aceptadas (mismo criterio que cotizaciones)
const VALID_CURRENCIES = ['BOB', 'USD'];

// ---------------------------------------------------------------------------
// LICITACION_ROLE_TRANSITIONS — matriz de control de acceso por TIPO DE ACTOR.
//
// A diferencia de cotizaciones (keyed por nombre de rol), aquí la autoridad
// depende de la RELACIÓN con la licitación, no solo del rol:
//   • responsable → el usuario Proyectos dueño (licitaciones.id_responsable)
//   • delegado    → Ejecutivo con can_approve_quotations=1 (releído fresco de BD)
//   • jefe        → Jefe / SysAdmin (autoridad absoluta, pueden intervenir siempre)
//
// Cualquier otro caso (Ejecutivo sin delegación, Administracion, un Proyectos
// que NO es el responsable) es SOLO LECTURA → denegado por defecto.
//
// La fila 'En evaluacion' es compartida entre responsable y delegado: implementa
// la "decisión conjunta" (ambos pueden mover a Presentada o devolver a Cotizando).
// ---------------------------------------------------------------------------
const LICITACION_ROLE_TRANSITIONS = {
  responsable: {
    'En preparacion': ['Cotizando', 'Archivada'],
    'Cotizando':      ['En evaluacion', 'En preparacion'],
    'En evaluacion':  ['Presentada', 'Cotizando'],
    'Presentada':     ['Adjudicada', 'No adjudicada'],
    'Adjudicada':     ['Archivada'],
    'No adjudicada':  ['Archivada'],
    'Archivada':      [],
  },

  delegado: {
    'En preparacion': [],
    'Cotizando':      ['En evaluacion'],
    'En evaluacion':  ['Presentada', 'Cotizando'],
    'Presentada':     [],
    'Adjudicada':     [],
    'No adjudicada':  [],
    'Archivada':      [],
  },

  // Jefe / SysAdmin — "todo": pueden llevar la licitación a cualquier estado
  // significativo desde cualquier estado activo. 'Archivada' sigue siendo
  // terminal incluso para ellos (espejo de la regla de cotizaciones).
  jefe: {
    'En preparacion': ['Cotizando', 'En evaluacion', 'Presentada', 'Adjudicada', 'No adjudicada', 'Archivada'],
    'Cotizando':      ['En preparacion', 'En evaluacion', 'Presentada', 'Adjudicada', 'No adjudicada', 'Archivada'],
    'En evaluacion':  ['En preparacion', 'Cotizando', 'Presentada', 'Adjudicada', 'No adjudicada', 'Archivada'],
    'Presentada':     ['En evaluacion', 'Cotizando', 'Adjudicada', 'No adjudicada', 'Archivada'],
    'Adjudicada':     ['No adjudicada', 'Archivada'],
    'No adjudicada':  ['Adjudicada', 'Archivada'],
    'Archivada':      [],
  },
};

// Estados en los que la licitación es EDITABLE (datos de cabecera).
// Fuera de estos, solo se permite cambiar el estado, no los campos.
const EDITABLE_STATES = ['En preparacion', 'Cotizando'];

// Columnas seguras para ORDER BY — previene inyección vía el parámetro sort_by.
const SORTABLE_COLUMNS = {
  codigo:          'l.codigo',
  nombre:          'l.nombre',
  estado:          'l.estado',
  fecha_limite:    'l.fecha_limite',
  creado_en:       'l.creado_en',
  cliente_nombre:  'cl.razon_social',
};

// ---------------------------------------------------------------------------
// resolveActorType — traduce (rol, canApprove, isResponsable) al tipo de actor
// que usa LICITACION_ROLE_TRANSITIONS. Devuelve null para actores de solo lectura.
// ---------------------------------------------------------------------------
function resolveActorType(rol, canApproveQuotations, isResponsable) {
  if (rol === 'Jefe' || rol === 'SysAdmin') return 'jefe';
  if (rol === 'Proyectos' && isResponsable === true) return 'responsable';
  if (rol === 'Ejecutivo' && canApproveQuotations === true) return 'delegado';
  return null;
}

// ---------------------------------------------------------------------------
// validateTransitionByRole — guarda sincrónica de transición de estado.
// Espejo conceptual de QuotationModel.validateTransitionByRole, pero con el
// eje adicional "isResponsable" (dueño de la licitación).
//
// @returns {{ valid: boolean, reason?: string, allowedTransitions?: string[] }}
// ---------------------------------------------------------------------------
function validateTransitionByRole(estadoActual, nuevoEstado, rol, canApproveQuotations = false, isResponsable = false) {
  const actorType = resolveActorType(rol, canApproveQuotations, isResponsable);

  if (!actorType) {
    const detalle = rol === 'Ejecutivo'
      ? `El rol '${rol}' necesita la delegación (can_approve_quotations) para operar licitaciones.`
      : rol === 'Proyectos'
        ? `Solo el responsable de la licitación puede cambiar su estado.`
        : `El rol '${rol}' tiene acceso de solo lectura sobre las licitaciones.`;
    return { valid: false, reason: detalle, allowedTransitions: [] };
  }

  const allowedFromState = LICITACION_ROLE_TRANSITIONS[actorType][estadoActual] || [];

  if (!allowedFromState.includes(nuevoEstado)) {
    const reason = allowedFromState.length === 0
      ? `No hay transiciones disponibles desde el estado '${estadoActual}' para su rol en esta licitación.`
      : `No se puede transicionar desde '${estadoActual}' hacia '${nuevoEstado}'. ` +
        `Transiciones permitidas: [${allowedFromState.join(', ')}].`;
    return { valid: false, reason, allowedTransitions: allowedFromState };
  }

  return { valid: true, allowedTransitions: allowedFromState };
}

// ---------------------------------------------------------------------------
// generateCorrelativo — ATÓMICO: debe llamarse dentro de una transacción del
// caller. Bloquea la fila del año (SELECT … FOR UPDATE) en
// licitaciones_correlativo, incrementa y devuelve 'LIC-YYYY/NNNN'.
// Espejo de correlativoRepository.generateCorrelativo, contador PROPIO.
// ---------------------------------------------------------------------------
function formatCorrelativo(anio, nextNumber) {
  return `LIC-${anio}/${String(nextNumber).padStart(4, '0')}`;
}

async function peekNextCorrelativo() {
  const currentYear = new Date().getFullYear();
  const [rows] = await pool.execute(
    'SELECT ultimo_nro FROM licitaciones_correlativo WHERE anio = ?',
    [currentYear]
  );
  const nextNumber = rows.length === 0 ? 1 : rows[0].ultimo_nro + 1;
  return formatCorrelativo(currentYear, nextNumber);
}

async function generateCorrelativo(connection) {
  const currentYear = new Date().getFullYear();

  const [rows] = await connection.execute(
    'SELECT ultimo_nro FROM licitaciones_correlativo WHERE anio = ? FOR UPDATE',
    [currentYear]
  );

  let nextNumber;
  if (rows.length === 0) {
    await connection.execute(
      'INSERT INTO licitaciones_correlativo (anio, ultimo_nro) VALUES (?, 1)',
      [currentYear]
    );
    nextNumber = 1;
  } else {
    nextNumber = rows[0].ultimo_nro + 1;
    await connection.execute(
      'UPDATE licitaciones_correlativo SET ultimo_nro = ? WHERE anio = ?',
      [nextNumber, currentYear]
    );
  }

  return formatCorrelativo(currentYear, nextNumber);
}

// ---------------------------------------------------------------------------
// create — Inserta la cabecera de la licitación dentro de una transacción del
// caller. Estado inicial 'En preparacion' (único valor inicial válido).
// ---------------------------------------------------------------------------
async function create(connection, data) {
  const sql = `
    INSERT INTO licitaciones
      (codigo, nombre, id_cliente, descripcion, presupuesto_referencial,
       moneda, fecha_limite, estado, id_responsable)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, 'En preparacion', ?)
  `;

  const [result] = await connection.execute(sql, [
    data.codigo,
    data.nombre,
    data.id_cliente,
    data.descripcion             || null,
    data.presupuesto_referencial ?? null,
    data.moneda                  || 'BOB',
    data.fecha_limite            || null,
    data.id_responsable,
  ]);

  return result.insertId;
}

// ---------------------------------------------------------------------------
// buildWhereClause — WHERE parametrizado compartido por findAll / countAll.
// Filtros: estado (exacto), q (código/nombre/razón social), id_responsable.
// ---------------------------------------------------------------------------
function buildWhereClause(filters = {}) {
  const conditions = [];
  const values     = [];

  if (filters.q && String(filters.q).trim()) {
    const like = `%${String(filters.q).trim()}%`;
    conditions.push('(l.codigo LIKE ? OR l.nombre LIKE ? OR cl.razon_social LIKE ?)');
    values.push(like, like, like);
  }

  if (filters.estado) {
    conditions.push('l.estado = ?');
    values.push(filters.estado);
  }

  if (filters.id_responsable) {
    conditions.push('l.id_responsable = ?');
    values.push(parseInt(filters.id_responsable, 10));
  }

  if (filters.id_cliente) {
    conditions.push('l.id_cliente = ?');
    values.push(parseInt(filters.id_cliente, 10));
  }

  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    values,
  };
}

// ---------------------------------------------------------------------------
// findAll — Listado paginado, filtrado y ordenado.
// LIMIT/OFFSET van como literales enteros validados (gotcha mysql2 v3: los
// mistipea como DOUBLE si van como parámetros bound → "Incorrect arguments").
// ---------------------------------------------------------------------------
async function findAll(filters = {}, pagination = {}, sort = {}) {
  const page   = Math.max(1, parseInt(pagination.page, 10) || 1);
  const limit  = Math.min(100, Math.max(1, parseInt(pagination.limit, 10) || 20));
  const offset = (page - 1) * limit;

  const sortColumn = SORTABLE_COLUMNS[sort.by] || 'l.creado_en';
  const sortOrder  = sort.order === 'ASC' ? 'ASC' : 'DESC';

  const { clause: whereClause, values: whereValues } = buildWhereClause(filters);

  const sql = `
      SELECT
        l.id,
        l.codigo,
        l.nombre,
        l.id_cliente,
        cl.razon_social      AS cliente_nombre,
        l.presupuesto_referencial,
        l.moneda,
        l.fecha_limite,
        l.estado,
        l.id_responsable,
        u.nombre_completo    AS responsable_nombre,
        (SELECT COUNT(*) FROM cotizaciones c WHERE c.id_licitacion = l.id) AS total_cotizaciones,
        l.creado_en,
        l.actualizado_en
      FROM licitaciones l
      INNER JOIN clientes cl ON cl.id = l.id_cliente
      INNER JOIN usuarios u  ON u.id  = l.id_responsable
      ${whereClause}
      ORDER BY ${sortColumn} ${sortOrder}
      LIMIT ${limit} OFFSET ${offset}
    `;

  const [rows] = await pool.execute(sql, whereValues);
  return rows;
}

// ---------------------------------------------------------------------------
// countAll — COUNT(*) con el mismo WHERE que findAll (para la paginación).
// ---------------------------------------------------------------------------
async function countAll(filters = {}) {
  const { clause: whereClause, values: whereValues } = buildWhereClause(filters);

  const sql = `
      SELECT COUNT(*) AS total
      FROM licitaciones l
      INNER JOIN clientes cl ON cl.id = l.id_cliente
      ${whereClause}
    `;

  const [rows] = await pool.execute(sql, whereValues);
  return rows[0].total;
}

// ---------------------------------------------------------------------------
// findById — Detalle completo: cabecera + responsable + cliente + las
// cotizaciones vinculadas (correlativo, estado, monto) y el total cotizado
// (suma de las vinculadas ya aprobadas/confirmadas) para comparar contra el
// presupuesto_referencial.
// ---------------------------------------------------------------------------
async function findById(id) {
  const sqlHeader = `
      SELECT
        l.id,
        l.codigo,
        l.nombre,
        l.id_cliente,
        cl.razon_social      AS cliente_nombre,
        cl.nit               AS cliente_nit,
        l.descripcion,
        l.presupuesto_referencial,
        l.moneda,
        l.fecha_limite,
        l.estado,
        l.observaciones_resultado,
        l.id_responsable,
        u.nombre_completo    AS responsable_nombre,
        l.creado_en,
        l.actualizado_en
      FROM licitaciones l
      INNER JOIN clientes cl ON cl.id = l.id_cliente
      INNER JOIN usuarios u  ON u.id  = l.id_responsable
      WHERE l.id = ?
      LIMIT 1
    `;

  const [headerRows] = await pool.execute(sqlHeader, [id]);
  if (!headerRows[0]) return null;
  const licitacion = headerRows[0];

  // Cotizaciones vinculadas (para la tabla del detalle)
  const [cotizaciones] = await pool.execute(
    `SELECT
        c.id,
        c.numero_correlativo,
        c.estado,
        c.monto_total,
        c.moneda,
        c.id_ejecutivo,
        eu.nombre_completo AS ejecutivo_nombre,
        c.creado_en
       FROM cotizaciones c
       INNER JOIN usuarios eu ON eu.id = c.id_ejecutivo
       WHERE c.id_licitacion = ?
       ORDER BY c.creado_en DESC`,
    [id]
  );
  licitacion.cotizaciones = cotizaciones;

  // Total cotizado (solo las vinculadas ya aprobadas/confirmadas cuentan para
  // la comparación contra el presupuesto — una cotización 'Pendiente' aún no
  // representa un compromiso de precio).
  const [totales] = await pool.execute(
    `SELECT COALESCE(SUM(c.monto_total), 0) AS total_comprometido
       FROM cotizaciones c
       WHERE c.id_licitacion = ?
         AND c.estado IN ('Aprobada internamente', 'Enviada al cliente', 'Confirmada', 'Aceptada')`,
    [id]
  );
  licitacion.total_comprometido = totales[0].total_comprometido;

  return licitacion;
}

// ---------------------------------------------------------------------------
// update — Actualiza los campos editables de la cabecera. La restricción de
// estado ('En preparacion'/'Cotizando') se aplica en el controller (que lee el
// estado primero); aquí se usa el guard adicional en el WHERE para blindar
// contra condiciones de carrera.
// ---------------------------------------------------------------------------
async function update(id, data) {
  const sql = `
    UPDATE licitaciones SET
      nombre                  = ?,
      id_cliente              = ?,
      descripcion             = ?,
      presupuesto_referencial = ?,
      moneda                  = ?,
      fecha_limite            = ?
    WHERE id = ? AND estado IN ('En preparacion', 'Cotizando')
  `;

  const [result] = await pool.execute(sql, [
    data.nombre,
    data.id_cliente,
    data.descripcion             || null,
    data.presupuesto_referencial ?? null,
    data.moneda                  || 'BOB',
    data.fecha_limite            || null,
    id,
  ]);

  return result.affectedRows > 0;
}

// ---------------------------------------------------------------------------
// updateStatus — Ejecuta la transición con concurrencia optimista
// (WHERE id=? AND estado=?). 0 filas → el estado cambió entre la lectura y la
// escritura → el controller responde 409. observaciones_resultado se persiste
// junto a la transición cuando se llega a un estado de desenlace.
// ---------------------------------------------------------------------------
async function updateStatus(id, nuevoEstado, estadoActual, observacionResultado = null) {
  const setClauses = ['estado = ?'];
  const params     = [nuevoEstado];

  // Al llegar a un estado de desenlace, guardar la nota de resultado si se envió.
  if (['Adjudicada', 'No adjudicada'].includes(nuevoEstado) && observacionResultado != null) {
    setClauses.push('observaciones_resultado = ?');
    params.push(String(observacionResultado).trim() || null);
  }

  const sql = `UPDATE licitaciones SET ${setClauses.join(', ')} WHERE id = ? AND estado = ?`;
  params.push(id, estadoActual);

  const [result] = await pool.execute(sql, params);
  return result.affectedRows > 0;
}

// ---------------------------------------------------------------------------
// logStateHistory — Inserta un registro en licitacion_historial_estados en cada
// transición. Fire-and-forget: los errores se registran pero nunca bloquean la
// operación principal (espejo de QuotationModel.logStateHistory).
// ---------------------------------------------------------------------------
async function logStateHistory({
  id_licitacion,
  estado_anterior,
  estado_nuevo,
  id_usuario     = null,
  nombre_usuario = null,
  rol_usuario    = null,
  observacion    = null,
  ip_origen      = null,
}) {
  try {
    await pool.execute(
      `INSERT INTO licitacion_historial_estados
           (id_licitacion, estado_anterior, estado_nuevo, id_usuario,
            nombre_usuario, rol_usuario, observacion, ip_origen)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id_licitacion,
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
    console.error(
      '[LicitacionModel.logStateHistory] Failed to write history record:',
      err.message,
      { id_licitacion, estado_anterior, estado_nuevo }
    );
  }
}

// ---------------------------------------------------------------------------
// findStateHistory — Línea de tiempo completa de una licitación: evento de
// creación (desde bitacora_auditoria) + todas las transiciones posteriores.
// ---------------------------------------------------------------------------
async function findStateHistory(licitacionId) {
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
      FROM licitacion_historial_estados h
      WHERE h.id_licitacion = ?
      ORDER BY h.creado_en ASC
    `;

  const [historyRows] = await pool.execute(sqlHistory, [licitacionId]);

  const sqlCreation = `
      SELECT
        ba.id,
        NULL                 AS estado_anterior,
        'En preparacion'     AS estado_nuevo,
        ba.nombre_usuario,
        NULL                 AS rol_usuario,
        NULL                 AS observacion,
        ba.ip_origen,
        ba.creado_en,
        'creacion'           AS tipo_evento
      FROM bitacora_auditoria ba
      WHERE ba.entidad = 'licitaciones'
        AND ba.id_entidad = ?
        AND ba.accion     = 'CREAR_LICITACION'
        AND ba.resultado  = 'exito'
      LIMIT 1
    `;

  const [creationRows] = await pool.execute(sqlCreation, [licitacionId]);

  return [...creationRows, ...historyRows];
}

module.exports = {
  // constants
  VALID_STATES,
  VALID_CURRENCIES,
  LICITACION_ROLE_TRANSITIONS,
  EDITABLE_STATES,
  SORTABLE_COLUMNS,
  // correlativo
  formatCorrelativo,
  peekNextCorrelativo,
  generateCorrelativo,
  // state machine
  validateTransitionByRole,
  resolveActorType,
  // writes
  create,
  update,
  updateStatus,
  // reads
  findAll,
  countAll,
  findById,
  // history
  logStateHistory,
  findStateHistory,
};
