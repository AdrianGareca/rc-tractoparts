# Respaldos

Cómo se respalda RC Tractoparts, cómo se restaura, y cómo se deja funcionando
solo. Está escrito para seguirlo de arriba abajo pegando los comandos.

**Estado al 13 de agosto de 2026:** los scripts existen y funcionan, pero la
automatización nunca se instaló. El último respaldo era del 30 de julio. Este
documento cierra eso.

---

## Cómo funciona el sistema

Hay dos cosas distintas que respaldar, y hacen falta las dos:

| Qué | Dónde vive | Qué pasa si se pierde |
|---|---|---|
| La **base de datos** | contenedor `rc_tractoparts_db` | Se pierden cotizaciones, clientes, licitaciones, la bitácora |
| Los **archivos** | `uploads/` y `storage/` del contenedor de la app | Se pierden los PDF de proforma y los documentos de licitación |

Restaurar solo la base te deja registros que apuntan a archivos que no existen.
Por eso los dos scripts corren juntos.

### Los cuatro scripts

| Script | Qué hace |
|---|---|
| `backup-db.sh` | Vuelca la base a un `.sql.gz` con fecha |
| `backup-files.sh` | Espeja `uploads/` y `storage/` |
| `restore-db.sh` | Restaura un respaldo, pidiendo confirmación escrita |
| `install-backup-cron.sh` | Instala las tareas automáticas |

### Por qué el respaldo de la base es confiable

`backup-db.sh` no confía en que el volcado salió bien. Escribe a un archivo
temporal `.parcial` y solo lo renombra al nombre definitivo después de cuatro
controles:

1. Que `mysqldump` no haya fallado.
2. Que el `.gz` no esté corrupto.
3. Que pese más de 10 KB — un respaldo de 200 bytes es una base vacía.
4. Que termine con la marca `Dump completed` que MySQL escribe al final. **Este
   es el importante**: detecta un volcado cortado a la mitad porque se llenó el
   disco.

Si algo falla, borra el temporal y **conserva el respaldo anterior**. Nunca
reemplaza uno bueno por uno dudoso.

Usa `--single-transaction`, así que saca una foto consistente sin bloquear nada:
la gente puede seguir cotizando mientras corre.

### Una diferencia entre los dos que conviene saber

El respaldo de la base es **versionado**: uno por día, se guardan 14.

El de archivos es un **espejo** (`rsync --delete`). Si alguien borra un documento
por error y el espejo corre esa noche, el espejo también lo borra. No hay una
versión de ayer a la que volver.

No es un error: un espejo de 428 MB por día llenaría el disco en dos semanas.
Pero significa que para los archivos el respaldo te protege de **perder el
servidor**, no de un **borrado accidental**.

---

## Parte 0 — Cerrar el hueco de hoy

Antes de automatizar nada. Son dos comandos y un minuto.

```bash
/root/rc-tractoparts/scripts/backup-db.sh
```

**Qué hace:** lee el `.env`, verifica que el contenedor de la base esté
corriendo, y vuelca la base a `/var/backups/rc-tractoparts/`.

**Qué NO toca:** no modifica la base — `mysqldump` solo lee. No toca el código
ni los archivos subidos.

**Cómo sabés que salió bien:** imprime `Respaldo OK:` con el nombre y el tamaño.
Va a imprimir también un aviso sobre `RCLONE_REMOTE`; eso es esperado y lo
resolvemos en la Parte 6.

```bash
/root/rc-tractoparts/scripts/backup-files.sh
```

**Qué hace:** copia `uploads/` y `storage/` del contenedor a un directorio
temporal y los sincroniza al espejo. Son unos 430 MB, tarda algunos segundos.

**Qué NO toca:** no borra ni modifica nada dentro del contenedor. Solo lee.

**Verificá que quedó:**

```bash
ls -lh /var/backups/rc-tractoparts/
```

Tenés que ver un `.sql.gz` con la fecha de hoy.

---

## Parte 1 — Que no vuelva a pasar

```bash
PROJECT_DIR=/root/rc-tractoparts bash /root/rc-tractoparts/scripts/install-backup-cron.sh
```

**El `PROJECT_DIR=` del principio** es una variable de entorno que vale solo para
ese comando; no queda definida después. Hace falta porque el script asume
`/opt/rc-tractoparts` por defecto y la aplicación está en `/root/rc-tractoparts`.
Sin eso corta con «No existe PROJECT_DIR» — que es probablemente lo que pasó la
primera vez que se intentó.

**Qué hace:** da permiso de ejecución a los scripts, crea
`/var/backups/rc-tractoparts` con permisos `700` y dueño root, y escribe dos
archivos:

`/etc/cron.d/rc-tractoparts-backup` con los horarios:

```
03:00  todos los días   respaldo de la base
03:30  todos los días   respaldo de archivos
04:00  los domingos     respaldo + prueba de restauración
```

`/etc/logrotate.d/rc-tractoparts-backup` para que los logs no crezcan sin fin.

**Qué NO toca:** ni la base, ni el código, ni los contenedores, ni el `.env`.

**Es idempotente:** correrlo dos veces sobrescribe los mismos archivos. No
duplica tareas.

**Verificá:**

```bash
cat /etc/cron.d/rc-tractoparts-backup
```

Las tres líneas tienen que decir `/root/rc-tractoparts/scripts/...`.
**Si dicen `/opt/`, la variable no se aplicó** y el cron va a fallar en silencio
todas las noches.

---

## Parte 2 — La cuenta de Google

Hasta acá los respaldos están **en el mismo disco que la base que respaldan**.
Eso protege contra un borrado accidental, pero no contra perder el servidor.

Esta parte no tiene comandos: se hace en el navegador, y conviene hacerla bien
porque esa cuenta va a custodiar los datos de todos los clientes.

1. Creá `backupsrctractoparts@gmail.com`.
2. Contraseña larga y única. **Guardala donde la puedas recuperar** — un gestor
   de contraseñas, o escrita en un lugar físico seguro.
3. **Activá la verificación en dos pasos antes de conectar nada.**
4. Poné un teléfono de recuperación que sea tuyo, no de un empleado que puede
   irse de la empresa.

**El espacio alcanza.** La cuenta gratis da 15 GB; los archivos pesan 428 MB y
el espejo los mantiene, no los acumula. Los volcados de la base son 60 KB cada
uno.

**Entrá cada tanto.** Google borra cuentas con dos años de inactividad. La subida
automática cuenta como actividad, pero no está de más abrirla de vez en cuando.

---

## Parte 3 — Instalar rclone en el servidor

`rclone` es la herramienta que copia a Google Drive.

```bash
apt update && apt install -y rclone
rclone version
```

**Qué hace:** instala rclone desde los repositorios de Ubuntu. La versión de
Ubuntu 24.04 alcanza de sobra para lo que necesitamos.

**Cómo sabés que salió bien:** `rclone version` imprime algo como `rclone v1.60.1`.

---

## Parte 4 — Autorizar Google Drive

Acá está la única parte incómoda. Google pide autorizar desde un navegador, y el
servidor no tiene ninguno. Se resuelve en dos tiempos: se obtiene el permiso en
tu Windows y se le pasa al servidor.

### 4.1 — En tu Windows

Instalá rclone:

```powershell
winget install Rclone.Rclone
```

Cerrá y volvé a abrir PowerShell para que tome el comando nuevo. Después:

```powershell
rclone authorize "drive"
```

**Qué hace:** abre tu navegador. Iniciá sesión con
`backupsrctractoparts@gmail.com` —cuidado de no usar tu cuenta personal— y
aceptá los permisos.

Cuando termine, PowerShell imprime un bloque largo entre llaves, algo así:

```
{"access_token":"ya29.a0Af...","token_type":"Bearer","refresh_token":"1//0e...","expiry":"2026-08-13T20:15:00.000000000-04:00"}
```

**Copiá ese bloque entero**, desde la primera `{` hasta la última `}`. Es lo que
le vas a pegar al servidor en el paso siguiente.

> Ese texto es la llave de la cuenta. No lo pegues en un chat, un correo ni un
> documento compartido. Va del portapapeles a la terminal del servidor y nada
> más.

### 4.2 — En el servidor

```bash
rclone config
```

Es un cuestionario. Estas son las respuestas, en orden:

| Pregunta | Respuesta |
|---|---|
| `e/n/d/r/c/s/q>` | `n` (New remote) |
| `name>` | `gdrive` |
| `Storage>` | `drive` |
| `client_id>` | *(Enter, vacío)* |
| `client_secret>` | *(Enter, vacío)* |
| `scope>` | `1` (Full access) |
| `service_account_file>` | *(Enter, vacío)* |
| `Edit advanced config?` | `n` |
| `Use web browser to automatically authenticate?` | **`n`** ← importante |
| `config_token>` | **pegá acá el bloque `{...}` del paso 4.1** |
| `Configure this as a Shared Drive?` | `n` |
| `y/e/d>` | `y` (Yes this is OK) |
| `e/n/d/r/c/s/q>` | `q` (Quit) |

**Sobre el `scope 1` (acceso completo):** normalmente conviene el permiso mínimo,
pero acá la cuenta es exclusiva para respaldos y no guarda nada más. El acceso
completo sobre una cuenta dedicada es un riesgo acotado, y simplifica bastante
la configuración.

**Probá que funciona:**

```bash
rclone lsd gdrive:
```

Si no da error, está conectado. (Puede no listar nada: la cuenta está vacía.)

---

## Parte 5 — El cifrado

Adentro de esos respaldos está la base completa: todos tus clientes, sus NIT, sus
teléfonos, cada cotización con sus precios. Si esa cuenta de Gmail se ve
comprometida, se lleva todo eso en texto plano.

`rclone crypt` cifra los archivos **antes** de subirlos. Google guarda bloques
ilegibles.

**Qué protege y qué no, dicho claro:** protege contra que alguien entre a la
cuenta de Google o contra que alguien en Google mire. **No** protege contra que
alguien entre al servidor — porque el servidor necesita poder escribir, y por lo
tanto tiene la llave.

```bash
rclone config
```

| Pregunta | Respuesta |
|---|---|
| `e/n/d/r/c/s/q>` | `n` |
| `name>` | `respaldos` |
| `Storage>` | `crypt` |
| `remote>` | `gdrive:rc-tractoparts` |
| `filename_encryption>` | `1` (standard) |
| `directory_name_encryption>` | `1` (true) |
| `Password or pass phrase` → `y/g/n>` | `g` (generar) |
| `Password strength (bits)>` | `128` |
| `Use this password?` | `y` |
| `Password or pass phrase for salt` → `y/g/n>` | `g` |
| `Password strength (bits)>` | `128` |
| `Use this password?` | `y` |
| `Edit advanced config?` | `n` |
| `y/e/d>` | `y` |
| `e/n/d/r/c/s/q>` | `q` |

### Esto es lo más importante de todo el documento

rclone te muestra las **dos contraseñas generadas una sola vez, en pantalla**.

**Copialas y guardalas fuera del servidor.** En el gestor de contraseñas, junto a
la clave de la cuenta de Gmail.

Si perdés esas dos contraseñas **y** perdés el servidor, los respaldos quedan
ilegibles para siempre. No hay recuperación posible: ese es exactamente el punto
del cifrado.

Guardá también una copia de la configuración, que contiene las llaves:

```bash
cat /root/.config/rclone/rclone.conf
```

Ese archivo, en el gestor de contraseñas. **No lo subas a Google Drive** — sería
guardar la llave adentro de la caja fuerte que abre.

---

## Parte 6 — Conectarlo a los respaldos

El script ya está preparado: solo hay que decirle a dónde subir.

```bash
echo "" >> /root/rc-tractoparts/.env
echo "# Destino remoto de los respaldos (rclone). Ver docs/respaldos.md" >> /root/rc-tractoparts/.env
echo "RCLONE_REMOTE=respaldos:rc-tractoparts" >> /root/rc-tractoparts/.env
```

**Qué hace:** agrega tres líneas al final del `.env`. La primera es una línea en
blanco, la segunda un comentario, y la tercera la variable. No modifica ninguna
línea existente.

**Verificá:**

```bash
tail -3 /root/rc-tractoparts/.env
```

**Probalo de verdad:**

```bash
/root/rc-tractoparts/scripts/backup-db.sh
```

Ahora el log tiene que decir `Copiado a respaldos:rc-tractoparts` en lugar del
aviso de siempre.

**Confirmá que llegó:**

```bash
rclone ls respaldos:rc-tractoparts
```

Tiene que listar el `.sql.gz`. Y si entrás a Google Drive desde el navegador vas
a ver nombres ilegibles — eso significa que el cifrado está funcionando.

**Y los archivos:**

```bash
/root/rc-tractoparts/scripts/backup-files.sh
```

La primera subida son 428 MB y puede tardar varios minutos. Las siguientes solo
mandan lo que cambió.

---

## Parte 7 — Probar que se puede restaurar

Un respaldo que nunca restauraste es una hipótesis, no un respaldo.

```bash
/root/rc-tractoparts/scripts/backup-db.sh --verify
```

**Qué hace:** además del respaldo normal, lo restaura en una base **temporal** y
verifica que quedó completa. **No toca la base de producción.**

Esto es lo que el cron corre los domingos a las 4. Conviene verlo funcionar una
vez a mano para saber cómo se ve cuando sale bien.

### El simulacro completo

Una vez, con tiempo y sin apuro, probá bajar un respaldo desde Google y
restaurarlo. Es la única forma de saber que la cadena entera funciona:

```bash
# Traer el respaldo desde Drive, descifrándolo al pasar
rclone copy respaldos:rc-tractoparts/rc_tractoparts_2026-08-13_0300.sql.gz /tmp/

# Ver qué haría, sin tocar nada
/root/rc-tractoparts/scripts/restore-db.sh /tmp/rc_tractoparts_2026-08-13_0300.sql.gz --dry-run
```

`restore-db.sh` sin `--dry-run` pide escribir **RESTAURAR** en mayúsculas para
confirmar. Esa confirmación existe porque una restauración **reemplaza la base
actual**.

---

## Parte 8 — Limpieza pendiente

Hay cinco volcados manuales viejos sueltos en el directorio del código:

```
backup-2026-07-17.sql
backup-2026-07-23-gastos.sql
backup-2026-07-23.sql
backup_pre_fechaconfirm_2026-07-11.sql
backup_rc_prod.sql
```

Están sin comprimir, en la carpeta del repositorio, con datos de clientes en
texto plano, y a un `git clean -fd` de desaparecer. Una vez que confirmes que los
automáticos funcionan:

```bash
mkdir -p /var/backups/rc-tractoparts/manuales-viejos
mv /root/rc-tractoparts/backup*.sql /var/backups/rc-tractoparts/manuales-viejos/
chmod 600 /var/backups/rc-tractoparts/manuales-viejos/*.sql
ls -lh /var/backups/rc-tractoparts/manuales-viejos/
```

**Qué hace:** los mueve fuera del repositorio a un lugar con permisos correctos.
No los borra — si alguno tiene algo que hace falta, sigue estando.

---

## Mantenimiento

**Una vez por mes**, tres comandos:

```bash
ls -lh /var/backups/rc-tractoparts/          # ¿hay uno de anoche?
tail -20 /var/backups/rc-tractoparts/backup.log   # ¿algún error?
rclone ls respaldos:rc-tractoparts | tail -5      # ¿están llegando a Drive?
```

**Una vez por año:** el simulacro de restauración completo de la Parte 7.

### Dónde queda cada cosa

| Qué | Dónde |
|---|---|
| Respaldos locales | `/var/backups/rc-tractoparts/` |
| Espejo de archivos | `/var/backups/rc-tractoparts/archivos/` |
| Registro de lo que pasó | `/var/backups/rc-tractoparts/backup.log` |
| Horarios | `/etc/cron.d/rc-tractoparts-backup` |
| Configuración de rclone | `/root/.config/rclone/rclone.conf` |
| Copia remota | Google Drive de `backupsrctractoparts@gmail.com`, cifrada |

### Lo que tiene que estar en el gestor de contraseñas

1. La clave de `backupsrctractoparts@gmail.com`
2. Los códigos de respaldo de su verificación en dos pasos
3. **Las dos contraseñas del cifrado de rclone**
4. Una copia de `/root/.config/rclone/rclone.conf`

Sin el punto 3, los respaldos remotos no se pueden abrir. Nunca.
