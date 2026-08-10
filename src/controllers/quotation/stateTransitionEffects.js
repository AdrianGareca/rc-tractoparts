// =============================================================================
// src/controllers/quotation/stateTransitionEffects.js
// Lo que pasa DESPUÉS de que un cambio de estado quedó guardado.
//
// LA REGLA QUE COMPARTEN LOS CUATRO EFECTOS
// Cuando estas funciones corren, el UPDATE ya está confirmado en la base. La
// transición OCURRIÓ. Por eso ninguna puede hacer fallar la respuesta: si el
// registro en bitácora falla, o el PDF no se regenera, o la notificación no
// entra, la cotización igual cambió de estado.
//
// Devolverle un error al usuario en ese punto sería decirle «no funcionó» sobre
// algo que sí funcionó — y lo llevaría a reintentar, generando una segunda
// transición sobre un estado que ya no es el que él cree.
//
// Por eso cada bloque tiene su propio try/catch y se limita a avisar por
// consola. No es descuido: es la decisión de que un efecto secundario nunca
// puede contradecir al hecho principal.
//
// POR QUÉ SON TRES FUNCIONES Y NO UNA
// Se llaman en secuencia desde updateStatus y podrían haber sido una sola
// `ejecutarEfectos()`. Se dejaron separadas para que el cuerpo del controlador
// siga leyéndose como la lista de cosas que ocurren, y para poder probar cada
// una por su lado — que es justamente lo que no se podía hacer cuando las 295
// líneas eran una sola función.
// =============================================================================

'use strict';

const QuotationModel  = require('../../models/QuotationModel');
const LicitacionModel = require('../../models/LicitacionModel');
const { logEvent, AuditActions } = require('../../utils/auditLog');

/** Prefijo común de los avisos por consola, para poder filtrarlos. */
const ETIQUETA = '[QuotationStateController.updateStatus]';

// ---------------------------------------------------------------------------
// 1. La huella: historial de estados + bitácora de auditoría
// ---------------------------------------------------------------------------
/**
 * Dos registros distintos con propósitos distintos:
 *
 *   • `cotizacion_historial_estados` es la línea de tiempo de ESTA cotización,
 *     la que se dibuja en la pantalla de detalle.
 *   • `bitacora_auditoria` es el registro transversal del sistema, donde se
 *     busca «qué hizo tal usuario» o «qué pasó tal día».
 *
 * @param {object} datos
 * @returns {Promise<void>} — nunca rechaza
 */
async function registrarHuella({
  id, estadoActual, nuevoEstado, usuario, observacion, clientIp, esReapertura, motivo,
  accion, detalle,
}) {
  // `accion` y `detalle` se pueden pasar para reusar esta función desde otro
  // flujo. La aprobación formal (POST /:id/aprobar) escribe exactamente la
  // misma huella pero con APROBAR o RECHAZAR en vez de CAMBIAR_ESTADO, y antes
  // tenía su propia copia del bloque entero — treinta líneas idénticas salvo
  // por esos dos valores.
  //
  // Se resuelven acá y no en el llamador para que quien no los pase obtenga el
  // comportamiento normal sin tener que conocerlo.
  const accionFinal = accion
    ?? (esReapertura ? AuditActions.REABRIR_COTIZACION : AuditActions.CAMBIAR_ESTADO);

  const detalleFinal = detalle ?? {
    estado_anterior: estadoActual,
    nuevo_estado:    nuevoEstado,
    observacion:     observacion || null,
    // El motivo se guarda con su propia clave SÓLO en las reaperturas: en una
    // transición normal no existe, y una clave presente con valor nulo haría
    // pensar que se pidió y no se completó.
    ...(esReapertura ? { motivo_reapertura: motivo } : {}),
  };

  try {
    await QuotationModel.logStateHistory({
      id_cotizacion:   id,
      estado_anterior: estadoActual,
      estado_nuevo:    nuevoEstado,
      id_usuario:      usuario.id,
      nombre_usuario:  usuario.nombre_usuario,
      rol_usuario:     usuario.rol,
      // `|| null` y no la cadena vacía: la columna es nullable y un '' haría
      // que la pantalla dibuje el bloque de observación vacío.
      observacion:     observacion || null,
      ip_origen:       clientIp,
    });

    await logEvent({
      id_usuario:     usuario.id,
      nombre_usuario: usuario.nombre_usuario,
      // Una reapertura lleva su PROPIA acción y no el CAMBIAR_ESTADO genérico.
      // El motivo es práctico: preguntar «cuántas ventas se reabrieron este
      // mes» tiene que ser un filtro por acción, no una excavación entre
      // cientos de cambios de estado rutinarios leyendo el detalle de cada uno.
      accion:     accionFinal,
      entidad:    'cotizaciones',
      id_entidad: id,
      detalle:    detalleFinal,
      ip_origen:  clientIp,
      resultado:  'exito',
    });
  } catch (err) {
    console.warn(`${ETIQUETA} Audit logging failed (non-fatal):`, err.message);
  }
}

// ---------------------------------------------------------------------------
// 2. El aviso al ejecutivo dueño de la cotización
// ---------------------------------------------------------------------------

/** Estado destino → tipo de notificación. 'Aceptada' es alias histórico. */
const TIPO_POR_ESTADO = {
  'Enviada al cliente': 'envio_cliente',
  'Confirmada':         'aprobacion',
  'Aceptada':           'aprobacion',
};

/**
 * Avisa al ejecutivo dueño cuando su cotización llega a un hito, y también
 * cuando le reabren una venta que él daba por cerrada.
 *
 * En los dos casos se omite la autonotificación: si el ejecutivo es quien
 * ejecutó la acción, ya sabe que la hizo. Notificarse a uno mismo entrena a
 * ignorar la campana.
 *
 * @returns {Promise<void>} — nunca rechaza
 */
async function notificarAlEjecutivo({
  id, quotation, nuevoEstado, usuario, esReapertura, motivo,
}) {
  // El dueño es quien recibe; si es el mismo que actuó, no hay nada que avisar.
  const esOtro = quotation.id_ejecutivo !== usuario.id;

  // ── Hito comercial ────────────────────────────────────────────────────────
  // Se dispara sin importar QUIÉN movió la cotización (Jefe, SysAdmin,
  // Administración o un ejecutivo delegado): el dueño necesita enterarse para
  // darle seguimiento, y no tiene por qué estar mirando la pantalla.
  if (esOtro && TIPO_POR_ESTADO[nuevoEstado]) {
    try {
      // El nombre del cliente cae al id si no vino en la consulta: es preferible
      // un mensaje con un número a un mensaje que diga «undefined».
      const cliente = quotation.cliente_nombre ?? String(quotation.id_cliente);

      const mensaje = nuevoEstado === 'Enviada al cliente'
        ? `La cotización #${quotation.numero_correlativo} para ${cliente} ` +
          `ha sido enviada al cliente. Ya puedes darle seguimiento.`
        : `La cotización #${quotation.numero_correlativo} para ${cliente} ` +
          `ha sido confirmada. Cierre de venta registrado.`;

      await QuotationModel.insertNotificacion({
        id_usuario:    quotation.id_ejecutivo,
        id_cotizacion: id,
        tipo:          TIPO_POR_ESTADO[nuevoEstado],
        mensaje,
      });
    } catch (err) {
      console.warn(`${ETIQUETA} Notification insert failed (non-fatal):`, err.message);
    }
  }

  // ── Reapertura ────────────────────────────────────────────────────────────
  // Sin este aviso, la cotización reaparecería en la lista del ejecutivo como
  // 'Pendiente' sin ninguna explicación, cuando él la había dado por cerrada.
  // El motivo que escribió el jefe viaja DENTRO del mensaje porque es
  // exactamente el dato que el ejecutivo necesita para saber qué corregir.
  if (esOtro && esReapertura) {
    try {
      await QuotationModel.insertNotificacion({
        id_usuario:    quotation.id_ejecutivo,
        id_cotizacion: id,
        tipo:          'correccion',
        mensaje: `La cotización #${quotation.numero_correlativo} fue REABIERTA por ` +
                 `${usuario.nombre_usuario} y volvió a estado Pendiente para que la corrijas. ` +
                 `Motivo: ${motivo}`,
      });
    } catch (err) {
      console.warn(`${ETIQUETA} Reopen notification failed (non-fatal):`, err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. El aviso al responsable de la licitación vinculada
// ---------------------------------------------------------------------------

/** Hitos que le importan a quien lleva el control del concurso. */
const HITOS_LICITACION = ['Aprobada internamente', 'Enviada al cliente', 'Confirmada', 'Aceptada'];

/**
 * Cuando la cotización pertenece a una licitación, el responsable de Proyectos
 * necesita seguir el concurso sin tener que revisar cotización por cotización.
 *
 * @returns {Promise<void>} — nunca rechaza
 */
async function notificarALicitacion({ quotation, nuevoEstado, usuario }) {
  // `!= null` y no `!quotation.id_licitacion`: un id 0 no existe como clave,
  // pero escribir la comparación laxa deja claro que se cubren null y undefined.
  if (quotation.id_licitacion == null) return;
  if (!HITOS_LICITACION.includes(nuevoEstado)) return;

  try {
    const lic = await LicitacionModel.findById(quotation.id_licitacion);

    // Se corta también si el responsable es quien actuó: misma regla de
    // autonotificación que arriba.
    if (!lic || lic.id_responsable === usuario.id) return;

    await QuotationModel.insertNotificacion({
      id_usuario:    lic.id_responsable,
      id_licitacion: lic.id,
      tipo:          'licitacion',
      mensaje: `La cotización #${quotation.numero_correlativo} vinculada a la licitación ` +
               `${lic.codigo} cambió a "${nuevoEstado}".`,
    });
  } catch (err) {
    console.warn(`${ETIQUETA} Licitación notification failed (non-fatal):`, err.message);
  }
}

module.exports = { registrarHuella, notificarAlEjecutivo, notificarALicitacion };
