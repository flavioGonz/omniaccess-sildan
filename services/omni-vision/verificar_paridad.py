"""
Comprueba que el pre y posproceso propio da lo mismo que las librerías originales en PyTorch.

Se corre en la etapa de exportación de la imagen (donde están torch, rfdetr y transformers):
si una versión nueva cambia su receta, la construcción falla en vez de servir cajas corridas,
siluetas desplazadas o atributos al azar en silencio.

Uso: python verificar_paridad.py <carpeta de modelos> <imagen> <imagen con una persona entera>

La pose se compara sobre la segunda imagen y sólo en los puntos que rfdetr da por visibles: en
una persona cortada por el borde (la de la primera) los puntos fuera de cuadro son adivinanzas
de baja confianza, y una diferencia ahí no dice nada del posproceso.
"""

import json
import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image

import rfdetr
import detector as D
from motor import Modelo

carpeta, ruta_img, ruta_persona = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
img = Image.open(ruta_img).convert("RGB")
W, H = img.size
UMBRAL = 0.5
# Tolerancias: FP32 en ONNX contra PyTorch, más el bilineal de PIL contra el de torch.
TOL_PX = 6.0
TOL_CONF = 0.05
# La silueta propia (cv2.resize) contra la de rfdetr (F.interpolate): misma máscara salvo el borde.
IOU_MIN = 0.95
# El vector de SigLIP en ONNX contra el de PyTorch.
COS_MIN = 0.999


def emparejar(ref_cajas, nuestras):
    """Para cada caja de referencia, la nuestra más cercana."""
    return [min(nuestras, key=lambda o: np.abs(np.array(o.caja) - np.array(c)).max()) for c in ref_cajas]


# ── detección ──
ref = rfdetr.RFDETRSmall().predict(img, threshold=UMBRAL)
m = Modelo(str(carpeta / "rfdetr-small.onnx"), "detectar", usar_gpu=False)
s = m.correr(D.preparar(img, m.resolucion))
nuestro = D.decodificar(s["dets"], s["labels"], W, H, UMBRAL, una_por_caja=False)
assert len(ref.class_id) == len(nuestro), f"detección: {len(ref.class_id)} vs {len(nuestro)} objetos"
for cid, conf, caja, o in zip(ref.class_id, ref.confidence, ref.xyxy, nuestro):
    assert D.CLASES_COCO[int(cid)] == o.clase, f"clase {D.CLASES_COCO[int(cid)]} != {o.clase}"
    assert abs(float(conf) - o.confianza) < TOL_CONF, f"confianza {conf} vs {o.confianza}"
    assert np.max(np.abs(np.array(caja) - np.array(o.caja))) < TOL_PX, f"caja {caja} vs {o.caja}"
print(f"detección ok ({len(nuestro)} objetos)")

# ── siluetas ──
ref = rfdetr.RFDETRSegSmall().predict(img, threshold=UMBRAL)
m = Modelo(str(carpeta / "rfdetr-seg-small.onnx"), "segmentar", usar_gpu=False)
s = m.correr(D.preparar(img, m.resolucion))
nuestro = D.decodificar(s["dets"], s["labels"], W, H, UMBRAL, una_por_caja=False)
assert len(ref.class_id) == len(nuestro), f"siluetas: {len(ref.class_id)} vs {len(nuestro)} objetos"
for mask_ref, o in zip(ref.mask, emparejar(ref.xyxy, nuestro)):
    mio = D.mascara(s["masks"][0, o.consulta], W, H)
    iou = (mio & mask_ref).sum() / max(1, (mio | mask_ref).sum())
    assert iou >= IOU_MIN, f"silueta de {o.clase}: IoU {iou:.3f}"
    print(f"  silueta {o.clase:<10} IoU {iou:.3f}")
print("siluetas ok")

# ── pose ──
persona = Image.open(ruta_persona).convert("RGB")
PW, PH = persona.size
ref = rfdetr.RFDETRKeypointPreview().predict(persona, threshold=0.3)
assert len(ref.xy) >= 1, "pose: rfdetr no vio a la persona de prueba"
m = Modelo(str(carpeta / "rfdetr-pose.onnx"), "pose", usar_gpu=False)
nuestro = D.decodificar_pose(m.correr(D.preparar(persona, m.resolucion)), PW, PH, 0.05)
for xy, conf, o in zip(ref.xy, ref.confidence, emparejar(ref.data["xyxy"], nuestro)):
    p = np.array([[x * PW, y * PH] for x, y, _ in o.extra["puntos"]])
    visibles = conf > 0.5
    d = float(np.abs(p - xy)[visibles].max()) if visibles.any() else 0.0
    assert d < TOL_PX, f"pose: puntos corridos {d:.1f} px"
    print(f"  pose: {int(visibles.sum())} puntos visibles, diferencia máxima {d:.2f} px, postura {o.extra.get('postura')}")
print("pose ok")

# ── atributos (SigLIP) ──
from transformers import AutoModel  # noqa: E402
meta = json.loads((carpeta / "siglip.json").read_text())
sig = AutoModel.from_pretrained(meta["modelo"]).eval()
rec = img.resize((meta["ancho"], meta["alto"]), Image.BILINEAR)
x = (np.asarray(rec, dtype=np.float32).transpose(2, 0, 1) / 255.0 - np.array(meta["media"]).reshape(3, 1, 1)) / np.array(meta["desvio"]).reshape(3, 1, 1)
x = x[None].astype(np.float32)
with torch.no_grad():
    v_ref = sig.vision_model(pixel_values=torch.from_numpy(x)).pooler_output[0].numpy()
v = Modelo(str(carpeta / "siglip2-imagen.onnx"), "atributos", usar_gpu=False).correr(np.concatenate([x, x]))["vector"]
for fila in v:  # el lote de dos tiene que dar dos veces lo mismo
    cos = float(fila @ v_ref / np.linalg.norm(fila) / np.linalg.norm(v_ref))
    assert cos >= COS_MIN, f"SigLIP: coseno {cos:.5f}"
print("atributos ok")
print("PARIDAD_OK")
