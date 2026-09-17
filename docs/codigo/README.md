# Qué hace cada parte del código

Esta carpeta explica el código de RC Tractoparts **carpeta por carpeta**. Cada
documento responde tres preguntas, en este orden, para que sirva a quien lo lea:

1. **En pocas palabras** — qué es y para qué sirve, sin jerga. Para quien usa o
   dirige el sistema.
2. **Cómo funciona** — archivo por archivo y función por función. Para quien
   tiene que modificarlo.
3. **Por qué es así** — las reglas y decisiones que le dieron esa forma. Para
   presentarlo o para no deshacer algo que costó aprender.

Además, **cada función del código tiene un comentario arriba** que dice qué hace.
Estos documentos son el mapa; los comentarios, el detalle en el lugar.

---

## El recorrido de una petición

Cuando alguien aprieta un botón en la pantalla, el navegador le pide algo al
servidor. Esa petición atraviesa siempre las mismas capas, y cada carpeta del
backend es una de ellas:

```
  navegador
     │   «dame las cotizaciones de este mes»
     ▼
  src/app.js + src/server.js ── recibe la petición, aplica la seguridad general
     ▼
  src/routes/        ── ¿existe esta dirección? ¿qué la atiende?
     ▼
  src/middlewares/   ── ¿quién sos? ¿tu rol puede hacer esto?
     ▼
  src/validators/    ── ¿los datos que mandaste tienen la forma correcta?
     ▼
  src/controllers/   ── decide qué hacer y qué responder
     ▼
  src/models/        ── habla con la base de datos (el único que escribe SQL)
     ▼
   MySQL
```

Al costado de ese camino hay piezas que usan varias capas:

- `src/config/` — la conexión a la base, los roles y la verificación del
  entorno al arrancar.
- `src/utils/` — herramientas chicas y compartidas: redondear dinero, leer un
  id de la URL, registrar en la bitácora, armar la paginación.
- `src/realtime/` — el único canal en tiempo real: el aviso de «alguien está
  redactando la próxima cotización».
- `src/services/` — la generación de los PDF.

**La regla que mantiene esto ordenado:** cada capa conoce a la de abajo y nunca
a la de arriba. Un modelo no sabe qué es una respuesta HTTP; un controlador no
escribe SQL.

---

## Los documentos

| Documento | Carpeta | Responde a |
|---|---|---|
| [servidor.md](servidor.md) | `src/server.js`, `src/app.js` | ¿Cómo arranca la aplicación? ¿Qué seguridad se aplica a todas las peticiones? |
| [config.md](config.md) | `src/config/` | ¿Cómo se conecta a la base? ¿Dónde están los roles? ¿Qué se verifica antes de arrancar? |
| [rutas.md](rutas.md) | `src/routes/` | ¿Qué direcciones tiene la API y quién puede usar cada una? |
| [middlewares.md](middlewares.md) | `src/middlewares/` | ¿Cómo se comprueba quién llama y qué puede hacer? |
| [validadores.md](validadores.md) | `src/validators/` | ¿Cómo se revisan los datos antes de guardarlos? |
| [controladores.md](controladores.md) | `src/controllers/` | ¿Qué pasa en cada operación: crear, aprobar, reportar? |
| [modelos.md](modelos.md) | `src/models/` | ¿Qué consultas se hacen a la base y dónde? |
| [utilidades.md](utilidades.md) | `src/utils/` | ¿Qué herramientas compartidas hay y por qué existen? |
| [servicios-pdf.md](servicios-pdf.md) | `src/services/` | ¿Cómo se dibujan la proforma, el expediente de licitación y el reporte? |
| [tiempo-real.md](tiempo-real.md) | `src/realtime/` | ¿Cómo funciona el aviso de cotización en redacción? |

---

## Palabras que aparecen seguido

| Palabra | Qué significa acá |
|---|---|
| **Ruta** o **endpoint** | Una dirección de la API, como `GET /api/cotizaciones`. El verbo dice si se lee (GET), crea (POST), modifica (PUT/PATCH) o borra (DELETE). |
| **Middleware** | Un paso que corre ANTES de atender la petición: puede dejarla pasar o cortarla (por ejemplo, si no hay sesión). |
| **Controlador** | La función que atiende una ruta: decide qué hacer y qué responder. |
| **Modelo** | El código que consulta y modifica una tabla de la base. |
| **Validador** | Las reglas que deben cumplir los datos que llegan (largos, formatos, valores permitidos). |
| **JWT** o **token** | El «pase» firmado que recibe quien inicia sesión y que acompaña cada petición. |
| **Pool de conexiones** | Las conexiones a MySQL que el servidor mantiene abiertas y reparte (son 10). |
| **Transacción** | Varias operaciones en la base que se guardan todas juntas, o ninguna. |
| **Rol** | Ejecutivo, Administracion, Jefe, SysAdmin o Proyectos: define qué puede hacer cada persona. |

---

## Cómo se mantiene al día

- Una función nueva lleva su comentario arriba desde el primer día.
- Si cambia lo que hace una carpeta, se actualiza su documento en el mismo
  cambio.
- `tests/unit/documentacion.test.js` verifica que los archivos que citan estos
  documentos existan: un documento que manda a un archivo borrado falla la
  suite.
