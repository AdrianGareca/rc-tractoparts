// =============================================================================
// src/controllers/quotation/stateTransitionGuards.js
// Las verificaciones previas a un cambio de estado, una por función.
//
// DE DÓNDE SALE ESTE ARCHIVO
// `updateStatus` tenía 295 líneas y era la función por la que pasa CADA cambio
// de estado de CADA cotización. Once fases encadenadas: siete que deciden si la
// transición procede y cuatro de efectos posteriores. Las siete primeras están
// acá.
//
// EL CONTRATO, QUE ES LO ÚNICO QUE HAY QUE RECORDAR
// Cada guardián devuelve `null` cuando todo está bien, o un objeto
// `{ status, body }` listo para `res.status(status).json(body)` cuando hay que
// cortar. Nada de excepciones para el flujo esperado: un 403 por rol no es un
// error del programa, es una respuesta legítima, y modelarlo como throw obliga
// a envolver todo en try/catch y a distinguir después cuál excepción era
// "de verdad".
//
// POR QUÉ EL ORDEN IMPORTA Y NO SE PUEDE REACOMODAR
// Los guardianes están pensados para ejecutarse en la secuencia en que se
// exportan. Dos casos concretos:
//
//   • El motivo de reapertura se pide DESPUÉS del guardián de rol. A quien no
//     tiene la llave se le responde 403 (no puede), no 422 (le falta un campo):
//     pedirle un motivo a alguien que igual va a ser rechazado sería mentirle
//     sobre por qué falló.
//   • La lista de verificación previa corre DESPUÉS de confirmar que el destino
//     es alcanzable, para no consultar la base por una transición que ya se
//     sabe inválida.
// =============================================================================

'use strict';

const QuotationModel = require('../../models/QuotationModel');
const UserModel      = require('../../models/UserModel');
// La lectura del id de la URL, compartida con los otros ocho controladores.
const { parseId }    = require('../../utils/parseId');

// ---------------------------------------------------------------------------
// 1. La forma de lo que llegó por HTTP
// ---------------------------------------------------------------------------
/**
 * Verifica el identificador y el estado destino ANTES de tocar la base.
 *
 * Es puro y sincrónico a propósito: son las únicas comprobaciones que no
 * necesitan consultar nada, así que hacerlas primero evita una consulta por
 * cada petición mal formada.
 *
 * @param   {*} idCrudo        — req.params.id, siempre string
 * @param   {*} nuevoEstado    — req.body.nuevo_estado
 * @returns {{status:number, body:object}|null}
 */
function verificarEntrada(idCrudo, nuevoEstado) {
  // La lectura del id se delega a parseId (src/utils/parseId.js). Cuando escribí
  // este guardián copié la comprobación a mano — y así sumé una repetición
  // número 29 a las 28 que después terminé unificando. Vale la pena señalarlo:
  // extraer código a un módulo nuevo no evita duplicarlo, si uno no revisa
  // antes si esa pieza ya existía en algún lado.
  const { error } = parseId(idCrudo, 'cotización');
  if (error) return error;

  // Se comprueba el tipo además de la presencia: un cliente que mande
  // `nuevo_estado: ["Confirmada"]` pasaría el chequeo de verdad y después
  // fallaría raro al comparar contra la matriz.
  if (!nuevoEstado || typeof nuevoEstado !== 'string') {
    return {
      status: 422,
      body: { success: false, message: 'nuevo_estado is required and must be a string.' },
    };
  }

  // El destino tiene que existir en el ENUM. Sin esto, un estado inventado
  // llegaría hasta el UPDATE y MySQL lo rechazaría con un error de columna,
  // que no le dice nada a quien llamó.
  if (!QuotationModel.VALID_STATES.includes(nuevoEstado)) {
    return {
      status: 422,
      body: {
        success: false,
        message: `Invalid target state '${nuevoEstado}'. Valid states: [${QuotationModel.VALID_STATES.join(', ')}]`,
      },
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// 2. La delegación, leída de la base y no del token
// ---------------------------------------------------------------------------
/**
 * Resuelve si quien llama tiene la delegación `can_approve_quotations`.
 *
 * Se lee de la BASE y no del JWT a propósito: quitarle la delegación a alguien
 * tiene que surtir efecto en el acto, sin esperar a que su token venza ni
 * obligarlo a volver a entrar. Es una consulta extra por transición, y es el
 * precio de que revocar un permiso signifique revocarlo ya.
 *
 * @param   {string} userRol
 * @param   {string} nuevoEstado
 * @param   {number} userId
 * @returns {Promise<boolean>}
 */
async function resolverDelegacion(userRol, nuevoEstado, userId) {
  // Sólo se consulta cuando puede cambiar algo:
  //   • un Ejecutivo, porque la delegación le da el ciclo comercial completo;
  //   • o cualquiera apuntando a 'Aprobada internamente', que es el destino
  //     que la delegación concede.
  // Para el resto la consulta no cambiaría ninguna decisión, así que se saltea.
  const puedeImportar = userRol === 'Ejecutivo' || nuevoEstado === 'Aprobada internamente';
  if (!puedeImportar) return false;

  const actingUser = await UserModel.findById(userId);

  // `Boolean()` porque MySQL devuelve el TINYINT como 0/1 y hay que
  // normalizarlo: la máquina de estados compara con `=== true`.
  return Boolean(actingUser?.can_approve_quotations);
}

// ---------------------------------------------------------------------------
// 3. Que la cotización exista y no esté ya donde se la quiere llevar
// ---------------------------------------------------------------------------
/**
 * @param   {object|null} quotation   — lo que devolvió findById
 * @param   {number}      id
 * @param   {string}      nuevoEstado
 * @returns {{status:number, body:object}|null}
 */
function verificarExistenciaYEstado(quotation, id, nuevoEstado) {
  if (!quotation) {
    return {
      status: 404,
      body: { success: false, message: `Quotation with ID ${id} was not found.` },
    };
  }

  // Mover una cotización al estado en el que ya está no es un error del
  // usuario, pero tampoco es una operación: se corta acá para no escribir en el
  // historial una transición que no ocurrió, que ensuciaría la trazabilidad y
  // dispararía una notificación por nada.
  if (quotation.estado === nuevoEstado) {
    return {
      status: 422,
      body: {
        success: false,
        message: `The quotation is already in the '${quotation.estado}' state. No change needed.`,
      },
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// 4. El permiso de rol
// ---------------------------------------------------------------------------
/**
 * Valida la transición puntual (estadoActual → nuevoEstado) para este rol.
 *
 * La lista de transiciones que trae el 403 describe el estado VIEJO — que es
 * justo lo que sirve ahí: "esto es lo que SÍ podías hacer desde donde estás".
 * NO uses `allowedTransitions` del caso `valid:true` para la respuesta de
 * éxito: sigue describiendo el estado viejo, no el que acaba de quedar tras
 * la transición. Para eso está `getAllowedTransitions()` en stateMachine.js,
 * que el controlador llama aparte una vez confirmada la escritura. Mezclar
 * los dos fue exactamente el bug de `allowed_transitions` con estado
 * desactualizado que se encontró en la ronda de estrés del 2026-08-25.
 *
 * @returns {{ error: {status,body}|null, allowedTransitions: string[] }}
 */
function verificarPermisoDeRol(estadoActual, nuevoEstado, userRol, canApproveDelegated) {
  const check = QuotationModel.validateTransitionByRole(
    estadoActual, nuevoEstado, userRol, canApproveDelegated
  );

  const allowedTransitions = check.allowedTransitions || [];

  if (check.valid) return { error: null, allowedTransitions };

  return {
    error: {
      status: 403,
      body: {
        success: false,
        message: check.reason,
        // Se devuelve el menú válido junto con el rechazo: así la pantalla puede
        // corregir sus opciones en el acto en vez de seguir ofreciendo un botón
        // que va a volver a dar 403.
        allowed_transitions: allowedTransitions,
      },
    },
    allowedTransitions,
  };
}

// ---------------------------------------------------------------------------
// 5. El motivo de una reapertura
// ---------------------------------------------------------------------------
/**
 * La llave abre la caja, pero el jefe firma el papel.
 *
 * @returns {{ error: {status,body}|null, esReapertura: boolean, motivo: string }}
 */
function verificarMotivoDeReapertura(estadoActual, nuevoEstado, observacion) {
  const esReapertura = QuotationModel.isReopening(estadoActual, nuevoEstado);

  // `String()` antes de `.trim()` porque observacion puede llegar como número
  // desde un cliente mal escrito, y `.trim` no existe en Number.
  const motivo = observacion != null ? String(observacion).trim() : '';

  // El trim es lo que hace que "   " no cuente como motivo.
  if (esReapertura && !motivo) {
    return {
      error: {
        status: 422,
        body: {
          success: false,
          message: 'Reabrir una venta ya confirmada exige un motivo. Indicá en "observacion" ' +
                   'por qué se reabre (queda registrado en el historial y en la bitácora).',
        },
      },
      esReapertura,
      motivo,
    };
  }

  // Se devuelven los dos datos calculados aunque no haya error: quien llama los
  // necesita después para elegir la acción de bitácora y para guardarlos.
  return { error: null, esReapertura, motivo };
}

// ---------------------------------------------------------------------------
// 6. La lista de verificación previa
// ---------------------------------------------------------------------------
/**
 * Una cotización tiene que estar completa —al menos un ítem, monto y fecha de
 * validez— antes de entrar al circuito de aprobación.
 *
 * Se aplica a TODOS los destinos hacia adelante y no sólo a 'En revision', para
 * que un Jefe no pueda saltearla yendo derecho a aprobar. Los retrocesos
 * (Rechazada, En espera, Pendiente) están exentos a propósito: son justamente
 * el camino para arreglar una cotización incompleta.
 *
 * @returns {Promise<{status:number, body:object}|null>}
 */
async function verificarListaPrevia(id, nuevoEstado) {
  if (!QuotationModel.REVIEW_REQUIRED_TARGET_STATES.includes(nuevoEstado)) return null;

  const errores = await QuotationModel.validateForReview(id);
  if (errores.length === 0) return null;

  return {
    status: 422,
    body: {
      success: false,
      message: 'The quotation does not meet all requirements to enter the approval pipeline. ' +
               'Resolve the following issues and try again.',
      // Se devuelve la lista completa y no el primer error: quien carga la
      // cotización prefiere enterarse de los tres faltantes de una vez y no
      // descubrirlos de a uno por intento.
      errors: errores,
    },
  };
}

// ---------------------------------------------------------------------------
// 7. El comentario del Administrador
// ---------------------------------------------------------------------------
/**
 * Sólo Administracion puede adjuntar `comentario_admin`. Para cualquier otro
 * rol se descarta en silencio en vez de devolver un error: el campo es opcional
 * y un cliente que lo mande de más no está haciendo nada malo, simplemente no
 * tiene efecto.
 *
 * @returns {string|null}
 */
function normalizarComentarioAdmin(userRol, comentarioAdmin) {
  if (userRol !== 'Administracion' || comentarioAdmin == null) return null;

  // `|| null` convierte la cadena vacía en null: guardar '' en la columna haría
  // que la pantalla dibuje el bloque de comentario con nada adentro.
  return String(comentarioAdmin).trim() || null;
}

module.exports = {
  verificarEntrada,
  resolverDelegacion,
  verificarExistenciaYEstado,
  verificarPermisoDeRol,
  verificarMotivoDeReapertura,
  verificarListaPrevia,
  normalizarComentarioAdmin,
};
