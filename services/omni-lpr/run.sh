#!/bin/sh
# Construye y (re)levanta omni-lpr (el lector de matrículas) en el CT.
#
#   sh services/omni-lpr/run.sh             → construye y levanta
#   SIN_BUILD=1 sh services/omni-lpr/run.sh → sólo recrea el contenedor con la imagen que hay
#
# Con GPU: los --device hacen falta porque el contenedor corre dentro de un LXC no privilegiado
# (nvidia-container-runtime con no-cgroups = true). Puerto sólo en localhost: lo usa la app del
# mismo CT. MAX_EN_VUELO del tracking-worker está en 1 a propósito (ver skill omniaccess-motor).
#
# Sin GPU (driver todavía sin cargar, p.ej. una instalación nueva con Secure Boot esperando la
# llave) corre en CPU y lo DICE: anda, pero ~20 veces más lento. Cuando la GPU aparece, correr
# este script de nuevo con SIN_BUILD=1 lo pasa a la GPU.
set -e
cd "$(dirname "$0")"
[ "${SIN_BUILD:-0}" = "1" ] || docker build -t omni-lpr:gpu -f Dockerfile.gpu .
docker rm -f omni-lpr 2>/dev/null || true
# Sólo los que son de verdad un dispositivo: en el lab (14/10) /dev/nvidia-modeset existía pero no
# era un nodo de dispositivo, Docker se negó a arrancar el contenedor y — como el viejo ya estaba
# borrado — el lector quedó caído. Un --device que no corresponde no agrega nada; uno que falta sí.
DISPOSITIVOS=""
for d in /dev/nvidia0 /dev/nvidiactl /dev/nvidia-uvm /dev/nvidia-uvm-tools /dev/nvidia-modeset; do
  [ -c "$d" ] && DISPOSITIVOS="$DISPOSITIVOS --device $d"
done
if nvidia-smi -L >/dev/null 2>&1; then
  docker run -d --name omni-lpr --restart unless-stopped --gpus all $DISPOSITIVOS \
    -p 127.0.0.1:8000:8000 -e EXECUTION_DEVICE=cuda \
    -v omni_lpr_models:/root/.cache omni-lpr:gpu
  echo "omni-lpr: en GPU"
else
  docker run -d --name omni-lpr --restart unless-stopped \
    -p 127.0.0.1:8000:8000 -e EXECUTION_DEVICE=cpu \
    -v omni_lpr_models:/root/.cache omni-lpr:gpu
  echo "omni-lpr: SIN GPU (nvidia-smi no contesta) — corriendo en CPU"
fi
