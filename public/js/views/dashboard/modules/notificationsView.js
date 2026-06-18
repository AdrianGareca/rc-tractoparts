// =============================================================================
// public/js/views/dashboard/modules/notificationsView.js
// Notification Center — pending corrections badge and modal summary.
//
// Handles two notification streams returned by GET /api/cotizaciones/notificaciones:
//   • tipo = 'correccion'    — quotation sent back to Pendiente (correction needed)
//   • tipo = 'aprobacion'    — Jefe approved the quotation internally
//   • tipo = 'envio_cliente' — Jefe sent the quotation to the client
//
// After the Ejecutivo opens the modal, POST /api/cotizaciones/notificaciones/leer
// marks approval/envio notifications as read so the badge count resets.
// =============================================================================

import api, { showToast } from '../../../services/apiClient.js';
import { escHtml }        from '../helpers.js';

// ---------------------------------------------------------------------------
// _tipoStyle — returns { icon, borderColor, labelColor } for each tipo
// ---------------------------------------------------------------------------
function _tipoStyle(tipo) {
  if (tipo === 'aprobacion')    return { icon: '✅', borderColor: '#10B981', labelColor: '#065F46' };
  if (tipo === 'envio_cliente') return { icon: '📤', borderColor: '#3B82F6', labelColor: '#1D4ED8' };
  return                               { icon: '⚠️', borderColor: '#F97316', labelColor: '#9A3412' }; // correccion
}

// ---------------------------------------------------------------------------
// _buildNotifItem — renders a single notification <li> element
// ---------------------------------------------------------------------------
function _buildNotifItem(n) {
  const { icon, borderColor, labelColor } = _tipoStyle(n.tipo);
  const fecha = n.fecha_solicitud
    ? new Date(n.fecha_solicitud).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })
    : '—';

  const mensaje = n.observacion
    ? `<br><em class="text-sm" style="color:${labelColor};">${icon} ${escHtml(n.observacion)}</em>`
    : '';

  return `
    <li style="padding:.6rem .75rem;border:1px solid ${borderColor};border-left:4px solid ${borderColor};
               border-radius:6px;margin-bottom:.5rem;background:var(--bg-secondary);">
      <strong>${escHtml(n.numero_correlativo)}</strong>
      — ${escHtml(n.cliente_nombre ?? '—')}<br>
      <span class="text-sm" style="color:var(--text-secondary);">
        ${n.solicitado_por ? `Gestionado por: ${escHtml(n.solicitado_por)}` : ''}
        · ${fecha}
      </span>
      ${mensaje}
    </li>`;
}

// ---------------------------------------------------------------------------
// refreshNotifBadge
// Polls GET /api/cotizaciones/notificaciones once and updates the notification
// badge (#btn-notificaciones / #notif-count) in the topbar.
//
// When notifications exist, attaches an onclick handler that re-fetches the
// list, opens a summary modal, and marks approval notifications as read.
//
// @param {Object} UI  — The UI modal helper singleton from dashboardView.js
// ---------------------------------------------------------------------------
export async function refreshNotifBadge(UI) {
  try {
    const data  = await api.get('/api/cotizaciones/notificaciones');
    const total = data.total ?? 0;
    const btn   = document.getElementById('btn-notificaciones');
    const badge = document.getElementById('notif-count');
    if (!btn || !badge) return;

    if (total > 0) {
      btn.style.display = 'inline-flex';
      badge.textContent = total > 99 ? '99+' : String(total);
      btn.title         = `Tienes ${total} notificación${total > 1 ? 'es' : ''} pendiente${total > 1 ? 's' : ''}`;

      // One-time click handler — open notification summary modal
      btn.onclick = () => {
        api.get('/api/cotizaciones/notificaciones').then(async d => {
          const rows = d.data ?? [];

          // Partition OUTSIDE the modal callback so the reference is available
          // for the markNotificacionesLeidas call below (was the scope bug that
          // triggered a ReferenceError → caught by .catch → showed the toast).
          const aprobaciones = rows.filter(r => r.tipo === 'aprobacion' || r.tipo === 'envio_cliente');
          const correcciones = rows.filter(r => r.tipo === 'correccion');

          UI.openModal('🔔 Notificaciones', (body) => {
            const aprobSection = aprobaciones.length > 0 ? `
              <p class="text-sm fw-600" style="color:#065F46;margin:.75rem 0 .35rem;">
                ✅ Aprobaciones y envíos recientes
              </p>
              <ul style="list-style:none;padding:0;margin:0 0 .75rem;">
                ${aprobaciones.map(_buildNotifItem).join('')}
              </ul>` : '';

            const corrSection = correcciones.length > 0 ? `
              <p class="text-sm fw-600" style="color:#9A3412;margin:.75rem 0 .35rem;">
                ⚠️ Proformas que requieren correcciones
              </p>
              <ul style="list-style:none;padding:0;margin:0 0 .75rem;">
                ${correcciones.map(_buildNotifItem).join('')}
              </ul>` : '';

            body.innerHTML = `
              <p class="text-sm" style="color:var(--text-secondary);margin-bottom:.75rem;">
                Tienes <strong>${rows.length}</strong> notificación${rows.length > 1 ? 'es' : ''} pendiente${rows.length > 1 ? 's' : ''}.
              </p>
              ${aprobSection}
              ${corrSection}
              <p class="text-sm text-muted" style="margin-top:.75rem;">
                Abre la cotización desde "Mis Cotizaciones" para ver el detalle completo.
              </p>`;
          });

          // Mark approval/envio notifications as read so the badge resets
          // on the next poll. Correction notifications self-clear when the
          // Ejecutivo re-submits the quote.
          if (aprobaciones.length > 0) {
            await api.post('/api/cotizaciones/notificaciones/leer', {}).catch(() => {});
          }
        }).catch(() => showToast('No se pudo cargar las notificaciones.', 'error'));
      };
    } else {
      btn.style.display = 'none';
    }
  } catch (_) { /* non-fatal — badge failure must not break the dashboard */ }
}
