# Los controles de acceso — `src/middlewares/`

[Volver al índice](README.md)

## En pocas palabras

Son los **porteros** de la API. Antes de que una petición llegue a hacer algo,
estos controles preguntan:

1. **¿Quién sos?** — ¿tiene una sesión válida, vigente y que no fue cerrada?
2. **¿Tu rol puede hacer esto?** — un Ejecutivo no puede crear usuarios, por
   ejemplo.

Si la respuesta es no, la petición se corta ahí y nunca toca los datos. Hay un
tercer control, más chico, que traduce los errores de archivos subidos a
mensajes que se entienden.

## Cómo funciona

### `src/middlewares/authMiddleware.js` — ¿quién sos?

| Función | Qué hace |
|---|---|
| `authenticate(req, res, next)` | Verifica la sesión de cada petición (detalle abajo). Si todo está bien, deja en `req.user` el id, el nombre de usuario y el rol, y la petición sigue. |
| `revokeToken(token)` | Agrega una sesión a la lista de sesiones cerradas. Lo usa el cierre de sesión. |
| `isTokenRevoked(token)` | ¿Esta sesión fue cerrada? |
| `purgeExpiredTokens(now)` | Quita de la lista las sesiones que ya vencieron por su cuenta. |
| `tokenExpiryMs(token)` | Lee cuándo vence un token. |
| `revokedTokenCount()` y `__clearRevokedTokens()` | Solo para pruebas y diagnóstico. |

**Los pasos de `authenticate`, en orden:**

| Paso | Si falla |
|---|---|
| 1. La petición trae la cabecera `Authorization: Bearer <token>` | 401 |
| 2. Si llegó «Bearer Bearer», se corrige (pasa al pegar el token en Swagger) | — |
| 3. La sesión no está en la lista de cerradas de este proceso | 401 |
| 4. La firma del token es válida y no venció (algoritmo HS256 fijo) | 401 |
| 5. No es un token de un solo uso (como el de `/api-docs`) | 401 |
| 6. En la base: el usuario existe, está activo y su `token_version` coincide con la del token | 401 |

El paso 6 es el que hace que **cerrar sesión o desactivar a alguien corte sus
sesiones al instante**, aunque el servidor se haya reiniciado. Si la base falla
en ese paso, la petición sigue: el token ya demostró ser auténtico y un corte
momentáneo de la base no debe dejar afuera a toda la empresa.

### `src/middlewares/roleMiddleware.js` — ¿tu rol puede hacer esto?

| Función | Qué hace |
|---|---|
| `authorize(allowedRoles)` | Fábrica: recibe la lista de roles permitidos y devuelve el control para una ruta. Si el rol de `req.user` no está en la lista, responde 403 y la petición no llega al controlador. |

Siempre va **después** de `authenticate`. Las rutas lo usan así:
`[authenticate, authorize(['Jefe', 'SysAdmin'])]`.

### `src/middlewares/erroresDeSubida.js` — errores al subir archivos

| Función | Qué hace |
|---|---|
| `erroresDeSubida({ prefijosDeCliente })` | Arma el manejador de errores de subida de un grupo de rutas. Un archivo demasiado grande responde 413 y otro error de multer 422; los mensajes propios que empiezan con alguno de `prefijosDeCliente` (como el filtro de extensiones de licitaciones) responden 422 con su texto. Cualquier otro error pasa al manejador global. |

## Por qué es así

- **La sesión se verifica contra la base en cada petición**, y no solo por la
  firma del token, porque un token firmado sigue siendo válido hasta que vence.
  Sin la comprobación de `token_version` y `activo`, una persona desactivada
  podría seguir trabajando horas con la sesión que ya tenía abierta.
- **La lista de sesiones cerradas en memoria es solo un atajo.** La revocación
  que sobrevive a un reinicio es `token_version`, guardada en la base.
- **El control de rol está separado del de identidad** para poder combinarlos
  libremente en cada ruta y para que la matriz de permisos se lea en un solo
  lugar: el archivo de rutas.
- **Toda ruta nueva nace protegida.** Una prueba recorre todas las rutas que
  arma Express y falla si alguna no tiene `authenticate`, salvo las dos
  públicas a propósito: el inicio de sesión y `/health`.

## Dónde está probado

Pruebas rutasProtegidas (ninguna ruta queda sin control), authBearerDoble (la
corrección de «Bearer Bearer»), revokedTokens (la lista de sesiones cerradas),
authMe (la sesión leída de la base), userRoleEscalation (nadie se asciende de
rol) y erroresDeSubida (los mensajes de subida).
