# Configuración de Nginx — copia de respaldo

Estos dos archivos son una **copia** de lo que hay en el droplet. La fuente de
verdad sigue siendo el servidor: acá están para poder reconstruirlo si el
droplet se pierde.

## Por qué existe esta carpeta

Los respaldos automáticos cubren la base de datos y los archivos subidos
(PDFs, Excels, documentos de licitación), y están verificados. Pero la
configuración de Nginx y del certificado HTTPS **vivía únicamente dentro del
servidor**: no estaba en git ni en Drive.

Eso dejaba un hueco concreto en la recuperación. Con el droplet perdido se
restauraban los datos, pero el sitio no volvía a levantar en HTTPS sin rearmar
esta configuración de memoria — y el detalle que más fácil se olvida es
justamente el que rompe las subidas de archivos (ver más abajo).

## Qué hay acá

| Archivo | Va en el servidor a | Para qué |
|---|---|---|
| `rctractoparts.conf` | `/etc/nginx/sites-available/rctractoparts` | El sitio: proxy inverso al contenedor en `127.0.0.1:3000`, HTTPS, y el redirect de `http` a `https` |
| `nginx.conf` | `/etc/nginx/nginx.conf` | La configuración global. **No es decorativa** — ver la advertencia de abajo |

## ⚠️ El detalle que rompe las subidas si se olvida

`nginx.conf` contiene esta línea:

```nginx
client_max_body_size 15M;
```

**Sin ella, Nginx vuelve a su valor por defecto: 1 MB.**

La aplicación acepta archivos de hasta `MAX_PDF_SIZE_MB` (10 MB en el `.env` de
producción). Si Nginx queda en 1 MB, cualquier PDF o Excel más grande que eso se
rechaza con un `413` **antes de llegar a la aplicación** — así que los registros
de la app no muestran nada y el error parece venir de la nada.

Por eso se respalda `nginx.conf` entero y no sólo el archivo del sitio.
`tests/unit/nginxLimites.test.js` verifica que este número siga siendo mayor o
igual al límite de la aplicación.

## Lo que NO está acá, a propósito

- **Los certificados TLS** (`/etc/letsencrypt/`). Son secretos y además tienen
  fecha de vencimiento: no sirve guardarlos. Se generan de nuevo con
  `certbot --nginx` en el droplet nuevo, que además deja instalada la renovación
  automática (`certbot.timer`).
- **El archivo `default`** de Nginx. Es el que trae Ubuntu de fábrica, sin
  modificar.

## Cómo restaurarlo

```bash
# 1. Copiar los dos archivos al droplet nuevo
scp deploy/nginx/nginx.conf          root@<IP>:/etc/nginx/nginx.conf
scp deploy/nginx/rctractoparts.conf  root@<IP>:/etc/nginx/sites-available/rctractoparts

# 2. Activar el sitio
ln -sf /etc/nginx/sites-available/rctractoparts /etc/nginx/sites-enabled/rctractoparts

# 3. Comprobar que la sintaxis es válida ANTES de recargar
nginx -t

# 4. Recargar
systemctl reload nginx

# 5. Generar el certificado TLS nuevo
certbot --nginx -d rctractoparts.org -d www.rctractoparts.org
```

`certbot` reescribe partes del archivo del sitio (las líneas marcadas
`# managed by Certbot`). Es esperado: se está apropiando de la configuración de
HTTPS, que es su trabajo.

## Sobre `ssl_protocols` en nginx.conf — no lo "arregles"

`nginx.conf` trae esta línea, que viene de Ubuntu:

```nginx
ssl_protocols TLSv1 TLSv1.1 TLSv1.2 TLSv1.3;
```

TLS 1.0 y 1.1 están obsoletos y a primera vista parece un problema serio.
**No lo es**: el bloque del sitio incluye `/etc/letsencrypt/options-ssl-nginx.conf`,
que certbot mantiene y que vuelve a declarar `ssl_protocols` con sólo las
versiones modernas. Lo que está dentro del `server` gana sobre lo global.

Comprobado contra el servidor real el 2026-09-03, negociando cada versión por
separado: **TLS 1.0 rechazado, 1.1 rechazado, 1.2 y 1.3 aceptados.** Antes de
cambiar esa línea, medí — no la leas y saques conclusiones.

## Mejora opcional, sin urgencia

`nginx.conf` tiene `# server_tokens off;` comentado, así que el servidor anuncia
su versión exacta en cada respuesta:

```
Server: nginx/1.24.0 (Ubuntu)
```

Descomentar esa línea la reduce a `Server: nginx`. No cierra ningún agujero por
sí sola: sólo le quita a un atacante el dato de qué versión atacar. Es un cambio
de una línea y un `systemctl reload nginx`.

## Mantener esta copia al día

Si alguna vez se cambia la configuración en el servidor, hay que volver a bajar
los archivos:

```bash
ssh root@<IP> 'cat /etc/nginx/sites-available/rctractoparts' > deploy/nginx/rctractoparts.conf
ssh root@<IP> 'cat /etc/nginx/nginx.conf'                    > deploy/nginx/nginx.conf
```

Una copia desactualizada es peor que no tenerla: se restaura con confianza algo
que ya no es lo que estaba funcionando.
