# La configuración — `src/config/`

[Volver al índice](README.md)

## En pocas palabras

Son los ajustes de base que el resto del sistema da por sentados:

- **cómo conectarse a la base de datos**;
- **cuáles son los roles** (Ejecutivo, Administracion, Jefe, SysAdmin, Proyectos);
- **cómo se describe la API** en la documentación interactiva;
- **qué debe estar bien configurado** para que la aplicación pueda arrancar.

## Cómo funciona

### `src/config/db.js` — la conexión a MySQL

Crea **un solo pool de conexiones** que comparte toda la aplicación. Ningún
archivo abre conexiones propias.

| Ajuste | Valor | Para qué |
|---|---|---|
| Base de datos | `DB_NAME`, o `DB_NAME_TEST` cuando corren las pruebas | Las pruebas nunca tocan la base real |
| Conexiones | `DB_CONNECTION_LIMIT` (10 por defecto) | Cuántas consultas simultáneas puede hacer el servidor |
| Cola | sin límite, con espera | Si las 10 están ocupadas, la petición espera su turno |
| Caracteres | `utf8mb4` | Tildes, ñ y emoji se guardan bien |
| Zona horaria | UTC | Las fechas se guardan en UTC; la conversión a hora de Bolivia se hace en la aplicación |
| Decimales | como números | Los montos llegan como número, no como texto |
| Varias sentencias | desactivado | Una defensa más contra la inyección de SQL |
| Mantener viva | cada 10 s de inactividad | Evita cortes de conexiones en horas de poco uso |

| Función | Qué hace |
|---|---|
| `testConnection()` | Pide una conexión, hace un ping y la devuelve. `server.js` la llama al arrancar: si la base no responde, la aplicación no se enciende. |

### `src/config/roles.js` — los cinco roles

La lista oficial de roles, con su número y su nombre. **Tiene que coincidir con
la tabla `roles` de `sql/init.sql`.**

| Función | Qué hace |
|---|---|
| `nombreDeRol(id)` | Traduce el número de un rol a su nombre para mostrarlo (por ejemplo, en la bitácora). |

### `src/config/swagger.js` — la documentación de la API

La configuración de OpenAPI que genera la página `/api-docs` a partir de los
comentarios de las rutas, y las **respuestas de error compartidas** (401, 403,
404, 422, 500) que las rutas reutilizan en vez de describirlas cada vez.

### `src/config/verificarEntorno.js` — el control del arranque

| Función | Qué hace |
|---|---|
| `revisarEntorno(env)` | Revisa las variables de entorno y devuelve `errores` (impiden arrancar) y `avisos` (se muestran y se sigue). No lee el entorno por su cuenta ni detiene nada: es una función pura. |
| `informarEntorno({ errores, avisos })` | Muestra el resultado en el log y devuelve si se puede arrancar. Si no, explica cómo generar un secreto nuevo. |
| `esDeEjemplo(valor)` | ¿El valor contiene un texto de ejemplo, como «change_me» o «replace_with»? |

**Qué se considera un error:**

- falta `JWT_SECRET`, `DB_USER`, `DB_PASSWORD` o `DB_NAME`;
- `JWT_SECRET` tiene menos de 32 caracteres;
- `JWT_SECRET` o `DB_PASSWORD` siguen siendo el texto de ejemplo del
  `.env.example`.

**Qué es solo un aviso:** un secreto de menos de 64 caracteres que usa una sola clase de caracteres (solo minúsculas, por ejemplo), menos de
10 rondas de bcrypt, o `NODE_ENV` sin definir.

## Por qué es así

- **Un solo pool** porque cada conexión a MySQL consume memoria del servidor.
  Con un pool compartido se controla cuántas hay en total. Es también el límite
  que descubrió la prueba de rendimiento del 15 de septiembre: si unos pocos
  reportes pesados ocupan las 10 conexiones, el resto espera. Por eso existe el
  tope de 30 segundos de `src/utils/topeConsultas.js`.
- **Los roles en un solo lugar** porque estaban escritos a mano 168 veces en 37
  archivos, y ya habían aparecido dos versiones distintas. Un nombre de rol mal
  escrito no da error: el permiso simplemente no se otorga, o se otorga de más.
- **El secreto de sesión se revisa por largo y por contenido** porque el texto
  de ejemplo del repositorio tiene 51 caracteres: un control que solo mirara el
  largo lo dejaría pasar, y ese texto es público.

## Dónde está probado

Pruebas rolesUnaSolaLista (los roles coinciden con la base), swaggerRespuestas
(las respuestas compartidas de la documentación), verificarEntorno (el control
del arranque) y topeConsultasMysql (la conexión real con el tope de tiempo).
