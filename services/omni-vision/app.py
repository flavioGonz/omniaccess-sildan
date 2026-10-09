"""
omni-vision: servicio HTTP de visión para OmniAccess (como omni-lpr, al lado).

Sólo inferencia. De dónde sale el cuadro, qué significa el resultado y qué se guarda vive en
la app (lib/vision*, laboratorio /admin/vision): ver openspec/changes/detector-objetos-yolo.

Contrato (estable, independiente de los modelos):
  GET  /salud      → modelos y su estado, cola, latencias por tarea, VRAM, sesiones de seguimiento.
  POST /detectar   → cuerpo = la imagen (JPEG/PNG) o multipart con campo "imagen".
        ?tarea=detectar|segmentar|pose   qué modelo mira la imagen (defecto: detectar)
        ?atributos=1                     además, color/carrocería/ropa/chaleco… de cada objeto
        ?sesion=<id>&fps=2               además, número de pista (cuadros seguidos de una cámara)
        ?umbral=0.4  ?grupos=persona,vehiculo
     → {ancho, alto, tarea, modelo, ms, pasos:{…ms}, objetos:[{clase, nombre, grupo, confianza,
        caja, caja_norm, silueta?, area?, puntos?, postura?, atributos?, pista?}]}
"""

from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

import detector as D
from atributos import Describidor
from motor import Cola, Modelo
from seguimiento import Sesiones

CARPETA = Path(os.environ.get("VISION_MODELOS", "/modelos"))
MODELO = os.environ.get("VISION_MODELO", "rfdetr-small")
MODELO_SILUETAS = os.environ.get("VISION_MODELO_SILUETAS", "rfdetr-seg-small")
MODELO_POSE = os.environ.get("VISION_MODELO_POSE", "rfdetr-pose")
# Por debajo de esto el detector "ve" sombras: 0,4 es donde RF-DETR Small deja de inventar
# personas en calles vacías de noche (a medir con las cámaras del barrio).
UMBRAL_DEFECTO = float(os.environ.get("VISION_UMBRAL", "0.4"))
# Una captura de cámara 4 MP en JPEG pesa ~1 MB; 15 MB deja margen sin abrir la puerta a cualquier cosa.
MAX_BYTES = 15 * 1024 * 1024
# El seguimiento asume cuadros a este ritmo si quien llama no lo dice.
FPS_DEFECTO = 2.0

catalogo = json.loads((CARPETA / "catalogo.json").read_text())
for m in (MODELO, MODELO_SILUETAS, MODELO_POSE):
    if m not in catalogo:
        raise SystemExit(f"El modelo {m} no está en la imagen; hay: {', '.join(catalogo)}")

modelos = {
    "detectar": Modelo(str(CARPETA / f"{MODELO}.onnx"), "detectar"),
    "segmentar": Modelo(str(CARPETA / f"{MODELO_SILUETAS}.onnx"), "segmentar"),
    "pose": Modelo(str(CARPETA / f"{MODELO_POSE}.onnx"), "pose"),
}
describidor = Describidor(CARPETA)
sesiones = Sesiones()
NOMBRE_MODELO = {"detectar": MODELO, "segmentar": MODELO_SILUETAS, "pose": MODELO_POSE}
# Se abre la detección al arrancar: es la que se usa siempre, y así el primer pedido no paga la carga.
modelos["detectar"].resolucion  # noqa: B018
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
    det = modelos["detectar"]
    info = catalogo[MODELO]
    return {
        "ok": True,
        # Lo de antes, para quien ya lo lee (topología, laboratorio).
        "modelo": MODELO, "licencia": info["licencia"], "coco_ap": info["coco_ap"],
        "proveedor": det.proveedor, "resolucion": det.resolucion, "umbral_defecto": UMBRAL_DEFECTO,
        "en_vuelo": 1 if Cola.en_vuelo else 0, "esperando": Cola.esperando,
        "total": sum(m.total for m in modelos.values()) + describidor.modelo.total,
        "errores": sum(m.errores for m in modelos.values()) + describidor.modelo.errores,
        "latencia_ms": det.latencias(),
        # Lo nuevo: cada tarea con su modelo y sus números.
        "tareas": {
            **{t: {"modelo": NOMBRE_MODELO[t], **catalogo[NOMBRE_MODELO[t]], **m.estado()} for t, m in modelos.items()},
            "atributos": {"modelo": describidor.meta["modelo"], "licencia": describidor.meta["licencia"], **describidor.modelo.estado()},
        },
        "seguimiento": {"sesiones": sesiones.cuantas(), "licencia": "Apache-2.0 (trackers · ByteTrack)"},
        "tope_vram_mb": int(os.environ.get("VISION_TOPE_VRAM_MB", "1536")),
        "vram": _vram(),
        "modelos_disponibles": [k for k, v in catalogo.items() if v.get("tarea") == "detectar"],
        "segundos_arriba": int(time.time() - arranque),
    }


def _procesar(datos: bytes, tarea: str, umbral: float, atributos: bool, sesion: str | None, fps: float) -> dict:
    pasos: dict[str, float] = {}
    img = D.abrir_imagen(datos)
    ancho, alto = img.size
    m = modelos[tarea]
    if tarea == "segmentar":
        objetos = D.segmentar(m, img, umbral)
    elif tarea == "pose":
        objetos = D.pose(m, img, umbral)
    else:
        s = m.correr(D.preparar(img, m.resolucion))
        objetos = D.decodificar(s["dets"], s["labels"], ancho, alto, umbral)
    pasos[tarea] = round(float(m.ultimo_ms), 1)
    if atributos and objetos:
        n = describidor.describir(img, objetos)
        if n:
            pasos["atributos"] = round(float(describidor.modelo.ultimo_ms), 1)
    seg = None
    if sesion:
        seg = sesiones.actualizar(sesion[:64], objetos, fps)
    return {"ancho": ancho, "alto": alto, "pasos": pasos, "seguimiento": seg, "objetos": objetos}


@app.post("/detectar")
async def detectar(request: Request, umbral: float | None = None, grupos: str | None = None,
                   tarea: str = "detectar", atributos: int = 0, sesion: str | None = None, fps: float | None = None):
    if tarea not in modelos:
        raise HTTPException(400, f"Tarea desconocida: {tarea}. Hay: {', '.join(modelos)}.")
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
        # La inferencia es bloqueante: a un hilo, para no frenar /salud mientras tanto.
        r = await run_in_threadpool(_procesar, datos, tarea, u, bool(atributos), sesion, fps or FPS_DEFECTO)
    except Exception as e:  # imagen ilegible o fallo de la GPU: se dice cuál
        return JSONResponse({"error": f"{type(e).__name__}: {e}"}, status_code=422 if "Image" in type(e).__name__ else 500)
    objetos = r.pop("objetos")
    if grupos:
        quiero = {g.strip() for g in grupos.split(",") if g.strip()}
        objetos = [o for o in objetos if o.grupo in quiero]
    return {
        **r, "tarea": tarea, "modelo": NOMBRE_MODELO[tarea], "umbral": u,
        "ms": round((time.perf_counter() - t0) * 1000, 1),
        # Compatibilidad con quien leía la latencia del detector con este nombre.
        "ms_inferencia": r["pasos"].get(tarea),
        "objetos": [o.a_dict() for o in objetos],
    }
