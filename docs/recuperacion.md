# Plan de recuperación ante desastre

Qué hacer si el droplet de producción desaparece — se rompe, DigitalOcean tiene
un problema, se borra por error. No repite lo que ya está documentado en otro
lado: junta en un solo checklist, en el orden correcto, lo que ya existe
repartido entre el README y `docs/respaldos.md`, para no tener que buscarlo
bajo presión.

**Tiempo estimado:** 30-45 minutos si tenés a mano las credenciales del gestor
de contraseñas. La mayor parte es esperar que Docker instale y que DNS
propague.

**Qué se pierde en el peor caso:** como mucho, las últimas 24 horas de
cotizaciones/licitaciones (el backup corre todas las noches a las 03:00). Los
archivos (PDFs/Excels) se sincronizan a las 03:30, así que el mismo margen
aplica ahí.

---

## Antes de empezar — lo que necesitás tener a mano

Todo esto tiene que estar en tu gestor de contraseñas (ver la lista completa
al final de `docs/respaldos.md`):

- [ ] La contraseña de `backupsrctractoparts@gmail.com`
- [ ] Una copia de `/root/.config/rclone/rclone.conf`
- [ ] Las dos contraseñas del cifrado de rclone (sin esto, los backups son
      ilegibles para siempre — no hay atajo)
- [ ] El `.env` de producción, o al menos las contraseñas/secretos que
      contiene (`DB_PASSWORD`, `DB_ROOT_PASSWORD`, `JWT_SECRET`,
      `SEED_*_PASSWORD`)
- [ ] Acceso al panel de DigitalOcean (para crear el droplet nuevo)
- [ ] Acceso al panel de tu registrador de dominio o de Cloudflare (para
      apuntar el dominio al droplet nuevo)

---

## Los pasos, en orden

### 1. Crear el droplet nuevo

Seguí **README.es.md §16.1 "Aprovisionar el Droplet"** — Ubuntu 22.04, firewall
(`ufw`), Docker + Nginx + Certbot. Es exactamente lo mismo que se hizo la
primera vez.

### 2. Apuntar el dominio al droplet nuevo

El droplet nuevo va a tener una IP distinta. Actualizá el registro `A` de
`rctractoparts.org` (en Cloudflare si ya está migrado, o en tu registrador si
no) para que apunte a la IP nueva. Puede tardar unos minutos en propagar.

### 3. Traer el código

```bash
git clone https://github.com/AdrianGareca/rc-tractoparts.git /root/rc-tractoparts
cd /root/rc-tractoparts
cp .env.example .env
```

Completá `.env` con los valores reales que tenías guardados (Antes de
empezar, arriba). **No inventes contraseñas nuevas para `DB_PASSWORD`/
`DB_ROOT_PASSWORD`** en este paso — tienen que ser las mismas que ya usaba la
base vieja, si no el contenedor de MySQL arranca con una base distinta.

### 4. Restaurar la configuración de rclone (necesaria para bajar los backups)

```bash
mkdir -p /root/.config/rclone
# Copiá tu rclone.conf guardado a esa ruta, o repetí docs/respaldos.md Parte 5
chmod 600 /root/.config/rclone/rclone.conf
rclone lsd gdrive:
```

Si el último comando lista tus carpetas de Drive, la configuración es correcta.

### 5. Levantar el stack VACÍO primero

```bash
docker compose up -d --build
```

Esto crea el contenedor de MySQL con una base **nueva y vacía** (via
`sql/init.sql`) — está bien, la vamos a reemplazar en el paso siguiente. No
uses la app todavía.

### 6. Restaurar la base de datos desde el último backup

```bash
# Traer el respaldo más reciente desde Drive (se descifra al bajar)
rclone lsl respaldos:rc-tractoparts | sort | tail -5   # confirmá cuál es el más nuevo
rclone copy respaldos:rc-tractoparts/<nombre_del_archivo>.sql.gz /tmp/

# Restaurar de verdad (pide escribir RESTAURAR para confirmar)
/root/rc-tractoparts/scripts/restore-db.sh /tmp/<nombre_del_archivo>.sql.gz
```

Ver `docs/respaldos.md` Parte 7 si hace falta el detalle completo de este paso.

### 7. Restaurar los archivos (PDFs y Excels)

```bash
rclone sync respaldos:rc-tractoparts/archivos /tmp/archivos-restaurados
docker cp /tmp/archivos-restaurados/uploads/. rc_tractoparts_app:/app/uploads/
docker cp /tmp/archivos-restaurados/storage/. rc_tractoparts_app:/app/storage/
```

### 8. Configurar Nginx + HTTPS

La configuración está respaldada en **`deploy/nginx/`**, así que no hay que
rearmarla de memoria:

```bash
scp deploy/nginx/nginx.conf          root@<IP>:/etc/nginx/nginx.conf
scp deploy/nginx/rctractoparts.conf  root@<IP>:/etc/nginx/sites-available/rctractoparts
ln -sf /etc/nginx/sites-available/rctractoparts /etc/nginx/sites-enabled/rctractoparts
nginx -t                 # comprobar la sintaxis ANTES de recargar
systemctl reload nginx
certbot --nginx -d rctractoparts.org -d www.rctractoparts.org
```

**Copiá los DOS archivos, no sólo el del sitio.** `nginx.conf` lleva
`client_max_body_size 15M`; sin esa línea Nginx vuelve a su valor por defecto
de 1 MB y deja de aceptar casi cualquier PDF — con un `413` que la aplicación
nunca ve ni registra, así que el error parece salido de la nada.

`certbot` genera un certificado nuevo (el viejo quedó en el droplet que ya no
existe) y deja instalada la renovación automática. Ver `deploy/nginx/README.md`
para el detalle, y **README.es.md §16.3 y §16.4** para el contexto original.

### 9. Reinstalar los backups automáticos

```bash
PROJECT_DIR=/root/rc-tractoparts bash /root/rc-tractoparts/scripts/install-backup-cron.sh
echo "RCLONE_REMOTE=respaldos:rc-tractoparts" >> /root/rc-tractoparts/.env
```

Sin este paso, el droplet nuevo no tiene ningún respaldo programado — quedarías
exactamente en la misma situación que causó este problema.

### 10. Verificar que todo funciona

- [ ] Entrar a `https://rctractoparts.org` y loguearse con una cuenta real.
- [ ] Ver que las cotizaciones/clientes/licitaciones viejas están ahí.
- [ ] Abrir el PDF de una cotización vieja — confirma que los archivos
      restauraron bien, no solo la base.
- [ ] Correr `docker compose logs -f app` un minuto y confirmar que no tira
      errores.
- [ ] Anotar la fecha y avisar al equipo (Jefe, ejecutivos) que el sistema
      está de vuelta.

---

## Si el problema NO es que el droplet murió, sino algo más chico

- **Se cayó la aplicación pero el droplet sigue vivo:** `docker compose up -d
  --build` alcanza, no hace falta nada de esta guía.
- **Alguien borró una cotización/cliente por error:** no restaures la base
  entera — se perdería todo lo cargado después del backup. Restaurá el
  backup en una base TEMPORAL (`restore-db.sh <archivo> --dry-run`, ver
  `docs/respaldos.md`) y copiá a mano solo el registro que hace falta.
- **Se corrompió un PDF/Excel puntual pero la base está bien:** el archivo
  puede estar en el espejo (`docs/respaldos.md` — pero recordá que es un
  espejo, no un historial: si se borró hace más de un día y el espejo ya
  corrió esa noche, no está ahí).
