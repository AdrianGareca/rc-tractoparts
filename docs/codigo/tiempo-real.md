# El aviso en tiempo real — `src/realtime/`

[Volver al índice](README.md)

## En pocas palabras

Cuando alguien abre el formulario de **Nueva Cotización**, el sistema le
**reserva el próximo número** (por ejemplo, SC-2026/000154). Si en ese momento
otra persona abre el mismo formulario, ve al instante un aviso: «Juan está
redactando la cotización SC-2026/000154». Cuando Juan guarda o cierra, el aviso
desaparece solo, sin recargar la página.

Es el **único** canal en tiempo real de la aplicación; todo lo demás funciona
con peticiones normales.

## Cómo funciona

Usa **Socket.IO**, una conexión que queda abierta entre el navegador y el
servidor para que el servidor pueda avisar sin que le pregunten.

### `src/realtime/socketServer.js`

| Función | Qué hace |
|---|---|
| `initSocket(httpServer)` | Conecta Socket.IO al servidor HTTP (lo llama `src/server.js`), exige sesión válida a cada conexión y registra los eventos. |
| `_buildAllowedOrigins()` | La lista de dominios permitidos, calculada **igual que el CORS** de `src/app.js`. |
| `origin(origin, callback)` | Acepta o rechaza la conexión según esa lista. |
| `_releaseIfOwner(socket)` | Si esta conexión tenía la reserva, la libera y avisa a todos. |
| `getIO()` | Da acceso al canal a otros módulos. |
| `broadcastDraftReleased()` | Avisa a todos que la reserva se liberó; lo usa la creación de cotizaciones al guardar. |

### El recorrido

| Momento | Evento | Qué pasa |
|---|---|---|
| Conexión | — | Se verifica el token igual que en la API: firma, cuenta activa y `token_version` vigente. Sin eso, no hay conexión. |
| Abrir el formulario | `cotizacion:draft:join` | `QuotationLockModel.acquireOrGet` reserva el número. Si la reserva es propia, se avisa a los demás con `cotizacion:draft:update`; si es de otra persona, se le responde quién la tiene. |
| Cerrar o guardar | `cotizacion:draft:leave` | Se libera la reserva y se avisa a todos. |
| Se corta la conexión | `disconnect` | Lo mismo que cerrar: nadie queda con una reserva fantasma. |
| La cotización se guardó | — | `releaseByNumeroCorrelativo` y `broadcastDraftReleased` limpian la reserva desde la API, por si el navegador no llegó a avisar. |
| El servidor arranca | — | `releaseAll` borra toda reserva previa. |

## Por qué es así

- **La reserva es un aviso, no el candado real.** El número definitivo lo
  asigna la transacción de creación con `FOR UPDATE`. La reserva sirve para que
  dos personas no redacten a ciegas la misma cotización; si igual guardan a la
  vez, la base garantiza números distintos.
- **La conexión en tiempo real exige la misma sesión que la API.** Una persona
  que cerró sesión o fue desactivada no puede seguir recibiendo avisos ni
  reservando números.
- **Una sola reserva por año.** El número es global de la empresa, así que la
  reserva también: nunca pueden existir dos personas «dueñas» del mismo número.
- **Se limpia al arrancar y al desconectarse.** Ninguna conexión sobrevive a un
  reinicio, y una pestaña cerrada de golpe no avisa: sin esas dos limpiezas, el
  formulario mostraría un aviso eterno.

## Dónde está probado

Prueba draftLockRelease (las reservas se liberan en cada camino: al cerrar, al
desconectarse y al guardar).
