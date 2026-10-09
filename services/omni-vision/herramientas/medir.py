"""
Cuánto le cuesta omni-vision al resto de OmniAccess. Corre en el CT, sólo con la biblioteca
estándar de Python, y no escribe nada en la base ni toca servicios.

Dos tramos de la misma duración:
  · reposo: omni-vision quieto; se mide lo de siempre.
  · carga:  omni-vision trabajando sin pausa (detección + atributos, siluetas y pose, en ronda),
            que es el peor caso: mucho más de lo que va a pedirle la app.
En los dos, cada segundo: GPU (uso, VRAM, potencia), carga de CPU, cuánto tarda omni-lpr en
leer un cuadro fijo de la LPR Interior, y cuánto tarda la web en contestar.

  python3 medir.py [segundos por tramo=30] > resultado.json
"""

import json
import os
import statistics
import subprocess
import sys
import threading
import time
import urllib.request
import base64

LPR = os.environ.get("OMNI_LPR_URL", "http://127.0.0.1:8000")
VISION = os.environ.get("OMNI_VISION_URL", "http://127.0.0.1:8010")
WEB = os.environ.get("WEB_URL", "http://127.0.0.1:10001/login")
GO2RTC = os.environ.get("GO2RTC_API", "http://127.0.0.1:1984")
CAMARA = os.environ.get("CAMARA", "lpr_lpr-interior_hd")
TRAMO = int(sys.argv[1]) if len(sys.argv) > 1 else 30


def get(url, datos=None, tipo=None, ms=30):
    h = {"Content-Type": tipo} if tipo else {}
    return urllib.request.urlopen(urllib.request.Request(url, data=datos, headers=h), timeout=ms).read()


cuadro = get(f"{GO2RTC}/api/frame.jpeg?src={CAMARA}")
cuerpo_lpr = json.dumps({"image_base64": base64.b64encode(cuadro).decode(),
                         "detector_model": "yolo-v9-t-640-license-plate-end2end",
                         "ocr_model": "cct-xs-v1-global-model"}).encode()


def gpu():
    r = subprocess.run(["nvidia-smi", "--query-gpu=utilization.gpu,memory.used,power.draw,temperature.gpu",
                        "--format=csv,noheader,nounits"], capture_output=True, text=True)
    u, m, p, t = [float(x) for x in r.stdout.strip().split(",")]
    return {"uso": u, "vram_mb": m, "watts": p, "temp": t}


def cronometrar(f):
    t0 = time.perf_counter()
    try:
        f()
        return (time.perf_counter() - t0) * 1000
    except Exception:
        return None


def tramo(nombre, segundos):
    muestras = []
    fin = time.time() + segundos
    while time.time() < fin:
        m = {"t": round(time.time(), 1), **gpu(), "carga": os.getloadavg()[0]}
        m["lpr_ms"] = cronometrar(lambda: get(f"{LPR}/api/v1/tools/detect_and_recognize_plate/invoke", cuerpo_lpr, "application/json"))
        m["web_ms"] = cronometrar(lambda: get(WEB))
        muestras.append(m)
        time.sleep(max(0, 1 - (time.time() - m["t"])))
    return muestras


def resumen(muestras, k):
    v = [m[k] for m in muestras if m.get(k) is not None]
    if not v:
        return None
    v.sort()
    return {"p50": round(statistics.median(v), 1), "p95": round(v[int(len(v) * 0.95) - 1 if len(v) > 1 else 0], 1), "max": round(max(v), 1)}


vision_ms = {}
parar = threading.Event()


def cargar():
    tareas = ["detectar&atributos=1", "segmentar", "pose"]
    i = 0
    while not parar.is_set():
        t = tareas[i % len(tareas)]
        ms = cronometrar(lambda: get(f"{VISION}/detectar?tarea={t}", cuadro, "image/jpeg"))
        vision_ms.setdefault(t, []).append(ms)
        i += 1


reposo = tramo("reposo", TRAMO)
h = threading.Thread(target=cargar, daemon=True)
h.start()
carga = tramo("carga", TRAMO)
parar.set(); h.join(timeout=10)
salud = json.loads(get(f"{VISION}/salud"))
out = {
    "cuadro_bytes": len(cuadro), "segundos_por_tramo": TRAMO,
    "reposo": {k: resumen(reposo, k) for k in ("uso", "vram_mb", "watts", "carga", "lpr_ms", "web_ms")},
    "carga": {k: resumen(carga, k) for k in ("uso", "vram_mb", "watts", "carga", "lpr_ms", "web_ms")},
    "vision_pedidos": {t: {"n": len(v), "p50_ms": round(statistics.median([x for x in v if x]), 1)} for t, v in vision_ms.items()},
    "vision_tareas": {t: v.get("latencia_ms") for t, v in salud.get("tareas", {}).items()},
}
print(json.dumps(out, indent=1))
