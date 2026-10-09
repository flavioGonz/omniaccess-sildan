"""
Búsqueda por texto y por imagen con SigLIP 2: el vector de una frase («camioneta blanca con
escalera») y el de una imagen (el recorte de un objeto del registro) viven en el mismo espacio,
así que el coseno entre los dos dice cuánto se parece la imagen a lo escrito.

  · La mitad de imágenes es la misma que usan los atributos (siglip2-imagen.onnx, en GPU).
  · La mitad de texto (siglip2-texto.onnx) corre en CPU y se abre recién con la primera búsqueda:
    son cientos de MB por el vocabulario multilingüe, y una búsqueda es un pedido suelto, no cada
    cuadro. Ver exportar.py para cómo se cuantiza y se compara contra PyTorch.
"""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path

import numpy as np
from PIL import Image

import motor


class Buscador:
    def __init__(self, carpeta: Path):
        self.carpeta = carpeta
        self.meta = json.loads((carpeta / "siglip-texto.json").read_text()) if (carpeta / "siglip-texto.json").exists() else None
        self.sesion = None
        self.tok = None
        self._c = threading.Lock()
        self.total = 0
        self.ultimo_ms = 0.0

    @property
    def disponible(self) -> bool:
        return self.meta is not None

    def _abrir(self):
        import onnxruntime as ort
        from tokenizers import Tokenizer
        with self._c:
            if self.sesion is not None:
                return
            op = ort.SessionOptions()
            op.intra_op_num_threads = motor.HILOS_CPU
            tok = Tokenizer.from_file(str(self.carpeta / "siglip2-tokenizer.json"))
            tok.enable_padding(length=self.meta["largo"], pad_id=self.meta["pad"])
            tok.enable_truncation(self.meta["largo"])
            # La imagen final tokeniza con otra versión de la librería que la exportación: si no
            # da los mismos números que allá, los vectores no se comparan con nada. Se dice.
            if self.meta.get("prueba_ids") and tok.encode(self.meta["prueba"]).ids != self.meta["prueba_ids"]:
                raise RuntimeError("El tokenizador no coincide con el de la exportación")
            self.tok = tok
            self.sesion = ort.InferenceSession(str(self.carpeta / "siglip2-texto.onnx"), op, providers=["CPUExecutionProvider"])

    def textos(self, textos: list[str]) -> np.ndarray:
        if self.sesion is None:
            self._abrir()
        t0 = time.perf_counter()
        ids = np.array([e.ids for e in self.tok.encode_batch([t.lower() if self.meta.get("minusculas") else t for t in textos])], dtype=np.int64)
        v = self.sesion.run(None, {"input_ids": ids})[0]
        self.total += len(textos)
        self.ultimo_ms = (time.perf_counter() - t0) * 1000
        return v / np.linalg.norm(v, axis=1, keepdims=True)

    def estado(self) -> dict:
        return {"disponible": self.disponible, "abierto": self.sesion is not None, "total": self.total,
                "cuantizado": (self.meta or {}).get("cuantizado"), "ultimo_ms": round(self.ultimo_ms, 1)}


def vector_imagen(describidor, img: Image.Image) -> np.ndarray:
    """El vector de la imagen entera (un recorte ya hecho), con la mitad de imágenes de los atributos."""
    m = describidor.meta
    rec = img.convert("RGB").resize((m["ancho"], m["alto"]), Image.BILINEAR)
    x = np.asarray(rec, dtype=np.float32).transpose(2, 0, 1) / 255.0
    x = ((x - describidor.media) / describidor.desvio).astype(np.float32)
    v = describidor.modelo.correr(x[None])["vector"][0]
    return v / np.linalg.norm(v)
