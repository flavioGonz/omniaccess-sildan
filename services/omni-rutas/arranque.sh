#!/bin/bash
# Lo que hace omni-rutas al arrancar: baja y prepara el mapa si falta o si se pidió otro, y se queda
# contestando por qué calle fue un recorrido.
#
# En /datos/estado deja en una línea por dónde va. OmniAccess lo lee para decir en pantalla
# «bajando el mapa» o «preparando el mapa» en vez de un «no contesta» que dura varios minutos.
set -u
DATOS=/datos
MAPA="${RUTAS_MAPA_URL:-https://download.geofabrik.de/south-america/uruguay-latest.osm.pbf}"
# Las reglas de un auto: qué calles se pueden andar, en qué sentido y a qué velocidad.
PERFIL="${RUTAS_PERFIL:-/opt/car.lua}"

estado() { echo "$1" > "$DATOS/estado"; echo "omni-rutas: $1"; }
# Si algo falla se dice y se espera antes de salir: Docker lo vuelve a levantar, y sin la espera
# bajaría el mapa en loop contra un servidor que quizá sólo está caído un rato.
fallo() { estado "error: $1"; sleep 300; exit 1; }

mkdir -p "$DATOS"
if [ ! -f "$DATOS/listo" ] || [ "$(cat "$DATOS/mapa.url" 2>/dev/null)" != "$MAPA" ]; then
    estado "bajando el mapa"
    rm -f "$DATOS/listo" "$DATOS"/mapa.osrm*
    curl -fsSL --retry 3 -o "$DATOS/mapa.osm.pbf" "$MAPA" || fallo "no se pudo bajar el mapa de $MAPA"
    estado "preparando el mapa"
    # Tres pasos, los que pide OSRM para contestar rápido (MLD): leer las calles, partirlas en
    # celdas y pesarlas. Para Uruguay son un par de minutos.
    ( cd "$DATOS" \
      && osrm-extract -p "$PERFIL" -t "${RUTAS_HILOS:-2}" mapa.osm.pbf 2>&1 | tail -n 3 && [ "${PIPESTATUS[0]}" = 0 ] \
      && osrm-partition mapa.osrm 2>&1 | tail -n 2 && [ "${PIPESTATUS[0]}" = 0 ] \
      && osrm-customize mapa.osrm 2>&1 | tail -n 2 && [ "${PIPESTATUS[0]}" = 0 ] ) || fallo "no se pudo preparar el mapa"
    echo "$MAPA" > "$DATOS/mapa.url"
    date -u +%FT%TZ > "$DATOS/listo"
    rm -f "$DATOS/mapa.osm.pbf"
fi

estado "listo"
# `exec`: que la señal de apagado le llegue a OSRM y no a este script. El tope de puntos por pedido
# lo fija quien pregunta (lib/rutas, de a cien); acá sólo se deja margen.
exec osrm-routed --algorithm mld --ip 0.0.0.0 --port 5000 --threads "${RUTAS_HILOS:-2}" --max-matching-size 400 "$DATOS/mapa.osrm"
