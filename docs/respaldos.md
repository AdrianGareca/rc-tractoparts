# Respaldos

Cómo se respalda RC Tractoparts, cómo se restaura, y cómo se deja funcionando
solo. Está escrito para seguirlo de arriba abajo pegando los comandos.

## Estado

**Al 17 de agosto de 2026 el sistema está completo y funcionando:**

| | |
|---|---|
| Respaldo de la base | diario, 03:00 |
| Respaldo de archivos | diario, 03:30 |
| Verificación de restauración | domingos, 04:00 |
| Copia fuera del servidor | Google Drive, cifrada |
| Credenciales | propias, permiso `drive.file` |

La primera verificación automática corrió el domingo 16 de agosto: restauró el
respaldo en una base temporal y confirmó las 20 tablas. Eso es lo que separa
«tener archivos» de «poder recuperar».

### Lo que se encontró al ponerlo en marcha

Dos cosas que el procedimiento original daba por buenas y no lo eran. Quedan
anotadas porque las dos habrían fallado en silencio:

**1. `backup-files.sh` no leía el `.env`.** `backup-db.sh` sí, así que la base
viajaba a Drive todas las noches y los archivos —casi 500 MB de PDF de proforma
y documentos de licitación— se quedaban solo en el disco del servidor. Justo la
mitad que NO se puede regenerar. Y era invisible: el bloque de subida se salteaba
sin registrar ningún aviso, y el log terminaba diciendo «Respaldo de archivos
completo», que era cierto a medias porque el espejo local sí estaba hecho.
Corregido: los dos scripts leen el `.env` y los dos avisan si no hay destino.

**2. El `client_id` compartido de rclone se retira durante 2026.** Lo avisa
rclone 1.75 al configurar; la versión 1.60 que trae Ubuntu no dice nada. Usarlo
habría hecho que los respaldos dejaran de subir en algún momento de este año,
sin aviso. Por eso la Parte 4 crea credenciales propias.

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

## Parte 3 — Crear credenciales propias de Google

**No uses el `client_id` compartido de rclone.** Se retira durante 2026: los
respaldos dejarían de subir en algún momento del año, sin avisar. La versión de
rclone que trae Ubuntu (1.60) ni siquiera lo menciona.

Todo esto en el navegador, con la sesión de la cuenta de respaldos.

1. Entrá a **https://console.cloud.google.com/** y aceptá los términos.
2. Creá un proyecto: `Respaldos RC Tractoparts`.
3. **Habilitá la API.** ☰ → *APIs & Services* → *Library* → buscá
   `Google Drive API` → **Enable**. Sin esto rclone se autentica pero no puede
   escribir, y el error no menciona la API por ningún lado.
4. **Configurá el consentimiento.** ☰ → *Google Auth Platform* → **Get started**.
   - *App name*: `Respaldos RC Tractoparts`
   - *User support email* y *contacto*: la cuenta de respaldos
   - *Audience*: **External**
5. **Publicalo.** En *Audience*, botón **Publish app**. Tiene que quedar en
   **In production**.

   Si queda en *Testing*, Google caduca el permiso **cada 7 días** y los
   respaldos dejan de subir todas las semanas.
6. **Creá el cliente.** *Clients* → **Create client** → *Application type*:
   **Desktop app** → nombre `rclone` → **Create**.

Copiá el **Client ID** y el **Client secret** al gestor de contraseñas. El
secret no se puede volver a ver después de cerrar esa ventana.

---

## Parte 4 — Configurar rclone

**Se hace entero en una máquina con navegador (Windows), y después se copia el
archivo al servidor.** Es más simple que autorizar en el servidor, y evita tener
que mover el token a mano — que es donde es fácil que se filtre.

Instalá rclone en Windows y **reiniciá la terminal**:

```powershell
winget install Rclone.Rclone
```

Después:

```powershell
rclone config
```

### El remoto de Drive

| Pregunta | Respuesta |
|---|---|
| `n/s/q>` | `n` |
| `name>` | `gdrive` |
| `Storage>` | `drive` |
| `client_id>` | el Client ID de la Parte 3 |
| `client_secret>` | el Client secret |
| `scope>` | `3` |
| `service_account_file>` | *(Enter)* |
| `Edit advanced config?` | `n` |
| `Use auto config?` | `y` |
| `Configure this as a Shared Drive?` | `n` |
| `y/e/d>` | `y` |

**Por qué `scope` 3 (`drive.file`):** rclone solo ve y toca los archivos que él
mismo creó. Es exactamente lo que hace un respaldo, acota el daño si la cuenta
se compromete por otro lado, y Google no lo considera un permiso «sensible» —
así que publicar la app no requiere ningún trámite de verificación.

Se abre el navegador solo. Iniciá sesión con la cuenta de respaldos y aceptá.

### El cifrado, encadenado sobre el anterior

**Sin salir del menú**, en el mismo `rclone config`:

| Pregunta | Respuesta |
|---|---|
| `e/n/d/r/c/s/q>` | `n` |
| `name>` | `respaldos` |
| `Storage>` | `crypt` |
| `remote>` | `gdrive:rc-tractoparts` |
| `filename_encryption>` | **Enter** (default `standard`) |
| `directory_name_encryption>` | **Enter** (default `true`) |
| `y/g>` | **`y`** — escribí la tuya |
| `Enter the password:` | pegala *(no se ve nada, es normal)* |
| `Confirm the password:` | otra vez |
| `y/g/n>` (salt) | **`y`** |
| `Enter the password:` | la segunda, distinta |
| `Confirm the password:` | otra vez |
| `Edit advanced config?` | `n` |
| `y/e/d>` | `y` |
| `e/n/d/r/c/s/q>` | `q` |

**Elegí `y` y no `g`.** Con `y` rclone pide la contraseña en modo oculto y no
aparece en pantalla; con `g` la imprime, y una contraseña impresa en una terminal
termina en capturas, en registros y en conversaciones. Generá las dos en el
gestor de contraseñas antes de empezar y pegalas a ciegas.

En `filename_encryption` apretá **Enter** en lugar de escribir el número: un
valor mal tipeado se guarda como texto literal y el remoto falla al usarlo.

### Esto es lo más importante de todo el documento

Esas dos contraseñas son las que descifran los respaldos. Guardalas en el gestor
de contraseñas junto a la clave de la cuenta.

Si las perdés **y** perdés el servidor, los respaldos quedan ilegibles para
siempre. No hay recuperación: ese es exactamente el punto del cifrado.

---

## Parte 5 — Pasar la configuración al servidor

En Windows:

```powershell
ssh root@EL_SERVIDOR "mkdir -p /root/.config/rclone"
scp "$env:APPDATAcloneclone.conf" root@EL_SERVIDOR:/root/.config/rclone/rclone.conf
```

En el servidor:

```bash
chmod 600 /root/.config/rclone/rclone.conf
rclone listremotes
rclone lsd gdrive:
echo prueba > /tmp/prueba.txt
rclone copy /tmp/prueba.txt respaldos:
rclone ls respaldos:
```

`chmod 600` deja el archivo legible solo por root: adentro están las llaves de
Drive y del cifrado.

El último comando tiene que devolver `prueba.txt`. Esa es **la prueba de la
cadena entera**: cifró, subió a Drive con credenciales propias, y lo volvió a
leer descifrado.

Guardá también una copia de `rclone.conf` en el gestor de contraseñas. Si mañana
hay que rearmar el servidor desde cero, con ese archivo se recupera todo.
**No lo subas a Drive** — sería guardar la llave adentro de la caja fuerte.

---

## Parte 6 — Conectarlo a los respaldos

```bash
echo "" >> /root/rc-tractoparts/.env
echo "# Destino remoto de los respaldos (rclone). Ver docs/respaldos.md" >> /root/rc-tractoparts/.env
echo "RCLONE_REMOTE=respaldos:rc-tractoparts" >> /root/rc-tractoparts/.env
tail -3 /root/rc-tractoparts/.env
```

Probalo de verdad:

```bash
/root/rc-tractoparts/scripts/backup-db.sh
rclone delete respaldos:prueba.txt
nohup /root/rc-tractoparts/scripts/backup-files.sh >/dev/null 2>&1 &
tail -f /var/backups/rc-tractoparts/backup.log
```

El respaldo de archivos son unos 500 MB la primera vez y tarda un par de
minutos; por eso va en segundo plano con `nohup`, así una caída del SSH no lo
corta. `Ctrl+C` sale del seguimiento sin detener la subida.

**Las dos líneas que confirman que salió del servidor:**

```
[...] Copiado a respaldos:rc-tractoparts
[...] [archivos] Sincronizado con respaldos:rc-tractoparts/archivos
```

**Si falta la segunda, los archivos NO subieron.** Ese fue el bug que apareció
al poner esto en marcha, y no daba error de ninguna clase.

Y el recuento final:

```bash
rclone ls respaldos:rc-tractoparts/archivos | wc -l
rclone size respaldos:rc-tractoparts
```

En Drive vas a ver nombres ilegibles. Eso es el cifrado funcionando: Google
guarda los bytes pero no puede leer ni cómo se llaman los archivos.

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
