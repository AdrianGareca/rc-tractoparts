// =============================================================================
// public/js/views/quotationForm/draftLock.js
// Reserva en tiempo real del próximo correlativo ("alguien más está redactando").
//
// Encapsula TODO el estado del draft-lock — socket, si esta pestaña es la dueña
// de la reserva, y si el formulario ya se destruyó — que antes vivía suelto en
// FormMediator. El Mediator ahora sólo delega.
//
// El flag `destroyed` es también el que usa render() para abortar si el modal
// se cerró mientras cargaban los catálogos: hay un único dueño de ese estado.
//
// Extraído de FormMediator._initDraftLock / _renderLockState /
// _updateCorrelativoPreview / _releaseDraftLock sin cambios de comportamiento.
// Cubierto por tests/unit/quotationFormDraftLock.test.js.
// =============================================================================

import { connectSocket } from '../../services/socketClient.js';
import { escText, nextCorrelativoOf } from './helpers.js';

/** Timeout de los acks de Socket.IO (que por defecto no tienen ninguno). */
export const ACK_TIMEOUT_MS = 5000;

/**
 * Texto del aviso "otro ejecutivo está redactando". Función pura.
 *
 * Es INFORMATIVO, no una advertencia: no hay riesgo de duplicado que evitar.
 * El serial se asigna atómicamente al guardar (SELECT…FOR UPDATE de
 * generateCorrelativo), así que quien guarde primero se queda con ese número y
 * este formulario recibe el siguiente. Pedirle al usuario que espere sería
 * bloquearlo por algo que la base de datos ya resuelve.
 *
 * @returns {{ html: string, proximo: string|null }}
 */
export function buildLockBannerHtml(state) {
  const nombre  = escText(state?.ejecutivo?.nombre ?? 'otro ejecutivo');
  const numero  = escText(state?.numero_correlativo ?? '');
  const proximo = nextCorrelativoOf(state?.numero_correlativo);

  const html =
    `ℹ️ <strong>${nombre}</strong> está redactando la cotización <strong>${numero}</strong> ` +
    `en este momento. Podés continuar normalmente: al guardar se te asignará ` +
    (proximo
      ? `el siguiente número disponible (aprox. <strong>${escText(proximo)}</strong>).`
      : `el siguiente número disponible.`);

  return { html, proximo };
}

export class DraftLockController {
  #container;
  #socket    = null;   // Realtime draft-lock connection (creation mode only)
  #hasLock   = false;  // true once THIS socket owns the global next-number reservation
  #destroyed = false;  // true once the form was torn down — guards the async connect

  constructor(container) {
    this.#container = container;
  }

  /** True once release() corrió — el formulario ya no debe tocar el DOM. */
  isDestroyed() { return this.#destroyed; }

  /** True cuando esta pestaña es la dueña de la reserva. */
  hasLock() { return this.#hasLock; }

  // ── Reserva + suscripción a los cambios en vivo ──────────────────────────
  // Fire-and-forget: la capa de tiempo real es una mejora de UX, nunca una
  // dependencia dura del formulario.
  async init() {
    try {
      const socket = await connectSocket();

      // The form may have been closed (cancel / destroy) WHILE connectSocket was
      // still resolving. In that window release() ran as a no-op (there was no
      // socket yet), so if we adopted this socket now it would leak and leave a
      // stale "está redactando" banner for everyone else. Bail out and tear the
      // just-opened socket down immediately.
      if (this.#destroyed) {
        socket.disconnect();
        return;
      }

      this.#socket = socket;
      this.#socket.on('cotizacion:draft:update', (state) => this.renderLockState(state));

      // .timeout() guards against a hung ack (e.g. server restarted between
      // connect and join) — without it this await could wait forever since
      // Socket.IO acks have no default timeout.
      const ack = await new Promise((resolve) => {
        this.#socket
          .timeout(ACK_TIMEOUT_MS)
          .emit('cotizacion:draft:join', null, (err, res) => resolve(err ? null : res));
      });

      if (!ack?.success) return;

      if (ack.mine) {
        this.#hasLock = true;
        this.updateCorrelativoPreview(ack.numero_correlativo);
      } else {
        this.renderLockState({
          locked:             true,
          numero_correlativo: ack.numero_correlativo,
          ejecutivo:          ack.ejecutivo,
        });
      }
    } catch (err) {
      // Non-fatal: realtime layer unreachable — the form still works exactly
      // as before, just without the live collision warning.
      console.warn('[quotationForm] Draft-lock realtime layer unavailable:', err?.message || err);
    }
  }

  /** Render (or clear) the "someone else is drafting this number" notice. */
  renderLockState(state) {
    const banner = this.#container.querySelector('#qf-lock-banner');
    if (!banner) return;

    if (state?.locked && !this.#hasLock) {
      const { html, proximo } = buildLockBannerHtml(state);

      banner.innerHTML = html;
      banner.classList.remove('alert-warning');
      banner.classList.add('alert-info', 'show');

      // Show the approximate next serial instead of the one already taken, so
      // the badge stops contradicting the notice right below it.
      if (proximo) this.updateCorrelativoPreview(`${proximo} (aprox.)`);
    } else if (!state?.locked) {
      banner.classList.remove('show', 'alert-info');
      banner.classList.add('alert-warning');
      banner.innerHTML = '';

      // The previous holder just released the number — try to claim it as
      // ours so this form's preview reflects the now-available serial.
      if (!this.#hasLock && this.#socket?.connected) {
        this.#socket
          .timeout(ACK_TIMEOUT_MS)
          .emit('cotizacion:draft:join', null, (err, ack) => {
            if (!err && ack?.success && ack.mine) {
              this.#hasLock = true;
              this.updateCorrelativoPreview(ack.numero_correlativo);
            }
          });
      }
    }
  }

  /** Update the read-only "Próximo Nº" badge once this socket owns the reservation. */
  updateCorrelativoPreview(numeroCorrelativo) {
    const el = this.#container.querySelector('.correlativo-preview span:last-child');
    if (el) el.textContent = numeroCorrelativo;
  }

  /** Release this socket's reservation (if any) and tear down the connection. Idempotent. */
  release() {
    // Mark teardown so an in-flight init() connect that resolves AFTER this
    // point disconnects the socket instead of adopting (and leaking) it.
    this.#destroyed = true;
    if (!this.#socket) return;
    if (this.#hasLock) {
      this.#socket.emit('cotizacion:draft:leave');
      this.#hasLock = false;
    }
    this.#socket.disconnect();
    this.#socket = null;
  }
}
