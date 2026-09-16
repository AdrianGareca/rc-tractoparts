# Las consultas a la base — `src/models/`

[Volver al índice](README.md)

## En pocas palabras

Los modelos son **los únicos que hablan con la base de datos**. Cada uno se
ocupa de una o varias tablas y ofrece operaciones con nombre claro: «buscá este
cliente», «guardá esta cotización», «contá las pendientes de aprobación». El
resto del sistema pide cosas a los modelos y nunca escribe SQL por su cuenta.

## Cómo funciona

### Reglas que cumplen todos

- **Consultas parametrizadas:** los valores van como `?` y nunca pegados dentro
  del texto de la consulta. Es la defensa contra la inyección de SQL.
- **Transacciones de quien llama:** las funciones que reciben `connection` deben
  correr dentro de una transacción que abrió el controlador; así varias
  escrituras se confirman juntas o no se confirma ninguna.
- **Concurrencia optimista:** un cambio de estado se escribe con
  `WHERE id = ? AND estado = ?`. Si otra persona cambió el estado un instante
  antes, no se actualiza nada y se avisa, en vez de pisar su cambio.
- **Paginación en dos consultas gemelas:** `findAll` trae una página y
  `countAll` cuenta el total **con el mismo filtro**, armado por una sola
  función para que nunca diverjan.

### Usuarios, clientes y catálogos

**`src/models/UserModel.js`** — tabla `usuarios`

| Función | Qué hace |
|---|---|
| `findByUsername`, `findById`, `findAll` | Buscar cuentas (activas o no). |
| `findDelegatedExecutives()` | Ejecutivos activos con delegación para aprobar. |
| `create`, `update` | Crear y editar (la contraseña llega ya cifrada). |
| `updateLoginSuccess(id)` | Tras un ingreso correcto: pone en cero los intentos fallidos y anota el último acceso. |
| `incrementFailedAttempts(id)` | Suma un intento fallido y bloquea la cuenta al llegar al límite. |
| `getTokenVersion`, `getSessionState` | Leen la versión de sesión (y si la cuenta está activa) para validar cada petición. |
| `incrementTokenVersion(id)` | Invalida al instante **todas** las sesiones de esa persona. |

**`src/models/ClientModel.js`** — tabla `clientes`

| Función | Qué hace |
|---|---|
| `search(q)` | Hasta 20 clientes activos por razón social o NIT. |
| `findById(id)` / `findByIdAny(id)` | Un cliente activo / un cliente activo o no. |
| `findAllPaginated`, `countAll` | El listado de gestión y su total. |
| `findByNit(nit)` | Quién tiene ya ese NIT, para explicar un conflicto. |
| `create`, `update` | Alta y edición. |
| `origenExists(id)` | ¿Existe ese origen de cliente? |

**`src/models/BrandModel.js`** y **`src/models/OrigenClienteModel.js`** —
catálogos de marcas y orígenes, con la misma forma: `getAll()` (activos en orden
alfabético), `findByNombre(nombre)` (sin distinguir mayúsculas) y `create(nombre)`.

**`src/models/AuditLogModel.js`** — lectura de `bitacora_auditoria`

| Función | Qué hace |
|---|---|
| `findAll`, `countAll` | La bitácora filtrada, de lo más reciente a lo más viejo, y su total. |
| `_buildWhereClause(filters)` | El filtro compartido por las dos. |
| `distinctEntidades()` | Las tablas que aparecen de verdad en la bitácora, para el filtro. |

La **escritura** de la bitácora no está acá: la hace `logEvent` en
`src/utils/auditLog.js`.

### Cotizaciones

`src/models/QuotationModel.js` es una **fachada**: no tiene lógica propia, junta
en un solo objeto las funciones de `src/models/quotation/`, que están separadas
por responsabilidad.

| Archivo | Responsabilidad | Funciones principales |
|---|---|---|
| `src/models/quotation/constants.js` | Los estados, **la matriz de quién puede mover qué**, las columnas por las que se puede ordenar y fragmentos de SQL compartidos. | `isReopening`, `marcadoresDe`, `literalesDe` |
| `src/models/quotation/correlativoRepository.js` | Los números de cotización, con formato `SC-AAAA/NNNNNN`. | `formatCorrelativo`, `peekNextCorrelativo` (solo mira), `generateCorrelativo` (reserva, bloqueando la fila del año) |
| `src/models/quotation/whereBuilder.js` | El filtro del listado. | `buildWhereClause`, `necesitaClientes` (une la tabla de clientes solo si algún filtro la necesita) |
| `src/models/quotation/readRepository.js` | Lecturas. | `findById` (con ítems y aprobación), `findAll`, `countAll`, `findSummaryByState`, `findPendingApproval`, `countPendingApproval`, `checkDuplicate` (cotizaciones parecidas en 30 días), `escapeLike` |
| `src/models/quotation/writeRepository.js` | Escrituras. | `create`, `createDetalles`, `updateEditableHeader`, `replaceDetalles`, `updatePdfPath`, `updateExcelPath`, `swapFilePath`, `updateComentarioAdmin`, `updateSeguimientoVenta`, `_verificarReferenciasDetalles` (productos y marcas de los ítems existen), `_idsFaltantes` |
| `src/models/quotation/stateMachine.js` | La máquina de estados y la aprobación. | `validateTransitionByRole`, `getAllowedTransitions`, `validateForReview` (lista previa), `updateStatus`, `approve`, `logStateHistory`, `findStateHistory` |
| `src/models/quotation/notificationRepository.js` | Los avisos. | `insertNotificacion`, `findNotificacionesEjecutivo`, `findNotificacionesPendientes` (pedidos de corrección), `findSeguimientosDelDia`, `findFechasSeguimientoOcupadas`, `markNotificacionesLeidas` |
| `src/models/quotation/analyticsRepository.js` | Reportes de ventas. | `getProgreso`, `getAdvancedReports`, `buildFilters`, `_getSeguimientoVentaResumen` |
| `src/models/quotation/clienteItemReport.js` | Consumo por cliente e ítem, a nivel de línea. | `find`, `count`, `ejecutivos`, `_where`, `LINEAS_SQL` |
| `src/models/quotation/misMetricas.js` | Las métricas personales del ejecutivo. | `obtener`, `_consultarPeriodo` (seis consultas en paralelo), `_periodoAnterior` (la ventana previa para comparar), `_fetchPorEstado`, `_fetchResumen`, `_fetchPorMes`, `_fetchPendientes`, `_fetchConfirmadas`, `_fetchTopItems` |

**`src/models/QuotationLockModel.js`** — tabla `cotizacion_borrador_lock`

| Función | Qué hace |
|---|---|
| `acquireOrGet({...})` | Reserva el próximo número para quien abre el formulario; si ya lo reservó otra persona, devuelve quién. Hay **una sola** reserva por año. |
| `releaseBySocketId(socketId)` | Libera la reserva de una conexión que se cerró. |
| `releaseByNumeroCorrelativo(numero)` | Libera la reserva cuando la cotización ya se guardó. |
| `releaseAll()` | Libera todo al arrancar el servidor. |

### Licitaciones

**`src/models/LicitacionModel.js`** — tablas `licitaciones`, su historial y su
correlativo

| Función | Qué hace |
|---|---|
| `formatCorrelativo`, `peekNextCorrelativo`, `generateCorrelativo` | Los números, con formato `LIC-AAAA/NNNN`. |
| `resolveActorType(...)`, `validateTransitionByRole(...)` | Quién es quien llama (responsable, ejecutivo delegado, Jefe) y si puede hacer ese cambio de estado. **La matriz de transiciones de licitaciones vive acá.** |
| `create`, `update`, `updateStatus` | Crear, editar la cabecera y cambiar de estado (con concurrencia optimista). |
| `findAll`, `countAll`, `buildWhereClause` | Listado paginado. |
| `findById(id)` | Detalle completo: cabecera, responsable, cliente, cotizaciones vinculadas, totales y gastos. |
| `logStateHistory`, `findStateHistory` | El historial de estados. |

**`src/models/LicitacionDocumentModel.js`** y
**`src/models/LicitacionGastoModel.js`** — documentos y gastos: `create`,
`findByLicitacion`, `findById`, `deleteById` (y `sumByLicitacion` en gastos).
El modelo de documentos **nunca toca el disco**: borrar el archivo es tarea del
controlador.

## Por qué es así

- **Solo los modelos escriben SQL** para que una tabla se consulte siempre de la
  misma forma, y para que un cambio de columna se haga en un solo archivo.
- **El correlativo se reserva bloqueando la fila del año** (`FOR UPDATE`). Sin
  ese bloqueo, dos personas que guardan al mismo segundo podrían recibir el mismo
  número. La prueba de concurrencia dispara creaciones simultáneas y exige
  números distintos.
- **`QuotationModel.js` quedó como fachada** porque el archivo original había
  llegado a 1600 líneas. Separarlo por responsabilidad no cambió ningún llamado: el
  resto del sistema sigue usando `QuotationModel`.
- **Los reportes pesados usan `consultarReporte`** en vez de consultar directo:
  así llevan el tope de 30 segundos y no pueden acaparar las conexiones de toda
  la empresa (ver [utilidades.md](utilidades.md)).
- **El conteo de la cola y del listado no une tablas que no necesita.** Unir clientes y
  usuarios solo para contar agrega trabajo a la base sin cambiar el resultado.

## Dónde está probado

Pruebas correlativo.concurrencia y licitacionCorrelativoConcurrencia (números
únicos bajo carga), getAllowedTransitions, quotationReopen y
licitacionTransicionesEspejo (las matrices de estados), whereBuilderClientes
(los filtros), draftLockRelease (las reservas), detalleReferenciaInvalida
(ítems con referencias inexistentes), colaAprobacionPaginada, misMetricas,
reporteClienteItem, clienteItemAlcance, indicesBitacora y topeConsultas.
