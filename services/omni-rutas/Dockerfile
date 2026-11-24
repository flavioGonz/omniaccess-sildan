# omni-rutas: por qué calle fue. Recibe las posiciones de un rastreador —una cada diez o cuarenta
# segundos— y devuelve el camino por la calle que las une, para que el trayecto no corte por las
# manzanas. Sin mandarle a nadie por dónde anda cada vehículo.
#
# Adentro va OSRM (BSD-2-Clause) con el mapa de OpenStreetMap (ODbL) del país que se elija. Es una
# pieza de OmniAccess que se prende y se apaga como una función, igual que omni-geo, omni-lpr y
# omni-vision, y no un servicio que haya que administrar aparte.
#
# El mapa NO va en la imagen: se baja y se prepara la primera vez que arranca (arranque.sh) y queda
# en el volumen /datos. Así la imagen es la misma para cualquier país, y reconstruirla no obliga a
# preparar el mapa de nuevo.
#
# Se parte de la imagen que publica el proyecto y no de Debian con `apt`, como omni-geo: Debian 13
# no trae OSRM empaquetado (se miró el 24/11) y compilarlo acá son veinte minutos y 4 GB.
# Versión fija: es la que se probó. Subirla es una decisión, no un efecto de reconstruir.
FROM ghcr.io/project-osrm/osrm-backend:v26.10.0-debian
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY arranque.sh /arranque.sh
RUN chmod +x /arranque.sh
VOLUME /datos
EXPOSE 5000
# Mientras prepara el mapa no contesta: por eso la paciencia al arrancar. Un punto cualquiera:
# lo que importa es que conteste, no qué.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20m --retries=3 CMD curl -fs "http://127.0.0.1:5000/nearest/v1/driving/-56.16,-34.9" >/dev/null || exit 1
ENTRYPOINT []
CMD ["/arranque.sh"]
