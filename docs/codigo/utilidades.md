# Las herramientas compartidas — `src/utils/`

[Volver al índice](README.md)

## En pocas palabras

Son **herramientas chicas que usan muchas partes del sistema**: redondear
dinero, leer un número de la URL, registrar algo en la bitácora, nombrar un
archivo descargado. Casi todas nacieron igual: la misma tarea estaba escrita a
mano en varios lugares, **cada copia había quedado un poco distinta**, y alguna
de esas diferencias era un error real. Juntarlas en un solo lugar hizo que
exista una sola versión correcta.

## Cómo funciona

### `src/utils/quotationTotals.js` — el dinero

| Función | Qué hace |
|---|---|
| `redondearCentavos(n)` | Redondea a dos decimales con el medio **hacia arriba**, como una factura (2,345 → 2,35). |
| `calcularSubtotal(cantidad, precioUnitario)` | Cantidad por precio, redondeado. |
| `calcularMontoTotal(detalles)` | Suma los subtotales **ya redondeados** de cada ítem. |

Se redondea **cada línea y después se suma**, igual que la proforma impresa. Al
revés, el total de los reportes y el del PDF podían diferir en un centavo.

### `src/utils/licitacionTotals.js` — los gastos de una licitación

| Función | Qué hace |
|---|---|
| `sumGastosEnMoneda(gastos, moneda)` | Suma solo los gastos en la moneda de la licitación e informa si quedó alguno afuera. Sumar bolivianos con dólares daba una ganancia inventada. |

### `src/utils/auditLog.js` — la bitácora

| Función | Qué hace |
|---|---|
| `logEvent({...})` | Registra un evento (quién, qué acción, sobre qué, desde qué IP, con qué resultado) en `bitacora_auditoria`. **Nunca lanza un error:** si la bitácora falla, lo anota en el log y la operación principal sigue. |

También exporta `AuditActions`, la lista cerrada de nombres de acción, para que
nadie escriba «CREAR_COTIZACION» de dos formas.

### `src/utils/parseId.js` — el id de la URL

| Función | Qué hace |
|---|---|
| `parseId(valor, entidad)` | Convierte `req.params.id` en un número entero positivo, o devuelve el error 422 listo para responder. |

La comprobación estaba escrita 28 veces en nueve controladores, con el mensaje
de error redactado de cuatro formas y en dos idiomas.

### `src/utils/paginacion.js` — el bloque de paginación

| Función | Qué hace |
|---|---|
| `construirPaginacion({ page, limit, totalRecords })` | Arma `{ page, limit, totalRecords, totalPages, hasNext, hasPrev }`. |

Cuatro controladores lo armaban a mano y los cuatro habían quedado distintos:
uno calculaba «hay página siguiente» con otra fórmula y otro ni lo informaba.

### `src/utils/topeConsultas.js` — el tope de 30 segundos

| Función | Qué hace |
|---|---|
| `conTope(sql, ms)` | Agrega a la consulta la indicación para que MySQL la corte si pasa del tope. |
| `consultarReporte(sql, params)` | Ejecuta una consulta de reporte con el tope puesto. Los modelos de reportes la usan en lugar de consultar directo. |
| `esTopeExcedido(err)` | ¿El error es el corte por tiempo? Así el controlador responde «acotá el rango» y no «error interno». |

Nació de la prueba de rendimiento del 15 de septiembre: con 40.000
cotizaciones, tres reportes sin rango de fechas bajaban al resto de la empresa
de 71 a 15 peticiones por segundo.

### `src/utils/uploadFilename.js` — nombres seguros al subir

| Función | Qué hace |
|---|---|
| `buildUploadFilename({...})` | El nombre con que se guarda un archivo subido; garantiza que no tenga separadores de carpeta. |
| `sanitizeIdSegment(raw)` | Deja solo letras y números del id. |
| `sanitizeExtension(originalname)` | Una extensión limpia. |
| `arreglarNombreOriginal(originalname)` | Corrige los nombres con tildes o ñ que el receptor de archivos entrega mal codificados. |

### `src/utils/nombreDeDescarga.js` — nombres al descargar

| Función | Qué hace |
|---|---|
| `cabeceraDeDescarga(nombre, disposicion)` | Arma la cabecera que le dice al navegador cómo se llama el archivo, **con sus tildes**. |
| `nombreAscii(nombre)` | La versión sin acentos para navegadores viejos, sin comillas ni saltos de línea. |

Antes, «Especificación técnica.pdf» se descargaba como «Especificaci_n
t_cnica.pdf».

## Por qué es así

- **Una sola versión de cada cálculo.** Los errores de dinero de este proyecto
  vinieron de copias que se desincronizaron; con una función compartida, la
  corrección se hace una vez.
- **La bitácora no puede tumbar una venta.** Registrar es importante, pero si
  su tabla tiene un problema, la cotización tiene que guardarse igual.
- **Los nombres de archivo que elige el usuario nunca se usan tal cual,** ni
  para escribir en disco (podían salir de su carpeta) ni en una cabecera HTTP
  (un salto de línea permitía inyectar cabeceras).
- **Son funciones puras siempre que se pudo:** reciben datos y devuelven datos,
  sin tocar la base ni la respuesta. Por eso se prueban solas y rápido.

## Dónde está probado

Pruebas calcularTotales, redondeoDeCentavos, importeEnLetras, laProformaCuadra,
licitacionTotals, accionesDeBitacora, parseIdCompartido, paginacionCompartida,
topeConsultas, topeConsultasMysql, uploadFilename y nombreDeDescarga.
