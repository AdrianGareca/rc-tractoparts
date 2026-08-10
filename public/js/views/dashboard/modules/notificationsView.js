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
// _requestNotifPermission
// Silently requests Web Notification permission on first load.
// MUST be called from a user-gesture context (e.g. page load after interaction)
// to satisfy browser security policies.  Non-fatal: failing does not affect
// the in-app badge or modal — desktop push is purely additive.
// ---------------------------------------------------------------------------
export function requestNotifPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// _pushDesktopNotif
// Fires a native browser desktop notification if permission has been granted.
// Works when the tab is in the background or minimised (WhatsApp-web style).
// @param {string} title   — Notification header
// @param {string} body    — Short dynamic body text
// @param {string} [icon]  — Optional icon URL (defaults to company logo)
// ---------------------------------------------------------------------------
function _pushDesktopNotif(title, body, icon = '/assets/images/rc_logo.png') {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, {
      body,
      icon,
      badge: icon,
      tag:   'rc-tractoparts-notif',   // collapses repeated notifications into one
      renotify: true,                  // vibrate/sound even if tag already shown
    });
    // Auto-close after 6 s so it doesn't pile up in the notification centre
    setTimeout(() => n.close(), 6000);
  } catch (_) { /* non-fatal — Notification API unavailable in some contexts */ }
}

// ---------------------------------------------------------------------------
// _tipoStyle — returns { borderColor, labelColor } for each tipo
//
// Los labelColor eran hexadecimales fijos (#065F46, #1D4ED8, #0F766E, #9A3412):
// el tono 700/800 de cada matiz, que es el valor que --clr-*-soft toma SÓLO en
// el tema claro. En los temas oscuros quedaba texto casi negro sobre fondo
// oscuro. Con el token, el color sigue al tema.
//
// Cada tipo traía además un emoji que se anteponía al texto de la observación.
// Sobraba por partida doble: la notificación ya lleva ese mismo color en el
// borde izquierdo, y ya está agrupada bajo el título de su tipo. El dibujo era
// la tercera vez que se decía lo mismo, y encima quedaba pegado al comentario
// que escribió una persona — que es lo único que hay para leer ahí.
// ---------------------------------------------------------------------------
function _tipoStyle(tipo) {
  if (tipo === 'aprobacion')    return { borderColor: 'var(--clr-green)',  labelColor: 'var(--clr-green-soft)' };
  if (tipo === 'envio_cliente') return { borderColor: 'var(--clr-blue)',   labelColor: 'var(--clr-blue-soft)' };
  if (tipo === 'licitacion')    return { borderColor: 'var(--clr-teal)',   labelColor: 'var(--clr-teal-soft)' };
  return                               { borderColor: 'var(--clr-orange)', labelColor: 'var(--clr-orange-soft)' }; // correccion
}

// ---------------------------------------------------------------------------
// _buildNotifItem — renders a single notification <li> element
// ---------------------------------------------------------------------------
function _buildNotifItem(n) {
  const { borderColor, labelColor } = _tipoStyle(n.tipo);
  const fecha = n.fecha_solicitud
    ? new Date(n.fecha_solicitud).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })
    : '—';

  const mensaje = n.observacion
    ? `<br><em class="text-sm" style="color:${labelColor};">${escHtml(n.observacion)}</em>`
    : '';

  return `
    <li style="padding:.6rem .75rem;border:1px solid ${borderColor};border-left:4px solid ${borderColor};
               border-radius:6px;margin-bottom:.5rem;background:var(--bg-raised);">
      <strong>${escHtml(n.numero_correlativo)}</strong>
      — ${escHtml(n.cliente_nombre ?? '—')}<br>
      <span class="text-sm text-secondary">
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
      // Track previous count so we only push a desktop notification when
      // the badge count actually increases (new events, not just re-polls).
      const prevTotal = parseInt(btn.dataset.prevTotal ?? '0', 10);
      btn.dataset.prevTotal = String(total);

      // Visibilidad por clase, no por element.style: los estilos del botón
      // viven en css/components.css (.notif-btn) y mezclar ambos mecanismos
      // hace que el estado final dependa de cuál escribió último.
      btn.classList.remove('hidden');
      badge.textContent = total > 99 ? '99+' : String(total);
      btn.title         = `Tienes ${total} notificación${total > 1 ? 'es' : ''} pendiente${total > 1 ? 's' : ''}`;

      // Fire a desktop push notification when new events have arrived since
      // the last poll — even if the browser tab is minimised or in the background.
      if (total > prevTotal) {
        const diff = total - prevTotal;
        _pushDesktopNotif(
          'RC Tractoparts',
          `Tienes ${diff} nueva${diff > 1 ? 's' : ''} notificación${diff > 1 ? 'es' : ''} pendiente${diff > 1 ? 's' : ''}.`,
        );
      }
      // One-time click handler — open notification summary modal
      btn.onclick = () => {
        api.get('/api/cotizaciones/notificaciones').then(d => {
          const rows = d.data ?? [];

          // Partition OUTSIDE the modal callback so the reference is available
          // for the markNotificacionesLeidas call wired to the explicit button.
          //   • aprobaciones/envios + licitacion → live in the `notificaciones`
          //     table and are cleared by POST /notificaciones/leer.
          //   • correcciones → derived from the state history; self-clear when the
          //     quote is re-submitted (NOT cleared by the button).
          const aprobaciones = rows.filter(r => r.tipo === 'aprobacion' || r.tipo === 'envio_cliente');
          const licitaciones = rows.filter(r => r.tipo === 'licitacion');
          const correcciones = rows.filter(r => r.tipo === 'correccion');
          // All table-backed notifications the "marcar leídas" button clears.
          const marcables = aprobaciones.length + licitaciones.length;

          UI.openModal('Notificaciones', (body) => {
            const sectionHtml = (titleColor, title, items) => items.length > 0 ? `
              <p class="text-sm fw-600" style="color:${titleColor};margin:.75rem 0 .35rem;">${title}</p>
              <ul class="lista-limpia mb-1">
                ${items.map(_buildNotifItem).join('')}
              </ul>` : '';

            const aprobSection = sectionHtml('var(--clr-green-soft)', 'Aprobaciones y envíos recientes', aprobaciones);
            const licSection   = sectionHtml('var(--clr-teal-soft)', 'Licitaciones', licitaciones);
            const corrSection  = sectionHtml('var(--clr-orange-soft)', 'Proformas que requieren correcciones', correcciones);

            // "Mark as read" clears every table-backed notification (aprobaciones,
            // envíos y licitaciones). Se muestra siempre que haya alguna marcable.
            const markReadBtn = marcables > 0
              ? `<button id="btn-marcar-leidas" class="btn btn-ghost btn-sm mt-1">
                   Marcar como leídas
                 </button>`
              : '';

            body.innerHTML = `
              <p class="text-sm text-secondary mb-1">
                Tienes <strong>${rows.length}</strong> notificación${rows.length > 1 ? 'es' : ''} pendiente${rows.length > 1 ? 's' : ''}.
              </p>
              ${aprobSection}
              ${licSection}
              ${corrSection}
              ${markReadBtn}`;

            // Wire the explicit mark-as-read button AFTER innerHTML is set
            body.querySelector('#btn-marcar-leidas')?.addEventListener('click', async () => {
              await api.post('/api/cotizaciones/notificaciones/leer', {}).catch(() => {});
              showToast('Notificaciones marcadas como leídas.', 'success');
              // Refresh badge immediately so the count updates
              await refreshNotifBadge(UI);
            });
          });
        }).catch(() => showToast('No se pudo cargar las notificaciones.', 'error'));
      };
    } else {
      // Reset the peak counter too — otherwise a later, smaller batch of new
      // notifications (e.g. total=1 after everything was marked read) would
      // never exceed the stale prevTotal and the desktop push would stay silent.
      btn.dataset.prevTotal = '0';
      btn.classList.add('hidden');
    }
  } catch (_) { /* non-fatal — badge failure must not break the dashboard */ }
}

// ---------------------------------------------------------------------------
// startNotifPolling
// Starts a periodic refresh of the notification badge so the count stays
// current across soft navigations and long-lived dashboard sessions.
// Returns the interval ID so the caller can clear it on teardown.
//
// @param {Object} UI          — The UI modal helper singleton
// @param {number} [intervalMs=90000] — Poll interval (default 90 s)
// ---------------------------------------------------------------------------
export function startNotifPolling(UI, intervalMs = 90_000) {
  // Fetch immediately, then on each interval tick
  refreshNotifBadge(UI);
  return setInterval(() => refreshNotifBadge(UI), intervalMs);
}
