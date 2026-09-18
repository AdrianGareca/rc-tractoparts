# Las pantallas — `public/js/` y `public/js/views/`

[Volver al índice](README.md)

## En pocas palabras

Todo lo anterior de esta carpeta de documentos corre en el **servidor**. Esto
corre en el **navegador** de cada persona: es lo que dibuja las pantallas,
reacciona a los clics y le pide datos al servidor.

La aplicación tiene **tres pantallas**:

| Pantalla | Qué es | Archivo |
|---|---|---|
| **Inicio de sesión** | Usuario y contraseña. | `public/js/views/authView.js` |
| **Tablero** | Todo lo demás: listados, aprobaciones, reportes, clientes, licitaciones. Cambia según el rol. | `public/js/views/dashboardView.js` |
| **Formulario de cotización** | Crear o editar una cotización, en una ventana encima del tablero. | `public/js/views/quotationForm.js` |

## Cómo funciona

### Sin compilación

El navegador carga los archivos **tal cual están en el repositorio**, como
módulos de JavaScript nativos (`import` / `export`). No hay un paso que los
junte o los achique. Eso tiene dos consecuencias que explican muchas decisiones:

- **No se pueden compartir archivos con el servidor.** Donde el navegador
  necesita la misma regla que el servidor (los roles, la máquina de estados, el
  cálculo del dinero) hay una **copia deliberada**, y una prueba exige que las
  dos copias digan lo mismo.
- **No se cargan librerías de afuera.** La política de seguridad del sitio solo
  permite scripts propios; por eso, por ejemplo, los gráficos están dibujados
  a mano (ver [navegador-compartidos.md](navegador-compartidos.md)).

### Las carpetas

| Carpeta | Qué tiene | Documento |
|---|---|---|
| `public/js/views/` | Las tres pantallas. | este |
| `public/js/views/dashboard/` | Todo el tablero: una versión por rol y cada pestaña. | [tablero.md](tablero.md) |
| `public/js/views/quotationForm/` | Las piezas del formulario de cotización. | [formulario-cotizacion.md](formulario-cotizacion.md) |
| `public/js/services/` | La conexión con el servidor, la sesión y el tema claro/oscuro. | [navegador-servicios.md](navegador-servicios.md) |
| `public/js/shared/` | Herramientas que usan varias pantallas. | [navegador-compartidos.md](navegador-compartidos.md) |

Y un archivo suelto en la raíz: `public/js/theme-boot.js`, que aplica el tema
guardado **antes** de que se pinte la página, para que no se vea el parpadeo de
un tema al otro al abrirla.

### Inicio de sesión — `public/js/views/authView.js`

Antes de mandar el usuario y la contraseña, el formulario los pasa por una
**cadena de controles**: cada uno revisa una cosa y, si falla, marca el campo y
corta; si pasa, le cede el turno al siguiente.

| Control | Qué revisa |
|---|---|
| `PresenceHandler` | Que estén los dos campos. |
| `UsernameFormatHandler` | Que el usuario tenga solo letras, números y guiones, de 3 a 50. |
| `PasswordLengthHandler` | Que la contraseña no esté vacía. |
| `ApiSubmitHandler` | El último: manda el inicio de sesión y traduce la respuesta. |

`ApiSubmitHandler` nunca dice si el usuario existe: ante una contraseña
equivocada el mensaje es el mismo que ante un usuario inexistente. Si hubo
demasiados intentos, lo explica.

### Tablero — `public/js/views/dashboardView.js`

`DashboardController` arranca el tablero: verifica que haya sesión, **relee a
la persona desde la base** (su rol o su delegación pueden haber cambiado desde
que entró), arma la barra lateral y la superior, y elige **la estrategia de su
rol**: una clase distinta para Ejecutivo, Jefe, Administrador y Proyectos. El
detalle está en [tablero.md](tablero.md).

### Formulario de cotización — `public/js/views/quotationForm.js`

`mountQuotationForm` monta el formulario dentro de una ventana y devuelve una
función para desmontarlo, que además sabe decir si hay cambios sin guardar. Por
dentro, `FormMediator` coordina las piezas del formulario sin que se conozcan
entre sí. El detalle está en [formulario-cotizacion.md](formulario-cotizacion.md).

### Los patrones de diseño, y dónde está cada uno

El código del navegador usa varios patrones clásicos, cada uno donde resuelve
algo concreto. Sirven como mapa: si se conoce el patrón, se sabe cómo leer el
archivo.

| Patrón | Dónde | Qué resuelve |
|---|---|---|
| **Cadena de responsabilidad** | Inicio de sesión | Agregar un control nuevo es agregar un eslabón, sin tocar los otros. |
| **Estrategia** | Tablero, una por rol | El controlador del tablero no sabe qué ve cada rol; se lo pregunta a su estrategia. |
| **Comando** | Tablero, acciones que cambian datos | Aprobar, cambiar de estado o crear un usuario pasan por el mismo ejecutor: botón desactivado mientras espera y aviso de éxito o error. |
| **Mediador** | Formulario de cotización | La grilla de ítems, el buscador de clientes y los totales no se hablan entre sí: hablan con el mediador. |
| **Observador** | Formulario de cotización | Cada vez que cambia un ítem, los subtotales y el total se recalculan solos. |
| **Instancia única** | Sesión | Hay una sola sesión en todo el navegador y nadie más lee o escribe el token. |

## Por qué es así

- **Todo lo que el navegador decide, el servidor lo vuelve a decidir.** El
  navegador esconde los botones que un rol no puede usar, pero eso es
  comodidad, no seguridad: cada acción la revalida el servidor.
- **Se relee a la persona al abrir el tablero** porque la delegación para
  aprobar no viaja en el token: sin releerla, alguien a quien se la quitaron
  seguiría viendo los botones hasta volver a entrar.
- **Las pantallas se dividieron en archivos chicos** porque el tablero original
  era un solo archivo enorme. Las estrategias, las pestañas y las ventanas se
  separaron sin cambiar su comportamiento, y las piezas principales tienen hoy
  su prueba.

## Dónde está probado

Las pruebas del navegador corren sobre una página simulada (jsdom): montan la
pantalla, hacen clic y miran el resultado. Pruebas quotationFormTemplate,
quotationFormObservers, quotationFormSubmit, quotationFormLineItems,
quotationFormClientSearch, quotationFormFileUpload, pantallaConsumo,
pantallaColaAprobacion, pantallaClientes y pantallaUsuarios, entre otras.
