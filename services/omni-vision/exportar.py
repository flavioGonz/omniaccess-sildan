"""
Exporta a ONNX, una vez, al construir la imagen, todos los modelos libres que usa omni-vision.

  · Detección: RF-DETR Nano / Small / Medium (Apache-2.0). Large también es Apache pero en una
    3050 compartida con omni-lpr no se justifica; XL y 2XL son PML 1.0 y quedan afuera.
  · Segmentación: RF-DETR Seg Small (Apache-2.0): caja + silueta.
  · Pose: RF-DETR Keypoint Preview (Apache-2.0, versión preliminar): 17 puntos por persona.
  · Atributos: la mitad de imágenes de SigLIP 2 base (Apache-2.0) y los vectores de las frases
    de atributos.py, calculados acá con la mitad de texto.
  · Búsqueda: la mitad de TEXTO de SigLIP 2, cuantizada a int8 para correr en CPU, y su
    tokenizador. Es lo que convierte «camioneta blanca con escalera» en un vector comparable con
    los de las imágenes del registro.

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

# ── SigLIP 2, mitad de texto (búsqueda) ──
#
# El vocabulario de Gemma (256 mil palabras × 768) hace pesada a esta mitad: en float32 son más
# de mil MB. Corre en CPU (una búsqueda es un pedido por vez, no cada cuadro) y cuantizada a int8,
# si la cuantización no la cambia: se compara contra PyTorch y si el coseno baja de
# COSENO_MIN_TEXTO se queda la de float32. Lo mismo con el tokenizador: el de la imagen final
# (librería `tokenizers`) tiene que dar los mismos números que el procesador de transformers.
import onnxruntime as ort  # noqa: E402
from onnxruntime.quantization import QuantType, quantize_dynamic  # noqa: E402
from tokenizers import Tokenizer  # noqa: E402

LARGO_TEXTO = 64
COSENO_MIN_TEXTO = 0.98
PRUEBAS_TEXTO = ["camioneta blanca con escalera", "persona con paraguas", "una moto roja", "perro negro",
                 "a white van with a ladder", "repartidor con mochila de delivery"]


class MitadTexto(torch.nn.Module):
    def __init__(self, modelo):
        super().__init__()
        self.m = modelo

    def forward(self, input_ids):
        o = self.m.get_text_features(input_ids=input_ids)
        return o if torch.is_tensor(o) else o.pooler_output


tmp_texto = Path("/tmp/export/siglip2-texto.onnx")
tmp_texto.parent.mkdir(parents=True, exist_ok=True)
torch.onnx.export(MitadTexto(m), (torch.zeros(1, LARGO_TEXTO, dtype=torch.long),), str(tmp_texto),
                  input_names=["input_ids"], output_names=["vector"], opset_version=17, dynamo=False,
                  dynamic_axes={"input_ids": {0: "n"}, "vector": {0: "n"}})
p.tokenizer.save_pretrained("/tmp/export/tok")
shutil.copy("/tmp/export/tok/tokenizer.json", destino / "siglip2-tokenizer.json")

tok = Tokenizer.from_file(str(destino / "siglip2-tokenizer.json"))
pad = p.tokenizer.pad_token_id
tok.enable_padding(length=LARGO_TEXTO, pad_id=pad)
tok.enable_truncation(LARGO_TEXTO)
ref_ids = p(text=[t.lower() for t in PRUEBAS_TEXTO], padding="max_length", max_length=LARGO_TEXTO, truncation=True, return_tensors="np")["input_ids"]
mis_ids = np.array([e.ids for e in tok.encode_batch([t.lower() for t in PRUEBAS_TEXTO])], dtype=np.int64)
if not np.array_equal(ref_ids, mis_ids):
    raise SystemExit("El tokenizador de la imagen final no da lo mismo que transformers")

with torch.no_grad():
    ref = MitadTexto(m)(torch.from_numpy(ref_ids)).numpy()
ref = ref / np.linalg.norm(ref, axis=1, keepdims=True)
tmp_int8 = Path("/tmp/export/siglip2-texto-int8.onnx")
quantize_dynamic(str(tmp_texto), str(tmp_int8), weight_type=QuantType.QInt8)
sal = ort.InferenceSession(str(tmp_int8), providers=["CPUExecutionProvider"]).run(None, {"input_ids": ref_ids})[0]
sal = sal / np.linalg.norm(sal, axis=1, keepdims=True)
coseno = float(np.min(np.sum(ref * sal, axis=1)))
usado = tmp_int8 if coseno >= COSENO_MIN_TEXTO else tmp_texto
shutil.copy(usado, destino / "siglip2-texto.onnx")
(destino / "siglip-texto.json").write_text(json.dumps({
    "largo": LARGO_TEXTO, "pad": int(pad), "minusculas": True,
    "cuantizado": usado == tmp_int8, "coseno_int8": round(coseno, 4),
    # La imagen final tokeniza con otra versión de `tokenizers`: al abrir, compara contra esto.
    "prueba": PRUEBAS_TEXTO[0].lower(), "prueba_ids": [int(x) for x in mis_ids[0]],
}))
catalogo["siglip2-texto"] = {"clase": SIGLIP, "tarea": "busqueda", "licencia": "Apache-2.0"}
print(f"exportado siglip2-texto ({'int8' if usado == tmp_int8 else 'float32'}, coseno int8 {coseno:.4f})", flush=True)

(destino / "catalogo.json").write_text(json.dumps(catalogo, indent=2))
