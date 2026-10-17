#!/bin/sh
# Construye y (re)levanta omni-vision en el CT. Igual que omni-lpr: puerto sólo en localhost
# (lo consume la app del mismo CT, no se publica), GPU compartida, reinicio salvo parada manual.
#
#   sh services/omni-vision/run.sh            → construye y levanta
#   VISION_MODELO=rfdetr-nano sh .../run.sh   → otro tamaño (nano | small | medium)
#
# La construcción usa CPU unos minutos (exporta los modelos); no toca la app ni omni-lpr.
#
# Memoria: 6 GB. Con la mitad de texto de SigLIP para la búsqueda (1,1 GB en float32: la versión
# int8 se apartaba demasiado, coseno 0,90 contra PyTorch) el proceso ronda 3,2 GB; con 4 GB de
# tope quedaba a un pico de que Docker lo matara. El CT tiene 12 GB y omni-lpr usa ~200 MB.
#   SIN_BUILD=1 sh .../run.sh                → sólo recrea el contenedor con la imagen que ya está
#                                              (lo usa el vigía cuando `docker start` no alcanza)
set -e
cd "$(dirname "$0")"
[ "${SIN_BUILD:-0}" = "1" ] || docker build -t omni-vision:gpu .
docker rm -f omni-vision 2>/dev/null || true
# El detector propio activo (lo escribe la app al activar un entrenamiento). Vacía = no hay.
mkdir -p "${VISION_PROPIO_DIR:-/opt/OmniAccess/entrenamientos/activo}"
# El índice de fotos del vocabulario abierto (indice_vocab.py): ~21 KB por foto, 30 días.
mkdir -p "${VISION_VOCAB_INDICE_DIR:-/opt/OmniAccess/vocab-indice}"
# Sin GPU (driver sin cargar) se levanta igual en CPU y se avisa: con `--gpus all` y sin driver,
# Docker se niega a crear el contenedor y el detector quedaba directamente sin correr.
GPU="--gpus all"
nvidia-smi -L >/dev/null 2>&1 || { GPU=""; echo "omni-vision: SIN GPU (nvidia-smi no contesta) — corriendo en CPU"; }
docker run -d --name omni-vision $GPU --restart unless-stopped \
  -p 127.0.0.1:8010:8010 \
  -v "${VISION_PROPIO_DIR:-/opt/OmniAccess/entrenamientos/activo}":/propio:ro \
  -v "${VISION_VOCAB_INDICE_DIR:-/opt/OmniAccess/vocab-indice}":/indice \
  -e VISION_MODELO="${VISION_MODELO:-rfdetr-small}" \
  --cpus 2 --memory "${VISION_MEMORIA:-6g}" \
  omni-vision:gpu
