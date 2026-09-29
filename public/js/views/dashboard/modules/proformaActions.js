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

import { escHtml, fmtDate } from '../helpers.js';
import { REOPEN_SOURCE_STATES, allowedTransitions } from '../../../shared/quotationTransitions.js';
import AuthSession from '../../../services/authSession.js';

// ─────────────────────────────────────────────────────────────────────────────
// LOS TRES BOTONES DEL EJECUTIVO SIN DELEGACIÓN
//
// Decidido por Adrian el 2026-09-28: el ejecutivo dueño de la cotización puede
// ENVIARLA al cliente (una vez que el Jefe la aprobó), marcar que el cliente la
// RECHAZÓ, y ARCHIVARLA. Nada más: confirmar la venta y todo lo demás lo hace
// el Jefe.
//
// Hasta ese día el ejecutivo no tenía NINGÚN botón de estado. El aviso de
// aprobación le decía «Ya puedes enviarla» y no había con qué.
//
// Para cambiar qué puede hacer, se toca esta lista Y la fila `Ejecutivo` de la
// matriz (src/models/quotation/constants.js, con su espejo en
// shared/quotationTransitions.js). Un botón sólo aparece si está en los dos
// lados: así esta lista nunca ofrece algo que el servidor va a rechazar.
// ─────────────────────────────────────────────────────────────────────────────
export const BOTONES_DEL_EJECUTIVO = [
  { destino: 'Enviada al cliente', id: 'btn-ejec-enviar',    clase: 'btn-success',        texto: 'Marcar como enviada al cliente' },
  { destino: 'Rechazada',          id: 'btn-ejec-rechazada', clase: 'btn-danger btn-sm',  texto: 'El cliente la rechazó' },
  { destino: 'Archivada',          id: 'btn-ejec-archivar',  clase: 'btn-ghost btn-sm',   texto: 'Archivar' },
];

/**
 * Qué botones de estado ve un ejecutivo SIN delegación sobre esta cotización.
 *
 * Tres condiciones, las tres necesarias:
 *   1. es Ejecutivo y NO tiene delegación (el delegado usa la grilla del Jefe);
 *   2. la cotización es SUYA (el servidor lo exige: Guards.verificarDueno);
 *   3. la matriz permite ese paso desde el estado actual.
 *
 * Función pura salvo por la sesión, que se puede pasar para probarla.
 *
 * @param {Object} q — la cotización (estado, id_ejecutivo)
 * @param {Object} [sesion] — { rol, userId, delegado }; por defecto, la sesión actual
 * @returns {Array<{destino, id, clase, texto}>} — posiblemente vacía
 */
export function botonesDelEjecutivo(q, sesion = {
  rol:      AuthSession.getRole(),
  userId:   AuthSession.getUserId(),
  delegado: AuthSession.canApproveQuotations(),
}) {
  if (sesion.rol !== 'Ejecutivo' || sesion.delegado) return [];
  if (Number(q.id_ejecutivo) !== Number(sesion.userId)) return [];

  const permitidos = allowedTransitions('Ejecutivo', q.estado, false);
  return BOTONES_DEL_EJECUTIVO.filter((b) => permitidos.includes(b.destino));
}

/** El bloque de botones del ejecutivo dueño, o '' si no le toca ninguno. */
function ejecutivoButtonsHtml(q) {
  const botones = botonesDelEjecutivo(q);
  if (botones.length === 0) return '';

  return `
    <div class="approval-actions">
      <h4 class="approval-actions-title">Acciones</h4>
      <div class="approval-actions-grid">
        ${botones.map((b) => `<button class="btn ${b.clase}" id="${b.id}">${escHtml(b.texto)}</button>`).join('')}
      </div>
    </div>`;
}

// Debe reflejar EXACTAMENTE src/validators/quotationValidator.js
// SALES_FOLLOWUP_STATES — un desvío hace que el backend rechace con 422 (el
// mismo problema que ya paso una vez con los roles, ver rolesUnaSolaLista.test.js).
const SALES_FOLLOWUP_STATES = [
  'Interesado', 'En negociacion', 'Confirmado', 'No le interesa', 'Venta concretada',
];


/**
 * Qué acciones habilita el estado actual para quien está mirando.
 *
 * Función PURA: no arma HTML, sólo decide. Separarla de los botones es lo que
 * permite responder «¿por qué no me aparece Archivar?» leyendo veinte líneas
 * en vez de buscar un `if` entre el marcado.
 *
 * NINGUNA de estas condiciones es una medida de seguridad: el servidor
 * revalida cada transición contra la matriz de roles y contra el flag de
 * delegación releído de la base. Acá sólo se evita ofrecer un botón que va a
 * devolver 403 — que es distinto de impedir la acción.
 *
 * @returns {Object} un booleano por acción, más `operative`
 */
function calcularPermisos(q, { jefeMode, delegateMode }) {
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


  return {
    operative, canApprove, canEnviarCliente, canAceptar, canRechazar,
    canHold, canRetract, canRevertir, canArchivar, canReabrir,
  };
}

/** La grilla de acciones del Jefe y del ejecutivo delegado. */
function jefeButtonsHtml(q, jefeMode, permisos) {
  const {
    operative, canApprove, canEnviarCliente, canAceptar, canRechazar,
    canHold, canRetract, canRevertir, canArchivar, canReabrir,
  } = permisos;

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

  return jefeButtons;
}

/** El panel de revisión del Administrador: comentario y poner en espera. */
function adminButtonsHtml(q, adminMode) {
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

  return adminButtons;
}

/** El comentario del Administrador, tal como lo ven el ejecutivo y el Jefe. */
function adminCommentBlockHtml(q, { adminMode, jefeMode }) {

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

  return adminCommentBlock;
}

/**
 * El seguimiento comercial (pipeline de venta con el cliente) — independiente
 * del `estado` de aprobación interno de arriba. Editable para Jefe y
 * Administracion (cualquier cotización) y para el Ejecutivo dueño de ESTA
 * cotización — es quien realmente habla con el cliente. Mismo criterio de
 * dueño que el backend aplica en PATCH /:id/seguimiento.
 * En cualquier otro caso (un ejecutivo mirando una cotización ajena) se
 * muestra de solo lectura, y solo si hay un valor guardado — así no se ofrece
 * un botón que el servidor va a rechazar con 403.
 */
function seguimientoVentaBlockHtml(q, { canEdit }) {
  if (canEdit) {
    const esOtro = q.estado_venta === 'Otro';
    return `
    <div class="approval-actions seguimiento-venta-panel">
      <h4 class="approval-actions-title">Seguimiento comercial</h4>
      <div class="form-group mb-1">
        <label class="form-label" for="seguimiento-estado-input">Estado de venta</label>
        <select class="form-control" id="seguimiento-estado-input">
          <option value="">Sin seguimiento</option>
          ${SALES_FOLLOWUP_STATES.map((s) => `<option value="${escHtml(s)}" ${q.estado_venta === s ? 'selected' : ''}>${escHtml(s)}</option>`).join('')}
          <option value="Otro" ${esOtro ? 'selected' : ''}>Otro (especificar)</option>
        </select>
      </div>
      <div class="form-group mb-1 ${esOtro ? '' : 'hidden'}" id="seguimiento-detalle-group">
        <label class="form-label" for="seguimiento-detalle-input">Especificar</label>
        <input class="form-control" type="text" id="seguimiento-detalle-input" maxlength="255"
               value="${escHtml(q.estado_venta_detalle ?? '')}"
               placeholder="Ej: esperando presupuesto del cliente" />
      </div>
      <div class="form-group mb-1">
        <label class="form-label" for="seguimiento-fecha-btn">Fecha de próximo seguimiento</label>
        <!-- Botón, no <input type="date">: el picker nativo no se puede marcar
             por dentro. El calendario propio (shared/calendarPicker.js) sí
             puede pintar qué días ya tienen otro seguimiento agendado. -->
        <input type="hidden" id="seguimiento-fecha-input"
               value="${q.fecha_proximo_seguimiento ? String(q.fecha_proximo_seguimiento).slice(0, 10) : ''}" />
        <button type="button" class="form-control text-left" id="seguimiento-fecha-btn">
          ${q.fecha_proximo_seguimiento ? fmtDate(q.fecha_proximo_seguimiento) : 'Sin fecha — elegir'}
        </button>
      </div>
      <span class="field-error" id="seguimiento-venta-err"></span>
      <div class="proforma-acciones-fila">
        <button class="btn btn-ghost btn-sm" id="btn-save-seguimiento">
          Guardar seguimiento
        </button>
      </div>
    </div>`;
  }

  // Solo lectura: nada que mostrar si nunca se registró seguimiento.
  if (!q.estado_venta) return '';

  const etiqueta = q.estado_venta === 'Otro' ? (q.estado_venta_detalle || 'Otro') : q.estado_venta;
  return `
    <div class="form-group seguimiento-venta">
      <span class="form-label text-orange">Seguimiento comercial</span>
      <p class="proforma-description mt-025">
        ${escHtml(etiqueta)}${q.fecha_proximo_seguimiento ? ` · Próximo seguimiento: ${fmtDate(q.fecha_proximo_seguimiento)}` : ''}
      </p>
    </div>`;
}

/**
 * Arma los cuatro bloques de marcado a partir de los permisos.
 *
 * @param {Object}  q     — la cotización completa
 * @param {Object}  modo  — { jefeMode, adminMode, delegateMode }
 * @returns {{ jefeButtons, adminButtons, delegateButtons, ejecutivoButtons, adminCommentBlock, seguimientoVentaBlock }}
 */
export function buildProformaActions(q, { jefeMode, adminMode, delegateMode }) {
  const permisos = calcularPermisos(q, { jefeMode, delegateMode });

  return {
    jefeButtons:       jefeButtonsHtml(q, jefeMode, permisos),
    adminButtons:      adminButtonsHtml(q, adminMode),
    // Vacío a propósito: el ejecutivo delegado usa la MISMA grilla que el
    // Jefe (jefeButtons ya contempla delegateMode). La clave se mantiene
    // porque la plantilla la interpola, y sacarla obligaría a tocarla.
    delegateButtons:   '',
    // Sólo en la vista del ejecutivo (sin modo jefe, admin ni delegado): en las
    // otras, quien mira ya tiene su propia grilla.
    ejecutivoButtons:  (jefeMode || adminMode || delegateMode) ? '' : ejecutivoButtonsHtml(q),
    adminCommentBlock: adminCommentBlockHtml(q, { adminMode, jefeMode }),
    seguimientoVentaBlock: seguimientoVentaBlockHtml(q, {
      canEdit: jefeMode || adminMode ||
        (AuthSession.getRole() === 'Ejecutivo' && AuthSession.getUserId() === q.id_ejecutivo),
    }),
  };
}
