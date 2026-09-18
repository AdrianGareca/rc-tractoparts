# La conexión con el servidor — `public/js/services/`

[Volver al índice](README.md) · [Las pantallas](pantallas.md)

## En pocas palabras

Son las cuatro piezas que **todas las pantallas usan para hablar con el
servidor** y para recordar quién está conectado:

| Archivo | Qué hace |
|---|---|
| `public/js/services/apiClient.js` | Manda los pedidos al servidor y trae las respuestas. |
| `public/js/services/authSession.js` | Guarda la sesión: el pase firmado y los datos de la persona. |
| `public/js/services/socketClient.js` | Abre la conexión en tiempo real para el aviso de cotización en redacción. |
| `public/js/services/theme.js` | El tema claro, oscuro o automático. |

## Cómo funciona

### Los pedidos — `apiClient.js`

Toda pantalla pide datos con `api.get`, `api.post`, `api.put`, `api.patch`,
`api.delete` o `api.upload` (para archivos). Cada uno es una línea que llama al
mismo motor interno, que:

- agrega el pase de la sesión a cada pedido;
- convierte la respuesta en datos;
- si el servidor responde con error, lo convierte en un error con su código
  (`err.status`) y su detalle (`err.data`), para que la pantalla muestre el
  mensaje junto al campo que corresponde;
- si el servidor dice **401** (la sesión venció o la cerraron), borra la sesión
  local y vuelve a la pantalla de inicio. Así ninguna pantalla tiene que
  ocuparse de eso por su cuenta.

`showToast(message, type, duration)` muestra los avisos flotantes de éxito,
error o información.

### La sesión — `authSession.js`

Hay **una sola** sesión en todo el navegador, y es el único lugar que lee o
escribe el pase.

| Función | Qué hace |
|---|---|
| `setSession(token, user)` | Guarda el pase y los datos al iniciar sesión. |
| `updateUser(user)` | Actualiza los datos de la persona (el tablero los relee de la base al abrirse). |
| `getToken()`, `getUser()` | Los devuelven. |
| `isAuthenticated()` | ¿Hay un pase y todavía no venció? No verifica la firma: eso lo hace el servidor en cada pedido. |
| `clearSession()` | Borra todo al salir. |
| `getRole()`, `getUserId()`, `getDisplayName()`, `getUsername()` | Atajos de una línea a los datos de la persona. |
| `canApproveQuotations()` | ¿Tiene la delegación para aprobar? |

### El tiempo real — `socketClient.js`

`connectSocket()` abre la conexión en tiempo real con el pase de la sesión y
devuelve una promesa: se cumple si conecta y falla si no (sesión inválida,
servidor caído). **No se reconecta sola**, a propósito: la reserva del número
está atada a esa conexión exacta, y una reconexión silenciosa mostraría un
estado que ya no es cierto. Si se cae, se pierde el aviso, no se muestra algo
falso. El recorrido completo está en [tiempo-real.md](tiempo-real.md).

### El tema — `theme.js`

Tres opciones, no dos: **automático** (sigue al sistema operativo, es el valor
por defecto), **claro** y **oscuro**. `cycleTheme()` pasa de una a la
siguiente, `applyTheme()` la aplica y la recuerda, y `themeButtonLabel()` da el
icono y el texto del botón. Los colores en sí viven en las hojas de estilo; este
archivo solo marca cuál usar.

## Por qué es así

- **Un solo lugar para los pedidos.** Si cada pantalla usara `fetch` por su
  cuenta, cada una tendría que acordarse del pase, del manejo de errores y de
  la sesión vencida. Una sola que se olvidara bastaría para un error difícil de
  encontrar.
- **Un solo lugar para la sesión.** Nadie más toca el almacenamiento del
  navegador para la sesión; así, cerrar sesión borra todo de verdad.
- **El navegador no decide si la sesión es válida.** Solo mira si venció para
  no mandar pedidos inútiles; la validez real la decide el servidor en cada
  pedido.
- **«Automático» es la opción por defecto** porque alguien que tiene su
  computadora en claro y entra por primera vez no debería encontrarse la
  aplicación a oscuras sin saber por qué.

## Dónde está probado

Pruebas quotationFormDraftLock y draftLockRelease (la conexión en tiempo
real), theme (el tema) y las pruebas de pantalla, que ejercitan los pedidos y los
avisos sobre una página simulada.
