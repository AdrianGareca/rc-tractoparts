#!/usr/bin/env bash
# =============================================================================
# scripts/install-backup-cron.sh
# Instala las tareas programadas de respaldo. Se ejecuta UNA vez, como root.
#
#   sudo ./scripts/install-backup-cron.sh
#
# Deja tres tareas en /etc/cron.d/rc-tractoparts-backup:
#   03:00 todos los días  → respaldo de la base
#   03:30 todos los días  → respaldo incremental de archivos
#   04:00 los domingos    → respaldo + verificación de restauración
#
# Por qué a esa hora: la empresa opera de día en Bolivia (UTC-4), así que a las
# 03:00 no hay nadie cotizando. El respaldo no bloquea escrituras
# (--single-transaction), pero igual conviene el horario de menor uso.
# =============================================================================

set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/rc-tractoparts}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/rc-tractoparts}"
CRON_FILE="/etc/cron.d/rc-tractoparts-backup"

[ "$(id -u)" -eq 0 ] || { echo "Ejecutá esto con sudo."; exit 1; }
[ -d "$PROJECT_DIR" ] || { echo "No existe PROJECT_DIR=$PROJECT_DIR"; exit 1; }

# ── Permisos ─────────────────────────────────────────────────────────────────
chmod +x "$PROJECT_DIR"/scripts/backup-db.sh \
         "$PROJECT_DIR"/scripts/backup-files.sh \
         "$PROJECT_DIR"/scripts/restore-db.sh

mkdir -p "$BACKUP_DIR"
# Los respaldos contienen TODA la base, incluidos los hashes de contraseñas y
# los datos de clientes. Solo root puede leerlos.
chmod 700 "$BACKUP_DIR"
chown root:root "$BACKUP_DIR"

# ── Tareas programadas ───────────────────────────────────────────────────────
# Se usa /etc/cron.d en vez de `crontab -e` porque queda versionado, es
# idempotente (reinstalar lo sobrescribe) y declara el usuario explícitamente.
cat > "$CRON_FILE" <<EOF
# RC Tractoparts — respaldos automáticos
# Generado por scripts/install-backup-cron.sh — no editar a mano.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
PROJECT_DIR=$PROJECT_DIR
BACKUP_DIR=$BACKUP_DIR

# Base de datos — todos los días a las 03:00
0 3 * * *   root  $PROJECT_DIR/scripts/backup-db.sh >> $BACKUP_DIR/cron.log 2>&1

# Archivos (PDFs y adjuntos) — todos los días a las 03:30
30 3 * * *  root  $PROJECT_DIR/scripts/backup-files.sh >> $BACKUP_DIR/cron.log 2>&1

# Domingos 04:00 — respaldo CON verificación de restauración.
# Un respaldo que nunca se probó restaurar es una suposición, no un respaldo.
0 4 * * 0   root  $PROJECT_DIR/scripts/backup-db.sh --verify >> $BACKUP_DIR/cron.log 2>&1
EOF

chmod 644 "$CRON_FILE"

# ── Rotación del log ─────────────────────────────────────────────────────────
# Sin esto, backup.log crece para siempre — el mismo problema que los respaldos
# vienen a resolver.
cat > /etc/logrotate.d/rc-tractoparts-backup <<EOF
$BACKUP_DIR/*.log {
    weekly
    rotate 8
    compress
    missingok
    notifempty
    create 600 root root
}
EOF

echo "Instalado en $CRON_FILE"
echo
echo "Tareas programadas:"
grep -E '^[0-9]' "$CRON_FILE" | sed 's/^/  /'
echo
echo "Probá el respaldo ahora mismo (no esperes al cron):"
echo "  sudo $PROJECT_DIR/scripts/backup-db.sh"
