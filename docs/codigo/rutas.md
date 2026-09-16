# Las direcciones de la API — `src/routes/`

[Volver al índice](README.md)

## En pocas palabras

Una ruta es **una dirección a la que el navegador le puede pedir algo**: «dame
la lista de cotizaciones», «aprobá esta», «bajame el PDF». Esta carpeta es el
**directorio** de todas esas direcciones y, para cada una, dice dos cosas:

- **quién puede usarla** (qué roles);
- **qué función la atiende** (en `src/controllers/`).

Es el mejor lugar para responder «¿quién puede hacer qué?» en todo el sistema.

## Cómo funciona

Cada archivo es un grupo de direcciones que `src/app.js` monta bajo un prefijo:

| Archivo | Prefijo | Tema |
|---|---|---|
| `src/routes/authRoutes.js` | `/api/auth` | Inicio y cierre de sesión |
| `src/routes/userRoutes.js` | `/api/usuarios` | Cuentas de usuario |
| `src/routes/clientRoutes.js` | `/api/clientes` | Clientes |
| `src/routes/brandRoutes.js` | `/api/marcas` | Catálogo de marcas |
| `src/routes/origenClienteRoutes.js` | `/api/origenes-cliente` | Catálogo de orígenes de cliente |
| `src/routes/quotationRoutes.js` | `/api/cotizaciones` | Cotizaciones |
| `src/routes/licitacionRoutes.js` | `/api/licitaciones` | Licitaciones |
| `src/routes/reportesRoutes.js` | `/api/reportes` | Reportes y métricas |
| `src/routes/auditoriaRoutes.js` | `/api/auditoria` | Bitácora de auditoría |

Cada ruta encadena sus pasos en orden: **sesión** (`authenticate`) → **rol**
(`authorize`) → a veces un **límite de peticiones** o la **recepción de
archivos** → a veces la **validación** (`validate`) → el **controlador**.
Encima de cada ruta hay un bloque `@swagger` que alimenta la documentación
interactiva de `/api-docs`.

### Abreviaturas de roles

| Abreviatura | Roles |
|---|---|
| **Todos** | Ejecutivo, Administracion, Jefe, SysAdmin, Proyectos |
| **Cotizan** | Ejecutivo, Administracion, Jefe, SysAdmin |
| **Gerencia** | Jefe, Administracion, SysAdmin |
| **Licitan** | Proyectos, Jefe, SysAdmin |
| **Sesión** | cualquier persona con sesión iniciada (no revisa el rol) |

### Sesión — `/api/auth`

| Verbo y dirección | Quién | Qué atiende | Qué hace |
|---|---|---|---|
| POST `/login` | Público | `AuthController.login` | Inicia sesión. Máximo 5 intentos cada 15 minutos por IP. |
| POST `/logout` | Sesión | `AuthController.logout` | Cierra la sesión. |
| GET `/me` | Sesión | `AuthController.getMe` | Devuelve quién es la persona conectada. |
| GET `/docs-token` | Jefe, SysAdmin | `AuthController.getDocsToken` | Emite el pase de 10 minutos para abrir `/api-docs`. |

### Usuarios — `/api/usuarios`

| Verbo y dirección | Quién | Qué atiende | Qué hace |
|---|---|---|---|
| GET `/` | Gerencia | `UserController.listUsers` | Lista las cuentas. |
| POST `/` | Gerencia | `UserController.createUser` | Crea una cuenta. |
| GET `/:id` | Gerencia | `UserController.getUserById` | Una cuenta. |
| PUT `/:id` | Gerencia | `UserController.updateUser` | Edita una cuenta (con reglas sobre quién puede tocar a un SysAdmin). |
| DELETE `/:id` | Gerencia | `UserController.deactivateUser` | Desactiva la cuenta (no la borra). |

### Clientes — `/api/clientes`

| Verbo y dirección | Quién | Qué atiende | Qué hace |
|---|---|---|---|
| GET `/` | Todos | `ClientController.search` | Busca clientes (paginado). |
| POST `/` | Todos | `ClientController.create` | Crea un cliente. |
| GET `/all` | Todos | `ClientController.listAll` | Lista completa para los selectores. |
| GET `/:id` | Todos | `ClientController.getById` | Un cliente. |
| PUT `/:id` | Todos | `ClientController.update` | Edita un cliente. |
| DELETE `/:id` | Gerencia | `ClientController.deactivate` | Desactiva el cliente. |

### Catálogos — `/api/marcas` y `/api/origenes-cliente`

| Verbo y dirección | Quién | Qué atiende | Qué hace |
|---|---|---|---|
| GET `/api/marcas` | Cotizan | `BrandController.getBrands` | Las marcas activas. |
| POST `/api/marcas` | Cotizan | `BrandController.createBrand` | Agrega una marca. |
| GET `/api/origenes-cliente` | Cotizan | `OrigenClienteController.getOrigenes` | Los orígenes activos. |
| POST `/api/origenes-cliente` | Cotizan | `OrigenClienteController.createOrigen` | Agrega un origen. |

### Cotizaciones — `/api/cotizaciones`

| Verbo y dirección | Quién | Qué atiende | Qué hace |
|---|---|---|---|
| GET `/resumen` | Todos | `QuotationController.getStateSummary` | Cuántas hay en cada estado. |
| GET `/next-correlativo` | Todos | `QuotationController.getNextCorrelativo` | Muestra el próximo número, sin reservarlo. |
| GET `/pendientes-aprobacion` | Gerencia | `QuotationController.getPendingApproval` | La cola de aprobación, paginada. |
| GET `/notificaciones` | Todos | `QuotationController.getNotificaciones` | Los avisos de la persona. |
| POST `/notificaciones/leer` | Todos | `QuotationController.markNotificacionesLeidas` | Marca los avisos como leídos. |
| GET `/seguimientos-ocupados` | Cotizan | `QuotationController.getSeguimientosOcupados` | Días con seguimientos ya agendados. |
| GET `/` | Todos | `QuotationController.getQuotations` | El listado con filtros, paginado. |
| POST `/` | Cotizan | `QuotationController.createQuotation` | Crea una cotización y su PDF. |
| GET `/:id` | Todos | `QuotationController.getQuotationById` | Una cotización con sus ítems. |
| PUT `/:id` | Solo Ejecutivo | `QuotationController.updateQuotation` | Edita una cotización. |
| GET `/:id/historial` | Todos | `QuotationStateController.getStateHistory` | Los cambios de estado. |
| PUT `/:id/estado` | Cotizan | `QuotationStateController.updateStatus` | Cambia el estado. |
| POST `/:id/aprobar` | Jefe, SysAdmin | `QuotationStateController.approveQuotation` | Aprueba o rechaza. |
| POST `/:id/upload` | Solo Ejecutivo | `QuotationPdfController.uploadFiles` | Sube el Excel de respaldo. Máximo 20 subidas cada 15 minutos. |
| GET `/:id/pdf` | Todos | `QuotationPdfController.downloadPdf` | Descarga la proforma. |
| GET `/:id/excel` | Todos | `QuotationPdfController.downloadExcel` | Descarga el Excel de respaldo. |
| PATCH `/:id/comentario-admin` | Solo Administracion | `QuotationController.patchComentarioAdmin` | El comentario del Administrador. |
| PATCH `/:id/seguimiento` | Cotizan | `QuotationController.patchSeguimientoVenta` | El seguimiento comercial. |

Los roles de la tabla son la **primera** barrera. Varias operaciones tienen
reglas finas adentro del controlador: por ejemplo, un Ejecutivo solo ve y edita
**sus** cotizaciones, y qué estados puede elegir cada rol lo decide la máquina
de estados (ver [modelos.md](modelos.md)).

### Licitaciones — `/api/licitaciones`

| Verbo y dirección | Quién | Qué atiende | Qué hace |
|---|---|---|---|
| GET `/next-correlativo` | Licitan | `LicitacionController.getNextCorrelativo` | El próximo número. |
| GET `/` | Todos | `LicitacionController.getLicitaciones` | El listado con filtros. |
| POST `/` | Licitan | `LicitacionController.createLicitacion` | Crea una licitación. |
| GET `/:id` | Todos | `LicitacionController.getLicitacionById` | Una licitación con sus totales. |
| GET `/:id/historial` | Todos | `LicitacionController.getStateHistory` | Los cambios de estado. |
| PUT `/:id` | Licitan | `LicitacionController.updateLicitacion` | Edita una licitación. |
| PUT `/:id/estado` | Proyectos, Ejecutivo, Jefe, SysAdmin | `LicitacionController.updateStatus` | Cambia el estado. |
| POST `/:id/documentos` | Licitan | `LicitacionDocumentController.uploadDocumentos` | Sube documentos. Máximo 20 subidas cada 15 minutos. |
| GET `/:id/documentos` | Todos | `LicitacionDocumentController.getDocumentos` | Lista los documentos. |
| GET `/:id/documentos/:docId` | Todos | `LicitacionDocumentController.downloadDocumento` | Descarga un documento. |
| DELETE `/:id/documentos/:docId` | Licitan | `LicitacionDocumentController.deleteDocumento` | Borra un documento. |
| POST `/:id/gastos` | Administracion, Proyectos, Jefe, SysAdmin | `LicitacionGastoController.addGasto` | Registra un gasto. |
| GET `/:id/gastos` | Todos | `LicitacionGastoController.getGastos` | Lista los gastos y su total. |
| DELETE `/:id/gastos/:gastoId` | Administracion, Proyectos, Jefe, SysAdmin | `LicitacionGastoController.deleteGasto` | Borra un gasto. |
| GET `/:id/pdf` | Todos | `LicitacionController.downloadPdf` | Descarga la ficha en PDF. |

### Reportes — `/api/reportes`

| Verbo y dirección | Quién | Qué atiende | Qué hace |
|---|---|---|---|
| GET `/progreso` | Gerencia | `ReportesController.getProgreso` | Avance de cada vendedor. |
| GET `/advanced` | Gerencia y Ejecutivo | `ReportesController.getAdvancedReports` | Los reportes de ventas (el Ejecutivo solo ve lo suyo). |
| GET `/pdf` | Gerencia y Ejecutivo | `ReportesController.getReportePdf` | El reporte en PDF. Máximo 20 cada 15 minutos. |
| GET `/cliente-item` | Sesión | `ReportesController.getClienteItem` | Consumo por cliente e ítem (el alcance lo decide el controlador según el rol). |
| GET `/mis-metricas` | Sesión | `ReportesController.getMisMetricas` | Las métricas personales. |

### Auditoría — `/api/auditoria`

| Verbo y dirección | Quién | Qué atiende | Qué hace |
|---|---|---|---|
| GET `/` | Gerencia | `AuditoriaController.getAuditLogs` | La bitácora, con filtros y paginada. |
| GET `/opciones` | Gerencia | `AuditoriaController.getFilterOptions` | Los valores posibles de los filtros. |

### Las funciones de esta carpeta

Casi todo es configuración; las pocas funciones configuran la recepción de
archivos y los límites de peticiones:

| Función | Dónde | Qué hace |
|---|---|---|
| `destination(...)` | `quotationRoutes.js`, `licitacionRoutes.js` | La carpeta del disco donde multer guarda el archivo subido. |
| `filename(req, file, cb)` | los mismos | El nombre con que se guarda, armado con `buildUploadFilename`. |
| `licDocFileFilter(_req, file, cb)` | `licitacionRoutes.js` | Rechaza documentos con una extensión no permitida antes de escribirlos. |
| `skip()` | `authRoutes.js`, `quotationRoutes.js`, `licitacionRoutes.js`, `reportesRoutes.js` | Desactiva el límite de peticiones en desarrollo y en pruebas. |

## Por qué es así

- **El orden de las rutas es parte de su significado.** Express prueba las rutas
  de arriba hacia abajo: si `/:id` se registrara antes que `/resumen`, la
  palabra «resumen» se tomaría como un id y la petición llegaría a la función
  equivocada **sin ningún error**. Por eso las direcciones fijas van siempre
  primero.
- **Los permisos se leen en un solo lugar.** Al declarar los roles en la ruta y
  no dentro de cada controlador, la matriz de permisos completa entra en esta
  carpeta.
- **Los nombres de archivos subidos nunca usan el id de la URL tal cual.**
  Express decodifica la dirección **después** de elegir la ruta, así que un id
  como `..%2f..%2f` podía sacar el archivo de su carpeta. `buildUploadFilename`
  deja solo letras y números.
- **Límites propios en login, subidas y PDF de reportes**, además del global:
  son las operaciones que un atacante repetiría (adivinar contraseñas) o que
  más cuestan al servidor (escribir a disco, armar un PDF).

## Dónde está probado

Pruebas rutasProtegidas (toda ruta exige sesión, salvo las públicas a
propósito), reportesAlcance (qué ve cada rol en reportes), loginLockout (el
límite de intentos), licitacionDocSizeLimit y pdfSizeLimit (tamaños de subida),
uploadFilename (los nombres seguros) y colaAprobacionPaginada (la cola de
aprobación).
