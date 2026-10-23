#!/bin/sh
# Desplegar en un comando, con vuelta atrás (punto 4, 21/10).
#
#   sh scripts/desplegar.sh /tmp/lab60.patch.gz       aplica, prueba, migra, compila sin corte y verifica
#   sh scripts/desplegar.sh --volver                   vuelve al despliegue anterior (código y .next)
#   REINICIAR=1 sh scripts/desplegar.sh …              además reinicia los procesos de PM2 tocados
#                                                      (omniaccess-webhooks sólo con REINICIAR_WEBHOOKS=1:
#                                                      server.js no se reinicia sin el OK de Nico)
#
# El build tarda más que una sesión de shell remota: lanzarlo con
#   setsid nohup sh scripts/desplegar.sh /tmp/x.patch.gz > /dev/null 2>&1 < /dev/null &
# y mirar /tmp/despliegue.log (última línea DESPLIEGUE_OK, DESPLIEGUE_FALLO o VUELTA_OK).
#
# Qué vuelve atrás solo y qué no:
#  · el código (git) y la web (.next) vuelven solos si fallan las pruebas o el build no contesta;
#  · las migraciones de la base NO se deshacen: por regla son aditivas (columnas y tablas nuevas),
#    así que el código anterior sigue andando con ellas.
set -u
cd "${OMNI_DIR:-$(dirname "$0")/..}"
LOG=/tmp/despliegue.log
REG=.despliegues
anotar() { echo "$(date '+%F %T') $*" | tee -a "$LOG"; }

# Qué proceso de PM2 corre cada archivo (los que se reinician a mano después de un cambio).
procesos_tocados() {
  git diff --name-only "$1" "$2" | awk '
    /^server\.js$|^lib-intrusion-capture\.js$|^lib-sightings\.js$|^lib-lista-negra\.js$|^lib-chapa\.js$|^handlers\// { p["omniaccess-webhooks"]=1 }
    /^tracking-worker\.js$|^lib-chapa\.js$/ { p["tracking-worker"]=1 }
    /^vision-.*\.js$/ { p["vision-worker"]=1 }
    /^dispatch-worker\.js$/ { p["dispatch-worker"]=1 }
    /^escucha-eventos\.js$/ { p["escucha-eventos"]=1 }
    /^alarm-receiver\.js$|^lib-dc09.*\.js$/ { p["alarm-receiver"]=1 }
    /^vigia\.js$/ { p["omniaccess-vigia"]=1 }
    /^camara-log\.js$/ { p["camara-log"]=1 }
    /^scripts\/entrenador\.js$/ { p["omniaccess-entrenador"]=1 }
    /^lib-cifrado-datos\.js$|^lib-s3\.js$/ { p["omniaccess-webhooks"]=1; p["tracking-worker"]=1; p["vision-worker"]=1; p["escucha-eventos"]=1; p["alarm-receiver"]=1; p["dispatch-worker"]=1 }
    END { for (k in p) print k }'
}

reiniciar() {
  for p in $1; do
    if [ "$p" = "omniaccess-webhooks" ] && [ "${REINICIAR_WEBHOOKS:-0}" != "1" ]; then anotar "PENDIENTE reiniciar $p (server.js: con el OK de Nico, REINICIAR_WEBHOOKS=1)"; continue; fi
    if [ "${REINICIAR:-0}" = "1" ]; then pm2 restart "$p" --update-env > /dev/null 2>&1 && anotar "reiniciado $p"; else anotar "PENDIENTE reiniciar $p"; fi
  done
}

if [ "${1:-}" = "--volver" ]; then
  ANTES=$(grep -v VUELTA "$REG" 2>/dev/null | tail -1 | awk '{print $3}')
  [ -n "$ANTES" ] || { anotar "VUELTA_FALLO: no hay despliegue anotado en $REG"; exit 1; }
  AHORA=$(git rev-parse HEAD)
  git reset -q --hard "$ANTES" || { anotar "VUELTA_FALLO: git reset"; exit 1; }
  if [ -d .next.prev ]; then
    rm -rf .next.vuelta && mv .next .next.vuelta && mv .next.prev .next && pm2 restart omniaccess-web --update-env > /dev/null
    anotar "web: vuelta al .next anterior (el que se sacó quedó en .next.vuelta)"
  else
    anotar "sin .next anterior: se recompila"; sh scripts/compilar-sin-corte.sh || { anotar "VUELTA_FALLO: build"; exit 1; }
  fi
  reiniciar "$(procesos_tocados "$ANTES" "$AHORA")"
  echo "$(date '+%F %T') VUELTA $ANTES (desde $AHORA)" >> "$REG"
  anotar "VUELTA_OK en $(git log --oneline -1)"
  exit 0
fi

PARCHE=${1:-}
[ -f "$PARCHE" ] || { anotar "DESPLIEGUE_FALLO: no encuentro el parche «$PARCHE»"; exit 1; }
[ -z "$(git status --porcelain --untracked-files=no)" ] || { anotar "DESPLIEGUE_FALLO: hay cambios sin commitear en el servidor; no se toca nada"; exit 1; }
: > "$LOG"
ANTES=$(git rev-parse HEAD)
anotar "desde $(git log --oneline -1)"

case "$PARCHE" in *.gz) gunzip -c "$PARCHE" > /tmp/despliegue.patch ;; *) cp "$PARCHE" /tmp/despliegue.patch ;; esac
if ! git -c user.name=Claude -c user.email=noreply@anthropic.com am -q /tmp/despliegue.patch >> "$LOG" 2>&1; then
  git am --abort > /dev/null 2>&1; anotar "DESPLIEGUE_FALLO: el parche no aplica; nada cambió"; exit 1
fi
anotar "aplicado: $(git log --oneline -1)"

volver_codigo() { git reset -q --hard "$ANTES"; anotar "código de vuelta en $(git log --oneline -1)"; }

if ! node scripts/probar.js > /tmp/despliegue-pruebas.log 2>&1; then
  volver_codigo; anotar "DESPLIEGUE_FALLO: fallaron las pruebas (ver /tmp/despliegue-pruebas.log)"; exit 1
fi
anotar "pruebas OK"

if [ -n "$(git diff --name-only "$ANTES" HEAD -- prisma/)" ]; then
  if ! npx prisma migrate deploy >> "$LOG" 2>&1 || ! npx prisma generate >> "$LOG" 2>&1; then
    volver_codigo; anotar "DESPLIEGUE_FALLO: la migración no corrió (revisar a mano el estado de la base)"; exit 1
  fi
  anotar "migraciones aplicadas"
fi

# Las funciones de la instalación (Intrusión, Recepción y Gestión de alarmas): la primera vez se
# escriben según lo que había; después no se tocan (idempotente).
node scripts/funciones-instalacion.js >> "$LOG" 2>&1 || anotar "AVISO: no se escribieron las funciones de la instalación"

if ! sh scripts/compilar-sin-corte.sh; then
  volver_codigo; anotar "DESPLIEGUE_FALLO: el build falló o no contestó (ver /tmp/build.log); la web sigue con lo anterior"; exit 1
fi
anotar "web compilada y contestando"
echo "$(date '+%F %T') $ANTES $(git rev-parse HEAD)" >> "$REG"
reiniciar "$(procesos_tocados "$ANTES" HEAD)"
anotar "DESPLIEGUE_OK $(git log --oneline -1)"
