"""
Comprueba que el pre y posproceso propio (detector.py) da lo mismo que `rfdetr` en PyTorch.

Se corre en la etapa de exportación de la imagen (donde están torch y rfdetr): si el
paquete cambia su receta en una versión nueva, la construcción falla en vez de servir
cajas corridas en silencio.

Uso: python verificar_paridad.py <modelo.onnx> <clase rfdetr> <imagen>
"""

import sys

import numpy as np
from PIL import Image

import rfdetr
from detector import Detector

ruta, nombre_clase, ruta_img = sys.argv[1], sys.argv[2], sys.argv[3]
UMBRAL = 0.5
# Tolerancia: FP32 en ONNX vs PyTorch, más el redondeo del bilineal de PIL contra el de torch.
TOL_PX = 6.0
TOL_CONF = 0.05

modelo = getattr(rfdetr, nombre_clase)()
ref = modelo.predict(Image.open(ruta_img).convert("RGB"), threshold=UMBRAL)
det = Detector(ruta, usar_gpu=False)
with open(ruta_img, "rb") as f:
    nuestro = det.detectar(f.read(), UMBRAL, una_por_caja=False)["objetos"]

ids_ref = list(ref.class_id)
print(f"rfdetr: {len(ids_ref)} objetos; omni-vision: {len(nuestro)}")
assert len(ids_ref) == len(nuestro), "distinta cantidad de objetos"
for (cid, conf, caja), o in zip(zip(ids_ref, ref.confidence, ref.xyxy), nuestro):
    from detector import CLASES_COCO
    assert CLASES_COCO[int(cid)] == o["clase"], f"clase {CLASES_COCO[int(cid)]} != {o['clase']}"
    assert abs(float(conf) - o["confianza"]) < TOL_CONF, f"confianza {conf} vs {o['confianza']}"
    assert np.max(np.abs(np.array(caja) - np.array(o["caja"]))) < TOL_PX, f"caja {caja} vs {o['caja']}"
    print(f"  ok {o['clase']:<12} {o['confianza']:.3f}")
print("PARIDAD_OK")
