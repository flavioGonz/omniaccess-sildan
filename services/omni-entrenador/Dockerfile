# omni-entrenador: afina RF-DETR con las fotos dibujadas en OmniVision › Entrenar › Objetos nuevos.
#
# No queda corriendo: scripts/entrenador.js lo lanza con `docker run --rm` por cada entrenamiento
# y termina con el modelo exportado a ONNX. Lleva PyTorch con CUDA 13 (la misma versión de
# PyTorch que el exportador de omni-vision, 2.14.1) y el mismo rfdetr (1.11.2): el ONNX que sale
# se lee con el pre/posproceso de omni-vision, que se copia de ahí y se prueba al terminar.
#
# Construir desde services/:  docker build -t omni-entrenador:gpu -f omni-entrenador/Dockerfile .
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cu130 torch==2.14.1 torchvision==0.29.1
RUN pip install --no-cache-dir "rfdetr[train,loggers]==1.11.2" onnx onnxscript onnxruntime==1.31.0 opencv-python-headless
# Triton (lo usa PyTorch en la GPU) compila un lanzador en C la primera vez que corre: sin gcc el
# entrenamiento se caía a los 15 s en la 3050 («Failed to find C compiler»). En CPU no pasa.
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Los pesos de partida se bajan al construir (rfdetr los guarda en la carpeta actual): entrenar
# no depende de internet.
RUN python -c "import rfdetr; rfdetr.RFDETRNano(); rfdetr.RFDETRSmall()" && ls -la /app
COPY omni-vision/detector.py omni-vision/motor.py omni-vision/propio.py omni-entrenador/entrenar.py ./
ENV PYTHONUNBUFFERED=1 OMP_NUM_THREADS=3
ENTRYPOINT ["python", "entrenar.py"]
