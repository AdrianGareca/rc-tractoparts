# Sistema de diseño

Cómo se ve la aplicación y por qué. Este documento existe para que una pantalla
nueva se parezca a las que ya están, sin tener que adivinar.

El README explica *qué hace* el sistema. Esto explica *cómo se ve* y, sobre
todo, **qué decisiones ya están tomadas** para no volver a discutirlas.

---

## 1. La identidad es el amarillo del logo

El logo de RC Tractoparts es **amarillo y negro**. Ese amarillo es
**`#FCCC24`**, y no se eligió a ojo: se **midió** de
`src/assets/images/rc_logo.png`, donde ocupa el 70,6 % de los píxeles. Es
también, con un punto de diferencia, el amarillo de la maquinaria pesada.

| Rol | Valor | Token |
|---|---|---|
| Amarillo de marca | `#FCCC24` | `--clr-marca` |
| Tinta sobre el amarillo | `#16150F` | `--text-sobre-marca` |
| Marino de la proforma | `#1B2B4B` | `--clr-navy` |
| Naranja de la proforma | `#C85A0F` | `--clr-proforma-orange` |

`tests/unit/paletaMarca.test.js` vuelve a decodificar el PNG en cada corrida y
compara. Si el logo cambia o alguien «ajusta» el token, la prueba lo dice.

### Tres identidades que no se hablaban

Hasta el 2026-09-02 la empresa tenía tres juegos de colores distintos:

| | Colores | Dónde |
|---|---|---|
| El logo | amarillo `#FCCC24` + negro | la marca de verdad |
| La proforma impresa | marino + naranja | lo único que ve el cliente |
| La aplicación | azul `#3B82F6` de Tailwind | de nadie |

La pantalla no usaba **ninguno** de los colores del logo. Se veía prestada
porque lo estaba: era la paleta por defecto del marco de CSS más usado que
existe —los propios comentarios de `tokens.css` lo documentaban: `slate-100`,
`slate-900`, los acentos en el tono `500`—, así que compartía literalmente sus
colores con todas las demás aplicaciones que la dejaron tal cual.

No se veía mal. Se veía genérica.

### Los dos temas son las dos caras de la misma marca

No compiten: **son una elección de quien usa la aplicación**, igual que
cualquier modo claro/oscuro.

| Tema | Fondo | Carácter |
|---|---|---|
| **Oscuro** | casi negro `#0B0B0C` | alto contraste; el amarillo salta |
| **Claro** | papel cálido `#F2EFE6` | convive con la proforma, que también se lee sobre blanco |

El azul dejó de ser Tailwind: ahora es el eléctrico `#213FFF`, y **ya no es la
acción principal**. Sólo significa «Enviada al cliente».

### Encima del amarillo nunca va blanco

Blanco sobre `#FCCC24` da un contraste de **1,4:1**; el mínimo legible es 4,5:1.
Antes de este cambio `.btn-primary` era `background: var(--clr-blue)` con
`color: var(--clr-white)`: volver amarillo el fondo sin tocar el texto habría
dejado **ilegible el botón más usado de la aplicación**.

Por eso la marca tiene token propio y no se cuelga de `--clr-blue`:

- `--clr-marca` es el fondo.
- `--text-sobre-marca` es lo que se escribe encima. **Nunca `--clr-white`.**

`paletaMarca.test.js` recorre todo el CSS buscando esa combinación y calcula el
contraste en vez de confiar en un número anotado.

> **Ojo con `Pendiente`.** Usa `--clr-amber` (`#F59E0B`), anaranjado y por eso
> distinguible del amarillo de marca — pero son vecinos. Si alguna vez se
> confunden, **lo que se mueve es el ámbar del estado, no la marca.**

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
