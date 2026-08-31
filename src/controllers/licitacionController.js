// =============================================================================
// src/controllers/licitacionController.js
// Licitación Controller — ciclo de vida de licitaciones (entidad paraguas).
//
//   createLicitacion   — POST /api/licitaciones        (Proyectos, Jefe, SysAdmin)
//   getLicitaciones    — GET  /api/licitaciones         (todos los autenticados)
//   getLicitacionById  — GET  /api/licitaciones/:id     (todos los autenticados)
//   getStateHistory    — GET  /api/licitaciones/:id/historial
//   updateLicitacion   — PUT  /api/licitaciones/:id     (responsable, Jefe, SysAdmin)
//   updateStatus       — PUT  /api/licitaciones/:id/estado
//
// Layering: el controller orquesta; solo LicitacionModel ejecuta SQL sobre las
// tablas de licitaciones. Patrón calcado de quotationController /
// quotationStateController (transacción + liberación de conexión antes de
// auditar, re-lectura fresca de can_approve_quotations, auditoría no fatal).
// =============================================================================

'use strict';

// `pool` ya no se importa acá: la única transacción que este controlador
// manejaba a mano (createLicitacion) pasó a withDeadlockRetry, que pide y
// devuelve la conexión por su cuenta.
const LicitacionModel            = require('../models/LicitacionModel');
const LicitacionDocumentModel    = require('../models/LicitacionDocumentModel');
const QuotationModel             = require('../models/QuotationModel');
const UserModel                  = require('../models/UserModel');
const { logEvent, AuditActions } = require('../utils/auditLog');
const licitacionPdfService       = require('../services/licitacionPdfService');
// Lectura del id de la URL, compartida: estaba escrita a mano 28 veces
// con el mensaje en dos idiomas distintos.
const { parseId } = require('../utils/parseId');
// El bloque `pagination`, compartido.
const { construirPaginacion } = require('../utils/paginacion');
// Transacción con reintento ante deadlocks. Se comparte con cotizaciones a
// propósito: las dos creaciones compiten por la fila de su contador de
// correlativo con SELECT … FOR UPDATE, que es exactamente la contención que
// hace que InnoDB declare un deadlock legítimo bajo carga.
const { withDeadlockRetry } = require('./quotation/transactionHelpers');
// Filtros de listado (estado, id_responsable) — ver el comentario largo junto
// a la función en licitacionValidator.js.
const { validateListFilters } = require('../validators/licitacionValidator');
// Mismo control que ya existía para cotizaciones: no atar una licitación a un
// cliente inexistente o desactivado. Se reutiliza la MISMA función (misma
// tabla, misma regla) en vez de duplicar la consulta acá.
const { verificarCliente } = require('./quotation/clienteLinkGuard');

// ---------------------------------------------------------------------------
// ROLES_VALIDOS_RESPONSABLE — quién puede ser id_responsable de una licitación.
//
// LicitacionModel.resolveActorType() sólo reconoce como actor con permisos de
// escritura a: Proyectos (cuando ES el responsable), o Jefe/SysAdmin (siempre,
// independientemente de quién sea el responsable). Un id_responsable con
// cualquier OTRO rol (Ejecutivo sin delegación, Administracion) no resuelve a
// ningún actor type: la persona queda sin poder editar la cabecera (403 por
// ownership en updateLicitacion) NI cambiar el estado (403 de
// validateTransitionByRole) de una licitación de la que figura como dueña.
//
// Se permite Jefe/SysAdmin acá (y no sólo Proyectos) porque el comportamiento
// existente ya deja que se autoasignen al crear sin indicar id_responsable
// (ver el comentario en createLicitacion) — y para ellos nunca es un problema:
// su actor type es 'jefe' sin importar si son o no el responsable formal.
// ---------------------------------------------------------------------------
const ROLES_VALIDOS_RESPONSABLE = ['Proyectos', 'Jefe', 'SysAdmin'];

// ---------------------------------------------------------------------------
// validarRolResponsable — 422 si el usuario referenciado no existe o su rol
// no puede ser responsable de una licitación (ver ROLES_VALIDOS_RESPONSABLE).
// Usado tanto en la creación como en la reasignación por edición.
// ---------------------------------------------------------------------------
async function validarRolResponsable(idResponsable) {
  const usuario = await UserModel.findById(idResponsable);

  if (!usuario) {
    return {
      status: 422,
      body: { success: false, message: `El responsable #${idResponsable} indicado no existe.` },
    };
  }

  if (!ROLES_VALIDOS_RESPONSABLE.includes(usuario.rol)) {
    return {
      status: 422,
      body: {
        success: false,
        message: `El usuario #${idResponsable} (${usuario.nombre_completo}) tiene el rol '${usuario.rol}' ` +
                 `y no puede ser responsable de una licitación. Roles válidos: [${ROLES_VALIDOS_RESPONSABLE.join(', ')}].`,
      },
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// validarClienteYResponsableParaCrear — las dos comprobaciones de
// createLicitacion, agrupadas en una función aparte para que el controller no
// crezca: cliente convocante existente/activo + rol válido del responsable.
// ---------------------------------------------------------------------------
async function validarClienteYResponsableParaCrear(idCliente, responsableId) {
  const errCliente = await verificarCliente(idCliente, 'LicitacionController.createLicitacion');
  if (errCliente) return errCliente;

  return validarRolResponsable(responsableId);
}

// ---------------------------------------------------------------------------
// resolverClienteEnEdicion — decide el id_cliente a persistir en
// updateLicitacion. Sólo revalida existencia/activo cuando el vínculo está
// CAMBIANDO respecto del que la licitación ya tenía — una edición que no
// toca el cliente no se traba porque éste se haya desactivado después de
// asignado (mismo criterio que clienteLinkGuard.js aplica en cotizaciones).
// @returns {Promise<{error}|{idCliente:number}>}
// ---------------------------------------------------------------------------
async function resolverClienteEnEdicion(idClienteBody, licitacion) {
  const nuevoIdCliente = parseInt(idClienteBody, 10);
  if (nuevoIdCliente === licitacion.id_cliente) return { idCliente: nuevoIdCliente };

  const errCliente = await verificarCliente(idClienteBody, 'LicitacionController.updateLicitacion');
  return errCliente ? { error: errCliente } : { idCliente: nuevoIdCliente };
}

// ---------------------------------------------------------------------------
// resolverResponsableEnEdicion — reasignar el responsable de una licitación
// es una acción restringida a Jefe/SysAdmin; el nuevo responsable se valida
// con la misma regla de rol que en la creación (validarRolResponsable). Un
// id_responsable ausente, o igual al que ya tenía, no cambia nada — no hace
// falta ser Jefe/SysAdmin para reenviar la cabecera sin tocar el responsable.
// @returns {Promise<{error}|{idResponsable:number}>}
// ---------------------------------------------------------------------------
async function resolverResponsableEnEdicion(idResponsableBody, licitacion, isPrivileged) {
  if (idResponsableBody === undefined || idResponsableBody === licitacion.id_responsable) {
    return { idResponsable: licitacion.id_responsable };
  }

  if (!isPrivileged) {
    return {
      error: {
        status: 403,
        body: { success: false, message: 'Solo Jefe/SysAdmin puede reasignar el responsable de la licitación.' },
      },
    };
  }

  const errResponsable = await validarRolResponsable(idResponsableBody);
  return errResponsable ? { error: errResponsable } : { idResponsable: idResponsableBody };
}

const LicitacionController = {

  // ---------------------------------------------------------------------------
  // downloadPdf — GET /api/licitaciones/:id/pdf  (todos los autenticados)
  // Genera el expediente de la licitación ON-DEMAND (no se persiste) y lo
  // transmite directo, así siempre refleja el estado/cotizaciones/gastos actual.
  // ---------------------------------------------------------------------------
  async downloadPdf(req, res) {
    const { id, error: idError } = parseId(req.params.id, 'licitación');
    const clientIp = req.ip || req.socket?.remoteAddress || null;
    if (idError) return res.status(idError.status).json(idError.body);

    try {
      const licitacion = await LicitacionModel.findById(id);
      if (!licitacion) {
        return res.status(404).json({ success: false, message: `No se encontró la licitación con ID ${id}.` });
      }

      // findById no trae los documentos adjuntos (son de otra tabla, y el
      // resto de sus llamadores no los necesitan) — se agregan acá para que
      // el expediente los liste. Antes el PDF no mencionaba ni la cantidad de
      // documentos subidos, aunque hubiera varios.
      licitacion.documentos = await LicitacionDocumentModel.findByLicitacion(id);

      const safeName = String(licitacion.codigo || `LIC-${id}`).replace(/[^\w\-]/g, '_');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="Expediente_${safeName}.pdf"`);

      const doc = licitacionPdfService.createDoc(licitacion);
      doc.on('error', (streamErr) => {
        console.error('[LicitacionController.downloadPdf] PDF stream error:', streamErr.message);
      });
      doc.pipe(res);
      try {
        licitacionPdfService.renderExpediente(doc, licitacion);
      } catch (renderErr) {
        // Nunca dejar la petición colgada: cerramos el stream aunque el layout
        // falle (el cliente recibiría un PDF parcial en vez de un botón trabado).
        console.error('[LicitacionController.downloadPdf] Render error:', renderErr.message);
      }
      doc.end();

      // Auditoría no fatal (el stream ya se está enviando).
      logEvent({
        id_usuario:     req.user.id,
        nombre_usuario: req.user.nombre_usuario,
        accion:         AuditActions.DESCARGAR_PDF_LICITACION,
        entidad:        'licitaciones',
        id_entidad:     id,
        detalle:        { codigo: licitacion.codigo },
        ip_origen:      clientIp,
        resultado:      'exito',
      }).catch(() => {});
    } catch (error) {
      console.error('[LicitacionController.downloadPdf] Error:', error.message);
      if (!res.headersSent) {
        return res.status(500).json({ success: false, message: 'No se pudo generar el PDF de la licitación.' });
      }
    }
  },

  // ---------------------------------------------------------------------------
  // createLicitacion — POST /api/licitaciones  (Proyectos, Jefe, SysAdmin)
  // Transacción atómica: generateCorrelativo (FOR UPDATE) + create → commit →
  // liberar conexión → auditar (fuera de la conexión de la transacción).
  // ---------------------------------------------------------------------------
  async createLicitacion(req, res) {
    const {
      nombre,
      id_cliente,
      descripcion,
      presupuesto_referencial,
      moneda,
      fecha_limite,
      id_responsable,
    } = req.body;

    const clientIp = req.ip || req.socket?.remoteAddress || null;

    // El responsable es el propio usuario si es Proyectos; si es Jefe/SysAdmin
    // debe indicar a qué usuario Proyectos pertenece (o se asigna a sí mismo).
    const responsableId = req.user.rol === 'Proyectos'
      ? req.user.id
      : (id_responsable != null ? parseInt(id_responsable, 10) : req.user.id);

    // Cliente convocante existente/activo + rol válido del responsable — ver
    // validarClienteYResponsableParaCrear. Sin la segunda, un Jefe/SysAdmin
    // que se equivoca de id deja a un Ejecutivo/Administracion como dueño de
    // una licitación que nunca va a poder editar ni mover de estado.
    const errValidacion = await validarClienteYResponsableParaCrear(id_cliente, responsableId);
    if (errValidacion) return res.status(errValidacion.status).json(errValidacion.body);

    try {
      // Transacción con reintento, igual que createQuotation. Antes esto se
      // manejaba a mano —getConnection / beginTransaction / commit / release,
      // más el rollback en el catch— y era el ÚNICO lugar de controllers/ que
      // seguía así. La diferencia no es sólo de estilo: sin reintento, dos
      // licitaciones creadas a la vez podían chocar sobre la fila del contador
      // de correlativo y una recibía un 500 opaco, cuando lo correcto ante un
      // deadlock de InnoDB es reintentar la transacción entera (lo dice la
      // propia guía de MySQL, y es lo que cotizaciones ya hacía).
      //
      // Los dos valores salen COMO RESULTADO y no como variables de afuera:
      // withDeadlockRetry puede correr este bloque más de una vez, así que
      // cada intento tiene que producir los suyos.
      const { codigo, licitacionId } = await withDeadlockRetry(async (connection) => {
        const codigoNuevo = await LicitacionModel.generateCorrelativo(connection);

        const idNuevo = await LicitacionModel.create(connection, {
          codigo:                  codigoNuevo,
          nombre:                  String(nombre).trim(),
          id_cliente:              parseInt(id_cliente, 10),
          descripcion:             descripcion ? String(descripcion).trim() : null,
          presupuesto_referencial: presupuesto_referencial ?? null,
          moneda:                  moneda || 'BOB',
          fecha_limite:            fecha_limite || null,
          id_responsable:          responsableId,
        });

        return { codigo: codigoNuevo, licitacionId: idNuevo };
      }, { label: 'LicitacionController.createLicitacion' });

      // ── Auditoría (no fatal) ─────────────────────────────────────────────
      try {
        await logEvent({
          id_usuario:     req.user.id,
          nombre_usuario: req.user.nombre_usuario,
          accion:         AuditActions.CREAR_LICITACION,
          entidad:        'licitaciones',
          id_entidad:     licitacionId,
          detalle:        { codigo, nombre, id_cliente, id_responsable: responsableId },
          ip_origen:      clientIp,
          resultado:      'exito',
        });
      } catch (auditErr) {
        console.warn('[LicitacionController.createLicitacion] Audit logging failed (non-fatal):', auditErr.message);
      }

      // Igual que en createQuotation: despues del commit, nada puede convertir
      // una creacion exitosa en un error.
      //
      // Aca era todavia peor. LicitacionModel.findById dispara CUATRO consultas,
      // y una de ellas va contra `licitacion_gastos` — una tabla que solo existe
      // si se corrio sql/upgrade_2026_licitacion_gastos.sql. En una base sin esa
      // migracion, TODA creacion de licitacion devolvia 500 aunque la fila se
      // hubiera creado perfectamente.
      let created = null;
      try {
        created = await LicitacionModel.findById(licitacionId);
      } catch (postErr) {
        console.warn('[LicitacionController.createLicitacion] Post-commit read failed (non-fatal):', postErr.message);
      }

      return res.status(201).json({
        success: true,
        message: `Licitación ${codigo} creada.`,
        // Lo minimo para que la pantalla siga si la re-lectura fallo.
        data:    created ?? { id: licitacionId, codigo },
      });
    } catch (error) {
      // El rollback y la devolución de la conexión ya los hizo
      // withDeadlockRetry — mismo criterio que createQuotation.

      // FK violation (cliente o responsable inexistente) → 422 legible.
      if (error.code === 'ER_NO_REFERENCED_ROW_2' || error.code === 'ER_NO_REFERENCED_ROW') {
        return res.status(422).json({
          success: false,
          message: 'El cliente convocante o el responsable indicado no existe.',
        });
      }

      console.error('[LicitacionController.createLicitacion] Error:', error.message);
      return res.status(500).json({ success: false, message: 'No se pudo crear la licitación.' });
    }
  },

  // ---------------------------------------------------------------------------
  // getNextCorrelativo — GET /api/licitaciones/next-correlativo
  // Vista previa no vinculante del próximo código (para el encabezado del form).
  // ---------------------------------------------------------------------------
  async getNextCorrelativo(req, res) {
    try {
      const codigo = await LicitacionModel.peekNextCorrelativo();
      return res.status(200).json({ success: true, data: { codigo } });
    } catch (error) {
      console.error('[LicitacionController.getNextCorrelativo] Error:', error.message);
      return res.status(500).json({ success: false, message: 'No se pudo previsualizar el correlativo.' });
    }
  },

  // ---------------------------------------------------------------------------
  // getLicitaciones — GET /api/licitaciones  (todos los autenticados)
  // Listado paginado + filtros (estado, q, id_responsable, id_cliente).
  // ---------------------------------------------------------------------------
  async getLicitaciones(req, res) {
    try {
      // Filtros inválidos (estado inexistente, id_responsable no numérico) se
      // rechazan ANTES de tocar la base: sin esto, buildWhereClause arma un
      // WHERE que ninguna fila cumple y el endpoint responde 200 vacío,
      // indistinguible de "sin resultados para un filtro válido".
      const filterErrors = validateListFilters(req.query);
      if (filterErrors) {
        return res.status(422).json({
          success: false,
          message: 'Parámetros de filtro inválidos.',
          errors:  filterErrors,
        });
      }

      const filters = {
        q:              req.query.q,
        estado:         req.query.estado,
        id_responsable: req.query.id_responsable,
        id_cliente:     req.query.id_cliente,
      };

      const pagination = { page: req.query.page, limit: req.query.limit };
      const sort       = { by: req.query.sort_by, order: req.query.sort_order };

      const [data, total] = await Promise.all([
        LicitacionModel.findAll(filters, pagination, sort),
        LicitacionModel.countAll(filters),
      ]);

      const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

      return res.status(200).json({
        success:    true,
        total,
        page,
        limit,
        // Este endpoint publica los campos sueltos y no un objeto `pagination`
        // (licitacionesView.js lee body.total). No se cambia la forma; si el
        // calculo, que antes daba 0 con la lista vacia en vez de 1.
        totalPages: construirPaginacion({ page, limit, totalRecords: total }).totalPages,
        data,
      });
    } catch (error) {
      console.error('[LicitacionController.getLicitaciones] Error:', error.message);
      return res.status(500).json({ success: false, message: 'No se pudieron obtener las licitaciones.' });
    }
  },

  // ---------------------------------------------------------------------------
  // getLicitacionById — GET /api/licitaciones/:id  (todos los autenticados)
  // ---------------------------------------------------------------------------
  async getLicitacionById(req, res) {
    const { id, error: idError } = parseId(req.params.id, 'licitación');
    if (idError) return res.status(idError.status).json(idError.body);

    try {
      const licitacion = await LicitacionModel.findById(id);
      if (!licitacion) {
        return res.status(404).json({ success: false, message: `No se encontró la licitación con ID ${id}.` });
      }
      return res.status(200).json({ success: true, data: licitacion });
    } catch (error) {
      console.error('[LicitacionController.getLicitacionById] Error:', error.message);
      return res.status(500).json({ success: false, message: 'No se pudo obtener la licitación.' });
    }
  },

  // ---------------------------------------------------------------------------
  // getStateHistory — GET /api/licitaciones/:id/historial  (todos los autenticados)
  // ---------------------------------------------------------------------------
  async getStateHistory(req, res) {
    const { id, error: idError } = parseId(req.params.id, 'licitación');
    if (idError) return res.status(idError.status).json(idError.body);

    try {
      const licitacion = await LicitacionModel.findById(id);
      if (!licitacion) {
        return res.status(404).json({ success: false, message: `No se encontró la licitación con ID ${id}.` });
      }

      const history = await LicitacionModel.findStateHistory(id);
      return res.status(200).json({
        success:              true,
        licitacion_reference: licitacion.codigo,
        total:                history.length,
        data:                 history,
      });
    } catch (error) {
      console.error('[LicitacionController.getStateHistory] Error:', error.message);
      return res.status(500).json({ success: false, message: 'No se pudo obtener el historial.' });
    }
  },

  // ---------------------------------------------------------------------------
  // updateLicitacion — PUT /api/licitaciones/:id  (responsable, Jefe, SysAdmin)
  // Solo se puede editar la cabecera en estados 'En preparacion'/'Cotizando'.
  // ---------------------------------------------------------------------------
  async updateLicitacion(req, res) {
    const { id, error: idError } = parseId(req.params.id, 'licitación');
    if (idError) return res.status(idError.status).json(idError.body);

    const clientIp = req.ip || req.socket?.remoteAddress || null;

    try {
      const licitacion = await LicitacionModel.findById(id);
      if (!licitacion) {
        return res.status(404).json({ success: false, message: `No se encontró la licitación con ID ${id}.` });
      }

      // Ownership: Proyectos solo puede editar SUS licitaciones; Jefe/SysAdmin, todas.
      const isPrivileged  = req.user.rol === 'Jefe' || req.user.rol === 'SysAdmin';
      const isResponsable = req.user.id === licitacion.id_responsable;
      if (!isPrivileged && !isResponsable) {
        return res.status(403).json({
          success: false,
          message: 'Solo el responsable de la licitación (o Jefe/SysAdmin) puede editarla.',
        });
      }

      // Guard de estado: la cabecera es editable solo en preparación/cotizando.
      if (!LicitacionModel.EDITABLE_STATES.includes(licitacion.estado)) {
        return res.status(409).json({
          success: false,
          message: `La licitación en estado '${licitacion.estado}' ya no es editable. ` +
                   `Solo se puede editar en: [${LicitacionModel.EDITABLE_STATES.join(', ')}].`,
        });
      }

      const { nombre, id_cliente, descripcion, presupuesto_referencial, moneda, fecha_limite, id_responsable } = req.body;

      // Cliente convocante (sólo revalidado si el vínculo cambia) + reasignar
      // el responsable (restringido a Jefe/SysAdmin) — ver
      // resolverClienteEnEdicion / resolverResponsableEnEdicion más arriba.
      const clienteResuelto = await resolverClienteEnEdicion(id_cliente, licitacion);
      if (clienteResuelto.error) return res.status(clienteResuelto.error.status).json(clienteResuelto.error.body);

      const responsableResuelto = await resolverResponsableEnEdicion(id_responsable, licitacion, isPrivileged);
      if (responsableResuelto.error) {
        return res.status(responsableResuelto.error.status).json(responsableResuelto.error.body);
      }

      // ── Un campo que NO vino se deja como estaba ────────────────────────────
      // La diferencia es entre `undefined` (no lo mandaron: no lo toques) y
      // `null` (lo mandaron vacio: borralo). Antes los dos terminaban en null y
      // una actualizacion parcial borraba la descripcion, el presupuesto y la
      // fecha limite, y ademas devolvia la moneda a BOB.
      //
      // Se compara con `!== undefined` y no con `||` a proposito: un presupuesto
      // de 0 y una descripcion vacia son valores legitimos que `||` descarta.
      const sinTocar = (recibido, actual) => (recibido !== undefined ? recibido : actual);

      const updated = await LicitacionModel.update(id, {
        // Estos dos son obligatorios en el esquema: siempre vienen.
        nombre:     String(nombre).trim(),
        id_cliente: clienteResuelto.idCliente,

        descripcion: descripcion !== undefined
          ? (descripcion ? String(descripcion).trim() : null)
          : licitacion.descripcion,

        presupuesto_referencial: sinTocar(presupuesto_referencial, licitacion.presupuesto_referencial),
        moneda:                  sinTocar(moneda, licitacion.moneda),
        fecha_limite:            sinTocar(fecha_limite, licitacion.fecha_limite),
        id_responsable:          responsableResuelto.idResponsable,
      });

      if (!updated) {
        // El estado cambió entre la lectura y la escritura (concurrencia).
        return res.status(409).json({
          success: false,
          message: 'No se pudo actualizar: la licitación fue modificada concurrentemente. Refresque e intente de nuevo.',
        });
      }

      try {
        await logEvent({
          id_usuario:     req.user.id,
          nombre_usuario: req.user.nombre_usuario,
          accion:         AuditActions.EDITAR_LICITACION,
          entidad:        'licitaciones',
          id_entidad:     id,
          detalle:        { nombre, id_cliente },
          ip_origen:      clientIp,
          resultado:      'exito',
        });
      } catch (auditErr) {
        console.warn('[LicitacionController.updateLicitacion] Audit logging failed (non-fatal):', auditErr.message);
      }

      const refreshed = await LicitacionModel.findById(id);
      return res.status(200).json({ success: true, message: 'Licitación actualizada.', data: refreshed });
    } catch (error) {
      if (error.code === 'ER_NO_REFERENCED_ROW_2' || error.code === 'ER_NO_REFERENCED_ROW') {
        return res.status(422).json({ success: false, message: 'El cliente convocante o el responsable indicado no existe.' });
      }
      console.error('[LicitacionController.updateLicitacion] Error:', error.message);
      return res.status(500).json({ success: false, message: 'No se pudo actualizar la licitación.' });
    }
  },

  // ---------------------------------------------------------------------------
  // updateStatus — PUT /api/licitaciones/:id/estado
  // Roles autorizados por ruta: Proyectos, Ejecutivo, Jefe, SysAdmin. La matriz
  // del modelo decide según (rol, delegación, si es responsable). Un Ejecutivo
  // sin delegación → 403 del modelo.
  // ---------------------------------------------------------------------------
  async updateStatus(req, res) {
    const { id, error: idError } = parseId(req.params.id, 'licitación');
    if (idError) return res.status(idError.status).json(idError.body);

    const { nuevo_estado, observacion } = req.body;
    const userRol  = req.user.rol;
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    if (!LicitacionModel.VALID_STATES.includes(nuevo_estado)) {
      return res.status(422).json({
        success: false,
        message: `Estado destino inválido '${nuevo_estado}'. Válidos: [${LicitacionModel.VALID_STATES.join(', ')}].`,
      });
    }

    try {
      const licitacion = await LicitacionModel.findById(id);
      if (!licitacion) {
        return res.status(404).json({ success: false, message: `No se encontró la licitación con ID ${id}.` });
      }

      const estadoActual  = licitacion.estado;
      const isResponsable = req.user.id === licitacion.id_responsable;

      if (estadoActual === nuevo_estado) {
        return res.status(422).json({
          success: false,
          message: `La licitación ya está en el estado '${estadoActual}'. No hay cambio que aplicar.`,
        });
      }

      // Re-lectura fresca de la delegación desde BD (nunca confiar en el JWT):
      // un Ejecutivo delegado opera la matriz 'delegado'. Se resuelve solo para
      // Ejecutivos (los otros roles no dependen de la bandera).
      let canApproveDelegated = false;
      if (userRol === 'Ejecutivo') {
        const actingUser = await UserModel.findById(req.user.id);
        canApproveDelegated = Boolean(actingUser?.can_approve_quotations);
      }

      const transitionCheck = LicitacionModel.validateTransitionByRole(
        estadoActual,
        nuevo_estado,
        userRol,
        canApproveDelegated,
        isResponsable
      );

      if (!transitionCheck.valid) {
        return res.status(403).json({
          success:             false,
          message:             transitionCheck.reason,
          allowed_transitions: transitionCheck.allowedTransitions || [],
        });
      }

      const updated = await LicitacionModel.updateStatus(id, nuevo_estado, estadoActual, observacion || null);
      if (!updated) {
        return res.status(409).json({
          success: false,
          message: 'No se pudo actualizar el estado: la licitación fue modificada concurrentemente. Refresque e intente de nuevo.',
        });
      }

      // ── Historial + auditoría (no fatales) ───────────────────────────────
      try {
        await LicitacionModel.logStateHistory({
          id_licitacion:   id,
          estado_anterior: estadoActual,
          estado_nuevo:    nuevo_estado,
          id_usuario:      req.user.id,
          nombre_usuario:  req.user.nombre_usuario,
          rol_usuario:     userRol,
          observacion:     observacion || null,
          ip_origen:       clientIp,
        });

        await logEvent({
          id_usuario:     req.user.id,
          nombre_usuario: req.user.nombre_usuario,
          accion:         AuditActions.CAMBIAR_ESTADO_LICITACION,
          entidad:        'licitaciones',
          id_entidad:     id,
          detalle:        { estado_anterior: estadoActual, nuevo_estado, observacion: observacion || null },
          ip_origen:      clientIp,
          resultado:      'exito',
        });
      } catch (auditErr) {
        console.warn('[LicitacionController.updateStatus] Audit logging failed (non-fatal):', auditErr.message);
      }

      // ── Notificaciones (no fatales) ──────────────────────────────────────
      await notifyStateChange({
        licitacion,
        nuevoEstado: nuevo_estado,
        actorId:     req.user.id,
      });

      return res.status(200).json({
        success: true,
        message: `Estado de la licitación actualizado: '${estadoActual}' → '${nuevo_estado}'.`,
        data:    {
          id,
          estado_anterior:     estadoActual,
          nuevo_estado,
          allowed_transitions: transitionCheck.allowedTransitions,
        },
      });
    } catch (error) {
      console.error('[LicitacionController.updateStatus] Error:', error.message);
      return res.status(500).json({ success: false, message: 'No se pudo actualizar el estado de la licitación.' });
    }
  },
};

// ---------------------------------------------------------------------------
// notifyStateChange — Notificaciones mínimas de licitación (no fatales).
//
//   • Al entrar en 'Cotizando': se avisa a los ejecutivos comerciales delegados
//     (can_approve_quotations=1) para que "primero vean lo que subió Proyectos"
//     y armen/manden la cotización vinculada.
//   • En cualquier otra transición: si quien la ejecuta NO es el responsable,
//     se avisa al responsable de la licitación para que le dé seguimiento.
//
// Todo va envuelto en try/catch: una notificación nunca revierte la transición.
// ---------------------------------------------------------------------------
async function notifyStateChange({ licitacion, nuevoEstado, actorId }) {
  try {
    if (nuevoEstado === 'Cotizando') {
      const delegados = await UserModel.findDelegatedExecutives();
      const mensaje = `La licitación ${licitacion.codigo} — "${licitacion.nombre}" ` +
        `pasó a Cotizando. Revisa la información cargada y arma la cotización vinculada.`;
      await Promise.all(
        delegados
          .filter((d) => d.id !== actorId) // no auto-notificar al que la movió
          .map((d) => QuotationModel.insertNotificacion({
            id_usuario:    d.id,
            id_licitacion: licitacion.id,
            tipo:          'licitacion',
            mensaje,
          }))
      );
      return;
    }

    // Cualquier otra transición hecha por alguien distinto del responsable
    // → avisar al responsable Proyectos.
    if (actorId !== licitacion.id_responsable) {
      await QuotationModel.insertNotificacion({
        id_usuario:    licitacion.id_responsable,
        id_licitacion: licitacion.id,
        tipo:          'licitacion',
        mensaje: `La licitación ${licitacion.codigo} — "${licitacion.nombre}" ` +
                 `cambió a "${nuevoEstado}".`,
      });
    }
  } catch (notifErr) {
    console.warn('[LicitacionController.notifyStateChange] Notification insert failed (non-fatal):', notifErr.message);
  }
}

module.exports = LicitacionController;
