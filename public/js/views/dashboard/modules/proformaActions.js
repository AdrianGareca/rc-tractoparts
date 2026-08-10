// =============================================================================
// public/js/views/dashboard/modules/proformaActions.js
// Qué botones puede ver cada rol sobre una proforma, y su marcado.
//
// POR QUÉ SE SEPARÓ DE LA PLANTILLA
// buildProformaHTML tenía 346 líneas y era la función más larga del proyecto
// entero. Adentro convivían dos cosas de naturaleza distinta:
//
//   • DECISIÓN — quién puede hacer qué según su rol y el estado actual. Son
//     reglas de negocio, y las mismas que el servidor vuelve a verificar.
//   • PRESENTACIÓN — cómo se dibujan los datos de la cotización.
//
// Mezcladas, cambiar un permiso obligaba a leer trescientas líneas de HTML para
// encontrar el `if`. Separadas, las reglas caben en una pantalla.
//
// ESTAS CONDICIONES SON SÓLO DE INTERFAZ
// Ninguna es una medida de seguridad: el servidor revalida cada transición
// contra la matriz de roles y contra el flag de delegación releído de la base.
// Lo que hacen acá es no ofrecer un botón que va a devolver 403 — que es
// distinto de impedir la acción.
// =============================================================================

import { escHtml } from '../helpers.js';
import { REOPEN_SOURCE_STATES } from '../../../shared/quotationTransitions.js';

/**
 * Calcula los permisos de interfaz y arma los tres bloques de botones.
 *
 * @param {Object}  q             — la cotización completa
 * @param {Object}  modo
 * @param {boolean} modo.jefeMode     — vista de decisión del Jefe
 * @param {boolean} modo.adminMode    — vista de revisión del Administrador
 * @param {boolean} modo.delegateMode — ejecutivo con delegación ampliada
 * @returns {{ jefeButtons:string, adminButtons:string, adminCommentBlock:string }}
 */
export function buildProformaActions(q, { jefeMode, adminMode, delegateMode }) {
  // Operational action grid — contextual buttons based on current state.
  // Rendered for the Jefe AND for delegated executives (Delegación de Funciones
  // ampliada): both operate the full lifecycle with the same transitions. The
  // backend re-validates every action against the DB-fresh flag, so these
  // conditionals are pure UI gating.
  const operative       = jefeMode || delegateMode;
  const canApprove      = operative && ['Pendiente', 'En revision', 'En espera'].includes(q.estado);
  const canEnviarCliente= operative && ['Pendiente', 'En revision', 'En espera', 'Aprobada internamente'].includes(q.estado);
  const canAceptar      = operative && ['Aprobada internamente', 'Enviada al cliente'].includes(q.estado);
  const canRechazar     = operative && !['Confirmada', 'Aceptada', 'Archivada', 'Rechazada'].includes(q.estado);
  const canHold         = operative && ['Pendiente', 'En revision', 'Aprobada internamente', 'Enviada al cliente'].includes(q.estado);
  const canRetract      = operative && ['En revision', 'En espera', 'Aprobada internamente', 'Enviada al cliente'].includes(q.estado);
  // High-privilege revert: only Jefe/SysAdmin can revert a Rechazada quotation.
  // Deliberately NOT extended to delegates — reverting a rejection re-opens a
  // closed commercial decision and stays with the Jefe.
  const canRevertir = jefeMode && q.estado === 'Rechazada';

  // Archivar — la capacidad estaba en la matriz del backend desde siempre
  // (todos los roles pueden archivar desde cualquier estado no terminal) pero
  // NINGUNA condición de este bloque dibujaba el botón. El efecto visible era
  // que con la cotización en 'Confirmada' las siete condiciones anteriores daban
  // false y el panel del Jefe se renderizaba vacío: se abría la proforma y no
  // había una sola acción disponible.
  const canArchivar = operative && q.estado !== 'Archivada';

  // La llave del jefe — reabrir una venta ya cerrada.
  // Sólo Jefe/SysAdmin: el backend rechaza la transición para un ejecutivo
  // delegado aunque opere con la matriz del Jefe, así que ofrecerle el botón
  // sería ofrecerle un 403. Mismo criterio que canRevertir.
  const canReabrir = jefeMode && REOPEN_SOURCE_STATES.includes(q.estado);

  const jefeButtons = operative ? `
    <div class="approval-actions">
      <h4 class="approval-actions-title">${jefeMode ? 'Decisión del Jefe' : 'Acciones Operativas — Delegación de Funciones'}</h4>
      <div class="approval-actions-grid">
        ${canRetract ? `<button class="btn btn-warning btn-sm" id="btn-solicitar-cambios">
          Solicitar cambios
        </button>` : ''}
        ${canHold ? `<button class="btn btn-hold btn-sm" id="btn-en-espera">
          Poner en espera
        </button>` : ''}
        ${canApprove ? `<button class="btn btn-success" id="btn-aprobar">
          Aprobar cotización
        </button>` : ''}
        ${canEnviarCliente ? `<button class="btn btn-success" id="btn-enviar-cliente">
          Aprobar y Enviar al Cliente
        </button>` : ''}
        ${canAceptar ? `<button class="btn btn-primary btn-fila-entera" id="btn-aceptar">
          Confirmar Cotización — Cierre de Venta
        </button>` : ''}
        ${canRechazar ? `<button class="btn btn-danger btn-sm" id="btn-rechazar">
          Rechazar
        </button>` : ''}
        ${canArchivar ? `<button class="btn btn-ghost btn-sm" id="btn-archivar">
          Archivar
        </button>` : ''}
      </div>
    </div>
    ${canReabrir ? `
    <div class="approval-actions llave-jefe">
      <h4 class="approval-actions-title llave-jefe-title">Llave del Jefe</h4>
      <p class="text-sm llave-jefe-text">
        Esta cotización es una <strong>venta cerrada</strong>. Reabrirla la devuelve a
        <strong>Pendiente</strong> para que el ejecutivo pueda corregirla, y luego se vuelve
        a confirmar. Es una acción excepcional: exige un motivo y queda
        <strong>registrada</strong> con tu nombre en el historial y en la bitácora de auditoría.
      </p>
      <button class="btn btn-sm llave-jefe-btn" id="btn-reabrir">
        Reabrir para corrección
      </button>
    </div>` : ''}
    ${canRevertir ? `
    <div class="approval-actions revertir-rechazo">
      <h4 class="approval-actions-title revertir-rechazo-title">Revertir rechazo</h4>
      <p class="text-sm text-secondary mb-1">
        Como autoridad comercial superior, puede revaluar esta cotización y reintroducirla
        en el flujo de aprobación. Las observaciones de rechazo previas serán preservadas
        en el historial de estados.
      </p>
      <div class="proforma-acciones-fila">
        <button class="btn btn-warning btn-sm" id="btn-revertir-pendiente">
          Revertir a Pendiente
        </button>
        <button class="btn btn-orange btn-sm" id="btn-revertir-revision">
          Revertir a En Revisión
        </button>
      </div>
    </div>` : ''}
    ` : '';

  // Admin action panel — comment box + "En Espera" + "Solicitar cambios" buttons
  const adminButtons = adminMode ? `
    <div class="approval-actions admin-review-panel">
      <h4 class="approval-actions-title">Revisión del Administrador</h4>
      <div class="form-group mb-1">
        <label class="form-label" for="admin-comment-input">Comentario de supervisión</label>
        <textarea class="form-control textarea-vertical" id="admin-comment-input" rows="3"
                  placeholder="Ej: Verificar disponibilidad con proveedor antes de aprobar...">${escHtml(q.comentarios_admin ?? '')}</textarea>
        <span class="field-error" id="admin-comment-err"></span>
      </div>
      <div class="proforma-acciones-fila">
        <button class="btn btn-ghost btn-sm" id="btn-save-comment">
          Guardar comentario
        </button>
        <button class="btn btn-hold btn-sm" id="btn-admin-en-espera">
          Poner en espera con Comentario
        </button>
        ${
          ['En revision', 'En espera', 'Aprobada internamente'].includes(q.estado)
            ? `<button class="btn btn-warning btn-sm" id="btn-admin-solicitar-cambios">
          Solicitar cambios
        </button>`
            : ''
        }
      </div>
    </div>` : '';

  // NOTE (Delegación ampliada): the former single "Aprobar internamente" button
  // block was superseded by the full operational grid above (jefeButtons renders
  // in delegate mode too). Delegated actions are wired by ExecutiveStrategy to
  // flow through PUT /:id/estado — never the jefeOnly POST /:id/aprobar route.
  const delegateButtons = '';

  // Read-only admin comment block — shown to ALL authenticated roles when a
  // comment exists, so Ejecutivos can see supervisor notes.  In Jefe mode an
  // empty-state placeholder is also rendered so the section is never invisible.
  // Hidden in adminMode because that mode already provides an editable textarea.
  const adminCommentBlock = !adminMode && q.comentarios_admin
    ? `<div class="form-group comentario-admin">
      <span class="form-label text-orange">Comentario del Administrador</span>
      <p class="proforma-description mt-025">${escHtml(q.comentarios_admin)}</p>
    </div>`
    : jefeMode && !adminMode
      ? `<div class="form-group comentario-admin">
      <span class="form-label text-orange">Comentario del Administrador</span>
      <p class="proforma-description text-muted mt-025 fst-italic">Sin comentarios del Administrador.</p>
    </div>`
      : '';
  return { jefeButtons, adminButtons, delegateButtons, adminCommentBlock };
}
