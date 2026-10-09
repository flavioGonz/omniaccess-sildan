"""
¿Conviene "más YOLO" para leer matrículas? Medición sobre capturas reales de las barreras.

Toma eventos de las cámaras LPR de acceso (Hikvision, con su ANPR propio) y lee cada foto de
dos maneras con omni-lpr, el lector en contenedor (fast-alpr: YOLOv9 para encontrar la chapa
+ un OCR CCT para leerla):

  A. Foto entera, como lee hoy el seguimiento (detector de 640 px, OCR cct-xs).
  B. Primero el vehículo: omni-vision encuentra autos/camionetas/motos, se recorta cada uno
     con margen y omni-lpr lee el recorte. La chapa ocupa más píxeles del cuadro que ve el
     detector de chapas, que es lo que suele fallar en una foto ancha.

Y lo compara con lo que leyó la cámara (que hace de referencia cuando leyó) y, en los
NO_LEIDA de la cámara, cuenta cuántos cada método logra leer.

No toca la base ni los servicios: sólo lee fotos y llama a los dos lectores. Corre dentro de
la imagen de omni-vision (tiene PIL y numpy) con la red del host:

  docker run --rm --network host -e TOKEN=... -v /tmp/cmp:/w omni-vision:gpu \
      python3 /w/comparar_lpr.py /w/eventos.json /w/resultado.json

eventos.json: [{"id", "placa" (de la cámara), "foto" (/api/files/...)}]
"""

import base64
import io
import json
import os
import re
import sys
import time
import urllib.request

from PIL import Image

APP = os.environ.get("APP_URL", "http://127.0.0.1:10001")
LPR = os.environ.get("OMNI_LPR_URL", "http://127.0.0.1:8000")
VISION = os.environ.get("OMNI_VISION_URL", "http://127.0.0.1:8010")
TOKEN = os.environ.get("TOKEN", "")
DETECTOR = "yolo-v9-t-640-license-plate-end2end"
OCR = "cct-xs-v1-global-model"
VEHICULOS = {"car", "truck", "bus", "motorcycle"}
MARGEN = 0.10


def pedir(url, cuerpo=None, tipo="application/json", cookie=False, ms=20):
    h = {"Content-Type": tipo} if cuerpo is not None else {}
    if cookie and TOKEN:
        h["Cookie"] = f"session={TOKEN}"
    r = urllib.request.urlopen(urllib.request.Request(url, data=cuerpo, headers=h), timeout=ms)
    return r.read()


def leer(jpeg: bytes):
    t0 = time.perf_counter()
    cuerpo = json.dumps({"image_base64": base64.b64encode(jpeg).decode(), "detector_model": DETECTOR, "ocr_model": OCR}).encode()
    d = json.loads(pedir(f"{LPR}/api/v1/tools/detect_and_recognize_plate/invoke", cuerpo))
    ms = (time.perf_counter() - t0) * 1000
    items = (d.get("content") or [{}])[0].get("data") or []
    out = []
    for it in items:
        txt = re.sub(r"[^A-Z0-9]", "", ((it.get("ocr") or {}).get("text") or "").upper())
        c = (it.get("ocr") or {}).get("confidence")
        conf = sum(c) / len(c) if isinstance(c, list) and c else (c or 0)
        if 6 <= len(txt) <= 8 and re.search(r"[A-Z]", txt) and re.search(r"[0-9]", txt):
            out.append((txt, round(min(conf, (it.get("detection") or {}).get("confidence", 1)), 3)))
    return sorted(out, key=lambda x: -x[1]), ms


def distancia(a, b):
    """Caracteres distintos (Levenshtein), para contar 'casi' una lectura."""
    if a == b:
        return 0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def main():
    eventos = json.load(open(sys.argv[1]))
    salida = []
    for e in eventos:
        try:
            jpeg = pedir(APP + e["foto"], cookie=True)
        except Exception as ex:
            salida.append({**e, "error": f"foto: {ex}"})
            continue
        img = Image.open(io.BytesIO(jpeg)).convert("RGB")
        W, H = img.size
        a, ms_a = leer(jpeg)
        t0 = time.perf_counter()
        v = json.loads(pedir(f"{VISION}/detectar?grupos=vehiculo", jpeg, "image/jpeg"))
        ms_v = (time.perf_counter() - t0) * 1000
        vehiculos = [o for o in v["objetos"] if o["clase"] in VEHICULOS]
        b, ms_b = [], 0.0
        for o in vehiculos:
            x1, y1, x2, y2 = o["caja"]
            mw, mh = (x2 - x1) * MARGEN, (y2 - y1) * MARGEN
            rec = img.crop((int(max(0, x1 - mw)), int(max(0, y1 - mh)), int(min(W, x2 + mw)), int(min(H, y2 + mh))))
            buf = io.BytesIO(); rec.save(buf, "JPEG", quality=92)
            r, ms = leer(buf.getvalue())
            b += r; ms_b += ms
        b = sorted(b, key=lambda x: -x[1])
        salida.append({**e, "ancho": W, "alto": H,
                       "a": a[:3], "ms_a": round(ms_a, 1),
                       "vehiculos": [(o["clase"], o["confianza"]) for o in vehiculos], "ms_vision": round(ms_v, 1),
                       "b": b[:3], "ms_b": round(ms_b, 1)})
        print(e["placa"], "A:", a[:1], "B:", b[:1], len(vehiculos), "veh", flush=True)

    # Resumen
    def mejor(lst):
        return lst[0][0] if lst else None
    res = {"n": len(salida)}
    leidas = [s for s in salida if "error" not in s and s["placa"] != "NO_LEIDA"]
    nol = [s for s in salida if "error" not in s and s["placa"] == "NO_LEIDA"]
    for k in ("a", "b"):
        res[f"{k}_exacta"] = sum(1 for s in leidas if mejor(s[k]) == s["placa"])
        res[f"{k}_casi"] = sum(1 for s in leidas if mejor(s[k]) and distancia(mejor(s[k]), s["placa"]) <= 1)
        res[f"{k}_nada"] = sum(1 for s in leidas if not s[k])
        res[f"{k}_en_noleidas"] = sum(1 for s in nol if s[k])
        ms = sorted(s[f"ms_{k}"] for s in salida if "error" not in s)
        res[f"{k}_ms_p50"] = ms[len(ms) // 2] if ms else None
    ms = sorted(s["ms_vision"] for s in salida if "error" not in s)
    res["vision_ms_p50"] = ms[len(ms) // 2] if ms else None
    res["leidas_por_camara"] = len(leidas)
    res["noleidas_por_camara"] = len(nol)
    res["sin_vehiculo"] = sum(1 for s in salida if "error" not in s and not s["vehiculos"])
    res["errores"] = sum(1 for s in salida if "error" in s)
    json.dump({"resumen": res, "eventos": salida}, open(sys.argv[2], "w"), ensure_ascii=False, indent=1)
    print(json.dumps(res, indent=1))


main()
