// =============================================================================
// src/models/quotation/whereBuilder.js
// Parameterized WHERE-clause construction shared by the paginated listing
// (findAll) and its COUNT(*) twin (countAll), so filter logic is never
// duplicated between the two.
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// buildWhereClause
// Constructs a parameterized WHERE clause from a filters object.
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
function buildWhereClause(filters = {}) {
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

module.exports = { buildWhereClause };
