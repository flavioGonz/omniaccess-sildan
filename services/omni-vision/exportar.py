"""
Exporta los RF-DETR libres a ONNX, una vez, al construir la imagen.

Sólo los tamaños Apache-2.0 (Nano, Small, Medium). Large también es Apache pero en una 3050
compartida con omni-lpr no se justifica; XL y 2XL son PML 1.0 y quedan afuera a propósito.

Uso: python exportar.py <carpeta destino>
"""

import json
import shutil
import sys
from pathlib import Path

import rfdetr

# Nombre corto (el que va en VISION_MODELO) → clase de rfdetr. COCO AP50:95 y latencia T4
# FP16 según el README de rfdetr, para que Ajustes muestre de dónde sale cada número.
MODELOS = {
    "rfdetr-nano": ("RFDETRNano", 48.4, 2.3),
    "rfdetr-small": ("RFDETRSmall", 53.0, 3.5),
    "rfdetr-medium": ("RFDETRMedium", 54.7, 4.4),
}

destino = Path(sys.argv[1])
destino.mkdir(parents=True, exist_ok=True)
catalogo = {}
for corto, (clase, ap, ms_t4) in MODELOS.items():
    tmp = Path("/tmp/export") / corto
    getattr(rfdetr, clase)().export(output_dir=str(tmp))
    onnx = next(tmp.glob("*.onnx"))
    shutil.copy(onnx, destino / f"{corto}.onnx")
    catalogo[corto] = {"clase": clase, "licencia": "Apache-2.0", "coco_ap": ap, "ms_t4_fp16": ms_t4,
                       "rfdetr": rfdetr.__version__ if hasattr(rfdetr, "__version__") else None}
    print(f"exportado {corto}")
(destino / "catalogo.json").write_text(json.dumps(catalogo, indent=2))
