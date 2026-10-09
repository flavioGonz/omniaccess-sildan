"""
Exporta a ONNX, una vez, al construir la imagen, todos los modelos libres que usa omni-vision.

  · Detección: RF-DETR Nano / Small / Medium (Apache-2.0). Large también es Apache pero en una
    3050 compartida con omni-lpr no se justifica; XL y 2XL son PML 1.0 y quedan afuera.
  · Segmentación: RF-DETR Seg Small (Apache-2.0): caja + silueta.
  · Pose: RF-DETR Keypoint Preview (Apache-2.0, versión preliminar): 17 puntos por persona.
  · Atributos: la mitad de imágenes de SigLIP 2 base (Apache-2.0) y los vectores de las frases
    de atributos.py, calculados acá con la mitad de texto, que no viaja a la imagen final.

Uso: python exportar.py <carpeta destino>
"""

import json
import shutil
import sys
from pathlib import Path

import numpy as np
import torch

import rfdetr
from atributos import frases

destino = Path(sys.argv[1])
destino.mkdir(parents=True, exist_ok=True)

# Nombre corto → (clase de rfdetr, tarea, COCO AP del README de rfdetr, ms en T4 FP16).
MODELOS = {
    "rfdetr-nano": ("RFDETRNano", "detectar", 48.4, 2.3),
    "rfdetr-small": ("RFDETRSmall", "detectar", 53.0, 3.5),
    "rfdetr-medium": ("RFDETRMedium", "detectar", 54.7, 4.4),
    "rfdetr-seg-small": ("RFDETRSegSmall", "segmentar", 43.1, 4.4),
    "rfdetr-pose": ("RFDETRKeypointPreview", "pose", 71.8, 9.7),
}

catalogo = {}
for corto, (clase, tarea, ap, ms_t4) in MODELOS.items():
    tmp = Path("/tmp/export") / corto
    getattr(rfdetr, clase)().export(output_dir=str(tmp))
    onnx = next(tmp.glob("*.onnx"))
    shutil.copy(onnx, destino / f"{corto}.onnx")
    catalogo[corto] = {"clase": clase, "tarea": tarea, "licencia": "Apache-2.0", "coco_ap": ap, "ms_t4_fp16": ms_t4}
    print(f"exportado {corto}", flush=True)

# ── SigLIP 2 ──
from transformers import AutoModel, AutoProcessor  # noqa: E402

SIGLIP = "google/siglip2-base-patch16-256"
m = AutoModel.from_pretrained(SIGLIP).eval()
p = AutoProcessor.from_pretrained(SIGLIP)


class MitadImagen(torch.nn.Module):
    def __init__(self, modelo):
        super().__init__()
        self.v = modelo.vision_model

    def forward(self, pixel_values):
        return self.v(pixel_values=pixel_values).pooler_output


tam = p.image_processor.size
alto, ancho = int(tam["height"]), int(tam["width"])
torch.onnx.export(MitadImagen(m), (torch.zeros(1, 3, alto, ancho),), str(destino / "siglip2-imagen.onnx"),
                  input_names=["pixel_values"], output_names=["vector"], opset_version=17, dynamo=False,
                  # Lote variable: los recortes de una misma foto van juntos, en un solo turno de GPU.
                  dynamic_axes={"pixel_values": {0: "n"}, "vector": {0: "n"}})

lista = frases()
with torch.no_grad():
    enc = p(text=[f for *_, f in lista], padding="max_length", max_length=64, return_tensors="pt")
    salida = m.get_text_features(**enc)
    t = salida if torch.is_tensor(salida) else salida.pooler_output
    t = torch.nn.functional.normalize(t, dim=-1).numpy().astype(np.float32)
np.savez(destino / "atributos.npz", vectores=t)
(destino / "siglip.json").write_text(json.dumps({
    "modelo": SIGLIP, "licencia": "Apache-2.0", "alto": alto, "ancho": ancho,
    "media": list(p.image_processor.image_mean), "desvio": list(p.image_processor.image_std),
    "escala": float(m.logit_scale.exp()), "sesgo": float(m.logit_bias),
    "frases": [list(x) for x in lista],
}, ensure_ascii=False, indent=1))
catalogo["siglip2"] = {"clase": SIGLIP, "tarea": "atributos", "licencia": "Apache-2.0"}
print("exportado siglip2", flush=True)

(destino / "catalogo.json").write_text(json.dumps(catalogo, indent=2))
