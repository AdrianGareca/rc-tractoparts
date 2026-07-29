#!/usr/bin/env bash
# =============================================================================
# scripts/backup-db.sh
# Respaldo diario de la base de datos MySQL de RC Tractoparts.
#
# Qué hace:
#   1. Vuelca la base con mysqldump DESDE DENTRO del contenedor (la BD no está
#      publicada al host, así que no se puede conectar de afuera).
#   2. Comprime con gzip.
#   3. Verifica que el archivo no esté vacío ni truncado ANTES de rotar.
#   4. Borra los respaldos más viejos que RETENTION_DAYS.
#   5. Opcional: copia el respaldo fuera del servidor con rclone.
#
# Uso:
#   ./scripts/backup-db.sh              # respaldo normal
#   ./scripts/backup-db.sh --verify     # además, prueba restaurarlo en una BD temporal
#
# Se ejecuta desde cron (ver scripts/install-backup-cron.sh).
# =============================================================================

set -euo pipefail

# ── Configuración ────────────────────────────────────────────────────────────
# Directorio del proyecto (donde vive docker-compose.yml y el .env).
PROJECT_DIR="${PROJECT_DIR:-/opt/rc-tractoparts}"

# Dónde se guardan los respaldos. Fuera del repo, para que un `git clean` no
# se los lleve por delante.
BACKUP_DIR="${BACKUP_DIR:-/var/backups/rc-tractoparts}"

# Cuántos días conservar. 14 días con la base de esta escala son unos pocos
# cientos de MB: barato frente a perder una semana de cotizaciones.
RETENTION_DAYS="${RETENTION_DAYS:-14}"

# Nombre del contenedor de MySQL (docker-compose.yml → container_name).
DB_CONTAINER="${DB_CONTAINER:-rc_tractoparts_db}"

# Destino remoto de rclone (ej. "gdrive:rc-tractoparts/backups").
# Si queda vacío, el respaldo se guarda SOLO en el disco local.
RCLONE_REMOTE="${RCLONE_REMOTE:-}"

LOG_FILE="${LOG_FILE:-$BACKUP_DIR/backup.log}"

# ── Utilidades ───────────────────────────────────────────────────────────────
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

fallar() {
  log "ERROR: $*"
  exit 1
}

# ── Preparación ──────────────────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"

cd "$PROJECT_DIR" || fallar "No existe PROJECT_DIR=$PROJECT_DIR"

# Las credenciales se leen del .env del proyecto: no se duplican acá.
[ -f .env ] || fallar "No se encontró $PROJECT_DIR/.env"
# shellcheck disable=SC1091
set -a; source .env; set +a

: "${DB_NAME:?DB_NAME no está definida en .env}"
: "${DB_ROOT_PASSWORD:?DB_ROOT_PASSWORD no está definida en .env}"

# El contenedor tiene que estar corriendo.
docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER" \
  || fallar "El contenedor '$DB_CONTAINER' no está corriendo"

FECHA="$(date '+%Y-%m-%d_%H%M')"
ARCHIVO="$BACKUP_DIR/${DB_NAME}_${FECHA}.sql.gz"
TEMPORAL="${ARCHIVO}.parcial"

# ── Volcado ──────────────────────────────────────────────────────────────────
# Notas sobre las banderas:
#   --single-transaction : consistencia sin bloquear escrituras (InnoDB). Sin
#                          esto, el respaldo traba la app mientras corre.
#   --routines --triggers --events : sin esto se pierden procedimientos,
#                          triggers y eventos programados; el esquema volvería
#                          incompleto y el error recién se vería al restaurar.
#   --quick              : no carga la tabla entera en memoria.
#   --set-gtid-purged=OFF: evita sentencias GTID que ensucian la restauración
#                          en un servidor distinto.
#
# MYSQL_PWD se pasa por entorno en vez de -p"$PASS": un password en la línea de
# comandos queda visible en `ps aux` para cualquier usuario del sistema.
log "Iniciando respaldo de '$DB_NAME'…"

if ! docker exec -e MYSQL_PWD="$DB_ROOT_PASSWORD" "$DB_CONTAINER" \
      mysqldump \
        --user=root \
        --single-transaction \
        --routines --triggers --events \
        --quick \
        --set-gtid-purged=OFF \
        --default-character-set=utf8mb4 \
        "$DB_NAME" 2>>"$LOG_FILE" | gzip -9 > "$TEMPORAL"; then
  rm -f "$TEMPORAL"
  fallar "mysqldump falló — se conserva el respaldo anterior"
fi

# ── Verificación ─────────────────────────────────────────────────────────────
# Un respaldo que no se verifica no es un respaldo: es un archivo. Estas tres
# comprobaciones detectan el caso clásico de un dump truncado que pasa
# inadvertido durante meses.

# 1. El gzip está íntegro.
gzip -t "$TEMPORAL" 2>/dev/null || { rm -f "$TEMPORAL"; fallar "El archivo comprimido está corrupto"; }

# 2. Tiene un tamaño razonable (un dump vacío pesa ~1 KB).
TAMANO=$(stat -c%s "$TEMPORAL" 2>/dev/null || stat -f%z "$TEMPORAL")
[ "$TAMANO" -gt 10240 ] || { rm -f "$TEMPORAL"; fallar "El respaldo pesa solo ${TAMANO} bytes: sospechoso"; }

# 3. mysqldump cierra siempre con esta línea. Si falta, el volcado se cortó.
zcat "$TEMPORAL" | tail -5 | grep -q "Dump completed" \
  || { rm -f "$TEMPORAL"; fallar "El volcado está truncado (falta la marca 'Dump completed')"; }

mv "$TEMPORAL" "$ARCHIVO"
log "Respaldo OK: $(basename "$ARCHIVO") ($(du -h "$ARCHIVO" | cut -f1))"

# ── Copia fuera del servidor ─────────────────────────────────────────────────
# Un respaldo en el mismo disco que la base NO protege del caso más probable:
# que el disco o el droplet entero se pierdan.
if [ -n "$RCLONE_REMOTE" ]; then
  if command -v rclone >/dev/null 2>&1; then
    if rclone copy "$ARCHIVO" "$RCLONE_REMOTE" --log-file="$LOG_FILE" --log-level INFO; then
      log "Copiado a $RCLONE_REMOTE"
    else
      # No se aborta: el respaldo local existe y es mejor que nada.
      log "AVISO: falló la copia remota. El respaldo local quedó guardado."
    fi
  else
    log "AVISO: RCLONE_REMOTE está configurado pero rclone no está instalado."
  fi
else
  log "AVISO: sin RCLONE_REMOTE — el respaldo queda SOLO en este disco."
fi

# ── Rotación ─────────────────────────────────────────────────────────────────
# Se borra DESPUÉS de confirmar que el nuevo respaldo es válido, nunca antes.
BORRADOS=$(find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -type f -mtime "+$RETENTION_DAYS" -print -delete | wc -l)
[ "$BORRADOS" -gt 0 ] && log "Rotación: $BORRADOS respaldo(s) de más de $RETENTION_DAYS días eliminados."

TOTAL=$(find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -type f | wc -l)
log "Listo. $TOTAL respaldo(s) en $BACKUP_DIR ($(du -sh "$BACKUP_DIR" | cut -f1))."

# ── Verificación profunda (opcional) ─────────────────────────────────────────
# Restaura el respaldo en una base descartable y cuenta las tablas. Es la única
# prueba real de que el archivo sirve. Pesada: conviene una vez por semana, no
# todos los días.
if [ "${1:-}" = "--verify" ]; then
  BD_PRUEBA="restore_check_$$"
  log "Verificando restauración en '$BD_PRUEBA'…"

  docker exec -e MYSQL_PWD="$DB_ROOT_PASSWORD" "$DB_CONTAINER" \
    mysql --user=root -e "DROP DATABASE IF EXISTS \`$BD_PRUEBA\`; CREATE DATABASE \`$BD_PRUEBA\`;"

  if zcat "$ARCHIVO" | docker exec -i -e MYSQL_PWD="$DB_ROOT_PASSWORD" "$DB_CONTAINER" \
       mysql --user=root "$BD_PRUEBA" 2>>"$LOG_FILE"; then
    TABLAS=$(docker exec -e MYSQL_PWD="$DB_ROOT_PASSWORD" "$DB_CONTAINER" \
      mysql --user=root -N -B -e \
      "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$BD_PRUEBA';")
    log "Restauración verificada: $TABLAS tabla(s) recreadas."
    [ "$TABLAS" -ge 10 ] || log "AVISO: se esperaban ~18 tablas y se recrearon $TABLAS."
  else
    log "ERROR: el respaldo NO se pudo restaurar."
  fi

  docker exec -e MYSQL_PWD="$DB_ROOT_PASSWORD" "$DB_CONTAINER" \
    mysql --user=root -e "DROP DATABASE IF EXISTS \`$BD_PRUEBA\`;"
fi
