"""
omni-vision: servicio HTTP de detección de objetos para OmniAccess (como omni-lpr, al lado).

Sólo inferencia. De dónde sale el cuadro, qué significa el resultado y qué se guarda vive en
la app (lib/vision/*, vision-worker): ver openspec/changes/detector-objetos-yolo/design.md.

Contrato (estable, independiente del modelo):
  GET  /salud      → modelo, licencia, proveedor (CUDA/CPU), cola, latencias, VRAM.
  POST /detectar   → cuerpo = la imagen (JPEG/PNG) o multipart con campo "imagen".
                     ?umbral=0.4  ?grupos=persona,vehiculo  (opcionales)
                     → {ancho, alto, ms, objetos:[{clase, nombre, grupo, confianza, caja, caja_norm}]}
"""

from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from detector import Detector

CARPETA_MODELOS = Path(os.environ.get("VISION_MODELOS", "/modelos"))
MODELO = os.environ.get("VISION_MODELO", "rfdetr-small")
# Por debajo de esto el detector "ve" sombras: 0,4 es el punto donde RF-DETR Small deja de
# inventar personas en calles vacías de noche (a medir con las cámaras del barrio).
UMBRAL_DEFECTO = float(os.environ.get("VISION_UMBRAL", "0.4"))
# Una captura de cámara 4 MP en JPEG pesa ~1 MB; 15 MB deja margen sin abrir la puerta a cualquier cosa.
MAX_BYTES = 15 * 1024 * 1024

catalogo = json.loads((CARPETA_MODELOS / "catalogo.json").read_text())
if MODELO not in catalogo:
    raise SystemExit(f"VISION_MODELO={MODELO} no existe; hay: {', '.join(catalogo)}")
detector = Detector(str(CARPETA_MODELOS / f"{MODELO}.onnx"))
arranque = time.time()

app = FastAPI(title="omni-vision", docs_url=None, redoc_url=None)


def _vram() -> dict | None:
    """Memoria de la GPU entera (no sólo la nuestra): lo que importa es cuánto le queda a omni-lpr."""
    try:
        r = subprocess.run(["nvidia-smi", "--query-gpu=memory.used,memory.total,utilization.gpu",
                            "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=3)
        usada, total, uso = [int(x.strip()) for x in r.stdout.strip().split(",")]
        return {"usada_mb": usada, "total_mb": total, "uso_gpu": uso}
    except Exception:
        return None


@app.get("/salud")
def salud():
    info = catalogo[MODELO]
    return {
        "ok": True,
        "modelo": MODELO,
        "licencia": info["licencia"],
        "coco_ap": info["coco_ap"],
        "proveedor": detector.proveedor,
        "resolucion": detector.resolucion,
        "umbral_defecto": UMBRAL_DEFECTO,
        "en_vuelo": detector.en_vuelo,
        "esperando": detector.esperando,
        "total": detector.total,
        "errores": detector.errores,
        "latencia_ms": detector.latencias(),
        "tope_vram_mb": int(os.environ.get("VISION_TOPE_VRAM_MB", "1536")),
        "vram": _vram(),
        "modelos_disponibles": list(catalogo),
        "segundos_arriba": int(time.time() - arranque),
    }


@app.post("/detectar")
async def detectar(request: Request, umbral: float | None = None, grupos: str | None = None):
    tipo = request.headers.get("content-type", "")
    if tipo.startswith("multipart/"):
        form = await request.form()
        archivo = form.get("imagen")
        if archivo is None or not hasattr(archivo, "read"):
            raise HTTPException(400, "Falta el campo 'imagen'.")
        datos = await archivo.read()
    else:
        datos = await request.body()
    if not datos:
        raise HTTPException(400, "No llegó ninguna imagen.")
    if len(datos) > MAX_BYTES:
        raise HTTPException(413, "La imagen pesa demasiado.")
    u = UMBRAL_DEFECTO if umbral is None else max(0.05, min(0.95, umbral))
    t0 = time.perf_counter()
    try:
        # La inferencia es bloqueante: se manda a un hilo para no frenar /salud mientras tanto.
        from starlette.concurrency import run_in_threadpool
        r = await run_in_threadpool(detector.detectar, datos, u)
    except HTTPException:
        raise
    except Exception as e:  # imagen ilegible o fallo de la GPU: se dice cuál
        return JSONResponse({"error": f"{type(e).__name__}: {e}"}, status_code=422 if "Image" in type(e).__name__ else 500)
    if grupos:
        quiero = {g.strip() for g in grupos.split(",") if g.strip()}
        r["objetos"] = [o for o in r["objetos"] if o["grupo"] in quiero]
    r["ms"] = round((time.perf_counter() - t0) * 1000, 1)
    r["modelo"] = MODELO
    r["umbral"] = u
    return r
