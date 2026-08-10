# Sistema de diseño

Cómo se ve la aplicación y por qué. Este documento existe para que una pantalla
nueva se parezca a las que ya están, sin tener que adivinar.

El README explica *qué hace* el sistema. Esto explica *cómo se ve* y, sobre
todo, **qué decisiones ya están tomadas** para no volver a discutirlas.

---

## 1. La identidad viene del papel, no de la pantalla

RC Tractoparts ya tenía identidad visual antes de tener aplicación: **azul
marino y naranja**, en la cabecera, el encabezado de la tabla de ítems y el
cuadro de totales de cada proforma impresa que recibe un cliente.

Los valores viven en `src/services/pdf/constants.js`:

| Rol | Valor | Token de pantalla |
|---|---|---|
| Marino | `#1B2B4B` | `--clr-navy` |
| Naranja de proforma | `#C85A0F` | `--clr-proforma-orange` |

**La pantalla se derivó del papel, no al revés.** Las superficies del tema
oscuro (`--bg-deep`, `--bg-surface`, `--bg-raised`, `--bg-hover`) salen de la
familia del marino, y el tema claro se corrió medio grado en la misma
dirección.

### Por qué se cambió

La paleta original era la de Tailwind **sin modificar** — los propios
comentarios de `tokens.css` lo documentaban: `slate-100`, `slate-300`,
`slate-900`, y los acentos en el tono `500`. Es el juego de colores por
defecto del marco de CSS más usado que existe, así que una aplicación que lo
deja tal cual **comparte literalmente sus colores con todas las demás que
hicieron lo mismo**.

No se veía mal. Se veía genérica. Y mientras tanto la identidad real de la
empresa estaba sólo en el PDF.

---

## 2. Los colores de estado NO se tocan

`Pendiente` es ámbar, `Aprobada` verde, `Rechazada` roja. Eso es un idioma que
los ejecutivos ya tienen incorporado después de meses de uso: cambiarlo es
cambiarles el vocabulario, no el aspecto.

Cualquier ajuste de paleta debe dejar la máquina de estados como está.

> **Decisión pendiente, para quien la tome:** los estados usan **seis matices**
> (ámbar, naranja, azul, violeta, verde, rojo). Ese arcoíris es lo que más
> queda de estética de tablero de demostración, y el violeta para `Confirmada`
> es el más arbitrario. Reducirlo a tres familias se vería bastante más como
> software de gestión, pero cambia significados aprendidos. **No es una
> decisión técnica; es del área comercial.**

---

## 3. Reglas que ya no se discuten

Las cuatro tienen un test que las hace cumplir (ver `docs/pruebas.md`). No son
preferencias: cada una salió de un problema medido.

### 3.1 Cero emoji en la interfaz

Había **129**. Es el tic visual más reconocible del software generado: ningún
sistema de gestión que use una empresa le pone un emoji al título de una
sección o a un botón.

- **Encabezados** → los reemplaza el filete naranja de `.card-header h3::before`,
  que es *la misma línea* que el PDF dibuja antes de cada sección.
- **Botones** → sin reemplazo. Un botón bien rotulado no necesita ninguno.
- **Avisos** → sin reemplazo. El aviso ya viene coloreado según el tipo.
- **Estados vacíos y tipos de archivo** → SVG de trazo (`public/js/shared/icons.js`).

**Dónde sí hay íconos, y por qué:** la barra lateral, los estados vacíos y la
lista de adjuntos. Son los tres lugares donde la vista *recorre* buscando algo
y la forma llega antes que la palabra. Un ícono que se usa así se gana el
espacio; uno que acompaña a un botón que ya dice lo que hace, no.

Todos los SVG son monocromos y usan `currentColor`, así que heredan el color
de su contexto y se apagan con él. Un emoji es multicolor por definición: no
hereda nada y cada sistema operativo lo dibuja distinto, de modo que la
pantalla que uno diseña no es la que ve el usuario.

### 3.2 Mayúscula sólo en la primera palabra

**«Nueva cotización», no «Nueva Cotización».**

En español los títulos y rótulos llevan mayúscula en la primera palabra y en
los nombres propios. El inglés capitaliza cada palabra significativa del
título; el español no.

Es el rastro más confiable de software traducido del inglés —o escrito por
alguien pensando en inglés—. Nadie sabe explicar por qué se ve raro, pero se
nota.

**Excepciones, que sí van con mayúscula:**

- Los **valores de estado** (`En revision`, `Aprobada internamente`): son datos
  que el backend compara literalmente. Cambiarlos devuelve HTTP 422.
- Los **roles** (Jefe, Administrador, Ejecutivo, SysAdmin, Proyectos): nombres
  propios en este dominio.
- Nombres propios reales: `Excel`, `NIT`, `BOB — Boliviano`, `PZA (Piezas)`.

### 3.3 El diseño vive en el CSS, no en el JavaScript

Un atributo `style=""` **gana sobre cualquier regla de la hoja de estilos**.
Había 274 repartidos por `public/js`, y mientras estuvieran ahí no se podía
cambiar el aspecto de la aplicación desde el CSS: había que ir archivo por
archivo del código.

La deuda no era de prolijidad. Era que **el diseño estaba clavado**.

Quedan unos veinte, y son legítimos: anchos calculados al dibujar
(`width:${porcentaje}%`), el `--stat-accent` que cada tarjeta de indicador
inyecta con su color, y los bordes de notificación que dependen del tipo.

**Antes de escribir una clase nueva, buscá si ya existe.** Al migrar los
últimos paneles aparecieron cinco casos de clases que ya estaban y se estaban
reimplementando inline encima de sí mismas:

| Clase | Ya hacía | Lugares que la reescribían |
|---|---|---|
| `.filter-bar` | flex, gap, wrap, align-end, padding | 4 |
| `.item-input` | ancho de los campos de la tabla de ítems | 7 |
| `.truncate` | recorte con puntos suspensivos | 3 |
| `.sub-modal` | `max-width: 560px` | 1 |
| `.btn-success` | fondo verde desde el token | 1 |

El caso extremo estaba en `proformaTemplate.js`: un botón con
`class="btn btn-success"` **y encima** un `style` que pintaba el mismo verde a
mano, incluido un `grid-column` que la regla `.approval-actions-grid
.btn-success` ya aplicaba. El estilo inline le ganaba a la clase que el propio
elemento se estaba aplicando.

### 3.4 Ningún color escrito a mano

Había **81 hexadecimales sueltos** en el JavaScript. Un color escrito a mano no
sigue la paleta: se puede cambiar `tokens.css` entero y ese lugar se queda como
estaba.

El caso que más se repitió —tres veces, en tres archivos distintos— fueron
valores como `#065F46`, `#1D4ED8`, `#B45309`. Parecen colores cualesquiera,
pero son **exactamente lo que valen los tokens `--clr-*-soft` en el tema claro
y sólo ahí**. En los temas oscuros quedaba texto casi negro sobre fondo oscuro.

Un color a mano no es sólo desprolijo: **rompe los temas en silencio.**

---

## 4. Cómo nombrar una clase

Por **para qué es**, no por **qué hace**.

```css
.fg-doble        /* bien: el campo que ocupa el doble que sus hermanos */
.flex-2          /* mal: mañana nadie sabe si puede tocarlo */
```

La diferencia importa cuando alguien quiera cambiar el ancho del campo de
cliente y tenga que decidir si toca esa regla o si se lleva puesto otro panel
que casualmente usaba el mismo `flex`.

Las utilidades genéricas (`.mt-2`, `.gap-1`, `.text-muted`) sí existen y están
bien para espaciado y color de texto. La distinción es: **una utilidad compone,
un componente tiene nombre propio.**

---

## 5. Dónde está cada cosa

| Archivo | Qué contiene |
|---|---|
| `public/css/tokens.css` | La paleta, la tipografía, radios y sombras. Los cuatro bloques de tema. |
| `public/css/base.css` | Reset y utilidades (`.mt-*`, `.text-*`, `.flex`, `.hidden`). |
| `public/css/buttons.css` | Todas las variantes de botón. |
| `public/css/components.css` | Insignias, tarjetas, indicadores, avisos, estado vacío, paginación. |
| `public/css/proforma.css` | La proforma en pantalla. |
| `public/css/quotation-form.css` | El formulario de cotización. |
| `public/js/shared/icons.js` | Los SVG: navegación, estados vacíos, tipos de archivo. |

**El orden de carga importa** y está fijado en `index.html` y `dashboard.html`.
Al tocar cualquier `.css` hay que subir el `?v=N` de las dos páginas, o los
navegadores siguen sirviendo la versión vieja.

---

## 6. Lo que falta

- **Los seis matices de estado** (ver §2). Decisión del área comercial.
- **Tipografía.** Hoy es la del sistema (`Segoe UI` y sus alternativas). Es una
  elección defendible —carga instantánea, cero peticiones— pero es también lo
  que usa todo lo demás. Una tipografía propia es el paso que más cambiaría el
  carácter de la interfaz, y el que más cuidado necesita: una fuente web mal
  elegida arruina la legibilidad de una tabla de números.
- **Densidad.** Las tablas ya se apretaron una vez. Vale medirlo con los
  ejecutivos antes de seguir.
