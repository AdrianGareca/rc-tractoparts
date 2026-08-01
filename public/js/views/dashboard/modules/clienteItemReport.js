// =============================================================================
// public/js/views/dashboard/modules/clienteItemReport.js
// Reporte «Consumo por Ítem» — qué repuestos se piden, cuánto y a quién.
//
// PARA QUÉ SIRVE (esto define todo el diseño)
// La empresa cotiza todo lo que le mandan. Muchas piezas chicas no valen la
// pena de importar de a una, pero si se piden seguido conviene traer un lote y
// tenerlas en stock. Este reporte es para tomar esa decisión.
//
// POR ESO HAY DOS VISTAS, Y LA PRINCIPAL ES «POR ÍTEM»
//
//   📦 Por ítem (la que decide la compra)
//      Una fila por repuesto, sumando TODOS los clientes y vendedores.
//      La columna que más importa no es la cantidad sino CUÁNTOS CLIENTES
//      distintos lo pidieron: 20 unidades repartidas entre 5 clientes es mucho
//      mejor candidato a stock que 20 que pidió uno solo y capaz no repite.
//
//   👤 Detalle por ejecutivo
//      Una fila por (ejecutivo, cliente, código). Contesta otra pregunta:
//      «¿qué le cotizó cada vendedor a cada cliente?». Sin esta separación las
//      cotizaciones de todos los vendedores se veían mezcladas y no se entendía
//      nada — fue lo primero que reportó ventas al probarlo.
//
// Las dos son la misma consulta con distinto GROUP BY, así que los números
// siempre cierran entre ellas.
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

// El listado se ordena por cantidad, no por fecha: hablar de «más nuevas /
// más antiguas» sería mentira.
const ETIQUETAS = { inicio: 'Ir al principio', fin: 'Ir al final' };

/** Cantidad sin ceros de relleno: 12.0000 → 12, pero 1.5 sigue siendo 1.5. */
function fmtCantidad(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(4).replace(/\.?0+$/, '');
}

const celdaCodigo = (f) => f.sin_codigo
  ? '<span class="text-muted" title="La línea se cargó sin código; se agrupa por descripción.">— sin código —</span>'
  : `<span class="fw-600">${escHtml(f.codigo)}</span>`;

const celdaMarca = (f) => f.marca_nombre
  ? escHtml(f.marca_nombre)
  : '<span class="text-muted">—</span>';

// ── Definición de cada vista ────────────────────────────────────────────────
// Columnas, orden por defecto y cómo se arma cada fila. Tener las dos acá al
// lado hace evidente en qué se diferencian.
const VISTAS = {
  item: {
    etiqueta: '📦 Por ítem',
    ayuda: 'Cuánto se pide de cada repuesto en total. Ordenalo por «Clientes» para ver qué conviene stockear.',
    columnas: [
      { clave: 'codigo',   texto: 'Código' },
      { clave: 'marca',    texto: 'Marca' },
      { texto: 'Descripción' },
      { clave: 'cantidad', texto: 'Cantidad', derecha: true },
      { clave: 'clientes', texto: 'Clientes', derecha: true },
      { clave: 'items',    texto: 'Cotizaciones', derecha: true },
      { texto: 'Último pedido' },
    ],
    fila: (f) => `
      <td>${celdaCodigo(f)}</td>
      <td class="text-sm">${celdaMarca(f)}</td>
      <td class="text-sm">${escHtml(f.descripcion ?? '—')}</td>
      <td class="text-right fw-600">${fmtCantidad(f.cantidad_total)} ${escHtml(f.unidad ?? '')}</td>
      <td class="text-right fw-600">${f.clientes}</td>
      <td class="text-right">${f.cotizaciones}</td>
      <td class="text-sm">${fmtDate(f.ultima_vez)}</td>`,
    csv: {
      cabecera: ['Codigo', 'Marca', 'Descripcion', 'Cantidad', 'Unidad', 'Clientes', 'Cotizaciones', 'Primer pedido', 'Ultimo pedido'],
      fila: (f) => [
        f.sin_codigo ? '' : f.codigo, f.marca_nombre ?? '', f.descripcion ?? '',
        fmtCantidad(f.cantidad_total), f.unidad ?? '', f.clientes, f.cotizaciones,
        f.primera_vez ?? '', f.ultima_vez ?? '',
      ],
    },
  },

  detalle: {
    etiqueta: '👤 Detalle por ejecutivo',
    ayuda: 'Qué le cotizó cada vendedor a cada cliente. Una fila por ejecutivo, cliente y código.',
    columnas: [
      { clave: 'ejecutivo', texto: 'Ejecutivo' },
      { clave: 'cliente',   texto: 'Cliente' },
      { clave: 'codigo',    texto: 'Código' },
      { clave: 'marca',     texto: 'Marca' },
      { texto: 'Descripción' },
      { clave: 'cantidad',  texto: 'Cantidad', derecha: true },
      { clave: 'items',     texto: 'Cotiz.', derecha: true },
      { texto: 'Último pedido' },
    ],
    fila: (f) => `
      <td class="text-sm">${escHtml(f.ejecutivo_nombre ?? '—')}</td>
      <td class="fw-600">${escHtml(f.cliente_nombre)}</td>
      <td>${celdaCodigo(f)}</td>
      <td class="text-sm">${celdaMarca(f)}</td>
      <td class="text-sm">${escHtml(f.descripcion ?? '—')}</td>
      <td class="text-right fw-600">${fmtCantidad(f.cantidad_total)} ${escHtml(f.unidad ?? '')}</td>
      <td class="text-right">${f.cotizaciones}</td>
      <td class="text-sm">${fmtDate(f.ultima_vez)}</td>`,
    csv: {
      cabecera: ['Ejecutivo', 'Cliente', 'NIT', 'Codigo', 'Marca', 'Descripcion', 'Cantidad', 'Unidad', 'Cotizaciones', 'Primer pedido', 'Ultimo pedido'],
      fila: (f) => [
        f.ejecutivo_nombre ?? '', f.cliente_nombre, f.cliente_nit ?? '',
        f.sin_codigo ? '' : f.codigo, f.marca_nombre ?? '', f.descripcion ?? '',
        fmtCantidad(f.cantidad_total), f.unidad ?? '', f.cotizaciones,
        f.primera_vez ?? '', f.ultima_vez ?? '',
      ],
    },
  },
};

/**
 * @param {HTMLElement} panel
 * @param {Object} [opts]
 * @param {number} [opts.idEjecutivo] fija el reporte a un ejecutivo (su propia vista)
 * @returns {Promise<Function>} destroy
 */
export async function mountClienteItemReport(panel, opts = {}) {
  const state = {
    vista: 'item',                 // la que contesta la pregunta de compras
    page: 1,
    limit: 50,                     // 50 y no 25: con pocas filas por pagina, los
                                   // items de una misma cotizacion quedaban
                                   // repartidos y parecia que faltaban.
    desde: '', hasta: '', estado: '', q: '', ejecutivo: '',
    sortBy: 'cantidad', sortOrder: 'DESC',
  };

  let destroyPag = null;
  let ultimasFilas = [];

  panel.innerHTML = `
    <div class="card">
      <div class="card-header" style="flex-wrap:wrap;gap:.75rem;">
        <h3>📦 Consumo por Ítem</h3>
        <div style="display:flex;gap:.5rem;align-items:center;">
          <span class="text-muted text-sm" id="ci-total"></span>
          <button class="btn btn-ghost btn-sm" id="ci-csv">⬇ Exportar CSV</button>
        </div>
      </div>

      <div class="tab-bar" id="ci-vistas" style="margin:0;">
        ${Object.entries(VISTAS).map(([clave, v], i) => `
          <button class="tab-btn${i === 0 ? ' active' : ''}" data-vista="${clave}" type="button">${v.etiqueta}</button>
        `).join('')}
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
          <select class="form-control" id="ci-estado" style="min-width:165px;">
            <option value="">Todos (lo cotizado)</option>
            ${ESTADOS.map((e) => `<option value="${e}">${e}</option>`).join('')}
          </select>
        </div>
        ${opts.idEjecutivo ? '' : `
        <div class="form-group">
          <label class="form-label">Ejecutivo</label>
          <select class="form-control" id="ci-ejecutivo" style="min-width:170px;">
            <option value="">Todos</option>
          </select>
        </div>`}
        <div class="form-group">
          <label class="form-label">Buscar</label>
          <input class="form-control" type="search" id="ci-q"
                 placeholder="Cliente, código, marca o descripción…" style="min-width:210px;" />
        </div>
        <button class="btn btn-primary btn-sm" id="ci-apply" style="align-self:flex-end;">Aplicar</button>
        <button class="btn btn-ghost btn-sm" id="ci-clear" style="align-self:flex-end;">Limpiar</button>
      </div>

      <p class="text-sm" id="ci-nota"
         style="margin:0;padding:.6rem 1.25rem;color:var(--text-muted);border-bottom:1px solid var(--border);"></p>

      <div class="card-toolbar" id="ci-pagination"></div>
      <div id="ci-results">${tableSkeleton({ columnas: 7, etiqueta: 'Cargando consumo' })}</div>
    </div>`;

  const $ = (sel) => panel.querySelector(sel);

  const clearPagination = () => {
    destroyPag?.();
    destroyPag = null;
    const pie = $('#ci-pagination');
    if (pie) pie.innerHTML = '';
  };

  // Poblar el filtro de ejecutivos. No fatal: si falla, queda en «Todos».
  if (!opts.idEjecutivo) {
    try {
      const us = await api.get('/api/usuarios');
      const sel = $('#ci-ejecutivo');
      for (const u of (us.data ?? [])) {
        if (!u.activo) continue;
        sel.insertAdjacentHTML('beforeend',
          `<option value="${u.id}">${escHtml(u.nombre_completo)}</option>`);
      }
    } catch { /* el filtro simplemente queda vacio */ }
  }

  // La nota explica QUÉ está contando el número que se ve: «48» a secas se lee
  // como «compró 48» cuando puede incluir cotizaciones rechazadas.
  function actualizarNota() {
    const el = $('#ci-nota');
    if (!el) return;
    const alcance = state.estado
      ? `Contando solo cotizaciones en estado "${state.estado}".`
      : 'Contando TODAS las cotizaciones, incluidas las rechazadas: es lo que los clientes pidieron cotizar, no lo que compraron. Filtrá por "Confirmada" para ver ventas cerradas.';
    el.textContent = `${VISTAS[state.vista].ayuda} ${alcance}`;
  }

  function encabezados() {
    return VISTAS[state.vista].columnas.map((c) => {
      if (!c.clave) return `<th${c.derecha ? ' class="text-right"' : ''}>${c.texto}</th>`;
      const activo = state.sortBy === c.clave;
      const flecha = activo ? (state.sortOrder === 'ASC' ? ' ▲' : ' ▼') : '';
      return `<th data-sort="${c.clave}"${c.derecha ? ' class="text-right"' : ''}
                  style="cursor:pointer;user-select:none;">${c.texto}${flecha}</th>`;
    }).join('');
  }

  async function load() {
    const vista   = VISTAS[state.vista];
    const results = $('#ci-results');
    results.innerHTML = tableSkeleton({ columnas: vista.columnas.length, etiqueta: 'Cargando consumo' });
    actualizarNota();

    const params = new URLSearchParams({
      agrupar: state.vista,
      page: String(state.page), limit: String(state.limit),
      sort_by: state.sortBy, sort_order: state.sortOrder,
    });
    if (state.desde)  params.set('fecha_desde', state.desde);
    if (state.hasta)  params.set('fecha_hasta', state.hasta);
    if (state.estado) params.set('estado', state.estado);
    if (state.q)      params.set('q', state.q);

    const ejec = opts.idEjecutivo ?? state.ejecutivo;
    if (ejec) params.set('id_ejecutivo', String(ejec));

    try {
      const body  = await api.get(`/api/reportes/cliente-item?${params}`);
      const filas = body.data ?? [];
      ultimasFilas = filas;

      const total = body.pagination?.totalRecords ?? filas.length;
      $('#ci-total').textContent = state.vista === 'item'
        ? `${total} ítem(s) distintos`
        : `${total} combinación(es) ejecutivo–cliente–ítem`;

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
            <thead><tr>${encabezados()}</tr></thead>
            <tbody>${filas.map((f) => `<tr>${vista.fila(f)}</tr>`).join('')}</tbody>
          </table>
        </div>`;

      // Ordenar haciendo clic en el encabezado; volver a hacer clic invierte.
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
  // Se exporta lo que se está viendo: si alguien filtró y ordenó, el archivo
  // tiene que coincidir con la pantalla.
  function exportarCsv() {
    if (ultimasFilas.length === 0) return;
    const def = VISTAS[state.vista].csv;

    // Un valor que empieza con = + - @ lo interpreta Excel como fórmula. La
    // comilla simple es la mitigación estándar de CSV injection, y acá los
    // datos son texto que cargan los usuarios.
    const escapar = (v) => {
      let s = v == null ? '' : String(v);
      if (/^[=+\-@]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };

    const lineas = ultimasFilas.map((f) => def.fila(f).map(escapar).join(','));
    // El BOM hace que Excel abra el archivo como UTF-8; sin él, los acentos y
    // las ñ salen como caracteres raros.
    const csv  = '﻿' + [def.cabecera.map(escapar).join(','), ...lineas].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `consumo-${state.vista}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Controles ──────────────────────────────────────────────────────────────
  const aplicar = () => {
    state.desde     = $('#ci-desde').value;
    state.hasta     = $('#ci-hasta').value;
    state.estado    = $('#ci-estado').value;
    state.q         = $('#ci-q').value.trim();
    state.ejecutivo = $('#ci-ejecutivo')?.value ?? '';
    state.page      = 1;
    load();
  };

  panel.querySelectorAll('#ci-vistas .tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (state.vista === btn.dataset.vista) return;
      state.vista = btn.dataset.vista;
      panel.querySelectorAll('#ci-vistas .tab-btn')
        .forEach((b) => b.classList.toggle('active', b === btn));
      // Cada vista admite columnas de orden distintas: volver a «cantidad»
      // evita pedir un sort_by que la otra no acepta (el backend da 422).
      state.sortBy    = 'cantidad';
      state.sortOrder = 'DESC';
      state.page      = 1;
      load();
    });
  });

  $('#ci-apply').addEventListener('click', aplicar);
  $('#ci-estado').addEventListener('change', aplicar);
  $('#ci-ejecutivo')?.addEventListener('change', aplicar);
  $('#ci-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') aplicar(); });
  $('#ci-csv').addEventListener('click', exportarCsv);
  $('#ci-clear').addEventListener('click', () => {
    $('#ci-desde').value = ''; $('#ci-hasta').value = '';
    $('#ci-estado').value = ''; $('#ci-q').value = '';
    if ($('#ci-ejecutivo')) $('#ci-ejecutivo').value = '';
    aplicar();
  });

  await load();

  return function destroy() { clearPagination(); };
}
