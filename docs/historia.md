# Historia del proyecto

Cómo llegó RC Tractoparts a ser lo que es, desde el primer commit del 20 de
mayo de 2026. No reemplaza a `git log` —que tiene cada cambio— sino que cuenta
**las etapas, las decisiones y lo que se aprendió en cada una**, que es lo que
el historial de commits no dice.

Sirve para dos cosas: que quien llegue al proyecto entienda por qué el código
tiene la forma que tiene, y que nadie deshaga sin querer algo que costó
aprender.

---

## 1. De dónde salió

La empresa cotizaba en planillas de Excel, las exportaba a PDF, anotaba a mano
un número correlativo y registraba todo en una hoja compartida de Google
Sheets. De ahí venían los problemas que el sistema existe para resolver:

- **números correlativos duplicados o salteados** cuando dos ejecutivos
  cotizaban a la vez;
- **aprobaciones de palabra** o por mensajería, sin constancia de quién aprobó
  qué;
- **ningún estado** que dijera en qué punto estaba cada cotización;
- **cualquiera podía modificar cualquier fila** de la planilla compartida;
- PDF repartidos en carpetas y correos, difíciles de encontrar.

El punto de partida formal es el *Documento de Especificación de
Requerimientos* (versión 1.0 preliminar, junio de 2026): planteamiento del
problema, marco teórico, requerimientos, historias de usuario, arquitectura,
modelo de datos, plan de pruebas y gestión del proyecto. Planificaba tres
sprints de seis semanas con metodología XP-SCRUM sobre Node.js, Express y
MySQL.

---

## 2. Línea de tiempo

| Etapa | Fechas | Commits | En una frase |
|---|---|---|---|
| Sprint 1 — la base | 20 may – 25 may | 13 | Login, cotizaciones con correlativo, PDF y Swagger |
| Sprint 2 — el flujo completo | 29 may – 29 jun | 30 | Filtros, bitácora, validación, frontend por roles, máquina de estados |
| Puesta en producción y crecimiento | jul | 92 | Docker en DigitalOcean, licitaciones, clientes, reportes, primeras refactorizaciones |
| Endurecimiento | ago | 107 | Tres rondas de estrés, auditoría de seguridad, respaldos, rediseño, red de pruebas |
| Madurez y operación | 1 sep – 15 sep | 30 | Dependencias al día, Cloudflare, condiciones legales en el PDF, marcas desde Excel |

272 commits hasta el 15 de septiembre de 2026.

---

## 3. Sprint 1 — la base (mayo)

El primer commit (`d6c2679`, 20 de mayo) ya traía el esqueleto que se mantiene
hasta hoy: Express con capas separadas (rutas, middlewares, controladores,
modelos), MySQL con `sql/init.sql` como única fuente del esquema, autenticación
con JWT y contraseñas con bcrypt.

En esa semana se sumaron la generación automática del PDF con PDFKit, las
consultas con paginación y filtros, y la documentación interactiva de la API
con Swagger.

**La decisión que más duró:** el correlativo se genera dentro de una
transacción con `SELECT … FOR UPDATE` sobre una fila por año. Es lo que resuelve
el problema número uno de las planillas —dos personas sacando el mismo número—
y está probado con concurrencia real en
`tests/integration/correlativo.concurrencia.test.js`.

---

## 4. Sprint 2 — el flujo completo (junio)

- **Bitácora de auditoría** (HU11), **validación con Zod** en cada entrada,
  **límite de peticiones** por IP y respuestas de error que nunca filtran
  detalles internos.
- **El frontend** se armó sin empaquetador, con módulos ES nativos y patrones
  de diseño explícitos: Singleton (cliente de la API), Strategy (una estrategia
  de tablero por rol), Command, Mediator, Observer y Chain of Responsibility.
- **La máquina de estados** de la cotización (Pendiente → En revisión →
  Aprobada internamente → Enviada al cliente → Confirmada, más En espera,
  Rechazada y Archivada), con una matriz de qué rol puede mover qué estado.
- **Aprobación del Jefe**, notificaciones al ejecutivo y el primer tablero de
  reportes.
- **Un solo PDF por cotización**: el archivo se regenera en cada cambio y el
  anterior se borra. Nunca hay dos versiones dando vueltas.
- **Versión de token persistente** (`token_version`): cerrar sesión o
  desactivar a alguien invalida sus sesiones aunque el servidor se reinicie.
- **Delegación de funciones**: se implementó, se quitó entera el 22 de junio
  porque no convencía, y volvió dos días después con otro diseño —dinámica y
  controlada desde la API, no sólo desde la pantalla—.

---

## 5. Producción y crecimiento (julio)

### Salida a producción

Entre el 2 y el 6 de julio se preparó el despliegue con Docker Compose en un
droplet de DigitalOcean, detrás de Nginx con HTTPS. Desde entonces el
despliegue es `git pull` + `docker compose up -d --build`, a mano.

### Lo que pidió el uso real

- Formato de correlativo **SC-2026/000692**, igual a la numeración histórica
  de la empresa, y **candados en tiempo real con Socket.IO**: cuando alguien
  abre el formulario de cotización nueva, los demás ven que el número está
  reservado (`src/realtime/socketServer.js`).
- **FECHA CONFIRM.** en el PDF: el cierre de la venta, distinto de la
  aprobación interna.
- **Delegación ampliada**: un ejecutivo de confianza opera el ciclo completo
  con la matriz del Jefe, sin acceso administrativo.
- **Dos entidades emisoras** con su cuenta bancaria cada una, resuelta en
  `src/services/pdf/bankData.js`.
- **Clientes** con alta, edición y desactivación; **origen del cliente** para
  los reportes; **reportes en PDF**.
- **Módulo de licitaciones y rol Proyectos** (23 de julio): una licitación
  agrupa varias cotizaciones, con documentos adjuntos, gastos, resultado de
  ganancia o pérdida y un expediente en PDF.

### Primera limpieza de seguridad

El 23 de julio (`bfe55a1`) se sacaron del repositorio todas las credenciales:
las cuentas iniciales se siembran **bloqueadas** y se activan con un script que
toma las contraseñas del `.env`. Semanas después se comprobó que las
contraseñas viejas seguían visibles en el historial público de GitHub; se
rotaron el 28 de agosto (ver §7).

### Primeras refactorizaciones

Los archivos que habían crecido demasiado se partieron por responsabilidad:
el modelo de cotizaciones en repositorios (lectura, escritura, correlativo,
notificaciones, reportes), el formulario de cotización en diez piezas, el
servicio de PDF en un dibujante por sección (`src/services/pdf/drawers/`) y la
hoja de estilos en doce archivos.

**Lo que se aprendió:** una refactorización sin pruebas rompió la interfaz y
los PDF. Desde entonces, **ninguna refactorización se hace sin red** (ver §8).

También en julio: modo claro y oscuro, colores con nombre (tokens de diseño),
el arreglo de un *path traversal* al nombrar archivos subidos, el bloqueo por
fuerza bruta que en realidad nunca se aplicaba, y los scripts de respaldo.

---

## 6. Endurecimiento (agosto)

Fue el mes más intenso: 107 commits.

### Funciones nuevas

- **La llave del Jefe**: reabrir una venta confirmada, con motivo obligatorio y
  auditoría.
- **Paginación real** en el servidor (antes el navegador partía un arreglo que
  dejaba de funcionar pasado el tope de la API).
- **Reporte de consumo por cliente e ítem** (`src/models/quotation/clienteItemReport.js`):
  qué repuestos pide cada cliente, para decidir qué traer a stock.
- **Seguimiento comercial** (estado de venta, calendario y avisos del día),
  **autoguardado** del borrador y **pegado de ítems desde Excel**.

### Rediseño por fases

Los estilos escritos a mano dentro del JavaScript salieron a hojas de estilo,
los emoji se reemplazaron por íconos SVG y los colores sueltos por tokens. Cada
fase quedó vigilada por un **trinquete** (un número que puede bajar y nunca
subir) en `tests/unit/estilosInline.test.js`. Ver [pruebas.md](pruebas.md) y
[diseno.md](diseno.md).

### Una sola verdad para cada regla de negocio

- **Qué cuenta como venta** estaba escrito cuatro veces, distinto, en tres
  archivos. Hoy vive en `src/models/quotation/constants.js`.
- **El redondeo del dinero** se hace de una sola forma, en
  `src/utils/quotationTotals.js`, antes de guardar y no sólo al mostrar.
- **Los roles** se escriben en `src/config/roles.js` y una prueba exige que
  coincidan con la base (`tests/unit/rolesUnaSolaLista.test.js`).

### Las tres rondas de estrés

Se atacó la aplicación local con varios agentes en paralelo, cada uno contra
un área, reproduciendo cada problema contra el servidor real antes de
reportarlo.

| Ronda | Fecha | Hallazgos | El más grave | Resultado |
|---|---|---|---|---|
| 1 | 25 ago | 18 | Subir un PDF a una cotización ajena | 16 arreglados, 2 dejados así a propósito |
| 2 | 26–27 ago | 15 | Un Jefe o Administración podía crear cuentas SysAdmin | Todos arreglados, 17 commits |
| 3 | 27 ago | 23 | Administración podía ascenderse a Jefe | Todos arreglados el mismo día |

Los dos que se dejaron así fueron decisión de negocio: la fecha de seguimiento
acepta cualquier fecha, y el mensaje de cuenta bloqueada es distinto del de
contraseña incorrecta para que la persona sepa por qué no entra.

### Auditoría de seguridad

El 28 de agosto se hizo un diagnóstico en doce categorías. Lo que salió de ahí:

- **Credenciales en el historial público.** Rotadas. Reescribir el historial
  no se hizo: rompe los clones y no borra las copias que ya tomaron terceros;
  la mitigación real es cambiar las contraseñas.
- **Dependencias con avisos de seguridad**, algoritmo de JWT fijado
  explícitamente, límite de peticiones al PDF de reportes.
- **Respaldos**: se confirmó que están cifrados y que se verifican solos cada
  domingo restaurándolos en una base temporal. En el camino aparecieron cinco
  respaldos de mediados de agosto que nunca habían llegado a Google Drive; se
  subieron y se corrigió la causa. Todo en [respaldos.md](respaldos.md).
- **Dependabot** y un **plan de recuperación ante desastre**
  ([recuperacion.md](recuperacion.md)).
- Se descartaron a propósito, por el tamaño del equipo (unas cinco personas):
  segundo factor de autenticación, cifrado del disco del servidor y bóveda de
  secretos.

### La red de pruebas (fase 3)

Antes de partir las funciones más largas se puso la red:

- **jsdom** para probar pantallas de verdad, archivo por archivo.
- **Un arnés de geometría de PDF** (`tests/helpers/docFalso.js`) que anota
  dónde se dibujó cada texto y detecta superposiciones.
- La prueba de `pdfRegeneration`, que un comentario decía tener y no existía.

Con eso se partieron las funciones grandes, y el trinquete de funciones de más
de 80 líneas (`tests/unit/funcionesLargas.test.js`) bajó de 28 a 21. **La
proforma del cliente no se tocó**: es el documento que sale de la empresa y se
decidió no arriesgarlo.

---

## 7. Madurez y operación (septiembre)

- **Unidades de medida** a las siete que usa la empresa, **paleta de colores
  tomada del logo** y **gráficos** en las métricas.
- **Dependencias mayores al día**: helmet 8, bcryptjs 3 y express 5, cada una
  con su prueba de regresión (`tests/unit/cabecerasSeguridad.test.js`,
  `tests/unit/bcryptCompatibilidad.test.js`,
  `tests/unit/expressComportamiento.test.js`).
- **La configuración de Nginx dentro del repositorio**: antes existía sólo en
  el servidor, y perderlo era perderla.
- **Condiciones Generales de la Oferta** en una hoja al final de cada proforma,
  con el nombre de la entidad que emite y el texto legal congelado por una
  huella (`tests/unit/pdfTerminos.test.js`).
- **Reducción de duplicación**, que de paso encontró un bug real de zona
  horaria: entre las 20:00 y la medianoche, la fecha de «hoy» salía como la de
  mañana, y quien entraba de noche se perdía el aviso de seguimientos del día
  siguiente (`public/js/shared/fechaLocal.js`).
- **Seguridad**: la aplicación no arranca con un secreto de sesión de ejemplo
  (`src/config/verificarEntorno.js`), y toda ruta nueva nace protegida o la
  suite se pone en rojo (`tests/unit/rutasProtegidas.test.js`).
- **Cloudflare delante del servidor** (10 de septiembre). Hubo que preparar
  antes la configuración de IP real en Nginx: sin ella, toda la empresa habría
  compartido el mismo cupo de cinco intentos de login cada quince minutos.
- **Marcas desde Excel**: el pegado reconoce la marca contra el catálogo, avisa
  de las parecidas y deja decidir en pantalla qué hacer con las nuevas. Por
  regla de negocio, CAT y Caterpillar siguen siendo marcas separadas, en la
  base y en los reportes, porque cada vendedor usa la que reconocen sus
  clientes.
- **El PDF de reportes respeta el ejecutivo elegido** (15 de septiembre).

### La prueba de rendimiento (15 de septiembre)

Las tres rondas de agosto buscaron **errores**. Esta buscó **lentitud**: qué
pasa cuando la base tenga años de datos y varias personas trabajen a la vez.

**Cómo se midió.** Nada de esto tocó la base real ni el servidor de
producción. Se copió la base local a una base aparte y se la llenó con datos
sintéticos en dos escalas: una **realista** (unas 7.000 cotizaciones, cinco años
al ritmo actual) y una **extrema** (40.000 cotizaciones, 340.000 líneas de
ítems, 300.000 registros de bitácora). Contra esa copia corrió un servidor de
prueba con un monitor que registraba, segundo a segundo, el pool de conexiones
y el bloqueo del proceso. Se midió de tres formas: cada consulta por separado
con su plan de ejecución, cada pantalla con un solo usuario, y la aplicación con
decenas de usuarios simultáneos.

**Lo que se encontró, a escala extrema:**

| Qué | Medido | Por qué |
|---|---|---|
| Reporte de consumo por ítem | 79 s en la base, 104 s por HTTP | Agrupa todas las líneas de la historia en cada apertura, tres veces |
| Tres reportes de consumo a la vez | el resto de la empresa bajó de 71 a 15 peticiones por segundo | Ocupaban el pool de conexiones y todo lo demás esperaba en la cola |
| Conteo de «Todas las cotizaciones» | 404 ms | Unía tres tablas que no cambian el resultado |
| Cola de aprobación del Jefe | 11.630 filas, 3,7 MB por carga | No tenía paginación |
| Mis métricas sin rango | 5,8 s | La pestaña del ejecutivo abría con todo el historial |

Un detalle de producción que salió de acá: Nginx corta una petición a los 60
segundos, así que el reporte de consumo ya habría fallado con error 504.

**Lo que se cambió sin tocar el comportamiento.** El conteo de cotizaciones
dejó de unir tablas innecesarias; la lista de ejecutivos del reporte de consumo
dejó de recorrer todas las líneas; el conteo de ese reporte se hace sin armar
los grupos; Mis métricas corre sus seis consultas en paralelo. Antes de aceptar
cada cambio se comparó el resultado del código nuevo contra una copia del
original, en las dos escalas y con muchas combinaciones de filtros: 86
comparaciones, todas idénticas.

Una idea se probó y **se descartó por los números**: sacar el total del reporte
en la misma consulta que las filas. Parecía más eficiente y resultó más lenta
(44 s contra 37 s), porque obliga a MySQL a ordenar todos los grupos en lugar
de sólo los de la página.

**Lo que decidió Adrian**, porque ya no era optimización sino comportamiento:

1. El reporte de consumo y los reportes del ejecutivo **abren con los últimos
   12 meses**. El historial completo sigue disponible vaciando las fechas
   (`public/js/shared/fechaLocal.js`).
2. **La cola de aprobación se pagina** como los demás listados, y la del Jefe y
   la del Administrador pasan a ser un solo módulo
   (`public/js/views/dashboard/modules/colaAprobacion.js`).
3. **Los reportes pesados se cortan a los 30 segundos** con un mensaje que pide
   acotar las fechas, para que un reporte nunca vuelva a frenar a toda la
   empresa (`src/utils/topeConsultas.js`).
4. **No** se agrega por ahora la columna precalculada del código normalizado,
   que ahorraría un 35% del reporte de consumo pero exige una migración en
   producción. Queda como recomendación para cuando el volumen lo pida.

**El resultado**, medido con el código final en las dos escalas:

| Medición | Antes, extrema | Después, extrema | Después, 5 años |
|---|---|---|---|
| Consumo al abrir la pantalla (12 meses) | 104 s, con todo el historial | 16,8 s | 2,2 s |
| Consumo pidiendo todo el historial | 104 s | se corta a los 30 s con el aviso | 10,1 s |
| Resto de la empresa con 3 reportes pesados en curso | 15 peticiones por segundo | 56 | sin impacto: 331 |
| 25 usuarios a la vez, mediana y p99 | 1,5 s y 20 s | 0,8 s y 13,8 s | 0,17 s y 1,4 s |
| Cola de aprobación | 3,7 MB y 576 ms | 16 KB y 27 ms | 16 KB y 19 ms |
| «Todas las cotizaciones» | 378 ms | 38 ms | 19 ms |

Dos cosas para leer bien esa tabla. La escala extrema es un límite de
resistencia, no un pronóstico: equivale a décadas al ritmo actual, y ahí la
prueba de 25 usuarios sin pausa sigue siendo exigente. La escala de 5 años es la
que describe lo que va a sentir la empresa, y con ella la aplicación responde
en décimas de segundo aun con 25 personas trabajando a la vez.

Cada cambio dejó su prueba: `tests/unit/topeConsultas.test.js` exige que
ningún modelo de reportes consulte sin tope,
`tests/unit/whereBuilderClientes.test.js` vigila que el conteo sepa cuándo unir
clientes, y `tests/integration/colaAprobacionPaginada.test.js` recorre la cola
página por página comprobando que no se repita ni se pierda ninguna cotización.

### Explicar cada parte del código (16 de septiembre)

Con el sistema estable, el pedido fue que **cualquiera pueda entender qué hace
cada parte**: Adrian, un programador que lo retome, y quien lo presente
formalmente. La condición: no agregar líneas de código.

Se resolvió en dos capas. **Cada función del backend lleva un comentario arriba**
que dice qué hace; los comentarios no cuentan como código, así que el trinquete
de funciones largas no se movió. En los 77 archivos del núcleo faltaban 29, y se
agregaron verificando que ninguna instrucción cambiara. Y **un documento por
carpeta** en [codigo/README.md](codigo/README.md), cada uno en tres niveles: en
pocas palabras, cómo funciona archivo por archivo, y por qué es así.

Como un documento que describe funciones envejece en cuanto alguien renombra
una, `tests/unit/documentacion.test.js` ahora verifica que cada archivo,
enlace y función que nombran esos documentos siga existiendo.

Se hizo por etapas: el núcleo del backend el 16, la generación de PDF
(`src/services/`) el 17 y el navegador (`public/js/`) el 18. Quedaron 15
documentos más el índice. Todas las funciones con nombre llevan su comentario,
salvo una excepción deliberada: las respuestas de una sola línea que se pasan a
otra función (`onSuccess: () => this.refresh()` y parecidas) se explican una vez,
en la función que las recibe, y no en cada una de las decenas de lugares donde
se escriben.

### Las pruebas corren solas (18 de septiembre)

Hasta acá, las pruebas solo corrían si alguien escribía `npm test` en su
computadora: un cambio que rompía algo podía llegar a `main` y de ahí al
servidor sin que nada lo frenara. Desde el 18, `.github/workflows/pruebas.yml`
las corre en GitHub en cada push, con un MySQL de verdad levantado al lado y
con las mismas versiones que el servidor (Node 20, MySQL 8.0 y su método de
autenticación). Si algo falla, llega un correo.

Antes de subirlo se reprodujo localmente lo que iba a ver GitHub: una copia
limpia del repositorio, sin `.env`, en hora UTC y con Node 20. Pasó entera.
También se revisó lo único que Windows no puede reproducir: que ningún archivo
ni ninguna tabla se nombre con otras mayúsculas, porque Linux las distingue.

---

## 8. Cómo creció la red de pruebas

| Fecha | Pruebas | Qué la hizo crecer |
|---|---|---|
| 25 ago | 1861 | Primera ronda de estrés |
| 27 ago | 2111 | Tercera ronda de estrés |
| 31 ago | 2303 | Red de la fase 3: jsdom y geometría de PDF |
| 6 sep | 2398 | Actualización de dependencias mayores |
| 9 sep | 2561 | Reducción de duplicación y seguridad |
| 11 sep | ~2667 | Marcas desde Excel |
| 15 sep | 2750 | Prueba de rendimiento: tope de reportes, cola paginada, pantallas de consumo y de la cola |
| 16 sep | 2755 | Guardia de la documentación del código: archivos, enlaces y funciones citadas |
| 18 sep | 2761 | Las pruebas corren solas en GitHub en cada push, con las versiones del servidor |

El proyecto usa dos tipos de prueba poco habituales, explicados en
[pruebas.md](pruebas.md): los **trinquetes** (números que sólo pueden bajar) y
los **guardias** (pruebas que miran desde afuera lo que falla sin dar error).

---

## 9. Los errores que se repitieron

Cuatro familias de bug aparecieron más de una vez. Cada una tiene hoy una
prueba que la vigila, porque la atención sola no alcanzó:

1. **Un `.default()` de Zod en un formulario de edición** pisa en silencio los
   campos que no se mandaron. Así se cambió la moneda y la entidad emisora de
   cotizaciones que nadie quiso tocar (y la proforma salió con la cuenta
   bancaria equivocada). Pasó en cotizaciones y otra vez en licitaciones.
   Guardia: `tests/unit/editarNoPisaCampos.test.js`.
2. **El dinero redondeado de varias formas**: `toFixed` redondea mal ciertos
   valores, y la proforma dejaba de cuadrar. Guardia:
   `tests/unit/laProformaCuadra.test.js`.
3. **Los nombres de rol desincronizados** entre el código y la base.
4. **Texto largo en el PDF que se sale de su caja**: en PDFKit la opción
   `lineBreak: false` no impide que el texto se parta en varias líneas. Mordió
   en la tabla de ítems, en los datos del cliente, en la fila del ejecutivo y en
   los reportes. La regla: medir con `heightOfString` antes de dibujar.

Y un quinto, ambiental: **Bolivia está en UTC−4**. Tres veces una fecha
calculada en UTC cayó en el día equivocado (el bloqueo por intentos fallidos,
el filtro de «hoy» y el aviso de seguimientos).

---

## 10. Decisiones que no hay que deshacer

| Decisión | Por qué |
|---|---|
| El correlativo se genera con bloqueo de fila, no con un contador en memoria | Es la razón de ser del sistema: nunca dos cotizaciones con el mismo número |
| Un solo PDF por cotización, regenerado en cada cambio | El PDF siempre dice lo mismo que la base |
| Sin empaquetador en el frontend | Menos piezas que mantener; a cambio, `tests/unit/frontendImports.test.js` vigila los imports |
| Las matrices de permisos existen dos veces (servidor y navegador) | El servidor decide; el navegador no ofrece lo que va a ser rechazado. Ver [arquitectura.md](arquitectura.md) |
| No se fusionan marcas en la base | Los PDF se regeneran leyendo el catálogo en vivo: tocar datos viejos cambia documentos ya enviados |
| No se reescribió el historial de git | La mitigación real de una credencial expuesta es rotarla |
| La proforma del cliente no se refactoriza por deporte | Es lo único que sale de la empresa; ya se rompió una vez |
| El tamaño de un archivo no importa, el de una función sí | Un archivo de rutas largo es casi todo documentación de Swagger |

---

## 11. Lo que sigue abierto

- **El chequeo de salud es superficial**: `/health` responde aunque la base
  esté caída.
- **El encabezado de la entidad emisora del PDF** avanza con saltos fijos. Hoy
  no es alcanzable (las razones sociales válidas son cortas), pero hay una
  prueba en espera que se activa si alguien agrega una larga.
