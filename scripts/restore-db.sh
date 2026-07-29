#!/usr/bin/env bash
# =============================================================================
# scripts/restore-db.sh
# Restaura la base desde un respaldo de backup-db.sh.
#
# Existe porque un respaldo que nadie sabe restaurar bajo presión no sirve. El
# día que haga falta, va a ser un mal día: el procedimiento tiene que estar
# escrito y probado, no improvisarse.
#
# Uso:
#   ./scripts/restore-db.sh /var/backups/rc-tractoparts/rc_tractoparts_2026-07-28_0300.sql.gz
#   ./scripts/restore-db.sh <archivo> --dry-run   # restaura en una BD de prueba
#
# ⚠️  SIN --dry-run ESTO REEMPLAZA LA BASE DE PRODUCCIÓN.
# =============================================================================

set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/rc-tractoparts}"
DB_CONTAINER="${DB_CONTAINER:-rc_tractoparts_db}"
APP_CONTAINER="${APP_CONTAINER:-rc_tractoparts_app}"

ARCHIVO="${1:-}"
MODO="${2:-}"

[ -n "$ARCHIVO" ] || { echo "Uso: $0 <archivo.sql.gz> [--dry-run]"; exit 1; }
[ -f "$ARCHIVO" ] || { echo "No existe el archivo: $ARCHIVO"; exit 1; }

cd "$PROJECT_DIR"
# shellcheck disable=SC1091
set -a; source .env; set +a
: "${DB_NAME:?}"; : "${DB_ROOT_PASSWORD:?}"

# Integridad antes de tocar nada.
gzip -t "$ARCHIVO" || { echo "El archivo está corrupto."; exit 1; }
zcat "$ARCHIVO" | tail -5 | grep -q "Dump completed" \
  || { echo "El respaldo está truncado."; exit 1; }

if [ "$MODO" = "--dry-run" ]; then
  DESTINO="restore_dryrun_$$"
  echo "Restaurando en la base de prueba '$DESTINO' (producción NO se toca)…"
else
  DESTINO="$DB_NAME"
  echo "════════════════════════════════════════════════════════════════"
  echo "  Vas a REEMPLAZAR la base de PRODUCCIÓN '$DB_NAME'"
  echo "  con: $(basename "$ARCHIVO")"
  echo "  Fecha del respaldo: $(date -r "$ARCHIVO" '+%Y-%m-%d %H:%M' 2>/dev/null || echo desconocida)"
  echo "════════════════════════════════════════════════════════════════"
  read -r -p "Escribí RESTAURAR para confirmar: " CONFIRMACION
  [ "$CONFIRMACION" = "RESTAURAR" ] || { echo "Cancelado."; exit 1; }

  # Red de seguridad: se respalda el estado ACTUAL antes de pisarlo. Si el
  # respaldo elegido resulta ser el equivocado, todavía hay vuelta atrás.
  echo "Respaldando el estado actual antes de sobrescribir…"
  PREVIO="/var/backups/rc-tractoparts/PRE-RESTORE_$(date '+%Y-%m-%d_%H%M').sql.gz"
  mkdir -p "$(dirname "$PREVIO")"
  docker exec -e MYSQL_PWD="$DB_ROOT_PASSWORD" "$DB_CONTAINER" \
    mysqldump --user=root --single-transaction --routines --triggers --events \
    "$DB_NAME" | gzip -9 > "$PREVIO"
  echo "Estado previo guardado en: $PREVIO"

  # La app se detiene para que no escriba a mitad de la restauración.
  echo "Deteniendo la aplicación…"
  docker stop "$APP_CONTAINER" >/dev/null
fi

docker exec -e MYSQL_PWD="$DB_ROOT_PASSWORD" "$DB_CONTAINER" \
  mysql --user=root -e "DROP DATABASE IF EXISTS \`$DESTINO\`; CREATE DATABASE \`$DESTINO\` CHARACTER SET utf8mb4;"

echo "Restaurando…"
zcat "$ARCHIVO" | docker exec -i -e MYSQL_PWD="$DB_ROOT_PASSWORD" "$DB_CONTAINER" \
  mysql --user=root "$DESTINO"

TABLAS=$(docker exec -e MYSQL_PWD="$DB_ROOT_PASSWORD" "$DB_CONTAINER" \
  mysql --user=root -N -B -e \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DESTINO';")
echo "Restauradas $TABLAS tabla(s) en '$DESTINO'."

if [ "$MODO" = "--dry-run" ]; then
  COTIZ=$(docker exec -e MYSQL_PWD="$DB_ROOT_PASSWORD" "$DB_CONTAINER" \
    mysql --user=root -N -B -e "SELECT COUNT(*) FROM \`$DESTINO\`.cotizaciones;" 2>/dev/null || echo '?')
  echo "Cotizaciones en el respaldo: $COTIZ"
  docker exec -e MYSQL_PWD="$DB_ROOT_PASSWORD" "$DB_CONTAINER" \
    mysql --user=root -e "DROP DATABASE IF EXISTS \`$DESTINO\`;"
  echo "Base de prueba eliminada. Producción intacta."
else
  echo "Levantando la aplicación…"
  docker start "$APP_CONTAINER" >/dev/null
  echo "Restauración completa."
  echo "Si algo salió mal, el estado previo está en: $PREVIO"
fi
