# omni-vision: detección de objetos (RF-DETR, Apache-2.0) para OmniAccess.
#
# Dos etapas. La primera exporta los modelos a ONNX con PyTorch en CPU y comprueba que nuestro
# pre/posproceso da lo mismo que rfdetr (si no, la construcción falla). La segunda es la misma
# base que omni-lpr — CUDA 13 + cuDNN 9, onnxruntime-gpu 1.30, ya probada en la RTX 3050 — y no
# lleva PyTorch: imagen chica y VRAM topada.

FROM python:3.12-slim AS exportador
RUN apt-get update && apt-get install -y --no-install-recommends curl libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.14.1 torchvision==0.29.1 \
 && pip install --no-cache-dir "rfdetr[onnxexport]==1.11.2" onnx onnxscript onnxruntime==1.31.0
# Pocos hilos: la exportación corre en el mismo CT que la app en demo; que tarde más y no la frene.
ENV OMP_NUM_THREADS=3 MKL_NUM_THREADS=3
WORKDIR /src
COPY exportar.py detector.py verificar_paridad.py ./
RUN python exportar.py /modelos
# La imagen de ejemplo del propio README de rfdetr: un perro, una persona, una mochila, un auto.
RUN curl -fsSL -o /tmp/prueba.jpg https://media.roboflow.com/dog.jpg \
 && python verificar_paridad.py /modelos/rfdetr-small.onnx RFDETRSmall /tmp/prueba.jpg

FROM nvidia/cuda:13.0.2-cudnn-runtime-ubuntu24.04
ENV DEBIAN_FRONTEND=noninteractive PIP_BREAK_SYSTEM_PACKAGES=1
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip curl \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir onnxruntime-gpu==1.30.0 numpy pillow fastapi uvicorn python-multipart
COPY --from=exportador /modelos /modelos
WORKDIR /app
COPY detector.py app.py ./
ENV VISION_MODELOS=/modelos VISION_MODELO=rfdetr-small VISION_UMBRAL=0.4 \
    VISION_TOPE_VRAM_MB=1536 VISION_HILOS_CPU=2 OMP_NUM_THREADS=2
EXPOSE 8010
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8010/salud > /dev/null || exit 1
CMD ["python3", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8010", "--workers", "1"]
