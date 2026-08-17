#!/usr/bin/env bash
# =============================================================================
# scripts/backup-files.sh
# Respaldo de los archivos físicos: PDFs generados y adjuntos de los usuarios.
#
# POR QUÉ VA APARTE DE LA BASE:
# La base y los archivos se pierden distinto. Un mysqldump corre en segundos y
# se puede hacer todos los días sin costo; los archivos crecen sin techo y
# volcarlos enteros cada día desperdicia disco y ancho de banda. Acá se usa
# rsync incremental: sólo viaja lo que cambió.
#
# QUÉ RESPALDA (volúmenes Docker declarados en docker-compose.yml):
#   app_uploads  → /app/uploads   — PDFs de proformas generados por el sistema
#   app_storage  → /app/storage   — Excels y documentos de licitaciones subidos
#
# CONSISTENCIA: no se detiene la app. Un archivo que se esté escribiendo justo
# en ese instante puede quedar a medias en el respaldo, pero eso afecta a lo
# sumo a un PDF regenerable, no a un dato irrecuperable. Parar la aplicación
# para copiar archivos sería un costo mucho mayor que el riesgo.
# =============================================================================

set -euo pipefail

# Se autodetecta desde la ubicacion de ESTE script (…/proyecto/scripts/x.sh),
# en vez de una ruta fija: el proyecto puede estar en /opt, en /root o donde sea,
# y una ruta equivocada haria que el cron falle todas las noches en silencio.
PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/rc-tractoparts}"
ESPEJO_DIR="${ESPEJO_DIR:-$BACKUP_DIR/archivos}"
APP_CONTAINER="${APP_CONTAINER:-rc_tractoparts_app}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"
LOG_FILE="${LOG_FILE:-$BACKUP_DIR/backup.log}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [archivos] $*" | tee -a "$LOG_FILE"; }

mkdir -p "$ESPEJO_DIR"
cd "$PROJECT_DIR" || { log "ERROR: no existe $PROJECT_DIR"; exit 1; }

# ── Se lee el .env, igual que backup-db.sh ───────────────────────────────────
# ESTO FALTABA, Y EL EFECTO ERA GRAVE.
#
# RCLONE_REMOTE se define en el .env del proyecto. backup-db.sh lo lee; este
# script no lo hacia, asi que la variable llegaba SIEMPRE vacia y el bloque de
# subida de mas abajo se salteaba entero.
#
# Consecuencia: la base de datos viajaba a Drive todas las noches y los archivos
# —los PDF de proforma y los documentos de licitacion, casi 500 MB— se quedaban
# solo en el disco del servidor. Justo la mitad que NO se puede regenerar: una
# base se vuelve a volcar, un PDF que subio alguien no vuelve.
#
# Y era invisible: el `if` de abajo no tenia `else`, asi que no se registraba
# ningun aviso. El log decia "Respaldo de archivos completo" y era cierto — el
# espejo local estaba hecho— pero nada indicaba que no habia salido del servidor.
#
# El `|| true` deja que el script siga si no hay .env: el espejo local es util
# igual, y frenar por no poder subir seria peor que subir a medias.
if [ -f .env ]; then
  set -a; source .env; set +a
  RCLONE_REMOTE="${RCLONE_REMOTE:-}"
fi

docker ps --format '{{.Names}}' | grep -qx "$APP_CONTAINER" || {
  log "ERROR: el contenedor '$APP_CONTAINER' no está corriendo"; exit 1;
}

# ── Espejo local ─────────────────────────────────────────────────────────────
# `docker cp` saca los archivos del volumen sin necesidad de conocer la ruta
# interna de Docker en el host (que cambia entre versiones).
for CARPETA in uploads storage; do
  DESTINO="$ESPEJO_DIR/$CARPETA"
  mkdir -p "$DESTINO"

  TEMP="$(mktemp -d)"
  if docker cp "$APP_CONTAINER:/app/$CARPETA/." "$TEMP/" 2>>"$LOG_FILE"; then
    # --delete mantiene el espejo fiel: si un archivo se borró en la app,
    # también se va del espejo. El histórico lo cubre la copia remota.
    rsync -a --delete "$TEMP/" "$DESTINO/"
    CANT=$(find "$DESTINO" -type f | wc -l)
    log "$CARPETA: $CANT archivo(s), $(du -sh "$DESTINO" | cut -f1)"
  else
    log "AVISO: no se pudo copiar /app/$CARPETA"
  fi
  rm -rf "$TEMP"
done

# ── Copia fuera del servidor ─────────────────────────────────────────────────
if [ -n "$RCLONE_REMOTE" ] && command -v rclone >/dev/null 2>&1; then
  # `sync` (no `copy`) para que el remoto refleje el estado actual.
  if rclone sync "$ESPEJO_DIR" "$RCLONE_REMOTE/archivos" \
       --log-file="$LOG_FILE" --log-level INFO; then
    log "Sincronizado con $RCLONE_REMOTE/archivos"
  else
    log "AVISO: falló la sincronización remota; el espejo local quedó actualizado."
  fi
# ── Los dos silencios que este script tenia ──────────────────────────────────
# Antes este `if` no tenia ninguna rama alternativa: si no habia destino remoto,
# o si rclone no estaba instalado, el script no decia NADA y terminaba con
# "Respaldo de archivos completo" — que era cierto a medias y sonaba a que todo
# estaba cubierto.
#
# El respaldo de la base ya avisaba en ese caso; este no. Mismo problema, y era
# el unico de los dos que uno no podia notar leyendo el log.
elif [ -z "$RCLONE_REMOTE" ]; then
  log "AVISO: sin RCLONE_REMOTE — los archivos quedan SOLO en este disco."
else
  log "AVISO: RCLONE_REMOTE está configurado pero rclone no está instalado."
fi

log "Respaldo de archivos completo."
