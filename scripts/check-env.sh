#!/usr/bin/env bash
# =============================================================================
# scripts/check-env.sh
# Revisa el .env del servidor SIN imprimir los secretos.
#
# Muestra si cada variable está presente y si su valor es razonable, pero nunca
# el valor en sí: un .env volcado a la terminal queda en el historial del shell,
# en los logs de la sesión SSH y, si se pega en un chat, fuera de tu control.
#
# Uso:
#   ./scripts/check-env.sh              # revisa ./.env
#   ./scripts/check-env.sh /ruta/.env   # revisa otro archivo
# =============================================================================

set -uo pipefail

ARCHIVO="${1:-.env}"

VERDE='\033[0;32m'; ROJO='\033[0;31m'; AMBAR='\033[0;33m'; GRIS='\033[0;90m'; FIN='\033[0m'
ok()    { echo -e "  ${VERDE}✓${FIN} $*"; }
error() { echo -e "  ${ROJO}✗${FIN} $*"; FALLAS=$((FALLAS+1)); }
aviso() { echo -e "  ${AMBAR}!${FIN} $*"; AVISOS=$((AVISOS+1)); }
info()  { echo -e "  ${GRIS}·${FIN} $*"; }

FALLAS=0; AVISOS=0

[ -f "$ARCHIVO" ] || { echo -e "${ROJO}No existe $ARCHIVO${FIN}"; exit 1; }

echo "Revisando: $ARCHIVO"
echo

# ── Permisos ─────────────────────────────────────────────────────────────────
echo "PERMISOS DEL ARCHIVO"
PERMISOS=$(stat -c '%a' "$ARCHIVO" 2>/dev/null || stat -f '%A' "$ARCHIVO" 2>/dev/null)
case "$PERMISOS" in
  600|400) ok "Permisos $PERMISOS — solo el dueño puede leerlo" ;;
  *)       error "Permisos $PERMISOS — deberían ser 600. Corregí con: chmod 600 $ARCHIVO" ;;
esac

if git -C "$(dirname "$ARCHIVO")" check-ignore -q "$(basename "$ARCHIVO")" 2>/dev/null; then
  ok ".env está en .gitignore"
else
  aviso "No pude confirmar que .env esté en .gitignore (¿es un repo git?)"
fi
echo

# Lee una variable del archivo sin exportar todo el entorno.
leer() { grep -E "^\s*$1\s*=" "$ARCHIVO" 2>/dev/null | head -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*$//' | xargs 2>/dev/null; }

# ── Obligatorias ─────────────────────────────────────────────────────────────
echo "VARIABLES OBLIGATORIAS"
for V in DB_HOST DB_USER DB_PASSWORD DB_NAME JWT_SECRET; do
  VALOR=$(leer "$V")
  if [ -z "$VALOR" ]; then
    error "$V — FALTA. La aplicación no arranca sin esto."
  else
    ok "$V — presente (${#VALOR} caracteres)"
  fi
done
echo

# ── Seguridad ────────────────────────────────────────────────────────────────
echo "SEGURIDAD"

JWT=$(leer JWT_SECRET)
if [ -n "$JWT" ]; then
  if [ ${#JWT} -lt 32 ]; then
    error "JWT_SECRET tiene ${#JWT} caracteres — muy corto. Mínimo 32; ideal 64."
    info  "Generá uno con: openssl rand -base64 48"
  else
    ok "JWT_SECRET tiene ${#JWT} caracteres"
  fi
  case "$JWT" in
    *cambiar*|*change*|*secret*|*ejemplo*|*example*|*tu_*|*your_*)
      error "JWT_SECRET parece ser el valor de ejemplo. Cambialo YA." ;;
  esac
fi

PASS=$(leer DB_PASSWORD)
if [ -n "$PASS" ]; then
  [ ${#PASS} -lt 12 ] && aviso "DB_PASSWORD tiene ${#PASS} caracteres — corta para producción." \
                      || ok "DB_PASSWORD tiene ${#PASS} caracteres"
  case "$PASS" in
    *cambiar*|*change*|*password*|*ejemplo*|*123*)
      error "DB_PASSWORD parece un valor de ejemplo o débil." ;;
  esac
fi

ROUNDS=$(leer BCRYPT_ROUNDS)
if [ -n "$ROUNDS" ] && [ "$ROUNDS" -lt 10 ] 2>/dev/null; then
  aviso "BCRYPT_ROUNDS=$ROUNDS — bajo. Se recomienda 12."
else
  ok "BCRYPT_ROUNDS=${ROUNDS:-12 (por defecto)}"
fi
echo

# ── El chequeo crítico: las dos bases NO pueden ser la misma ────────────────
echo "BASES DE DATOS"
NOMBRE=$(leer DB_NAME)
NOMBRE_TEST=$(leer DB_NAME_TEST)

ok "DB_NAME = $NOMBRE"
if [ -z "$NOMBRE_TEST" ]; then
  info "DB_NAME_TEST sin definir — usa 'rc_tractoparts_test' por defecto"
elif [ "$(echo "$NOMBRE_TEST" | tr '[:upper:]' '[:lower:]')" = "$(echo "$NOMBRE" | tr '[:upper:]' '[:lower:]')" ]; then
  error "DB_NAME_TEST es IGUAL a DB_NAME ($NOMBRE)."
  info  "'npm test' ejecuta pretest, que hace DROP DATABASE sobre DB_NAME_TEST."
  info  "El script aborta solo por seguridad, pero corregilo igual."
else
  ok "DB_NAME_TEST = $NOMBRE_TEST (distinta de la de producción)"
fi
echo

# ── Producción ───────────────────────────────────────────────────────────────
echo "CONFIGURACIÓN DE PRODUCCIÓN"
ENTORNO=$(leer NODE_ENV)
case "$ENTORNO" in
  production) ok "NODE_ENV=production" ;;
  "")         aviso "NODE_ENV sin definir — docker-compose usa 'production' por defecto" ;;
  *)          error "NODE_ENV=$ENTORNO — en el servidor debería ser 'production'" ;;
esac

CORS=$(leer CORS_ORIGIN)
if [ -z "$CORS" ]; then
  aviso "CORS_ORIGIN vacío — con NODE_ENV=production conviene fijar tu dominio."
  info  "Ejemplo: CORS_ORIGIN=https://cotizaciones.tudominio.com"
else
  ok "CORS_ORIGIN = $CORS"
  case "$CORS" in
    *localhost*) aviso "CORS_ORIGIN apunta a localhost — ¿es el .env de producción?" ;;
  esac
fi
echo

# ── Bloqueo por intentos fallidos ────────────────────────────────────────────
# Estos valores AHORA se aplican de verdad: antes el bloqueo no funcionaba por
# un desfase de zona horaria, así que nadie notaba si el número era razonable.
echo "BLOQUEO POR FUERZA BRUTA"
INTENTOS=$(leer MAX_LOGIN_ATTEMPTS)
MINUTOS=$(leer LOCK_DURATION_MINUTES)
info "MAX_LOGIN_ATTEMPTS=${INTENTOS:-3 (por defecto)} · LOCK_DURATION_MINUTES=${MINUTOS:-15 (por defecto)}"
if [ -n "$INTENTOS" ] && [ "$INTENTOS" -le 2 ] 2>/dev/null; then
  aviso "Con $INTENTOS intentos, un usuario que tipea mal dos veces queda bloqueado."
fi
info "No hay recuperación de contraseña: si alguien se bloquea, un Jefe debe cambiársela."
echo

# ── Espacio en disco ─────────────────────────────────────────────────────────
echo "DISCO"
# `df -P` fuerza el formato POSIX: una línea por sistema de archivos y columnas
# fijas. Sin -P, algunas implementaciones parten la salida en dos líneas o
# cambian el orden, y el porcentaje termina leyéndose de la columna equivocada.
LINEA=$(df -P / 2>/dev/null | awk 'NR==2')
USO=$(echo "$LINEA" | awk '{print $5}' | tr -d '%')
LIBRE_KB=$(echo "$LINEA" | awk '{print $4}')

# Se exige que el porcentaje sea un número 0-100: Git Bash sobre Windows
# devuelve otro formato y sin esta comprobación se leería un recuento de bloques
# como si fuera un porcentaje, disparando una alarma falsa.
if echo "$USO" | grep -qE '^[0-9]+$' && [ "$USO" -le 100 ]; then
  LIBRE_GB=$(( LIBRE_KB / 1024 / 1024 ))
  if [ "$USO" -gt 85 ]; then
    error "Disco al ${USO}% (libre: ${LIBRE_GB} GB) — los respaldos necesitan lugar."
  else
    ok "Disco al ${USO}% (libre: ${LIBRE_GB} GB)"
  fi
else
  info "Uso de disco no legible en este sistema (normal fuera de Linux)."
  info "En el servidor, comprobalo con: df -h /"
fi
echo

# ── Resumen ──────────────────────────────────────────────────────────────────
echo "──────────────────────────────────────────"
if [ "$FALLAS" -gt 0 ]; then
  echo -e "${ROJO}$FALLAS problema(s) a corregir${FIN}, $AVISOS aviso(s)."
  exit 1
elif [ "$AVISOS" -gt 0 ]; then
  echo -e "${AMBAR}Sin problemas críticos${FIN}, $AVISOS aviso(s) para revisar."
else
  echo -e "${VERDE}Configuración correcta.${FIN}"
fi
