#!/bin/bash
# Lo que hace omni-geo al arrancar: prepara la base si no está, importa el mapa si falta o si se
# pidió otro, y se queda contestando direcciones.
#
# En /datos/estado deja en una línea por dónde va. OmniAccess lo lee para decir en pantalla
# «bajando el mapa» o «importando» en vez de un «no contesta» que dura un cuarto de hora.
set -u
DATOS=/datos
PG=$DATOS/pg
BIN=/usr/lib/postgresql/17/bin
MAPA="${GEO_MAPA_URL:-https://download.geofabrik.de/south-america/uruguay-latest.osm.pbf}"
NOM=/srv/nominatim/venv/bin/nominatim

estado() { echo "$1" > "$DATOS/estado"; echo "omni-geo: $1"; }
# Si algo falla se dice y se espera antes de salir: Docker lo vuelve a levantar, y sin la espera
# bajaría el mapa en loop contra un servidor que quizá sólo está caído un rato.
fallo() { estado "error: $1"; sleep 300; exit 1; }

mkdir -p "$DATOS" /run/postgresql && chown postgres: /run/postgresql

if [ ! -s "$PG/PG_VERSION" ]; then
    estado "preparando la base"
    install -d -o postgres -g postgres -m 700 "$PG"
    runuser -u postgres -- "$BIN/initdb" -D "$PG" --locale=en_US.UTF-8 -E UTF8 >/dev/null || fallo "no se pudo crear la base"
    # Medido para una máquina que sólo contesta direcciones de un país chico.
    cat >> "$PG/postgresql.conf" <<CONF
listen_addresses = ''
shared_buffers = ${GEO_PG_MEMORIA:-384MB}
maintenance_work_mem = 384MB
work_mem = 24MB
max_wal_size = 1GB
CONF
fi
# La bitácora la escribe PostgreSQL con su usuario, y /datos es de root: se le deja el archivo hecho.
touch "$DATOS/postgres.log" && chown postgres: "$DATOS/postgres.log"
runuser -u postgres -- "$BIN/pg_ctl" -D "$PG" -w -t 120 -l "$DATOS/postgres.log" start >/dev/null || fallo "PostgreSQL no arrancó (ver /datos/postgres.log)"
apagar() { runuser -u postgres -- "$BIN/pg_ctl" -D "$PG" -m fast stop >/dev/null 2>&1; exit 0; }
trap apagar TERM INT

rol() { runuser -u postgres -- psql -tAc "select 1 from pg_roles where rolname='$1'" | grep -q 1 || runuser -u postgres -- createuser $2 "$1"; }
rol nominatim -s
rol www-data ""

if [ ! -f "$DATOS/listo" ] || [ "$(cat "$DATOS/mapa.url" 2>/dev/null)" != "$MAPA" ]; then
    estado "bajando el mapa"
    rm -f "$DATOS/listo"
    install -d -o nominatim -g nominatim -m 755 "$DATOS/proyecto"
    curl -fsSL --retry 3 -o "$DATOS/mapa.osm.pbf" "$MAPA" || fallo "no se pudo bajar el mapa de $MAPA"
    chown nominatim: "$DATOS/mapa.osm.pbf"
    runuser -u postgres -- dropdb --if-exists nominatim
    # Con todos los lugares con nombre, no sólo las calles; y en español.
    printf 'NOMINATIM_IMPORT_STYLE=full\nNOMINATIM_DEFAULT_LANGUAGE=es\n' > "$DATOS/proyecto/.env"
    chmod 644 "$DATOS/proyecto/.env"
    estado "importando el mapa"
    ( cd "$DATOS/proyecto" && runuser -u nominatim -- "$NOM" import --osm-file "$DATOS/mapa.osm.pbf" --threads "${GEO_HILOS:-2}" 2>&1 | tail -n 5 ; exit "${PIPESTATUS[0]}" ) || fallo "la importación del mapa falló"
    echo "$MAPA" > "$DATOS/mapa.url"
    date -u +%FT%TZ > "$DATOS/listo"
    rm -f "$DATOS/mapa.osm.pbf"
fi

estado "listo"
cd "$DATOS/proyecto"
runuser -u www-data -- /srv/nominatim/venv/bin/python3 -m uvicorn --host 0.0.0.0 --port 8080 --workers "${GEO_PROCESOS:-2}" \
    --factory nominatim_api.server.falcon.server:run_wsgi &
wait $!
apagar
