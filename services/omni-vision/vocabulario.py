"""
Vocabulario abierto: detectar lo que se pida por texto («wheelbarrow», «ladder», «garbage bag»),
fuera de las 80 clases de COCO, sin entrenar nada.

Modelo: OWLv2 base patch16 «ensemble» de Google (Apache-2.0), en el ONNX de Xenova
(onnx-community), corrido con ONNX Runtime como el resto. Mira la imagen a 960×960 junto con las
frases y devuelve, por cada uno de sus 3600 parches, una caja y cuánto se parece a cada frase.

Por qué no YOLOE ni YOLO-World: AGPL / GPL. Grounding DINO es Apache también y anda parecido;
OWLv2 se eligió porque transformers lo trae entero y la paridad se puede verificar al construir.

COSTOS (por qué es una tarea aparte y se puede apagar):
  · ~0,6 GB de pesos y más de 1 GB de activaciones a 960 px: no entra sin tope en la 3050 de San
    Nicolás junto a omni-lpr y las otras tareas. Tiene su propio tope (VISION_TOPE_VRAM_VOCAB_MB)
    y se abre recién con el primer pedido.
  · Se SUELTA SOLO tras VISION_VOCAB_INACTIVO_S sin uso (5 min): un pedido suelto no debe dejar
    un giga de VRAM tomado para siempre.
  · Corre bajo el mismo turno de GPU que todo (motor.GPU): nunca en paralelo con otra inferencia.

El preproceso replica Owlv2ImageProcessor (verificar_paridad.py lo compara contra transformers):
  · RGB /255, relleno a cuadrado ABAJO y a la DERECHA con 0,5 (gris), estirado a 960 bilineal,
    normalizado con media/desvío de CLIP.
  · Las cajas salen cxcywh normalizadas al CUADRADO rellenado: se pasan a píxeles con el lado
    mayor de la imagen y se recortan a la imagen.
"""

from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path

import numpy as np
from PIL import Image

import motor
from detector import Objeto

MEDIAS = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32).reshape(3, 1, 1)
DESVIOS = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32).reshape(3, 1, 1)
LADO = 960
LARGO_TEXTO = 16
# Hasta cuántas frases por pedido: cada una suma poco, pero la respuesta crece.
CONSULTAS_MAX = 8
# OWLv2 da puntajes bajos aun a lo correcto (0,2–0,4 es un acierto claro): no es el 0,4 del detector.
UMBRAL_DEFECTO = float(os.environ.get("VISION_VOCAB_UMBRAL", "0.2"))
# Dos cajas de la misma frase que se pisan más que esto son el mismo objeto.
NMS_IOU = 0.3
TOPE_VRAM_MB = int(os.environ.get("VISION_TOPE_VRAM_VOCAB_MB", "2560"))
INACTIVO_S = int(os.environ.get("VISION_VOCAB_INACTIVO_S", "300"))


def _iou(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    x1 = np.maximum(a[0], b[:, 0]); y1 = np.maximum(a[1], b[:, 1])
    x2 = np.minimum(a[2], b[:, 2]); y2 = np.minimum(a[3], b[:, 3])
    inter = np.clip(x2 - x1, 0, None) * np.clip(y2 - y1, 0, None)
    area = lambda c: (c[..., 2] - c[..., 0]) * (c[..., 3] - c[..., 1])  # noqa: E731
    return inter / np.maximum(area(a) + area(b) - inter, 1e-9)


def preparar(img: Image.Image) -> np.ndarray:
    """1×3×960×960: relleno gris abajo/derecha hasta cuadrado, estirado a 960, normalizado CLIP."""
    rgb = img.convert("RGB")
    w, h = rgb.size
    lado = max(w, h)
    lienzo = Image.new("RGB", (lado, lado), (128, 128, 128))
    lienzo.paste(rgb, (0, 0))
    x = np.asarray(lienzo.resize((LADO, LADO), Image.BILINEAR), dtype=np.float32).transpose(2, 0, 1) / 255.0
    # El relleno es 0,5 exacto en el original (después de /255); 128/255 = 0,502 → se corrige.
    if w != h:
        if w > h:
            x[:, int(round(h / lado * LADO)):, :] = 0.5
        else:
            x[:, :, int(round(w / lado * LADO)):] = 0.5
    return ((x - MEDIAS) / DESVIOS)[None].astype(np.float32)


class Vocabulario:
    def __init__(self, carpeta: Path):
        self.carpeta = carpeta
        self.meta = json.loads((carpeta / "owlv2.json").read_text()) if (carpeta / "owlv2.json").exists() else None
        self.sesion = None
        self.proveedor = None
        self.tok = None
        self.entradas: list = []
        self.salidas: list[str] = []
        self._c = threading.Lock()
        self.total = 0
        self.errores = 0
        self.ultimo_ms = 0.0
        self.ultimo_uso = 0.0
        self._ms: list[float] = []

    @property
    def disponible(self) -> bool:
        return self.meta is not None

    def _abrir(self):
        import onnxruntime as ort
        from tokenizers import Tokenizer
        with self._c:
            if self.sesion is not None:
                return
            tok = Tokenizer.from_file(str(self.carpeta / "owlv2-tokenizer.json"))
            tok.enable_padding(length=LARGO_TEXTO, pad_id=self.meta["pad"], pad_token="!")
            tok.enable_truncation(LARGO_TEXTO)
            if self.meta.get("prueba_ids") and tok.encode(self.meta["prueba"]).ids != self.meta["prueba_ids"]:
                raise RuntimeError("El tokenizador de OWLv2 no coincide con el de la construcción")
            op = ort.SessionOptions()
            op.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            op.intra_op_num_threads = motor.HILOS_CPU
            prov: list = []
            if "CUDAExecutionProvider" in ort.get_available_providers():
                prov.append(("CUDAExecutionProvider", {
                    "device_id": 0, "gpu_mem_limit": TOPE_VRAM_MB * 1024 * 1024,
                    "arena_extend_strategy": "kSameAsRequested", "cudnn_conv_algo_search": "HEURISTIC",
                }))
            prov.append("CPUExecutionProvider")
            s = ort.InferenceSession(str(self.carpeta / "owlv2.onnx"), op, providers=prov)
            self.entradas = s.get_inputs()
            # Sólo lo que se usa: los embeddings de imagen (60×60×768) no se copian de la GPU en cada pedido.
            self.salidas = ["logits", "pred_boxes"]
            self.proveedor = s.get_providers()[0]
            self.tok = tok
            self.sesion = s

    def soltar(self) -> None:
        """Devuelve la VRAM (bajo el turno de GPU, para no sacarle la sesión a una inferencia)."""
        with motor.GPU:
            self.sesion = None
            self.entradas = []

    def soltar_si_inactivo(self) -> bool:
        if self.sesion is not None and time.time() - self.ultimo_uso > INACTIVO_S:
            self.soltar()
            return True
        return False

    def detectar(self, img: Image.Image, consultas: list[str], umbral: float | None = None) -> list[Objeto]:
        consultas = [c.strip()[:80] for c in consultas if c and c.strip()][:CONSULTAS_MAX]
        if not consultas:
            return []
        if self.sesion is None:
            self._abrir()
        self.ultimo_uso = time.time()
        u = UMBRAL_DEFECTO if umbral is None else max(0.01, min(0.95, umbral))
        enc = self.tok.encode_batch([c.lower() for c in consultas])
        ids = np.array([e.ids for e in enc], dtype=np.int64)
        mascara = np.array([e.attention_mask for e in enc], dtype=np.int64)
        x = preparar(img)
        alimento = {}
        for e in self.entradas:
            alimento[e.name] = x if e.name == "pixel_values" else ids if e.name == "input_ids" else mascara
        motor.Cola.esperando += 1
        with motor.GPU:
            motor.Cola.esperando -= 1
            motor.Cola.en_vuelo = "vocabulario"
            t0 = time.perf_counter()
            try:
                out = dict(zip(self.salidas, self.sesion.run(self.salidas, alimento)))
            except Exception:
                self.errores += 1
                raise
            finally:
                motor.Cola.en_vuelo = ""
            ms = (time.perf_counter() - t0) * 1000
        self.total += 1
        self.ultimo_ms = ms
        self._ms = (self._ms + [ms])[-motor.HISTORIA:]
        return decodificar(out["logits"][0], out["pred_boxes"][0], consultas, img.size, u)

    def latencias(self) -> dict:
        if not self._ms:
            return {"n": 0}
        a = np.array(self._ms)
        return {"n": int(a.size), "p50": round(float(np.percentile(a, 50)), 1), "p95": round(float(np.percentile(a, 95)), 1)}

    def estado(self) -> dict:
        return {"disponible": self.disponible, "abierto": self.sesion is not None, "proveedor": self.proveedor,
                "total": self.total, "errores": self.errores, "latencia_ms": self.latencias(),
                "suelta_tras_s": INACTIVO_S, "tope_vram_mb": TOPE_VRAM_MB}


def decodificar(logits: np.ndarray, cajas: np.ndarray, consultas: list[str], tam: tuple[int, int], umbral: float) -> list[Objeto]:
    """logits N×Q, cajas N×4 (cxcywh 0-1 del cuadrado rellenado) → objetos, sin repetidos por frase."""
    ancho, alto = tam
    lado = float(max(ancho, alto))
    prob = 1.0 / (1.0 + np.exp(-logits))
    mejor = prob.argmax(axis=1)
    p = prob[np.arange(prob.shape[0]), mejor]
    sel = np.where(p >= umbral)[0]
    if sel.size == 0:
        return []
    cx, cy, w, h = (cajas[sel, i] * lado for i in range(4))
    xyxy = np.stack([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], axis=1)
    xyxy[:, [0, 2]] = np.clip(xyxy[:, [0, 2]], 0, ancho)
    xyxy[:, [1, 3]] = np.clip(xyxy[:, [1, 3]], 0, alto)
    out: list[Objeto] = []
    for q in np.unique(mejor[sel]):
        idx = [i for i in range(sel.size) if mejor[sel[i]] == q]
        orden = sorted(idx, key=lambda i: -p[sel[i]])
        quedan: list[int] = []
        for i in orden:
            if quedan and (_iou(xyxy[i], xyxy[quedan]) > NMS_IOU).any():
                continue
            quedan.append(i)
        for i in quedan:
            c = xyxy[i]
            if c[2] - c[0] < 2 or c[3] - c[1] < 2:
                continue
            out.append(Objeto(
                clase=f"vocab:{consultas[q]}", nombre=consultas[q], grupo="vocabulario", confianza=float(p[sel[i]]),
                caja=[float(v) for v in c], caja_norm=[float(c[0] / ancho), float(c[1] / alto), float(c[2] / ancho), float(c[3] / alto)],
            ))
    out.sort(key=lambda o: -o.confianza)
    return out
