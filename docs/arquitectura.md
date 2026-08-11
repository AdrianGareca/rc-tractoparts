# Dónde está cada cosa

Un mapa para orientarse. El [README](../README.md) explica qué hace el sistema;
esto responde **«tengo que cambiar X, ¿dónde toco?»**.

---

## 1. El camino de una petición

Toda petición al backend atraviesa las mismas capas, en este orden:

```
  navegador
     │  fetch con el token en la cabecera
     ▼
  src/routes/*.js          ── qué URL existe, y su documentación Swagger
     │
     ▼
  src/middlewares/         ── authMiddleware: ¿quién sos?
     │                        roleMiddleware:  ¿tu rol alcanza?
     ▼
  src/validators/*.js      ── ¿el cuerpo tiene la forma correcta? (Zod)
     │
     ▼
  src/controllers/*.js     ── decidir: verificaciones, orden, qué responder
     │
     ▼
  src/models/*.js          ── el SQL, y sólo el SQL
     │
     ▼
   MySQL
```

**La regla que mantiene esto sano:** cada capa sabe de la de abajo y **nunca**
de la de arriba. Un modelo no arma HTML ni sabe qué código HTTP corresponde; un
controlador no escribe SQL.

Cuando algo se sale de eso, es una señal. Ejemplo real: la lectura del id de la
URL estaba escrita 28 veces en los controladores porque no tenía dónde vivir;
hoy es `src/utils/parseId.js`.

---

## 2. Dónde toco si tengo que cambiar…

| Quiero cambiar… | Voy a… |
|---|---|
| Quién puede mover una cotización de un estado a otro | `src/models/quotation/constants.js` (la matriz) — y su espejo `public/js/shared/quotationTransitions.js` |
| Qué se verifica antes de un cambio de estado | `src/controllers/quotation/stateTransitionGuards.js` |
| Qué pasa DESPUÉS de un cambio de estado | `src/controllers/quotation/stateTransitionEffects.js` |
| El aspecto del PDF de la proforma | `src/services/pdf/drawers/` (uno por sección) |
| Los colores, tipografía o radios | `public/css/tokens.css` — y ver [diseno.md](diseno.md) |
| Un texto que ve el usuario | El módulo que lo dibuja. Ver las reglas de redacción en [diseno.md](diseno.md) §3.2 |
| La forma del bloque `pagination` | `src/utils/paginacion.js` |
| Un mensaje de error de la API | `src/config/swagger.js` si es genérico; el controlador si es específico |
| El esquema de la base | `sql/init.sql`, más un `sql/upgrade_*.sql` para lo que ya está en producción |

---

## 3. Los dos espejos, y por qué existen

Hay dos lugares donde el mismo conocimiento vive a propósito en el backend y en
el frontend. **No es duplicación por descuido**, y borrar una copia rompe algo:

| Backend | Frontend | Por qué las dos |
|---|---|---|
| `models/quotation/constants.js` | `shared/quotationTransitions.js` | El backend **decide**; el frontend **no ofrece** lo que va a ser rechazado. Sin el espejo, el `<select>` mostraría los ocho estados y el usuario elegiría uno para recibir un 403 que no podía anticipar. |
| `models/LicitacionModel.js` | `modules/licitacion/permissions.js` | Lo mismo, para licitaciones. |

**La regla:** el frontend puede saber menos que el backend, nunca más. Si los
dos discrepan, gana el backend — y el frontend está mostrando una opción que no
existe.

Al tocar una matriz hay que tocar las dos. No hay test que lo obligue todavía;
es una deuda conocida.

---

## 4. El frontend, sin build step

No hay empaquetador, ni compilación, ni CDN (la política de contenido del
servidor los bloquea). Son módulos ES nativos que el navegador carga tal cual.

```
public/js/
  services/     ── apiClient (fetch + token), authSession, theme
  shared/       ── piezas que usan varias pantallas: paginación, esqueletos,
                   íconos, exportación CSV, estado vacío, sub-modal
  views/
    dashboard/
      strategies/  ── una por rol: qué pestañas ve y qué hace en cada una
      modules/     ── las pantallas concretas (clientes, auditoría, reportes…)
    quotationForm/ ── el formulario de cotización, partido en piezas
```

**El patrón Estrategia es el eje.** `dashboardView.js` mira el rol y monta la
estrategia que corresponde. Agregar un rol es agregar una estrategia, no un
`if` más en cada pantalla.

**Consecuencia de no tener build step:** una ruta de importación mal escrita no
se descubre hasta que el navegador la pide. Por eso existe
`tests/unit/frontendImports.test.js`, que verifica que todo símbolo usado esté
importado y que cada archivo compile.

---

## 5. Lo que se rompe en silencio

Cosas que este proyecto ya sufrió y que no dan ningún error cuando fallan. Cada
una tiene hoy un guardia (ver [pruebas.md](pruebas.md)):

- **Un elemento con dos atributos `class=`** — el navegador se queda con el
  primero y descarta el resto sin avisar.
- **Un `var(--token)` que no existe** — con respaldo, ignora el tema; sin
  respaldo, la propiedad entera se descarta.
- **Un botón que la plantilla dibuja y nadie engancha** — no hace nada al
  apretarlo.
- **`toLocaleString` en el servidor** — depende del ICU del binario; en Alpine
  las fechas salen en inglés y el dinero con el formato equivocado.
- **Un `$ref` de Swagger roto** — la página muestra la respuesta en blanco.

Si vas a agregar algo de esta familia, agregá también su guardia. La regla del
proyecto: **lo que falla sin dar error necesita un test que lo mire desde
afuera.**

---

## 6. Al tocar el CSS

Las hojas se cargan en un orden fijo desde `index.html` y `dashboard.html`, y
ese orden define qué regla gana. Están numeradas en su cabecera.

**Después de cualquier cambio en `public/css/`, hay que subir el `?v=N` de las
dos páginas** — si no, los navegadores siguen sirviendo la versión vieja y el
cambio no aparece.

Y en el despliegue: `public/` **no está montado como volumen**, así que hace
falta `docker compose build app`. Reiniciar no alcanza.
