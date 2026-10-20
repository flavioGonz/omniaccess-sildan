"""
Paridad de OWLv2: nuestro preproceso + el ONNX (vocabulario.py) contra Owlv2Processor +
Owlv2ForObjectDetection de transformers en PyTorch, el modelo original de Google.

Se compara lo que importa al usarlo: para cada frase, la MEJOR caja de cada imagen. Tiene que
ser la misma caja (IoU alto) con un puntaje parecido. El preproceso no es bit a bit igual (el
procesador de Google suaviza antes de achicar y acá se usa el bilineal de PIL), así que no se
exige igualdad de los logits sino del resultado.

    python verificar_vocabulario.py /modelos img1.jpg [img2.jpg …]
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from exportar_vocabulario import ORIGINAL, ORIGINAL_REV  # noqa: E402

CONSULTAS = ["a person", "a dog", "a backpack", "a car", "a bicycle"]
IOU_MIN = 0.85
DIF_PUNTAJE_MAX = 0.08


def iou(a, b):
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    i = max(0, x2 - x1) * max(0, y2 - y1)
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i
    return i / u if u > 0 else 0.0


def main(carpeta: str, imagenes: list[str]) -> None:
    import torch
    from transformers import Owlv2ForObjectDetection, Owlv2Processor
    import vocabulario as V

    proc = Owlv2Processor.from_pretrained(ORIGINAL, revision=ORIGINAL_REV)
    ref = Owlv2ForObjectDetection.from_pretrained(ORIGINAL, revision=ORIGINAL_REV).eval()
    voc = V.Vocabulario(Path(carpeta))
    fallas = 0
    for ruta in imagenes:
        img = Image.open(ruta).convert("RGB")
        w, h = img.size
        # La referencia: procesador y modelo originales.
        ent = proc(text=[CONSULTAS], images=img, return_tensors="pt")
        with torch.no_grad():
            r = ref(**ent)
        lado = max(w, h)
        lr = torch.sigmoid(r.logits[0]).numpy()
        br = r.pred_boxes[0].numpy()
        # Lo nuestro, con el mismo decodificador que en producción pero sin umbral.
        objs = voc.detectar(img, CONSULTAS, umbral=0.01)
        for q, c in enumerate(CONSULTAS):
            i = int(lr[:, q].argmax())
            pr = float(lr[i, q])
            if pr < 0.2:
                continue  # la referencia tampoco lo ve: no hay qué comparar
            cx, cy, bw, bh = br[i] * lado
            caja_ref = [max(0, cx - bw / 2), max(0, cy - bh / 2), min(w, cx + bw / 2), min(h, cy + bh / 2)]
            nuestros = [o for o in objs if o.nombre == c]
            if not nuestros:
                print(f"  {Path(ruta).name} «{c}»: referencia {pr:.3f}, nosotros nada  ✗"); fallas += 1; continue
            o = max(nuestros, key=lambda o: o.confianza)
            j = iou(caja_ref, o.caja)
            ok = j >= IOU_MIN and abs(o.confianza - pr) <= DIF_PUNTAJE_MAX
            fallas += 0 if ok else 1
            print(f"  {Path(ruta).name} «{c}»: ref {pr:.3f} / nuestro {o.confianza:.3f} · IoU {j:.3f}  {'✓' if ok else '✗'}")
    if fallas:
        raise SystemExit(f"OWLv2: {fallas} diferencias con el original — no se construye")
    print("OWLv2: paridad OK")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
