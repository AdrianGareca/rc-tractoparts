# El arranque y la puerta de entrada — `src/server.js` y `src/app.js`

[Volver al índice](README.md)

## En pocas palabras

Son los dos archivos que ponen la aplicación en marcha.

- **`src/server.js`** es el **encendido**: comprueba que la configuración sea
  segura, que la base de datos responda, y recién entonces empieza a atender.
  También se encarga del **apagado ordenado**, para no cortar operaciones a la
  mitad.
- **`src/app.js`** es la **puerta de entrada**: toda petición pasa por acá antes
  de llegar a su destino. Aplica la seguridad general (cabeceras de protección,
  qué sitios pueden llamar a la API, límite de peticiones), entrega las
  pantallas y responde los errores sin revelar detalles internos.

Están separados a propósito: las pruebas automáticas usan `app.js` sin encender
un servidor de verdad.

## Cómo funciona

### `src/server.js`

| Función | Qué hace |
|---|---|
| `startServer()` | Enciende la aplicación en este orden: (1) revisa el entorno con `revisarEntorno` y, si hay errores, **no arranca**; (2) prueba la conexión a MySQL; (3) libera las reservas de «cotización en redacción» que hayan quedado de un apagado anterior; (4) crea el servidor HTTP, le conecta el canal en tiempo real (Socket.IO) y escucha en el puerto `PORT` (3000 por defecto). |
| `gracefulShutdown(signal)` | Al recibir la orden de apagado (Docker, Ctrl-C), deja de aceptar peticiones nuevas, espera las que están en curso y cierra las conexiones a la base. Si en 10 segundos no terminó, fuerza la salida. |

Además registra en el log cualquier error que se escape de todas las capas
(`unhandledRejection` y `uncaughtException`).

### `src/app.js`

Arma la aplicación Express. **El orden de los pasos importa**, porque cada
petición los atraviesa de arriba hacia abajo:

| Paso | Qué hace |
|---|---|
| 1. `helmet` | Agrega las cabeceras de seguridad del navegador (política de contenido, protección contra clickjacking, HTTPS estricto). |
| — `trust proxy` | Confía en **un** proxy (Nginx) para conocer la IP real de quien llama. |
| 2. CORS | Solo los dominios de `CORS_ORIGIN` pueden usar la API desde un navegador. Fuera de producción se agrega `http://localhost:3000`; **en producción, sin `CORS_ORIGIN`, la aplicación no arranca**. |
| 3. Archivos estáticos | Entrega las pantallas de `public/` y las imágenes de marca. Va antes del límite de peticiones para que cargar una pantalla no gaste cupo. |
| 4. Límite global | 1000 peticiones cada 15 minutos por IP. Se desactiva en desarrollo y en pruebas. |
| 5. `morgan` | Registra cada petición en el log (formato completo en producción; ninguno en pruebas). |
| 6. Cuerpos JSON | Acepta cuerpos de hasta 5 MB. |
| 7. Swagger | La documentación de la API en `/api-docs`, solo para Jefe y SysAdmin. |
| 8. Rutas | Monta los nueve grupos de rutas bajo `/api/...` (ver [rutas.md](rutas.md)). |
| — `/health` | Responde `status: ok` con la hora: lo usa Docker para saber si la app está viva. |
| 9. Página no encontrada | Una dirección que no existe devuelve la página `404.html` si la pide un navegador, o un JSON si la pide la API. |
| 10. Errores globales | Traduce cualquier error a una respuesta segura (ver abajo). |

| Función | Qué hace |
|---|---|
| `origin(origin, callback)` | La decisión de CORS petición por petición: acepta si no hay cabecera Origin o si el dominio está permitido. |
| `skip()` | Desactiva el límite global en desarrollo y pruebas. |
| `requireDocsAccess(req, res, next)` | Protege `/api-docs`: exige un token de un solo uso, de 10 minutos y con propósito `api-docs`, emitido para Jefe o SysAdmin. |
| `deny(status, msg)` | Responde la página HTML de «Acceso restringido» con el motivo. |

**El manejador global de errores** responde:

| Caso | Respuesta |
|---|---|
| Dominio no permitido por CORS | 403 con el motivo |
| Cuerpo de más de 5 MB | 413 |
| JSON mal formado | 400 genérico (no repite el mensaje interno del intérprete) |
| Archivo subido demasiado grande | 413 |
| Cualquier otro error 4xx | Ese código con su mensaje |
| Cualquier 5xx | 500 con un mensaje genérico: **nunca** muestra el detalle interno, que queda solo en el log |

## Por qué es así

- **El entorno se verifica antes que nada** porque un secreto de sesión débil no
  produce ningún error visible: la aplicación funcionaría con normalidad y
  cualquiera que conociera ese valor podría fabricarse una sesión de Jefe.
  Detenerse al arrancar convierte un problema silencioso en uno evidente.
- **Las reservas de redacción se limpian al arrancar** porque ninguna conexión
  en tiempo real sobrevive a un reinicio: cualquier reserva que siga en la base
  es huérfana.
- **`trust proxy` vale 1 y no más.** Con Cloudflare delante, la IP real la
  entrega Nginx con su propia configuración. Subir este valor permitiría que
  cualquiera falsifique su IP en la bitácora y esquive el límite de intentos
  de inicio de sesión.
- **Los errores 500 nunca muestran su detalle** para no revelar estructura
  interna (tablas, rutas de archivos) a quien esté probando la aplicación.

## Dónde está probado

Pruebas rutasProtegidas (toda ruta exige sesión), paginaNoEncontrada (la página
404), cabecerasSeguridad (las cabeceras de helmet), expressComportamiento (los
cambios de Express 5), nginxIpReal (la IP real detrás del proxy) y
verificarEntorno (el control del arranque).
