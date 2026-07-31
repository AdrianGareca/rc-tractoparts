// =============================================================================
// public/js/views/dashboard/modules/clienteItemReport.js
// Reporte «Consumo por Cliente»: qué repuestos consume cada cliente y cuántos.
//
// Tabla PLANA a propósito — una fila por (cliente, código, unidad). Agrupar
// visualmente por cliente se ve más lindo, pero impide ordenar por cantidad
// entre clientes, que es justamente la pregunta útil: «¿cuál es el ítem que más
// se mueve, y quién lo pide?». Plana también es lo que se pega en un Excel sin
// tener que desarmarla.
//
// QUÉ SIGNIFICAN LOS NÚMEROS
// Por defecto cuenta TODAS las cotizaciones, incluidas las rechazadas: el total
// es «lo que el cliente pidió cotizar», no «lo que compró». El filtro de estado
// permite estrechar a Confirmada para lo segundo. La pantalla lo dice, porque
// un número sin esa aclaración se lee mal.
//
// NO HAY MONTOS. Un cliente puede tener cotizaciones en USD y en Bs., y sumarlas
// daría un número sin significado (el mismo error que hubo en los gastos de
// licitaciones). Si alguna vez se agrega, tiene que ir desglosado por moneda.
// =============================================================================

import api from '../../../services/apiClient.js';
import { escHtml, fmtDate } from '../helpers.js';
import { tableSkeleton } from '../../../shared/skeleton.js';
import { mountPagination } from '../../../shared/pagination.js';

const ESTADOS = [
  'Pendiente', 'En revision', 'En espera', 'Aprobada internamente',
  'Enviada al cliente', 'Confirmada', 'Rechazada', 'Archivada',
];

// Etiquetas del menú de la paginación: este listado se ordena por cantidad por
// defecto, así que hablar de «más nuevas / más antiguas» sería mentira.
const ETIQUETAS = { inicio: 'Ir al principio', fin: 'Ir al final' };

/** Cantidad sin ceros de relleno: 12.0000 → 12, pero 1.5 sigue siendo 1.5. */
function fmtCantidad(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(4).replace(/\.?0+$/, '');
}

/**
 * Monta el reporte en un contenedor.
 * @param {HTMLElement} panel
 * @param {Object} [opts]
 * @param {number} [opts.idEjecutivo] acota a las cotizaciones de un ejecutivo
 * @returns {Function} destroy
 */
export async function mountClienteItemReport(panel, opts = {}) {
  const state = {
    page: 1, limit: 25,
    desde: '', hasta: '', estado: '', q: '',
    sortBy: 'cantidad', sortOrder: 'DESC',
  };

  let destroyPag = null;
  let ultimasFilas = [];        // lo que se ve, para exportar exactamente eso

  panel.innerHTML = `
    <div class="card">
      <div class="card-header" style="flex-wrap:wrap;gap:.75rem;">
        <h3>📦 Consumo por Cliente</h3>
        <div style="display:flex;gap:.5rem;align-items:center;">
          <span class="text-muted text-sm" id="ci-total"></span>
          <button class="btn btn-ghost btn-sm" id="ci-csv">⬇ Exportar CSV</button>
        </div>
      </div>

      <div class="filter-bar">
        <div class="form-group">
          <label class="form-label">Desde</label>
          <input class="form-control" type="date" id="ci-desde" />
        </div>
        <div class="form-group">
          <label class="form-label">Hasta</label>
          <input class="form-control" type="date" id="ci-hasta" />
        </div>
        <div class="form-group">
          <label class="form-label">Estado</label>
          <select class="form-control" id="ci-estado" style="min-width:170px;">
            <option value="">Todos (lo cotizado)</option>
            ${ESTADOS.map((e) => `<option value="${e}">${e}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Buscar</label>
          <input class="form-control" type="search" id="ci-q"
                 placeholder="Cliente, código o descripción…" style="min-width:220px;" />
        </div>
        <button class="btn btn-primary btn-sm" id="ci-apply" style="align-self:flex-end;">Aplicar</button>
        <button class="btn btn-ghost btn-sm" id="ci-clear" style="align-self:flex-end;">Limpiar</button>
      </div>

      <p class="text-sm" id="ci-nota"
         style="margin:0;padding:.6rem 1.25rem;color:var(--text-muted);border-bottom:1px solid var(--border);"></p>

      <div class="card-toolbar" id="ci-pagination"></div>
      <div id="ci-results">${tableSkeleton({ columnas: 6, etiqueta: 'Cargando consumo por cliente' })}</div>
    </div>`;

  const $ = (sel) => panel.querySelector(sel);

  const clearPagination = () => {
    destroyPag?.();
    destroyPag = null;
    const pie = $('#ci-pagination');
    if (pie) pie.innerHTML = '';
  };

  // La nota explica QUÉ está contando el número que se ve. Sin esto, «48» se
  // lee como «compró 48» cuando puede incluir cotizaciones rechazadas.
  function actualizarNota() {
    const el = $('#ci-nota');
    if (!el) return;
    el.textContent = state.estado
      ? `Contando solo cotizaciones en estado "${state.estado}".`
      : 'Contando TODAS las cotizaciones, incluidas las rechazadas: el total es lo que el cliente pidió cotizar, no lo que compró. Filtrá por "Confirmada" para ver las ventas cerradas.';
  }

  function encabezado(clave, texto) {
    const activo = state.sortBy === clave;
    const flecha = activo ? (state.sortOrder === 'ASC' ? ' ▲' : ' ▼') : '';
    return `<th data-sort="${clave}" style="cursor:pointer;user-select:none;">${texto}${flecha}</th>`;
  }

  async function load() {
    const results = $('#ci-results');
    results.innerHTML = tableSkeleton({ columnas: 6, etiqueta: 'Cargando consumo por cliente' });
    actualizarNota();

    const params = new URLSearchParams({
      page: String(state.page), limit: String(state.limit),
      sort_by: state.sortBy, sort_order: state.sortOrder,
    });
    if (state.desde)  params.set('fecha_desde', state.desde);
    if (state.hasta)  params.set('fecha_hasta', state.hasta);
    if (state.estado) params.set('estado', state.estado);
    if (state.q)      params.set('q', state.q);
    if (opts.idEjecutivo) params.set('id_ejecutivo', String(opts.idEjecutivo));

    try {
      const body = await api.get(`/api/reportes/cliente-item?${params}`);
      const filas = body.data ?? [];
      ultimasFilas = filas;

      const total = body.pagination?.totalRecords ?? filas.length;
      $('#ci-total').textContent = `${total} combinación(es) cliente–ítem`;

      if (filas.length === 0) {
        results.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">📦</div>
            <h4>Sin datos</h4>
            <p>Ninguna cotización coincide con los filtros aplicados.</p>
          </div>`;
        clearPagination();
        return;
      }

      results.innerHTML = `
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                ${encabezado('cliente', 'Cliente')}
                ${encabezado('codigo', 'Código')}
                <th>Descripción</th>
                ${encabezado('cantidad', 'Cantidad')}
                ${encabezado('items', 'Cotizaciones')}
                <th>Último pedido</th>
              </tr>
            </thead>
            <tbody>
              ${filas.map((f) => `
                <tr>
                  <td class="fw-600">${escHtml(f.cliente_nombre)}</td>
                  <td>${f.sin_codigo
                        ? '<span class="text-muted" title="La línea se cargó sin código; se agrupa por descripción.">— sin código —</span>'
                        : `<span class="fw-600">${escHtml(f.codigo)}</span>`}</td>
                  <td class="text-sm">${escHtml(f.descripcion ?? '—')}</td>
                  <td class="text-right fw-600">${fmtCantidad(f.cantidad_total)} ${escHtml(f.unidad ?? '')}</td>
                  <td class="text-right">${f.cotizaciones}</td>
                  <td class="text-sm">${fmtDate(f.ultima_vez)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;

      // Ordenar haciendo clic en el encabezado. Volver a hacer clic invierte.
      results.querySelectorAll('[data-sort]').forEach((th) => {
        th.addEventListener('click', () => {
          const clave = th.dataset.sort;
          if (state.sortBy === clave) {
            state.sortOrder = state.sortOrder === 'ASC' ? 'DESC' : 'ASC';
          } else {
            state.sortBy = clave;
            state.sortOrder = 'DESC';
          }
          state.page = 1;
          load();
        });
      });

      destroyPag?.();
      destroyPag = mountPagination($('#ci-pagination'), body.pagination, {
        etiquetas: ETIQUETAS,
        onChange: ({ page, limit }) => { state.page = page; state.limit = limit; load(); },
      });
    } catch (err) {
      results.innerHTML = `<div class="empty-state"><p>Error: ${escHtml(err.data?.message || err.message)}</p></div>`;
      clearPagination();
    }
  }

  // ── Exportar a CSV ─────────────────────────────────────────────────────────
  // Se exporta lo que se está viendo, no todo el reporte: si alguien filtró y
  // ordenó, el archivo tiene que coincidir con la pantalla. Bajar el total
  // completo sin avisar sería una sorpresa desagradable con miles de filas.
  function exportarCsv() {
    if (ultimasFilas.length === 0) return;

    // Un valor que empieza con = + - @ lo interpreta Excel como fórmula. Se le
    // antepone una comilla simple: es la mitigación estándar de CSV injection,
    // y acá los datos vienen de texto que cargan los usuarios.
    const escapar = (v) => {
      let s = v == null ? '' : String(v);
      if (/^[=+\-@]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };

    const cabecera = ['Cliente', 'NIT', 'Codigo', 'Descripcion', 'Cantidad', 'Unidad', 'Cotizaciones', 'Primer pedido', 'Ultimo pedido'];
    const lineas = ultimasFilas.map((f) => [
      f.cliente_nombre, f.cliente_nit ?? '', f.sin_codigo ? '' : f.codigo,
      f.descripcion ?? '', fmtCantidad(f.cantidad_total), f.unidad ?? '',
      f.cotizaciones, f.primera_vez ?? '', f.ultima_vez ?? '',
    ].map(escapar).join(','));

    // El BOM al principio es lo que hace que Excel abra el archivo como UTF-8;
    // sin él, los acentos y las ñ salen como caracteres raros.
    const csv  = '﻿' + [cabecera.map(escapar).join(','), ...lineas].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `consumo-por-cliente-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Controles ──────────────────────────────────────────────────────────────
  const aplicar = () => {
    state.desde  = $('#ci-desde').value;
    state.hasta  = $('#ci-hasta').value;
    state.estado = $('#ci-estado').value;
    state.q      = $('#ci-q').value.trim();
    state.page   = 1;
    load();
  };

  $('#ci-apply').addEventListener('click', aplicar);
  $('#ci-estado').addEventListener('change', aplicar);
  $('#ci-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') aplicar(); });
  $('#ci-csv').addEventListener('click', exportarCsv);
  $('#ci-clear').addEventListener('click', () => {
    $('#ci-desde').value = ''; $('#ci-hasta').value = '';
    $('#ci-estado').value = ''; $('#ci-q').value = '';
    aplicar();
  });

  await load();

  return function destroy() { clearPagination(); };
}
