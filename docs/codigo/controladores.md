# Lo que pasa en cada operación — `src/controllers/`

[Volver al índice](README.md)

## En pocas palabras

Los controladores son **quienes toman las decisiones**. Cuando llega una
petición ya autorizada y con datos válidos, el controlador:

1. lee lo que haga falta de la base (a través de los modelos);
2. aplica las **reglas del negocio**: ¿esta cotización es tuya?, ¿se puede
   aprobar en el estado en que está?, ¿el cliente sigue activo?;
3. guarda los cambios, deja **huella en la bitácora** y avisa a quien corresponda;
4. responde: los datos pedidos, o un mensaje claro de por qué no se pudo.

## Cómo funciona

### Convenciones comunes

- Cada función atiende **una** ruta y lleva arriba un comentario con su verbo,
  su dirección y los roles que la usan.
- Un id inválido en la URL responde 422 con el mismo mensaje en todos lados
  (`parseId`, ver [utilidades.md](utilidades.md)).
- Toda operación importante llama a `logEvent` para la bitácora de auditoría.
- Los errores 500 registran el detalle en el log y responden un mensaje
  genérico.
- Las funciones de ayuda privadas empiezan con guion bajo (`_validarPassword`).

### Sesión y usuarios

**`src/controllers/authController.js`**

| Función | Qué hace |
|---|---|
| `login(req, res)` | Busca la cuenta, revisa si está bloqueada por intentos fallidos, compara la contraseña con bcrypt y, si todo está bien, abre la sesión. |
| `_rechazarLogin(res, {...})` | Registra el intento fallido en la bitácora y responde 401 con un mensaje que no revela si el usuario existe. |
| `_emitirSesion(res, {...})` | Limpia el contador de intentos, firma el token con el `token_version` actual y responde los datos de la persona. |
| `getMe(req, res)` | Devuelve la persona conectada leída **de la base**, no del token (así un cambio de rol se ve al instante). |
| `logout(req, res)` | Cierra la sesión: agrega el token a la lista de cerrados y sube `token_version`. |
| `getDocsToken(req, res)` | Emite el token de un solo uso para `/api-docs`. |

**`src/controllers/userController.js`**

| Función | Qué hace |
|---|---|
| `listUsers`, `getUserById` | Leen cuentas. |
| `createUser(req, res)` | Crea una cuenta con la contraseña cifrada, después de pasar todas las validaciones de abajo. |
| `updateUser(req, res)` | Edición parcial: nombre, rol, activo, delegación y cambio de contraseña. |
| `deactivateUser(req, res)` | Desactiva la cuenta (no se borra: sus cotizaciones la siguen nombrando). |
| `_validarPassword(password)` | Reglas mínimas de contraseña. |
| `_validarIdRol(idRol)` | El rol tiene que ser uno de los cinco que existen. |
| `_validarPermisoSobreAscensoAJefe(...)` | Solo Jefe y SysAdmin pueden dar el rol Jefe. |
| `_validarNoAutoEdicionDeRol(...)` | Nadie puede cambiar **su propio** rol. |
| `_validarPermisoSobreSysAdmin(...)` | Solo un SysAdmin crea o modifica a otro SysAdmin. |
| `resolveDelegationFlag(reqUserRol, rawValue)` | Solo quien tiene autoridad puede otorgar la delegación para aprobar cotizaciones. |

### Clientes y catálogos

**`src/controllers/clientController.js`**

| Función | Qué hace |
|---|---|
| `search(req, res)` | El autocompletado: hasta 20 clientes activos que coinciden. |
| `listAll(req, res)` | El listado de gestión, paginado e incluyendo inactivos. |
| `getById(req, res)` | Un cliente con todos sus datos. |
| `create(req, res)` | Alta rápida desde el formulario de cotización. Rechaza un NIT repetido. |
| `update(req, res)` | Corrige los datos de un cliente. |
| `deactivate(req, res)` | Lo desactiva (no se borra si tiene cotizaciones). |
| `_validarCamposCliente({...})` | Las reglas de los campos, compartidas por crear y editar. |
| `_validarOrigenCliente(id)` | El origen elegido tiene que existir, antes de guardar. |

**`src/controllers/catalogoSimple.js`** — una **fábrica** de controladores para
catálogos de un solo campo (nombre).

| Función | Qué hace |
|---|---|
| `crearControladorDeCatalogo({...})` | Recibe el modelo, la tabla y los textos, y devuelve `listar` y `crear`. |
| `listar(req, res)` | Todo el catálogo en orden alfabético. |
| `crear(req, res)` | Agrega un nombre; responde 409 si ya existe (sin distinguir mayúsculas). |
| `yaExiste(fila)` | La respuesta 409 compartida. |

`src/controllers/brandController.js` (marcas) y
`src/controllers/origenClienteController.js` (orígenes de cliente) son solo
**configuraciones** de esa fábrica.

### Cotizaciones

`src/controllers/quotationController.js` es la puerta del módulo: junta sus
propias funciones con las de lectura y notificaciones, para que las rutas usen
un solo nombre. El resto vive en `src/controllers/quotation/`.

**`src/controllers/quotationController.js`** — crear y editar

| Función | Qué hace |
|---|---|
| `createQuotation(req, res)` | En **una transacción**: reserva el correlativo, guarda la cabecera y los ítems, y confirma. Después genera el PDF. |
| `runPostCommitTasks({...})` | Lo que pasa **después** de confirmar: bitácora, PDF, liberar la reserva de redacción. Si algo falla acá, la respuesta sigue siendo «creada». |
| `calcularTotalCotizacion(...)` | Recalcula el total en el servidor a partir de los ítems; el total que manda el navegador no se usa. |
| `updateQuotation(req, res)` | Edita una cotización devuelta con «Solicitar cambios» (solo su dueño). |
| `campo(nombre)`, `campoSolicitante(...)` | Si un campo no vino en la edición, se conserva el valor anterior. |
| `getNextCorrelativo(req, res)` | Vista previa del próximo número, sin reservarlo. |
| `getQuotationById(req, res)` | Una cotización (un Ejecutivo solo ve las suyas). |
| `patchComentarioAdmin(req, res)` | El comentario del Administrador. |
| `patchSeguimientoVenta(req, res)` | El seguimiento comercial. |
| `getSeguimientosOcupados(req, res)` | Días que ya tienen un seguimiento agendado. |

**`src/controllers/quotation/quotationQueryController.js`** — lecturas

| Función | Qué hace |
|---|---|
| `getQuotations(req, res)` | El listado con filtros, orden y paginación. |
| `getPendingApproval(req, res)` | La cola de aprobación, paginada. |
| `getStateSummary(req, res)` | Cuántas hay por estado (el Ejecutivo, solo las suyas). |

**`src/controllers/quotation/quotationStateController.js`** — estados

| Función | Qué hace |
|---|---|
| `updateStatus(req, res)` | Cambia el estado pasando por los siete controles de `stateTransitionGuards.js` y después aplica los efectos de `stateTransitionEffects.js`. |
| `approveQuotation(req, res)` | Aprueba o rechaza (Jefe, SysAdmin). |
| `_validateApproveRequest(req)` | Los controles de entrada de la aprobación. |
| `_sendApprovalNotification({...})` | Avisa al Ejecutivo que su cotización fue aprobada. |
| `getStateHistory(req, res)` | La línea de tiempo de estados. |

**`src/controllers/quotation/stateTransitionGuards.js`** — los controles de un
cambio de estado, **en orden**:

| Función | Qué controla |
|---|---|
| `verificarEntrada(idCrudo, nuevoEstado)` | Que el id y el estado destino tengan forma válida. |
| `resolverDelegacion(userRol, nuevoEstado, userId)` | Si quien llama tiene delegación para aprobar, leída de la base. |
| `verificarExistenciaYEstado(quotation, id, nuevoEstado)` | Que la cotización exista y no esté ya en ese estado. |
| `verificarPermisoDeRol(...)` | Que ese rol pueda hacer ese paso puntual. |
| `verificarMotivoDeReapertura(...)` | Que reabrir una venta cerrada lleve un motivo. |
| `verificarListaPrevia(id, nuevoEstado)` | Que la cotización esté completa antes de mandarla a revisión. |
| `normalizarComentarioAdmin(userRol, comentario)` | Que solo Administracion adjunte su comentario. |

**`src/controllers/quotation/stateTransitionEffects.js`** — lo que pasa después

| Función | Qué hace |
|---|---|
| `registrarHuella({...})` | Escribe el historial de estados y la bitácora. |
| `notificarAlEjecutivo({...})` | Avisa al dueño en los hitos y cuando le reabren una venta. |
| `notificarALicitacion({...})` | Avisa al responsable de la licitación a la que pertenece. |

**Otras piezas de `src/controllers/quotation/`**

| Archivo y función | Qué hace |
|---|---|
| `quotationPdfController.js` → `downloadPdf`, `downloadExcel`, `uploadFiles` | Descargar la proforma (si falta en disco se regenera), descargar y subir el Excel. |
| `quotationPdfController.js` → `buildPdfDownloadName`, `_rejectIfNotOwner`, `_unlinkOldFile` | El nombre del archivo descargado, el control de dueño y el borrado del archivo reemplazado. |
| `quotationNotificationController.js` → `getNotificaciones`, `markNotificacionesLeidas`, `mergeNotificaciones` | Junta los tres tipos de aviso en una sola lista por fecha y los marca como leídos. |
| `quotationFilters.js` → `parseQuotationFilters`, `positiveInt`, `invalid` | Lee y valida los filtros del listado que llegan en la URL. |
| `transactionHelpers.js` → `withDeadlockRetry` | Corre una transacción y la reintenta hasta 3 veces si MySQL detecta un bloqueo mutuo. Siempre devuelve la conexión. |
| `pdfRegeneration.js` → `regenerateQuotationPdf` | Borra el PDF anterior, genera el nuevo y guarda su ruta. |
| `clienteLinkGuard.js` → `verificarCliente` | El cliente elegido existe y está activo, antes de guardar. |
| `licitacionLinkGuard.js` → `verificarVinculoLicitacion` | La licitación vinculada existe y admite cotizaciones. |

### Licitaciones

**`src/controllers/licitacionController.js`**

| Función | Qué hace |
|---|---|
| `createLicitacion(req, res)` | En una transacción: reserva el correlativo y crea la licitación. |
| `getLicitaciones`, `getLicitacionById`, `getStateHistory`, `getNextCorrelativo` | Lecturas. |
| `updateLicitacion(req, res)` | Edita la cabecera, solo en «En preparacion» o «Cotizando». |
| `sinTocar(recibido, actual)` | Un campo que no vino queda como estaba. |
| `updateStatus(req, res)` | Cambia el estado según la matriz de transiciones del modelo. |
| `notifyStateChange({...})` | Avisa a los ejecutivos cuando la licitación pasa a «Cotizando». |
| `downloadPdf(req, res)` | Genera la ficha en PDF en el momento (no se guarda). |
| `validarRolResponsable`, `validarClienteYResponsableParaCrear`, `resolverClienteEnEdicion`, `resolverResponsableEnEdicion` | El responsable tiene que ser Proyectos, Jefe o SysAdmin; solo Jefe y SysAdmin lo reasignan; el cliente tiene que estar activo. |

**`src/controllers/licitacionDocumentController.js`**

| Función | Qué hace |
|---|---|
| `uploadDocumentos(req, res)` | Recibe varios archivos, **revisa su contenido real** y los registra; si uno falla, se deshace todo. |
| `verifyMagicNumber(absPath, ext)` | Lee los primeros bytes del archivo y confirma que es lo que dice su extensión. |
| `isZip`, `isOle2`, y las entradas de `MAGIC_CHECKS` | Las firmas de cada tipo: Office moderno es un ZIP, Office antiguo es OLE2, y PDF, JPG y PNG tienen la suya. |
| `extOf`, `unlink`, `cleanupAll`, `borrarDeDisco`, `mimeDe` | Ayudas: la extensión, borrar del disco lo que no debe quedar, el tipo de contenido deducido de la extensión ya verificada. |
| `getDocumentos`, `downloadDocumento`, `deleteDocumento` | Listar, descargar y borrar. |
| `canManageDocuments(user, licitacion)` | Gestiona documentos el responsable, Jefe o SysAdmin. |

**`src/controllers/licitacionGastoController.js`**

| Función | Qué hace |
|---|---|
| `addGasto`, `getGastos`, `deleteGasto` | Registrar, listar (con el total en la moneda de la licitación) y borrar gastos. |
| `canManageGastos(user, licitacion)` | Gestiona gastos Administracion, el responsable, Jefe o SysAdmin. |

**`src/controllers/licitacion/`**

| Archivo y función | Qué hace |
|---|---|
| `buscarLicitacion.js` → `buscarLicitacion(valorId)` | Convierte el id de la URL en una licitación existente, o en el error que corresponde. |
| `persistirDocumentos.js` → `persistirDocumentos({...})` | Registra un archivo por fila; si uno falla, deshace los anteriores. |

### Reportes y auditoría

**`src/controllers/reportesController.js`**

| Función | Qué hace |
|---|---|
| `getProgreso`, `getAdvancedReports`, `getReportePdf`, `getClienteItem`, `getMisMetricas` | Un reporte cada una. |
| `resolveEjecutivoScope(req)` | **El único lugar** que decide de quién son los datos: la gerencia puede elegir un ejecutivo; cualquier otro rol ve siempre los suyos, aunque pida otro. |
| `resolveDateRange(query, defaultToMonth)`, `isValidDate(s)` | Lee y valida el rango de fechas. |
| `responderError(res, error, etiqueta, mensaje)` | La respuesta de error de todos los reportes: si se pasó del tope de 30 segundos responde 503 con «acotá el rango», no un 500. |

**`src/controllers/auditoriaController.js`**

| Función | Qué hace |
|---|---|
| `getAuditLogs(req, res)` | La bitácora con filtros y paginación. |
| `getFilterOptions(req, res)` | Los valores posibles de cada filtro. |

## Por qué es así

- **El total lo calcula el servidor.** Un navegador modificado podría mandar un
  total que no coincide con los ítems. El servidor lo recalcula siempre, con el
  mismo redondeo que usa el PDF.
- **Lo que pasa después de confirmar no puede fallar la creación.** Antes, si el
  PDF fallaba, la respuesta era «error», la persona reenviaba el formulario y se
  creaba una **segunda** cotización con otro número.
- **Un cambio de estado pasa por controles separados y numerados** en vez de una
  sola función de 300 líneas: cada control se prueba por su cuenta y se lee en
  orden.
- **El alcance de los reportes se decide en un solo lugar.** Si cada reporte lo
  decidiera por su cuenta, bastaría con que uno se olvidara para que un
  Ejecutivo viera las cifras de otro.
- **El contenido de los archivos se verifica, no solo la extensión.** Renombrar
  un ejecutable a `.pdf` no lo convierte en un PDF.
- **Un reporte que se pasa de 30 segundos responde 503, no 500:** no es una
  falla del servidor, es una consulta demasiado grande, y el mensaje le dice a
  la persona cómo achicarla.

## Dónde está probado

Pruebas creacionSobreviveAlPostCommit, correlativo.concurrencia, approvalChecklist,
reabrirConfirmada, editarNoPisaMoneda, clienteOrigenInvalido, userRoleEscalation,
bcryptCompatibilidad, loginLockout, catalogoSimple, quotationFilters,
quotationNotificaciones, transactionHelpers, pdfRegeneration, buscarLicitacion,
subidaParcialDocumentos, gastoDosIdentificadores, reportesAlcance,
reportePdfPorEjecutivo y topeConsultas.
