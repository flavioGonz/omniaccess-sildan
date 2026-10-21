#!/bin/sh
# Compilar y poner en producción la web de OmniAccess SIN cortar el sitio.
#
#   nohup sh scripts/compilar-sin-corte.sh > /dev/null 2>&1 &     (deja el resultado en /tmp/build.log)
#   SOLO_COMPILAR=1 sh scripts/compilar-sin-corte.sh                (compila en .next-nuevo y no cambia nada)
#
# Por qué: el script anterior (/tmp/build-fichas.sh) movía .next a un costado ANTES de compilar,
# así que durante todo el build (~4 min) el sitio no tenía qué servir y daba «Internal Server
# Error». Ahora se compila en .next-nuevo mientras el sitio sigue sirviendo el .next de siempre, y
# al terminar se cambian de golpe: el único corte es el reinicio del proceso (segundos).
#
# Después del cambio se mira que el sitio conteste (salud y una página). Si no contesta, se vuelve
# solo a lo anterior y se anota ROLLBACK: un build que compila pero no arranca no se queda puesto.
set -u
cd "$(dirname "$0")/.."
LOG=/tmp/build.log
NUEVO=.next-nuevo
URL=http://127.0.0.1:${PORT:-10001}
# Cuánto se espera a que el proceso nuevo conteste antes de dar el cambio por fallido.
ESPERA_SEG=60

rm -rf "$NUEVO"
if ! NEXT_DIST_DIR="$NUEVO" NODE_OPTIONS=--max-old-space-size=3072 npm run build > "$LOG" 2>&1 || [ ! -f "$NUEVO/BUILD_ID" ]; then
  echo BUILD_FAIL >> "$LOG"
  rm -rf "$NUEVO"
  exit 1
fi
if [ "${SOLO_COMPILAR:-0}" = "1" ]; then echo BUILD_OK_SIN_CAMBIAR >> "$LOG"; exit 0; fi

rm -rf .next.prev
mv .next .next.prev && mv "$NUEVO" .next
pm2 restart omniaccess-web --update-env > /dev/null

contesta() {
  [ "$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$URL/api/health")" = "200" ] &&
  [ "$(curl -s -o /dev/null -m 20 -w '%{http_code}' "$URL/login")" = "200" ]
}
i=0
until contesta; do
  i=$((i + 3))
  if [ "$i" -ge "$ESPERA_SEG" ]; then
    rm -rf .next.fallida && mv .next .next.fallida && mv .next.prev .next
    pm2 restart omniaccess-web --update-env > /dev/null
    echo "ROLLBACK: el build nuevo no contestó en ${ESPERA_SEG} s; quedó en .next.fallida" >> "$LOG"
    exit 1
  fi
  sleep 3
done
echo BUILD_OK >> "$LOG"
# Subir a git es aparte: si falla (en el lab el remoto pide una clave SSH que el CT no tiene), el
# build igual quedó bien puesto, y la salida del script tiene que decir eso (desplegar.sh la mira).
if git push -q origin "$(git rev-parse --abbrev-ref HEAD)" > /dev/null 2>&1; then echo PUSH_OK >> "$LOG"; else echo PUSH_FALLO >> "$LOG"; fi
exit 0
