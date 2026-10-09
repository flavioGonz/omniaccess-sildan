"""
omni-vision: servicio HTTP de visión para OmniAccess (como omni-lpr, al lado).

Sólo inferencia. De dónde sale el cuadro, qué significa el resultado y qué se guarda vive en
la app (lib/vision*, laboratorio /admin/vision): ver openspec/changes/detector-objetos-yolo.

Contrato (estable, independiente de los modelos):
  GET  /salud      → modelos y su estado, cola, latencias por tarea, VRAM, sesiones de seguimiento.
  POST /tareas     → {apagadas:[...]} qué tareas no corren (detectar, segmentar, pose, atributos,
                     texto, seguimiento). Apagar una suelta su modelo de la GPU.
  POST /detectar   → cuerpo = la imagen (JPEG/PNG) o multipart con campo "imagen".
        ?tarea=detectar|segmentar|pose   qué modelo mira la imagen (defecto: detectar)
        ?atributos=1                     además, color/carrocería/ropa/chaleco… de cada objeto
        ?sesion=<id>&fps=2               además, número de pista (cuadros seguidos de una cámara)
        ?texto=1                         además, el texto que se lee en la imagen (OCR de escena)
        ?umbral=0.4  ?grupos=persona,vehiculo
     → {ancho, alto, tarea, modelo, ms, pasos:{…ms}, objetos:[{clase, nombre, grupo, confianza,
        caja, caja_norm, silueta?, area?, puntos?, postura?, atributos?, pista?}],
        textos?:[{texto, confianza, poligono, sobreimpreso, tipo, dentro?}]}
"""

from __future__ import annotations

import gc
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
import motor
from motor import Cola, Modelo
from seguimiento import Sesiones
from texto import Lector

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
lector = Lector()
NOMBRE_MODELO = {"detectar": MODELO, "segmentar": MODELO_SILUETAS, "pose": MODELO_POSE}
arranque = time.time()

# Las tareas apagadas desde la app (Setting VISION_TAREAS). La app es la dueña: este conjunto
# arranca vacío y vision-worker lo vuelve a mandar en cada vuelta, así un reinicio del
# contenedor no deja prendido lo que alguien apagó.
TAREAS = ("detectar", "segmentar", "pose", "atributos", "texto", "seguimiento")
apagadas: set[str] = set()

app = FastAPI(title="omni-vision", docs_url=None, redoc_url=None)

# ─────────────── cuánto pesa cada tarea, medido acá ───────────────
#
# El laboratorio muestra un «peso» por tarea y no puede ser un número de folleto: la misma red
# pesa distinto según la placa, la resolución y la versión de ONNX Runtime. Se mide en el
# momento en que la tarea se carga (VRAM y RAM antes y después de la PRIMERA inferencia, que
# es cuando ONNX Runtime reserva su memoria; abrir la sesión sola reserva poco) y el CPU de
# cada pedido. Es aproximado y se dice así: la VRAM es la de toda la placa, y si omni-lpr
# reserva algo en ese mismo instante se le atribuye a la tarea.
CPU_HISTORIA = 200
medidas: dict[str, dict] = {}
_cpu_salud = {"t": time.time(), "c": time.process_time(), "pct": None}


def _vram_usada_mb() -> int | None:
    try:
        r = subprocess.run(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=3)
        return int(r.stdout.strip().split("\n")[0])
    except Exception:
        return None


def _rss_mb() -> float:
    try:
        for linea in open("/proc/self/status"):
            if linea.startswith("VmRSS:"):
                return int(linea.split()[1]) / 1024
    except Exception:
        pass
    return 0.0


def _tope_ram_mb() -> float | None:
    """El tope de memoria del contenedor (cgroup v2), si tiene."""
    try:
        v = open("/sys/fs/cgroup/memory.max").read().strip()
        return None if v == "max" else int(v) / 1024 / 1024
    except Exception:
        return None


def _cargada(t: str) -> bool:
    if t in modelos:
        return modelos[t].sesion is not None
    if t == "atributos":
        return describidor.modelo.sesion is not None
    if t == "texto":
        return lector.motor is not None
    return True  # seguimiento: no carga nada


def _paso(t: str, fn):
    """Corre un paso y anota cuánto CPU costó; si es la carga de la tarea, cuánta memoria tomó."""
    nueva = not _cargada(t)
    v0, r0 = (_vram_usada_mb(), _rss_mb()) if nueva else (None, None)
    c0 = time.process_time()
    out = fn()
    m = medidas.setdefault(t, {"cpu": []})
    m["cpu"].append((time.process_time() - c0) * 1000)
    if len(m["cpu"]) > CPU_HISTORIA:
        m["cpu"] = m["cpu"][-CPU_HISTORIA:]
    # Puede no haberse cargado (atributos sin objetos que describir): entonces no hay qué medir.
    if nueva and _cargada(t):
        v1 = _vram_usada_mb()
        if v0 is not None and v1 is not None:
            m["vram_mb"] = max(0, v1 - v0)
        m["ram_mb"] = round(max(0.0, _rss_mb() - r0), 1)
        m["medido"] = int(time.time())
    return out


def _medidas_salud() -> dict:
    out = {}
    for t, m in medidas.items():
        cpu = sorted(m["cpu"])
        out[t] = {"vram_mb": m.get("vram_mb"), "ram_mb": m.get("ram_mb"), "medido": m.get("medido"),
                  "cpu_ms": round(cpu[len(cpu) // 2], 1) if cpu else None, "n": len(cpu)}
    return out


def _cpu_pct() -> float | None:
    """CPU del proceso desde la consulta anterior, en % de UN núcleo (100 = un núcleo entero)."""
    ahora, c = time.time(), time.process_time()
    dt = ahora - _cpu_salud["t"]
    if dt >= 1:
        _cpu_salud["pct"] = round((c - _cpu_salud["c"]) / dt * 100, 1)
        _cpu_salud.update(t=ahora, c=c)
    return _cpu_salud["pct"]


def _precalentar() -> None:
    """Se abre la detección al arrancar —es la que se usa siempre— y se la mide de paso.

    Incluye el contexto de CUDA, que paga la primera tarea que se carga y comparten todas."""
    from PIL import Image
    m = modelos["detectar"]
    _paso("detectar", lambda: m.correr(D.preparar(Image.new("RGB", (640, 480)), m.resolucion)))


_precalentar()


def _vram() -> dict | None:
    """Memoria de la GPU entera (no sólo la nuestra): lo que importa es cuánto le queda a omni-lpr."""
    try:
        r = subprocess.run(["nvidia-smi", "--query-gpu=memory.used,memory.total,utilization.gpu",
                            "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=3)
        usada, total, uso = [int(x.strip()) for x in r.stdout.strip().split(",")]
        return {"usada_mb": usada, "total_mb": total, "uso_gpu": uso}
    except Exception:
        return None


def _soltar(t: str) -> None:
    """Suelta la sesión de una tarea apagada: así devuelve su VRAM (que es de omni-lpr también).

    Bajo el turno de GPU, para no sacarle la sesión a una inferencia que está corriendo. Si
    después se prende, la próxima foto la vuelve a abrir (paga la carga una vez)."""
    with motor.GPU:
        if t in modelos:
            modelos[t].sesion = None
        elif t == "atributos":
            describidor.modelo.sesion = None
        elif t == "texto":
            lector.motor = None
            lector._parchado = False
        elif t == "seguimiento":
            # Las pistas viejas no sirven al volver: se empiezan de cero.
            with sesiones._c:
                sesiones._s.clear()
    gc.collect()


@app.post("/tareas")
async def poner_tareas(request: Request):
    try:
        cuerpo = await request.json()
    except Exception:
        raise HTTPException(400, "Se espera JSON {apagadas:[...]}.")
    pedidas = {str(t) for t in (cuerpo.get("apagadas") or []) if str(t) in TAREAS}
    nuevas = pedidas - apagadas
    apagadas.clear()
    apagadas.update(pedidas)
    for t in nuevas:
        await run_in_threadpool(_soltar, t)
    return {"apagadas": sorted(apagadas), "soltadas": sorted(nuevas)}


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
        "total": sum(m.total for m in modelos.values()) + describidor.modelo.total + lector.total,
        "errores": sum(m.errores for m in modelos.values()) + describidor.modelo.errores,
        "latencia_ms": det.latencias(),
        # Lo nuevo: cada tarea con su modelo y sus números.
        "tareas": {
            **{t: {"modelo": NOMBRE_MODELO[t], **catalogo[NOMBRE_MODELO[t]], **m.estado(), "activa": t not in apagadas} for t, m in modelos.items()},
            "atributos": {"modelo": describidor.meta["modelo"], "licencia": describidor.meta["licencia"], **describidor.modelo.estado(), "activa": "atributos" not in apagadas},
            "texto": {"modelo": "RapidOCR · PP-OCR", "licencia": "Apache-2.0", **lector.estado(), "activa": "texto" not in apagadas},
        },
        "seguimiento": {"sesiones": sesiones.cuantas(), "licencia": "Apache-2.0 (trackers · ByteTrack)", "activa": "seguimiento" not in apagadas},
        "apagadas": sorted(apagadas),
        # Lo medido por tarea (ver _paso) y lo que ocupa el proceso entero ahora.
        "medidas": _medidas_salud(),
        "proceso": {"ram_mb": round(_rss_mb()), "tope_ram_mb": _tope_ram_mb(), "cpu_pct": _cpu_pct(), "nucleos": os.cpu_count()},
        "tope_vram_mb": int(os.environ.get("VISION_TOPE_VRAM_MB", "1536")),
        "vram": _vram(),
        "modelos_disponibles": [k for k, v in catalogo.items() if v.get("tarea") == "detectar"],
        "segundos_arriba": int(time.time() - arranque),
    }


def _procesar(datos: bytes, tarea: str, umbral: float, atributos: bool, sesion: str | None, fps: float, texto: bool = False) -> dict:
    pasos: dict[str, float] = {}
    img = D.abrir_imagen(datos)
    ancho, alto = img.size
    m = modelos[tarea]

    def principal():
        if tarea == "segmentar":
            return D.segmentar(m, img, umbral)
        if tarea == "pose":
            return D.pose(m, img, umbral)
        s = m.correr(D.preparar(img, m.resolucion))
        return D.decodificar(s["dets"], s["labels"], ancho, alto, umbral)
    objetos = _paso(tarea, principal)
    pasos[tarea] = round(float(m.ultimo_ms), 1)
    if atributos and objetos:
        n = _paso("atributos", lambda: describidor.describir(img, objetos))
        if n:
            pasos["atributos"] = round(float(describidor.modelo.ultimo_ms), 1)
    seg = None
    if sesion:
        seg = _paso("seguimiento", lambda: sesiones.actualizar(sesion[:64], objetos, fps))
    textos = None
    if texto:
        textos = _paso("texto", lambda: lector.leer(img, objetos))
        pasos["texto"] = round(float(lector.ultimo_ms), 1)
    return {"ancho": ancho, "alto": alto, "pasos": pasos, "seguimiento": seg, "objetos": objetos,
            **({"textos": textos} if textos is not None else {})}


@app.post("/detectar")
async def detectar(request: Request, umbral: float | None = None, grupos: str | None = None,
                   tarea: str = "detectar", atributos: int = 0, sesion: str | None = None, fps: float | None = None,
                   texto: int = 0):
    if tarea not in modelos:
        raise HTTPException(400, f"Tarea desconocida: {tarea}. Hay: {', '.join(modelos)}.")
    if tarea in apagadas:
        # 409 y no una lista vacía: «no hay nadie» y «no se miró» son respuestas distintas.
        return JSONResponse({"error": f"La tarea {tarea} está apagada.", "apagada": tarea}, status_code=409)
    # Los agregados apagados se ignoran y se dice cuáles: la detección sigue sirviendo sin ellos.
    ignoradas = [t for t, pedido in (("atributos", atributos), ("texto", texto), ("seguimiento", sesion)) if pedido and t in apagadas]
    if "atributos" in ignoradas:
        atributos = 0
    if "texto" in ignoradas:
        texto = 0
    if "seguimiento" in ignoradas:
        sesion = None
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
        r = await run_in_threadpool(_procesar, datos, tarea, u, bool(atributos), sesion, fps or FPS_DEFECTO, bool(texto))
    except Exception as e:  # imagen ilegible o fallo de la GPU: se dice cuál
        return JSONResponse({"error": f"{type(e).__name__}: {e}"}, status_code=422 if "Image" in type(e).__name__ else 500)
    objetos = r.pop("objetos")
    if grupos:
        quiero = {g.strip() for g in grupos.split(",") if g.strip()}
        objetos = [o for o in objetos if o.grupo in quiero]
    return {
        **r, "tarea": tarea, "modelo": NOMBRE_MODELO[tarea], "umbral": u,
        **({"apagadas": ignoradas} if ignoradas else {}),
        "ms": round((time.perf_counter() - t0) * 1000, 1),
        # Compatibilidad con quien leía la latencia del detector con este nombre.
        "ms_inferencia": r["pasos"].get(tarea),
        "objetos": [o.a_dict() for o in objetos],
    }
