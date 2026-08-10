# Las pruebas: qué protege cada una

**1330 pruebas en 64 suites.** Este documento no las lista: explica los **tipos**
que hay, porque este proyecto usa dos que no son habituales y que confunden si
uno se los cruza sin contexto.

```
npm test                  # todo (necesita --runInBand, ver §4)
npm run test:unit         # sólo unitarias
npm run test:integration  # sólo integración (levanta la base de pruebas)
npm run db:init:test      # reconstruye la base de pruebas
```

---

## 1. Pruebas normales

La mayoría. Entrada, salida, casos borde. `tests/unit/calcularTotales.test.js`,
`tests/unit/numberToWords.test.js`, los validadores.

Nada especial que explicar.

---

## 2. Pruebas de integración

`tests/integration/` — levantan la aplicación con **supertest** contra la base
de datos de pruebas real (`rc_tractoparts_test`), no contra una simulada.

Prueban las reglas que sólo existen cuando hay una base de por medio: la
generación atómica del correlativo bajo bloqueo de fila, los permisos por rol
en cada transición, la paginación del servidor.

**Antes de correrlas hay que reconstruir la base:** `npm run db:init:test`. El
script `pretest` lo hace solo al usar `npm test`.

---

## 3. Trinquetes

**Un trinquete es un número que puede bajar, nunca subir.**

Existen para migraciones grandes que no se pueden terminar de una sentada. En
vez de exigir cero desde el principio —lo que obligaría a cambiar doscientos
lugares a la vez, con el riesgo que eso trae—, se fija el número actual como
tope y se aprieta a medida que baja.

Viven en `tests/unit/estilosInline.test.js`:

| Trinquete | Al empezar | Hoy |
|---|---|---|
| Estilos inline en `public/js` | 274 | 23 |
| Emoji en la interfaz | 129 | 0 |
| Colores hexadecimales a mano | 81 | 0 |

Cada uno son **dos** pruebas, y el par importa:

1. `no hay más de N` — impide que la deuda crezca.
2. **`si bajaron, hay que bajar el tope`** — obliga a apretar el trinquete.

La segunda parece burocracia y no lo es: **un trinquete que no se aprieta deja
de trinquetear.** Sin ella el tope queda en 274 para siempre y alguien puede
volver a agregar doscientos sin que nadie se entere.

Y una vez atrapó algo mejor. El trinquete de colores reportaba **0** cuando en
realidad había 29: al escribir el archivo, el `\b` de la expresión regular se
había convertido en un carácter de retroceso real (`0x08`), invisible al leer
el código, que exigía un retroceso después de cada color. La primera prueba
**pasaba** —cero es menor que veintinueve—. La delató la segunda.

> **Un test que da cero y pasa es peor que uno que falla.**

### Si tocás un trinquete

Cuando baje, la prueba falla con el número exacto en el mensaje. Cambiá `TOPE`
por ese número. No hace falta nada más.

---

## 4. Guardias

Un guardia no prueba una función: **vigila una propiedad de todo el código.**
Recorre los archivos y falla si encuentra un patrón prohibido.

Existen porque cada uno salió de un bug que no daba ningún error.

| Guardia | Qué vigila | El bug que lo originó |
|---|---|---|
| `estilosInline.test.js` | Ningún elemento con dos `class=` | El navegador se queda con el primero y descarta el resto **en silencio**: la clase nueva no se aplica y no hay error en consola. Pasó tres veces. |
| `tokensDefinidos.test.js` | Todo `var(--x)` existe en el CSS | `--bg-secondary` no estaba definido en ningún lado. Con valor de respaldo pintaba siempre igual, ignorando el tema; sin respaldo, `var()` de una variable inexistente es inválido y la tarjeta de notificación **se quedaba sin fondo**. |
| `frontendImports.test.js` | Todo símbolo usado está importado, y todo `public/js` compila | Una migración dejó dos paneles con `SyntaxError` por un backtick mal cerrado dentro de un template anidado. |
| `proformaButtonsWired.test.js` | Todo botón que la plantilla dibuja tiene su manejador | El botón de archivar se dibujaba para el ejecutivo delegado y **nadie lo había enganchado**. No hacía nada al apretarlo. |
| `copyInterfaz.test.js` | Ningún aviso, título ni botón empieza con emoji; «exitosamente» no aparece | El mismo hecho se anunciaba de dos formas según la pantalla. |
| `estadosVacios.test.js` | El estado vacío tiene un solo dueño | Estaba dibujado a mano en dos estrategias, y las copias ya se habían quedado sin `escapeHtml`. |
| `pdfFormatSinICU.test.js` | Ningún servicio de PDF usa `Intl` ni `toLocaleString` | `node:20-alpine` puede venir sin ICU completo: las fechas salían en inglés y —peor— el dinero de las proformas enviadas a clientes salía `1,234.50` en vez de `1.234,50`. |
| `pdfIdentidad.test.js` | Los tres PDF comparten paleta, filete naranja y franja de marcas | Cada generador se escribió por separado y resolvía lo mismo distinto. El cliente los recibe juntos. |
| `swaggerRespuestas.test.js` | Las respuestas de error se describen una sola vez | «Error interno del servidor» estaba escrito con punto final 22 veces y sin punto otras 4. La documentación publicada describía el mismo error de tres formas. |
| `cssBundle.test.js` | Las hojas se enlazan en el orden correcto en ambas páginas | El orden de carga define qué regla gana. |

### Cómo se lee un guardia que falla

El mensaje dice **qué archivo, qué línea y por qué importa**. No hace falta ir
a leer el test. Si el mensaje no alcanza para arreglarlo, el mensaje está mal
escrito y conviene mejorarlo.

---

## 5. `--runInBand` no es opcional

`npm test` lo pasa siempre. **No lo saques.**

`tests/integration/correlativo.concurrencia.test.js` hace un
`DELETE FROM cotizaciones` sin filtro para probar la generación del correlativo
bajo carga. Si Jest corre suites en paralelo, ese borrado se lleva puestas las
filas de otra suite y los fallos aparecen en un archivo que no tiene nada que
ver.

Por eso también: **usá `npm test`, no `npx jest`.**

---

## 6. Escribir una prueba nueva

El orden que sigue el proyecto es **rojo → verde**: primero la prueba que
falla, después el arreglo. No es dogma; es que una prueba que nunca se vio
fallar no demostró todavía que prueba algo.

Dos costumbres que valen la pena:

**Probá la intención, no el mecanismo.** Los tests de `setFormaPago` fijaban
`style.display === 'none'`. Al mover ese `display` a una clase, los tests
fallaban aunque el comportamiento fuera correcto — y peor, si hubieran estado
mal escritos habrían pasado con el campo roto. Ahora preguntan *si está oculto*,
no *cómo*.

**El mensaje de error es la mitad del test.** Un guardia que dice
`expected [] to equal ['foo.js']` obliga a abrir el test para entender qué pasa.
Uno que explica el bug que previene se arregla sin salir de la terminal.
