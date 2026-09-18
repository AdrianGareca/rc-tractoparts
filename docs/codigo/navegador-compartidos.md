# Las herramientas compartidas del navegador — `public/js/shared/`

[Volver al índice](README.md) · [Las pantallas](pantallas.md)

## En pocas palabras

Son **piezas chicas que usan varias pantallas**: la paginación, el calendario,
los gráficos, la descarga de archivos, el formato de fechas. Igual que en el
servidor (ver [utilidades.md](utilidades.md)), casi todas nacieron de lo mismo:
una tarea escrita a mano en varias pantallas, con copias que habían empezado a
diferir.

Algunas son **copias deliberadas de reglas del servidor**, porque el navegador
no puede importar archivos del servidor. Cada una tiene una prueba que exige que
las dos copias digan exactamente lo mismo.

## Cómo funciona

### Las copias de reglas del servidor

| Archivo | Copia de | Qué contiene |
|---|---|---|
| `public/js/shared/roles.js` | `src/config/roles.js` | Los cinco roles y `nombreDeRol`. |
| `public/js/shared/quotationTransitions.js` | la máquina de estados | Qué estados puede elegir cada rol desde cada estado: `allowedTransitions`, `isReopening`. El selector solo ofrece lo que el servidor va a aceptar. |
| `public/js/shared/quotationTotals.js` | `src/utils/quotationTotals.js` | El dinero del formulario: redondear cada línea y después sumar (`sumSubtotals`, `computeTotal`, `clampDiscount`, `validateDetalle`). |

### Listados

| Archivo | Qué hace | Funciones |
|---|---|---|
| `public/js/shared/listSection.js` | El ciclo de cualquier listado: cargando → vacío, error o datos → paginar. Los cuatro paneles lo repetían. | `createListSection`, `emptyState` |
| `public/js/shared/pagination.js` | El control de páginas estilo correo: «1–50 de 6.058», con saltos al principio y al final y el menú de filas por página. | `mountPagination` |
| `public/js/shared/skeleton.js` | La silueta gris de lo que está por cargar, en lugar de un círculo girando. | `tableSkeleton`, `cardsSkeleton` |
| `public/js/shared/ultimaGana.js` | Que una respuesta vieja no pise a una nueva. | `crearTurnero` |

### Ventanas y controles

| Archivo | Qué hace | Funciones |
|---|---|---|
| `public/js/shared/subModal.js` | La ventana que se abre **encima** de otra (por ejemplo, el alta de cliente dentro del formulario). | `crearSubModal` |
| `public/js/shared/calendarPicker.js` | El calendario del próximo seguimiento. Marca los días que ya tienen algo agendado, pero no los bloquea. | `openCalendarPicker` |
| `public/js/shared/graficos.js` | Los gráficos: evolución mensual, anillo, aguja y cifras que suben desde cero. | `serieTemporal`, `anillo`, `aguja`, `contarHasta` |
| `public/js/shared/icons.js` | Los íconos de la barra lateral y de los tipos de archivo, dibujados en línea. | `navIcon`, `fileIcon`, `stateIcon` |

### Datos y archivos

| Archivo | Qué hace | Funciones |
|---|---|---|
| `public/js/shared/fechaLocal.js` | Las fechas del día **en hora de Bolivia**, no en UTC. | `hoyYmd`, `ymd`, `parseYmd`, `ultimos` |
| `public/js/shared/escapeHtml.js` | Neutraliza lo que escribió una persona antes de mostrarlo en pantalla. | `escapeHtml` |
| `public/js/shared/csvExport.js` | Exportar una tabla a CSV que Excel abra bien: con tildes, con filas bien cortadas y sin que una celda pueda ejecutarse como fórmula. | `buildCsv`, `downloadCsv`, `csvCell` |
| `public/js/shared/guardarArchivo.js` | Guardar un PDF o un Excel: deja elegir la carpeta cuando el navegador lo permite y dice dónde quedó. | `saveBlobAs`, `guardarArchivo`, `mensajeDeGuardado` |
| `public/js/shared/quotationFieldErrors.js` | Lleva cada error que devuelve el servidor al campo del formulario que corresponde. | `mapFieldErrors` |
| `public/js/shared/asyncCache.js` | Recuerda un resultado que tardó en llegar, pero **no** recuerda un fallo: el próximo intento vuelve a probar. | `createRetryableCache` |

## Por qué es así

- **Las copias de reglas son deliberadas y vigiladas.** Sin paso de compilación,
  el navegador no puede importar `src/`. La alternativa —que cada pantalla
  «sepa» los roles o los estados por su cuenta— ya había producido un «5» sin
  nombre en la bitácora (faltaba Proyectos) y un selector que ofrecía estados
  que el servidor rechazaba.
- **La fecha de hoy nunca sale de UTC.** Bolivia está cuatro horas detrás: entre
  las 20:00 y la medianoche, la fecha UTC ya es la de mañana. Así se perdió un
  día entero del aviso de seguimientos, sin que nadie lo notara.
- **La última respuesta en llegar no siempre es la que se pidió último.** Si el
  Jefe pide «este año» (lento) y enseguida «hoy» (rápido), sin el turnero la
  respuesta del año llega después y pisa la del día: números reales, pero de
  otro período. Es un error que se ve bien, el peor tipo.
- **Los gráficos están dibujados a mano.** La política de seguridad del sitio no
  deja cargar librerías de afuera, y copiar una entera para tres formas no
  compensaba. Leen sus colores de las hojas de estilo, así que siguen el tema
  claro u oscuro.
- **El escapado es uno solo.** Había dos copias idénticas; duplicar código de
  seguridad significa que una mejora futura llega a una y no a la otra.

## Dónde está probado

Pruebas rolesUnaSolaLista, quotationTransitionsFront y quotationTotalsFront
(que las copias coincidan con el servidor), fechaLocal, ultimaGana, asyncCache,
escapeHtml, badgeHtmlEscape, csvExport, guardarArchivo, pagination,
paginacionCompartida, skeleton, subModal, graficosMetricas y graficosPorRol.
