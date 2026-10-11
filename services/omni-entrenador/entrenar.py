"""
Entrena el detector propio de OmniVision: RF-DETR afinado con las fotos dibujadas en
OmniVision › Entrenar › Objetos nuevos. Corre en un contenedor aparte (omni-entrenador), una vez
por entrenamiento, y termina: no queda nada corriendo.

Entrada (la deja scripts/entrenador.js en la carpeta del trabajo):
    <trabajo>/crudo/dataset.json   { clases: [{id, nombre}], fotos: [{archivo, cajas: [{clase, caja: [x1,y1,x2,y2]}]}] }
    <trabajo>/crudo/<archivo>.jpg
    <trabajo>/parametros.json      { modelo, epocas, lote, acumular, lr, max_minutos, semilla }

Salida, en la misma carpeta:
    progreso.json   cada época: dónde va y las métricas de validación (lo lee la pantalla)
    resultado.json  al final: métricas por clase, la correspondencia de clases del ONNX y si dio la
                    paridad con rfdetr
    modelo.onnx     el detector afinado, listo para omni-vision
    detener         si aparece (lo crea «Cancelar»), el entrenamiento para al terminar la época

Por qué RF-DETR y no YOLO: es el detector que ya usa omni-vision (Apache-2.0); YOLO de
Ultralytics es AGPL. El ONNX que sale se lee con el mismo pre y posproceso que el de fábrica.
"""

import json
import random
import shutil
import sys
import time
import traceback
from pathlib import Path

import numpy as np
from PIL import Image

TRABAJO = Path(sys.argv[1])
CRUDO = TRABAJO / "crudo"
DATOS = TRABAJO / "coco"
SALIDA = TRABAJO / "salida"

# Fracción de fotos con objetos que va a validación: con 100-300 recuadros, 15 % deja ~20-45 para
# medir sin quitarle demasiado al entrenamiento.
VALIDACION = 0.15
# Debajo de esto no se puede medir nada: se valida con lo que haya y se dice.
VALIDACION_MIN = 3
# El umbral de fábrica de omni-vision: ante un empate de F1, se prefiere el más cercano a éste.
UMBRAL = 0.4
# Umbrales que se prueban para el modelo propio, y con cuál se predice una sola vez para contarlos.
UMBRALES = [0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7]
UMBRAL_BAJO = 0.1
# Para comparar rfdetr con el ONNX hacen falta detecciones: se compara con umbral bajo. Con el de
# trabajo, un modelo de pocas épocas no da ninguna y la paridad salía 1,0 sin haber comparado nada.
UMBRAL_PARIDAD = 0.05


def escribir(nombre: str, datos: dict) -> None:
    tmp = TRABAJO / f".{nombre}.tmp"
    tmp.write_text(json.dumps(datos, ensure_ascii=False, indent=1))
    tmp.replace(TRABAJO / nombre)  # de una vez: la pantalla nunca lee un archivo a medias


def armar_coco(manifiesto: dict, semilla: int) -> dict:
    """De dataset.json a la estructura que pide rfdetr (train/valid/test con _annotations.coco.json).

    Las categorías van de 0 a N-1 en el orden de las clases; las negativas (fotos sin recuadros)
    van todas a entrenamiento: en validación no suman a la medición y le enseñan a no ver de más.
    """
    clases = manifiesto["clases"]
    idx = {c["id"]: i for i, c in enumerate(clases)}
    fotos = [f for f in manifiesto["fotos"] if (CRUDO / f["archivo"]).exists()]
    con = [f for f in fotos if f["cajas"]]
    sin = [f for f in fotos if not f["cajas"]]
    rnd = random.Random(semilla)
    rnd.shuffle(con)
    n_val = max(VALIDACION_MIN, round(len(con) * VALIDACION)) if len(con) > VALIDACION_MIN * 2 else 0
    valid, train = con[:n_val], con[n_val:] + sin
    if not n_val:
        valid = con[:]  # muy pocas: se valida sobre las mismas (y el resultado lo dice)
    categorias = [{"id": i, "name": c["nombre"], "supercategory": "propio"} for i, c in enumerate(clases)]
    for nombre, lista in (("train", train), ("valid", valid), ("test", valid)):
        d = DATOS / nombre
        d.mkdir(parents=True, exist_ok=True)
        imgs, anns = [], []
        for k, f in enumerate(lista):
            with Image.open(CRUDO / f["archivo"]) as im:
                w, h = im.size
            shutil.copy(CRUDO / f["archivo"], d / f["archivo"])
            imgs.append({"id": k, "file_name": f["archivo"], "width": w, "height": h})
            for c in f["cajas"]:
                x1, y1, x2, y2 = c["caja"]
                bw, bh = (x2 - x1) * w, (y2 - y1) * h
                anns.append({"id": len(anns), "image_id": k, "category_id": idx[c["clase"]],
                             "bbox": [x1 * w, y1 * h, bw, bh], "area": bw * bh, "iscrowd": 0})
        (d / "_annotations.coco.json").write_text(json.dumps({"images": imgs, "annotations": anns, "categories": categorias}))
    return {"entrenamiento": len(train), "validacion": len(valid), "negativas": len(sin), "valida_sobre_las_mismas": not n_val,
            "cajas": sum(len(f["cajas"]) for f in con)}


def iou(a, b) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / u if u > 0 else 0.0


def medir(predecir, clases: list[dict]) -> dict:
    """Aciertos por clase sobre validación, y el umbral que mejor anda: lo que muestra la pantalla.

    Un recuadro dibujado está «encontrado» si el detector da una caja de su clase con IoU ≥ 0,5;
    una caja del detector sin recuadro que la explique es una «de más». Más simple que el mAP de
    COCO (que también se guarda), y se puede contar a mano. Se predice una vez con umbral bajo y
    se cuenta en cada umbral de UMBRALES: el modelo propio sale con el que da mejor F1, no con el
    de fábrica (un modelo afinado con pocas fotos suele estar menos seguro de sí).
    """
    ann = json.loads((DATOS / "valid" / "_annotations.coco.json").read_text())
    por_img: dict[int, list] = {}
    for a in ann["annotations"]:
        por_img.setdefault(a["image_id"], []).append(a)
    casos = []
    for im in ann["images"]:
        w, h = im["width"], im["height"]
        reales = [(a["category_id"], [a["bbox"][0] / w, a["bbox"][1] / h, (a["bbox"][0] + a["bbox"][2]) / w, (a["bbox"][1] + a["bbox"][3]) / h]) for a in por_img.get(im["id"], [])]
        casos.append((reales, predecir(DATOS / "valid" / im["file_name"], UMBRAL_BAJO)))

    def contar(t: float) -> dict:
        res = {i: {"recuadros": 0, "encontrados": 0, "de_mas": 0} for i in range(len(clases))}
        for reales, todas in casos:
            preds = [p for p in todas if p[2] >= t]
            usados = set()
            for c, caja in reales:
                res[c]["recuadros"] += 1
                mejor = max(((iou(caja, p[1]), j) for j, p in enumerate(preds) if p[0] == c and j not in usados), default=(0, -1))
                if mejor[0] >= 0.5:
                    res[c]["encontrados"] += 1
                    usados.add(mejor[1])
            for j, p in enumerate(preds):
                if j not in usados and p[0] in res:
                    res[p[0]]["de_mas"] += 1
        return res

    def f1(res: dict) -> float:
        tp = sum(v["encontrados"] for v in res.values())
        fn = sum(v["recuadros"] - v["encontrados"] for v in res.values())
        fp = sum(v["de_mas"] for v in res.values())
        return 2 * tp / (2 * tp + fn + fp) if tp else 0.0

    mejor_t = max(UMBRALES, key=lambda t: (f1(contar(t)), -abs(t - UMBRAL)))
    res = contar(mejor_t)
    return {"umbral": mejor_t, "f1": round(f1(res), 3), "por_clase": {clases[i]["id"]: v for i, v in res.items()}}


def main() -> None:
    p = json.loads((TRABAJO / "parametros.json").read_text())
    manifiesto = json.loads((CRUDO / "dataset.json").read_text())
    clases = manifiesto["clases"]
    t0 = time.time()
    escribir("progreso.json", {"fase": "preparando", "t": time.time()})
    conjunto = armar_coco(manifiesto, int(p.get("semilla", 7)))

    import torch
    import rfdetr
    import rfdetr.training as rt
    from pytorch_lightning import Callback

    epocas = int(p["epocas"])
    max_seg = float(p.get("max_minutos", 180)) * 60

    class Avance(Callback):
        """Cada época: escribe el avance, y para si se pidió cancelar o se pasó del tiempo."""

        def on_validation_epoch_end(self, trainer, module):
            m = {k: float(v) for k, v in trainer.callback_metrics.items() if hasattr(v, "item") and v.numel() == 1}
            ULTIMAS.clear(); ULTIMAS.update(m)
            transcurrido = time.time() - t0
            escribir("progreso.json", {"fase": "entrenando", "epoca": trainer.current_epoch + 1, "de": epocas,
                                       "metricas": m, "segundos": round(transcurrido), "t": time.time()})
            if (TRABAJO / "detener").exists() or transcurrido > max_seg:
                trainer.should_stop = True

    ULTIMAS: dict = {}
    original = rt.build_trainer

    def con_avance(*a, **k):
        tr = original(*a, **k)
        tr.callbacks.append(Avance())
        return tr

    rt.build_trainer = con_avance

    Clase = getattr(rfdetr, p.get("modelo", "RFDETRNano"))
    modelo = Clase()
    escribir("progreso.json", {"fase": "entrenando", "epoca": 0, "de": epocas, "t": time.time()})
    modelo.train(dataset_dir=str(DATOS), output_dir=str(SALIDA), epochs=epocas, batch_size=int(p.get("lote", 4)),
                 grad_accum_steps=int(p.get("acumular", 4)), lr=float(p.get("lr", 1e-4)), num_workers=int(p.get("hilos", 2)),
                 device="cuda" if torch.cuda.is_available() else "cpu", tensorboard=False, progress_bar=None,
                 early_stopping=True, early_stopping_patience=int(p.get("paciencia", 15)), checkpoint_interval=max(1, epocas))
    cancelado = (TRABAJO / "detener").exists()

    escribir("progreso.json", {"fase": "exportando", "t": time.time()})
    mejor = next((SALIDA / n for n in ("checkpoint_best_total.pth", "checkpoint_best_ema.pth", "checkpoint_best_regular.pth") if (SALIDA / n).exists()), None)
    final = Clase(pretrain_weights=str(mejor)) if mejor else modelo
    final.export(output_dir=str(SALIDA / "onnx"))
    onnx = next((SALIDA / "onnx").glob("*.onnx"))
    shutil.copy(onnx, TRABAJO / "modelo.onnx")

    # Lo que dice rfdetr, y lo mismo leído con el pre/posproceso de omni-vision sobre el ONNX.
    # Si no coinciden, el modelo no se ofrece: omni-vision vería otra cosa que la medida acá.
    def por_rfdetr(ruta):
        d = final.predict(str(ruta), threshold=UMBRAL_PARIDAD)
        w, h = Image.open(ruta).size
        return [(int(c), [x1 / w, y1 / h, x2 / w, y2 / h]) for (x1, y1, x2, y2), c in zip(d.xyxy.tolist(), d.class_id.tolist())]

    sys.path.insert(0, str(Path(__file__).parent))  # detector.py y motor.py van al lado (Dockerfile)
    from detector import decodificar, preparar_lineal as preparar  # el mismo archivo que omni-vision (sin antialias, como rfdetr)
    from motor import Modelo
    m_onnx = Modelo(str(TRABAJO / "modelo.onnx"), "detectar", usar_gpu=False)
    nombres = {i: f"propio:{c['id']}" for i, c in enumerate(clases)}
    # El ONNX emite logits por clase; con categorías 0..N-1 la columna i es la clase i. Si rfdetr
    # agregó una columna de fondo adelante, se corre uno: se elige el corrimiento que da paridad.
    col = int(m_onnx.correr(preparar(Image.new("RGB", (64, 64)), m_onnx.resolucion))["labels"].shape[-1])
    mejor_desp, mejor_coin = 0, -1.0
    muestras = sorted((DATOS / "valid").glob("*.jpg"))[:10]
    for desp in range(0, max(1, col - len(clases) + 1)):
        mapa = {i + desp: f"{i}" for i in range(len(clases))}
        coin = tot = 0
        for ruta in muestras:
            img = Image.open(ruta).convert("RGB")
            s = m_onnx.correr(preparar(img, m_onnx.resolucion))
            a = [(int(o.clase), o.caja_norm) for o in decodificar(s["dets"], s["labels"], img.width, img.height, UMBRAL_PARIDAD, False, clases=mapa)]
            b = por_rfdetr(ruta)
            tot += max(len(a), len(b))
            coin += sum(1 for x in a if any(x[0] == y[0] and iou(x[1], y[1]) > 0.9 for y in b))
        frac = coin / tot if tot else -1.0  # sin detecciones no se comparó nada: no cuenta como paridad
        if frac > mejor_coin:
            mejor_desp, mejor_coin = desp, frac

    def por_onnx(ruta, umbral):
        img = Image.open(ruta).convert("RGB")
        s = m_onnx.correr(preparar(img, m_onnx.resolucion))
        mapa = {i + mejor_desp: f"{i}" for i in range(len(clases))}
        return [(int(o.clase), o.caja_norm, o.confianza) for o in decodificar(s["dets"], s["labels"], img.width, img.height, umbral, True, clases=mapa)]

    # Las de rfdetr en la última validación (mAP de COCO, precisión, recall), para quien quiera el detalle.
    resultados = {k: round(v, 4) for k, v in ULTIMAS.items() if k.startswith("val/")}
    escribir("resultado.json", {
        "ok": True, "cancelado": cancelado, "segundos": round(time.time() - t0), "conjunto": conjunto,
        "modelo": p.get("modelo", "RFDETRNano"), "resolucion": int(m_onnx.resolucion), "preproceso": "lineal",
        "clases": [{"indice": i + mejor_desp, "id": c["id"], "nombre": c["nombre"]} for i, c in enumerate(clases)],
        "columnas": col, "paridad": round(mejor_coin, 3) if mejor_coin >= 0 else None, "medicion": medir(por_onnx, clases), "coco": resultados,
    })
    escribir("progreso.json", {"fase": "listo", "t": time.time()})


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        escribir("resultado.json", {"ok": False, "error": f"{type(e).__name__}: {e}", "traza": traceback.format_exc()[-4000:]})
        escribir("progreso.json", {"fase": "fallo", "t": time.time()})
        sys.exit(1)
