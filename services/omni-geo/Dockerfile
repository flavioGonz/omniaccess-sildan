# omni-geo: las direcciones de OmniAccess. Convierte un punto del mapa en «Cavour 3230, Parque
# Batlle, Montevideo» sin mandarle a nadie por dónde anda cada vehículo.
#
# Adentro va Nominatim (GPL-2.0) con PostgreSQL y PostGIS, y el mapa de OpenStreetMap (ODbL) del
# país que se elija. Todo en un solo contenedor, a propósito: es una pieza de OmniAccess que se
# prende y se apaga como una función (Ajustes › Características › «Direcciones de los lugares»),
# igual que omni-lpr y omni-vision, y no un servicio que haya que administrar aparte.
#
# El mapa NO va en la imagen: se baja y se importa la primera vez que arranca (arranque.sh) y queda
# en el volumen /datos. Así la imagen es la misma para cualquier país y pesa lo que pesan los
# programas, y reconstruirla no obliga a importar de nuevo.

FROM debian:13-slim
ENV DEBIAN_FRONTEND=noninteractive
# El idioma va ANTES de instalar PostgreSQL: sin él la base nace en SQL_ASCII y Nominatim falla con
# «a bytes-like object is required» recién al importar (pasó el 23/11 armando la primera versión).
RUN apt-get update && apt-get install -y --no-install-recommends locales \
 && sed -i 's/^# *en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen && locale-gen \
 && rm -rf /var/lib/apt/lists/*
ENV LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
RUN apt-get update && apt-get install -y --no-install-recommends \
      postgresql postgresql-17-postgis-3 postgresql-17-postgis-3-scripts osm2pgsql \
      python3-venv python3-pip python3-icu python3-psycopg python3-psutil python3-jinja2 python3-yaml \
      python3-dotenv python3-sqlalchemy python3-asyncpg python3-falcon python3-uvicorn \
      curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 # El cluster que crea el paquete no se usa: la base vive en el volumen y la arma arranque.sh.
 && rm -rf /var/lib/postgresql/17/main /etc/postgresql/17/main
# Versión fija: es la que se probó. Subirla es una decisión, no un efecto de reconstruir.
RUN useradd -m -d /srv/nominatim -s /bin/bash nominatim && chmod 755 /srv/nominatim \
 && runuser -u nominatim -- python3 -m venv --system-site-packages /srv/nominatim/venv \
 && runuser -u nominatim -- /srv/nominatim/venv/bin/pip install --no-cache-dir nominatim-db==5.3.3 nominatim-api==5.3.3
COPY arranque.sh /arranque.sh
RUN chmod +x /arranque.sh
VOLUME /datos
EXPOSE 8080
# Mientras importa el mapa no contesta: por eso tanta paciencia al arrancar.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30m --retries=3 CMD curl -fs http://127.0.0.1:8080/status || exit 1
CMD ["/arranque.sh"]
