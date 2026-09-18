# El tablero — `public/js/views/dashboard/`

[Volver al índice](README.md) · [Las pantallas](pantallas.md)

## En pocas palabras

El tablero es **la pantalla donde se trabaja** después de entrar. No es igual
para todos: cada rol ve sus propias pestañas y sus propios botones.

| Rol | Qué ve |
|---|---|
| **Ejecutivo** | Sus indicadores, las proformas del día, sus métricas, el listado de cotizaciones («Mías» y «Equipo») y el botón de Nueva cotización. Si tiene delegación, también licitaciones y las acciones de aprobación. |
| **Jefe** y **SysAdmin** | Cola de aprobación, todas las cotizaciones, licitaciones, usuarios, clientes, auditoría, consumo por cliente y reportes. |
| **Administrador** | Lo mismo que el Jefe, pero su cola es de **revisión**: comenta y pone en espera, no aprueba. |
| **Proyectos** | Licitaciones y clientes. Nunca crea cotizaciones. |

## Cómo funciona

### Una estrategia por rol — `public/js/views/dashboard/strategies/`

El controlador del tablero (en `public/js/views/dashboardView.js`) no sabe qué
ve cada rol: elige una **estrategia** y le dice «dibujate». Todas cumplen el
mismo contrato, definido en `dashboardStrategy.js`:

| Método | Qué hace |
|---|---|
| `render(container)` | Dibuja el tablero de ese rol. |
| `refresh()` | Lo vuelve a cargar después de un cambio (aprobar, editar, crear). |
| `_renderPanel(tab)` | Monta una pestaña, desmontando antes la anterior. |

| Archivo | Rol |
|---|---|
| `executiveStrategy.js` | Ejecutivo. Su `refresh()` numera cada recarga: si llega tarde la respuesta de una anterior, se descarta. |
| `managerStrategy.js` | Jefe y SysAdmin. Tiene el diálogo de aprobar o rechazar. |
| `adminStrategy.js` | Administrador. Comentario, «En espera» y «Solicitar cambios». |
| `proyectosStrategy.js` | Proyectos. |

`wireTabs(container, onTabChange)` enciende y apaga las pestañas; es igual en
las tres estrategias que las tienen.

### Las acciones que cambian datos — `commands.js`

Aprobar, cambiar de estado, comentar, crear o desactivar un usuario: cada una es
un **comando** con un solo método, `execute()`, que hace el pedido al servidor.
Todos se ejecutan con `CommandInvoker.run`, que desactiva el botón mientras
espera, muestra el aviso de éxito o de error y después llama a `onSuccess` o a
`onError`.

| Comando | Qué pide |
|---|---|
| `ApproveQuotationCommand` | Aprobar o rechazar (Jefe). |
| `ChangeStatusCommand` | Cambiar de estado. |
| `SetComentarioAdminCommand` | Guardar el comentario del Administrador. |
| `HoldWithCommentCommand` | Poner «En espera» con comentario obligatorio. |
| `SetSeguimientoVentaCommand` | Guardar el seguimiento comercial. |
| `CreateUserCommand`, `UpdateUserCommand`, `DeactivateUserCommand` | Crear, editar y desactivar cuentas. |

### La ventana modal — `modalUI.js`

Hay **una sola** ventana modal en el tablero, que usan todos.

| Función | Qué hace |
|---|---|
| `UI.openModal(title, renderFn, opciones)` | Abre la ventana y deja que `renderFn` dibuje adentro. Antes limpia lo que hubiera. |
| `UI.registerCleanup(fn)` | Lo que hay que hacer sí o sí al cerrar (por ejemplo, liberar la reserva del número de cotización). |
| `UI.registerCloseGuard(fn)` | Un guardián que puede impedir un cierre accidental si hay cambios sin guardar. |
| `UI.requestClose()` | Cierre accidental (X, Escape, clic afuera): consulta al guardián. |
| `UI.closeModal()` | Cierre explícito: no pregunta. |

### Las pestañas y ventanas — `modules/`

| Archivo | Qué es | Función principal |
|---|---|---|
| `colaAprobacion.js` | La cola del Jefe y la del Administrador, paginada. | `mountColaAprobacion` |
| `allQuotationsTab.js` | «Todas las cotizaciones», con filtros. | `mountAllQuotationsTab` |
| `clientsView.js` | Gestión de clientes. | `mountClientsTab` |
| `clientModal.js` y `cliente/` | La ventana de alta y edición de cliente, con el aviso de NIT repetido y el alta de origen en línea. | `openClienteModal` |
| `licitacionesView.js` | El listado de licitaciones. | `mountLicitacionesTab` |
| `licitacionModal.js` y `licitacion/` | Alta, edición y adjuntos de una licitación, y su detalle con presupuesto, cotizaciones, historial y gastos. | `openLicitacionModal`, `openLicitacionDetail` |
| `licitacion/permissions.js` | Qué transiciones y acciones de licitación se le ofrecen a cada rol. | `allowedTransitions`, `canManageGastos` |
| `usersTab.js` y `userCrudModals.js` | Gestión de usuarios: la tabla y sus cuatro ventanas. | `mountUsersTab` |
| `auditView.js` | La bitácora de auditoría, con filtros. | `mountAuditLogTab` |
| `clienteItemReport.js` | Consumo por cliente e ítem, exportable a CSV. | `mountClienteItemReport` |
| `reportesView.js` | Los reportes con gráficos. | `renderReportes`, `renderExecutiveMetrics` |
| `misMetricas.js` | Las métricas personales del ejecutivo. | `renderMisMetricas` |
| `proformaTemplate.js` | La proforma de solo lectura que se ve al abrir una cotización. | `buildProformaHTML` |
| `proformaActions.js` | **Qué botones** ve cada rol sobre esa proforma. | `buildProformaActions` |
| `stateChangeDialog.js` | El diálogo «confirmá este cambio de estado». | `confirmStateChange` |
| `timelineView.js` | El historial, la descarga de PDF y Excel, y el seguimiento comercial. | `wirePdfButton`, `wireSeguimientoVenta` |
| `notificationsView.js` | La campana de avisos, que se consulta cada cierto tiempo. | `refreshNotifBadge`, `startNotifPolling` |

Los paneles de listado **devuelven su propia limpieza** al montarse: la
estrategia la llama antes de montar la pestaña siguiente.

### Ayudantes — `helpers.js` y `constants.js`

Las insignias de color (`badgeHtml` para el estado de aprobación,
`seguimientoVentaBadgeHtml`, `licitacionBadgeHtml`, `roleBadgeHtml`), los
formatos (`fmtDate`, `fmtDateTime`, `fmtAmount`, `fmtFileSize`) y los textos
compartidos.

### Las funciones de una línea que no llevan comentario

En este tablero, casi todos los llamados pasan una respuesta de una línea:
`onSuccess: () => this.refresh()`, `onRevisar: (id) => this._viewAdminDetail(id)`,
`onPageChange: … load()`. Son decenas y todas dicen lo mismo con palabras
distintas: «cuando termines, hacé esto». Están explicadas **una vez**, en la
función que las recibe (`CommandInvoker.run`, `createListSection`,
`mountColaAprobacion`, `mountAllQuotationsTab`…), y no en cada lugar donde se
escriben. Las que ocupan varias líneas sí llevan su comentario.

## Por qué es así

- **Una clase por rol en vez de un tablero lleno de `if`.** Con los permisos
  mezclados, cambiar lo que ve el Administrador obligaba a leer lo del Jefe. Hoy
  cada rol se lee en su archivo.
- **Las piezas repetidas se juntaron.** La tabla de usuarios, la cola de
  aprobación, el diálogo de cambio de estado y la ventana de cliente estaban
  copiados en dos o tres estrategias, y **las copias ya habían empezado a
  diferir**. Hoy hay una sola de cada una.
- **Qué botón ve cada rol se separó de cómo se dibuja la proforma.** Era la
  función más larga del proyecto; separarla hizo que las reglas entren en una
  pantalla.
- **Los botones que se esconden no son seguridad.** Se esconden para no
  ofrecer algo que va a fallar; quien decide es el servidor, siempre.
- **Cada panel limpia lo suyo al cerrarse.** Sin eso, cada cambio de pestaña
  dejaba escuchas huérfanas en la página, que retenían tablas que ya no se
  veían.

## Dónde está probado

Pruebas pantallaColaAprobacion, pantallaClientes, pantallaUsuarios,
pantallaConsumo, proformaButtonsWired, quotationTransitionsFront,
licitacionGastosEspejo y licitacionTransicionesEspejo (que el navegador ofrezca
lo mismo que el servidor acepta).
