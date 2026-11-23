#!/bin/sh
# Construye y (re)levanta omni-geo, las direcciones de OmniAccess. Igual que omni-lpr y omni-vision:
# puerto sólo en localhost (lo consume la app del mismo equipo, no se publica) y reinicio salvo
# parada manual.
#
#   sh services/omni-geo/run.sh                 → construye y levanta
#   SIN_BUILD=1 sh services/omni-geo/run.sh     → sólo recrea el contenedor con la imagen que ya está
#   GEO_MAPA_URL=https://…/argentina-latest.osm.pbf sh …/run.sh   → otro país (importa de nuevo)
#
# Normalmente no se corre a mano: lo corre OmniAccess al prender «Direcciones de los lugares» en
# Ajustes › Características, y el vigía lo levanta si se cae.
#
# La primera vez baja el mapa e importa: unos diez minutos para Uruguay. Queda en el volumen
# `omni_geo_datos`, así que recrear el contenedor NO importa de nuevo.
#
# Memoria: 3 GB de tope. Contestando usa menos de 1 GB; el tope es para la importación.
set -e
cd "$(dirname "$0")"
[ "${SIN_BUILD:-0}" = "1" ] || docker build -t omni-geo:1 .
docker rm -f omni-geo 2>/dev/null || true
docker run -d --name omni-geo --restart unless-stopped \
  -p 127.0.0.1:"${OMNI_GEO_PUERTO:-8020}":8080 \
  -v omni_geo_datos:/datos \
  -e GEO_MAPA_URL="${GEO_MAPA_URL:-https://download.geofabrik.de/south-america/uruguay-latest.osm.pbf}" \
  --cpus "${GEO_CPUS:-2}" --memory "${GEO_MEMORIA:-3g}" --shm-size 256m \
  omni-geo:1
