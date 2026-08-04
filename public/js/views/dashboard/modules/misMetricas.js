// =============================================================================
// public/js/views/dashboard/modules/misMetricas.js
// El reporte propio del ejecutivo: cómo viene su trabajo y cómo lo cierra.
//
// QUÉ REEMPLAZA
// El tablero mostraba dos tablas —sus clientes principales y UNA fila con sus
// totales— y nada más. Para alguien que quiere ver cómo viene, era un resumen
// de un renglón.
//
// LA JERARQUÍA DE LA PANTALLA NO ES CASUAL
// Arriba de todo, grande, la CONVERSIÓN: de lo que mandé al cliente, cuánto
// cerré. Es lo que distingue al que cotiza mucho del que vende — y en esta
// empresa, donde se cotiza todo lo que llega, el volumen por sí solo no dice
// nada. Al lado, los días promedio hasta el cierre: cerrar el 40% en cinco días
// no es lo mismo que cerrar el 40% en dos meses.
//
// Debajo, el desglose por estado, que es la pregunta operativa del día a día:
// «¿en qué anda cada cotización mía?».
//
// LOS MONTOS VAN SIEMPRE SEPARADOS POR MONEDA. Sumar USD con Bs. da un número
// sin significado; es el mismo error que ya apareció dos veces en el proyecto.
// =============================================================================

import api from '../../../services/apiClient.js';
import { escHtml, badgeHtml, fmtAmount } from '../helpers.js';
import { tableSkeleton } from '../../../shared/skeleton.js';

/** Un número que puede no existir todavía. */
const val = (v, sufijo = '') => (v == null ? '—' : `${v}${sufijo}`);

// ── Tarjeta de indicador ─────────────────────────────────────────────────────
// `acento` tiñe el número: verde/ámbar/rojo según qué tan bien viene. El color
// se decide con el dato, no se fija a mano, para que no quede un verde alegre
// sobre una conversión del 3%.
// Usa las clases que ya existen (.stat-card-value / .stat-card-label), no unas
// inventadas: si no, la tarjeta hereda el borde y la sombra pero el texto queda
// sin estilo y se ve a medio hacer.
function tarjeta({ titulo, valor, detalle = '', acento = 'var(--clr-blue)', grande = false }) {
  return `
    <div class="stat-card" style="--stat-accent:${acento};">
      <div class="stat-card-value" style="${grande ? 'font-size:2.4rem;' : ''}color:${acento};">
        ${valor}
      </div>
      <div class="stat-card-label">${escHtml(titulo)}</div>
      ${detalle ? `<div class="text-muted text-xs" style="margin-top:.35rem;line-height:1.35;">${detalle}</div>` : ''}
    </div>`;
}

/** Verde arriba de 40, ámbar arriba de 20, rojo abajo. */
function colorConversion(pct) {
  if (pct == null) return 'var(--clr-gray)';
  if (pct >= 40)   return 'var(--clr-green)';
  if (pct >= 20)   return 'var(--clr-amber)';
  return 'var(--clr-red)';
}

function tablaPorEstado(filas) {
  if (filas.length === 0) {
    return '<div class="empty-state"><p>Sin cotizaciones en el período elegido.</p></div>';
  }

  const total = filas.reduce((a, f) => a + f.cantidad, 0);

  return `
    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th>Estado</th>
            <th class="text-right">Cantidad</th>
            <th class="text-right">% del total</th>
            <th class="text-right">Monto USD</th>
            <th class="text-right">Monto Bs.</th>
          </tr>
        </thead>
        <tbody>
          ${filas.map((f) => `
            <tr>
              <td>${badgeHtml(f.estado)}</td>
              <td class="text-right fw-600">${f.cantidad}</td>
              <td class="text-right text-muted">${((f.cantidad / total) * 100).toFixed(1)}%</td>
              <td class="text-right">${f.monto_usd > 0 ? fmtAmount(f.monto_usd, 'USD') : '—'}</td>
              <td class="text-right">${f.monto_bob > 0 ? fmtAmount(f.monto_bob, 'BOB') : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// ── Evolución mes a mes ──────────────────────────────────────────────────────
// Barras en CSS puro, sin librería de gráficos: son doce filas y la comparación
// que importa es «emitidas contra cerradas», que se lee bien con dos barras.
// Traer una dependencia de gráficos para esto sería desproporcionado.
function tablaPorMes(filas) {
  if (filas.length === 0) return '';
  const tope = Math.max(...filas.map((f) => f.emitidas), 1);

  return `
    <div class="card mt-2">
      <div class="card-header">
        <h3>Mi evolución</h3>
        <span class="text-muted text-sm">Emitidas contra cerradas, mes a mes</span>
      </div>
      <div style="padding:1rem 1.25rem;display:flex;flex-direction:column;gap:.6rem;">
        ${filas.map((f) => {
          const pct = f.emitidas > 0 ? Math.round((f.cerradas / f.emitidas) * 100) : 0;
          return `
          <div style="display:flex;align-items:center;gap:.75rem;">
            <span class="text-sm text-muted" style="min-width:5rem;">${escHtml(f.mes)}</span>
            <div style="flex:1;height:1.15rem;background:var(--bg-hover);border-radius:var(--radius-sm);overflow:hidden;position:relative;">
              <div style="width:${(f.emitidas / tope) * 100}%;height:100%;background:rgba(59,130,246,.35);"></div>
              <div style="width:${(f.cerradas / tope) * 100}%;height:100%;background:var(--clr-green);position:absolute;top:0;left:0;"></div>
            </div>
            <span class="text-sm" style="min-width:8.5rem;text-align:right;">
              <strong>${f.cerradas}</strong> de ${f.emitidas}
              <span class="text-muted">(${pct}%)</span>
            </span>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

/**
 * Dibuja el reporte propio dentro de un contenedor.
 *
 * @param {HTMLElement} el
 * @param {Object} [opts]
 * @param {string} [opts.desde] YYYY-MM-DD
 * @param {string} [opts.hasta] YYYY-MM-DD
 * @param {number} [opts.idEjecutivo] para que un Jefe mire las de otro
 */
export async function renderMisMetricas(el, { desde, hasta, idEjecutivo } = {}) {
  if (!el) return;
  el.innerHTML = tableSkeleton({ columnas: 5, etiqueta: 'Cargando mis métricas' });

  const params = new URLSearchParams();
  if (desde)       params.set('fecha_desde', desde);
  if (hasta)       params.set('fecha_hasta', hasta);
  if (idEjecutivo) params.set('id_ejecutivo', String(idEjecutivo));

  try {
    const res = await api.get(`/api/reportes/mis-metricas?${params}`);
    const m   = res.data ?? {};

    const colorConv = colorConversion(m.conversion);

    el.innerHTML = `
      <div class="stats-grid mb-2">
        ${tarjeta({
          titulo:  'Tasa de conversión',
          valor:   m.conversion == null ? '—' : `${m.conversion}%`,
          detalle: m.conversion == null
            ? 'Todavía no enviaste ninguna al cliente'
            : `${m.cerradas} cerradas de ${m.en_la_cancha} que llegaron al cliente`,
          acento:  colorConv,
          grande:  true,
        })}
        ${tarjeta({
          titulo:  'Días promedio hasta el cierre',
          valor:   val(m.dias_cierre),
          detalle: 'Desde que la cargás hasta que el cliente confirma',
          acento:  'var(--clr-violet)',
        })}
        ${tarjeta({
          titulo:  'En proceso',
          valor:   m.en_proceso ?? 0,
          detalle: 'Todavía no salieron al cliente',
          acento:  'var(--clr-amber)',
        })}
        ${tarjeta({
          titulo:  'Rechazadas',
          valor:   m.rechazadas ?? 0,
          detalle: `Sobre ${m.total ?? 0} cotizaciones en total`,
          acento:  'var(--clr-red)',
        })}
        ${tarjeta({
          titulo:  'Ticket promedio (USD)',
          valor:   m.ticket_usd == null ? '—' : fmtAmount(m.ticket_usd, 'USD'),
          detalle: 'Promedio de lo que cerrás en dólares',
          acento:  'var(--clr-teal)',
        })}
        ${tarjeta({
          titulo:  'Ticket promedio (Bs.)',
          valor:   m.ticket_bob == null ? '—' : fmtAmount(m.ticket_bob, 'BOB'),
          detalle: 'Promedio de lo que cerrás en bolivianos',
          acento:  'var(--clr-teal)',
        })}
      </div>

      <div class="card">
        <div class="card-header">
          <h3>En qué anda cada cotización</h3>
          <span class="text-muted text-sm">Los montos van separados por moneda: sumarlas no significaría nada</span>
        </div>
        ${tablaPorEstado(m.por_estado ?? [])}
      </div>

      ${tablaPorMes(m.por_mes ?? [])}`;
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>Error cargando métricas: ${escHtml(err.data?.message || err.message)}</p></div>`;
  }
}
