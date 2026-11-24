#!/bin/sh
# Construye y (re)levanta omni-rutas, el ajuste de los recorridos a la calle. Igual que omni-geo:
# puerto sólo en localhost (lo consume la app del mismo equipo, no se publica) y reinicio salvo
# parada manual.
#
#   sh services/omni-rutas/run.sh                 → construye y levanta
#   SIN_BUILD=1 sh services/omni-rutas/run.sh     → sólo recrea el contenedor con la imagen que ya está
#   RUTAS_MAPA_URL=https://…/argentina-latest.osm.pbf sh …/run.sh   → otro país (prepara de nuevo)
#
# Normalmente no se corre a mano: lo corre OmniAccess al prender «Recorridos por la calle» en
# Ajustes › Características, y el vigía lo levanta si se cae.
#
# La primera vez baja el mapa y lo prepara: unos minutos para Uruguay. Queda en el volumen
# `omni_rutas_datos`, así que recrear el contenedor NO lo prepara de nuevo.
#
# Memoria: 2 GB de tope. Contestando usa mucho menos; el tope es para la preparación.
set -e
cd "$(dirname "$0")"
[ "${SIN_BUILD:-0}" = "1" ] || docker build -t omni-rutas:1 .
docker rm -f omni-rutas 2>/dev/null || true
docker run -d --init --name omni-rutas --restart unless-stopped \
  -p 127.0.0.1:"${OMNI_RUTAS_PUERTO:-8021}":5000 \
  -v omni_rutas_datos:/datos \
  -e RUTAS_MAPA_URL="${RUTAS_MAPA_URL:-https://download.geofabrik.de/south-america/uruguay-latest.osm.pbf}" \
  --cpus "${RUTAS_CPUS:-2}" --memory "${RUTAS_MEMORIA:-2g}" \
  omni-rutas:1
