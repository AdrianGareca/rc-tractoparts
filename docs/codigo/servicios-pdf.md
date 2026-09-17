# Los documentos en PDF — `src/services/`

[Volver al índice](README.md)

## En pocas palabras

Acá se **dibujan los tres papeles** que produce el sistema:

| Papel | Qué es | Quién lo arma |
|---|---|---|
| **La proforma** | La cotización que se le manda al cliente, con sus ítems, totales, datos bancarios y la hoja de condiciones. | `src/services/pdfService.js` |
| **El expediente de licitación** | La ficha de una licitación: sus datos, las cotizaciones vinculadas, los gastos y los documentos adjuntos. | `src/services/licitacionPdfService.js` |
| **El reporte** | El reporte general de la empresa o el individual de un ejecutivo. | `src/services/reportePdfService.js` |

Dibujar un PDF no es como hacer una página web: **no hay líneas que se acomoden
solas**. Cada texto se coloca en una coordenada exacta de la hoja, y si algo
crece de más, se monta encima de lo que sigue. Por eso el código está partido en
piezas chicas que se pasan una medida entre sí.

## Cómo funciona

### La regla que sostiene todo: la `y`

La hoja A4 se mide en puntos, desde arriba hacia abajo. Cada pieza de dibujo
recibe **la altura donde empieza** (la `y`) y devuelve **la altura donde
terminó**. La siguiente arranca ahí. Así, agregar o mover una sección no obliga
a recalcular todo lo demás a mano.

```
  y = drawHeader(doc, ...)        →  devuelve la y de abajo del encabezado
  y = drawSubtitle(doc, y, ...)   →  sigue desde ahí
  y = drawItemsTable(doc, y, ...) →  y así hasta el pie
```

Las piezas que pueden crecer (una tabla larga, una observación extensa) se
encargan solas de **saltar de página** y de repetir el encabezado en la hoja
nueva.

### La proforma — `src/services/pdfService.js` y `src/services/pdf/`

`pdfService.js` es el **director de orquesta**: no dibuja nada por su cuenta,
llama a cada pieza en orden y guarda el archivo.

| Función | Qué hace |
|---|---|
| `generateQuotationPdf(quotation)` | Arma la proforma completa, la escribe en la carpeta de subidas y devuelve la ruta que se guarda en la cotización. |
| `purgeQuotationPdf(relativePath)` | Borra un PDF viejo del disco cuando se regenera. Si el archivo ya no está, lo da por bueno. |

Las piezas viven en `src/services/pdf/`:

**Datos y formato**

| Archivo | Funciones | Qué hace |
|---|---|---|
| `src/services/pdf/constants.js` | `buildItemLayout(showCodigo)` | La paleta de colores, las medidas de la hoja y el ancho de las nueve columnas de la tabla. Si la cotización no lleva código de ítem, esa columna se achica a cero y la descripción se queda con su espacio, en vez de dejar un hueco. |
| `src/services/pdf/format.js` | `fmtNum`, `fmtPrice`, `formatDate`, `formatDateTime`, `formatMes`, `hLine`, `sanitizeUnsupportedGlyphs` | Números con separador de miles, precios con dos decimales, fechas en formato boliviano, líneas horizontales, y el reemplazo de los símbolos que la fuente no sabe dibujar. |
| `src/services/pdf/numberToWords.js` | `numberToWordsES`, `_integerToWords`, `_buildWords`, `_lt1000` | El importe en letras del renglón **SON**. Redondea con la misma función que la caja del total, para que las letras digan exactamente el número impreso. |
| `src/services/pdf/bankData.js` | `resolveBankData`, `normalizeEntidad` | La cuenta bancaria que corresponde a la entidad emisora de esa cotización. |
| `src/services/pdf/terminos.js` | `textoClausula` | El texto legal de las 24 condiciones generales, con el marcador `{EMISOR}` que se reemplaza por la razón social que emite. |

**Las piezas que dibujan** (`src/services/pdf/drawers/`)

| Archivo | Funciones | Qué dibuja |
|---|---|---|
| `watermark.js` | `drawLogoWatermark`, `renderWatermark` | La marca de agua del logo, muy tenue, una por página y antes que todo lo demás para que el contenido quede encima; y el sello del estado, que solo se estampa cuando la cotización está aprobada o aceptada. |
| `header.js` | `drawHeader` | El encabezado: logo a la izquierda y la caja con los datos de la cotización a la derecha. |
| `brandStrip.js` | `drawBrandStrip` | La franja con los logos de las marcas. |
| `subtitle.js` | `drawSubtitle` | El título centrado «PROFORMA REPUESTOS». |
| `infoGrid.js` | `drawThreeColumnGrid`, `_drawColumn`, `_calcRowHeights` | El bloque de tres columnas: Cliente, Solicitante y Equipo. Mide las tres antes de dibujar para que queden parejas. |
| `itemsTable.js` | `drawItemsTable`, `drawTableHeaderRow`, `_drawRowCells`, `_calcRowHeight` | La tabla de ítems de nueve columnas. Calcula el alto de cada fila según el texto, corta de página cuando hace falta y repite el encabezado. |
| `totals.js` | `drawTotalsAndConditions`, `calcularImportes`, `dibujarLineaSon`, `dibujarCondicionesYBanco`, `dibujarCajaDeTotales` | El cierre: el importe en letras, las condiciones comerciales, los datos bancarios y la caja del total. |
| `observations.js` | `drawObservations` | El bloque de observaciones. |
| `footer.js` | `drawFooter`, `numerarPaginas` | El pie con los datos de contacto y la numeración «página X de Y», que recién se puede escribir cuando se sabe cuántas páginas salieron. |
| `terminos.js` | `drawTerminosPage`, `bandaIdentificacion`, `tituloTerminos`, `dibujarClausulas`, `medirClausulas`, `fecha`, `GEOMETRIA` | La hoja final de condiciones generales, a dos columnas. |

### El expediente de licitación — `src/services/licitacionPdfService.js`

| Función | Qué hace |
|---|---|
| `renderExpediente(doc, lic)` | Dibuja el expediente entero, sección por sección. |
| `cabecera(doc, lic)` | El encabezado membretado, con la misma estructura que la proforma. |
| `datosDeLaLicitacion(doc, y, lic)` | Los datos de la licitación. |
| `resumenEconomico(doc, y, lic, moneda)` | Presupuesto, cotizado, gastos y resultado. |
| `table(doc, y, columns, rows, emptyText)` | La tabla de las secciones. Cada columna se declara con su título, ancho y alineación, y puede traer una fórmula `r(fila)` para calcular el texto (un monto, una extensión de archivo) o `color(fila)` para pintarlo. |
| `sectionTitle`, `kvRow`, `ensureSpace`, `marco` | El título de sección, una fila de «etiqueta: valor», el control de espacio antes de dibujar, y el recuadro que envuelve una sección aunque cruce de hoja. |
| `fmtMoney`, `fmtFileSize` | Montos con su moneda y tamaños de archivo legibles. |
| `createDoc()` | Crea el documento A4 con sus márgenes. |

### El reporte — `src/services/reportePdfService.js`

| Función | Qué hace |
|---|---|
| `generateReportePdf(data)` | Arma el reporte entero y lo devuelve **en memoria**, no en disco: quien lo pidió decide qué hacer con él. Hay dos modos: empresa e individual. |
| `drawHeader`, `drawFooter`, `_pieEnTodasLasPaginas`, `sectionTitle`, `_drawTituloEnmarcado` | El encabezado, el pie en todas las páginas y los títulos. |
| `simpleTable`, `drawHeaderRow`, `_calcTableRowHeight` | La tabla de todas las secciones, con alto variable, sombreado alterno y salto de página. |
| `statBox` | Una caja de cifra grande: rótulo arriba, número abajo. |
| `_drawResumenGeneral`, `_drawTopClientes`, `_drawClientesPorOrigen` | Las secciones del modo empresa. |
| `drawMisMetricas` y sus siete secciones (`_drawStatBoxes`, `_drawPorEstadoTable`, `_drawComparacionPeriodo`, `_drawPendientesTable`, `_drawConfirmadasTable`, `_drawTopItemsTable`, `_drawPorMesTable`) | El bloque «Mi Rendimiento» del modo individual, en el mismo orden que la pantalla del ejecutivo. |

### Por qué algunas funciones de una línea no llevan comentario

En las tablas, cada columna puede traer una fórmula de una línea —`r` o
`render`— que calcula el texto de esa celda, y a veces un `color`. Son decenas y
todas hacen lo mismo. Están explicadas **una vez** en la función que las recibe
(`table` y `simpleTable`), que es donde alguien va a buscar qué significan;
repetir el comentario en cada columna taparía la tabla que se quiere leer de un
vistazo.

## Por qué es así

- **El PDF se arma con piezas y no de un tirón.** El archivo de la proforma
  tenía todo el dibujo adentro; cada cambio de una sección obligaba a leer el
  resto. Hoy cada pieza se prueba sola.
- **Nadie calcula alturas por su cuenta.** Toda pieza pide espacio antes de
  dibujar y devuelve dónde terminó. El error clásico de este tipo de código es
  un bloque que crece y se monta sobre el siguiente, y una sola vez pasó: el
  importe en letras terminó impreso encima de las condiciones.
- **La `y` que devuelve la última sección se guarda aunque nadie la use.** Está
  marcada para que el revisor de código no la borre: el día que se agregue una
  sección más abajo, tiene que arrancar de ahí.
- **El texto legal vive aparte del dibujo** porque lo redactó la abogada de la
  empresa. Una prueba lo compara palabra por palabra con el original aprobado:
  si alguien cambia una cláusula sin querer, la prueba se pone en rojo.
- **El nombre de la empresa no está escrito en las cláusulas.** Se usa el
  marcador `{EMISOR}`, porque el sistema emite con **dos** razones sociales y
  pegar un nombre fijo obligaría a la persona jurídica equivocada.
- **Los símbolos que la fuente no tiene se reemplazan por su código** (₩ sale
  como WON). Antes se dibujaban como otro carácter, válido pero distinto, sin
  ningún aviso: un dato equivocado que nadie notaba.
- **Las letras del importe se redondean con la misma función que el total.**
  Con la cuenta hecha aparte, una proforma llegó a decir «CUARENTA Y NUEVE CON
  99/100» sobre un total impreso de 50,00.

## Dónde está probado

Las pruebas de PDF no miran una imagen: **leen las coordenadas** con las que se
dibujó cada cosa y comprueban que nada se superponga ni se salga de la hoja.

Pruebas pdfGenerate y pdfLayout (la proforma completa), pdfGeometriaEncabezado,
pdfGeometriaTerminos, pdfGeometriaExpediente y pdfGeometriaReporte (que nada se
monte), pdfBloqueDeCierre (totales, condiciones y banco), pdfTerminos (el texto
legal palabra por palabra), pdfBankData (la cuenta de cada entidad),
pdfIdentidad, pdfFormat y pdfFormatSinICU (formatos, incluso sin la biblioteca
de idiomas), numberToWords e importeEnLetras (el importe en letras),
laProformaCuadra (que los totales cuadren), pdfRegeneration, reportePdfIndividual
y reportePdfPorEjecutivo.
