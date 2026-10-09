# omni-vision: visión libre (Apache-2.0) para OmniAccess — detección, siluetas, pose, atributos
# y seguimiento.
#
# Dos etapas. La primera exporta los modelos a ONNX con PyTorch en CPU (RF-DETR y SigLIP 2) y
# comprueba que nuestro pre/posproceso da lo mismo que las librerías originales (si no, la
# construcción falla). La segunda es la misma base que omni-lpr — CUDA 13 + cuDNN 9,
# onnxruntime-gpu 1.30, ya probada en la RTX 3050 — y no lleva PyTorch: imagen más chica y
# VRAM topada.

FROM python:3.12-slim AS exportador
RUN apt-get update && apt-get install -y --no-install-recommends curl libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.14.1 torchvision==0.29.1 \
 && pip install --no-cache-dir "rfdetr[onnxexport]==1.11.2" onnx onnxscript onnxruntime==1.31.0 \
      transformers==5.19.0 opencv-python-headless
# Pocos hilos: la exportación corre en el mismo CT que la app; que tarde más y no la frene.
ENV OMP_NUM_THREADS=3 MKL_NUM_THREADS=3
WORKDIR /src
COPY exportar.py detector.py motor.py atributos.py verificar_paridad.py ./
RUN python exportar.py /modelos
# Imágenes de prueba: la del README de rfdetr (perro, persona, mochila, auto) y una de COCO con
# una persona entera, para comparar los puntos de la pose donde se ven.
RUN curl -fsSL -o /tmp/prueba.jpg https://media.roboflow.com/dog.jpg \
 && curl -fsSL -o /tmp/persona.jpg http://images.cocodataset.org/val2017/000000000785.jpg \
 && python verificar_paridad.py /modelos /tmp/prueba.jpg /tmp/persona.jpg

FROM nvidia/cuda:13.0.2-cudnn-runtime-ubuntu24.04
ENV DEBIAN_FRONTEND=noninteractive PIP_BREAK_SYSTEM_PACKAGES=1
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip curl libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir onnxruntime-gpu==1.30.0 numpy pillow fastapi uvicorn python-multipart \
      opencv-python-headless trackers==2.6.1 supervision==0.30.9
COPY --from=exportador /modelos /modelos
WORKDIR /app
COPY detector.py motor.py atributos.py seguimiento.py app.py ./
ENV VISION_MODELOS=/modelos VISION_MODELO=rfdetr-small VISION_UMBRAL=0.4 \
    VISION_TOPE_VRAM_MB=1536 VISION_HILOS_CPU=2 OMP_NUM_THREADS=2
EXPOSE 8010
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8010/salud > /dev/null || exit 1
CMD ["python3", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8010", "--workers", "1"]
