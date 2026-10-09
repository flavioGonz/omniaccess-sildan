"""
Las sesiones de ONNX Runtime de omni-vision y el turno de GPU que comparten.

UN solo cerrojo para todo el contenedor, no uno por modelo: con omni-lpr, dos inferencias
simultáneas en la misma GPU envenenaron el contexto de CUDA (cudaErrorIllegalAddress). Con
cuatro modelos (detección, siluetas, pose, atributos) la tentación es correrlos en paralelo;
no se hace. El cerrojo serializa y quien llama decide cuánto esperar.

Cada modelo se abre recién la primera vez que se lo pide: quien sólo usa la detección no
paga la VRAM de la pose (el modelo de pose es el más grande de los cuatro).
"""

from __future__ import annotations

import os
import threading
import time

import numpy as np

GPU = threading.Lock()
_apertura = threading.Lock()

# Tope de VRAM por sesión. La 3050 tiene 6 GB y omni-lpr vive ahí: sin tope, el área de ONNX
# Runtime crece a potencias de dos y se queda con gigas que no devuelve.
TOPE_VRAM_MB = int(os.environ.get("VISION_TOPE_VRAM_MB", "1536"))
HILOS_CPU = int(os.environ.get("VISION_HILOS_CPU", "2"))
# Cuántas latencias se guardan por modelo para las medianas de /salud.
HISTORIA = 300


class Cola:
    """Cuántos pedidos esperan el turno de GPU, entre todos los modelos."""
    esperando = 0
    en_vuelo = ""


class Modelo:
    def __init__(self, ruta: str, nombre: str, usar_gpu: bool = True):
        self.ruta, self.nombre, self.usar_gpu = ruta, nombre, usar_gpu
        self.sesion = None
        self.proveedor = None
        self.total = 0
        self.errores = 0
        self._ms: list[float] = []
        self.abierto_en: float | None = None

    def _abrir(self):
        import onnxruntime as ort

        with _apertura:
            if self.sesion is not None:
                return
            op = ort.SessionOptions()
            op.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            # Pocos hilos: el CT comparte núcleos con la app, go2rtc y el worker de seguimiento.
            op.intra_op_num_threads = HILOS_CPU
            prov: list = []
            if self.usar_gpu and "CUDAExecutionProvider" in ort.get_available_providers():
                prov.append(("CUDAExecutionProvider", {
                    "device_id": 0,
                    "gpu_mem_limit": TOPE_VRAM_MB * 1024 * 1024,
                    # Crecer sólo lo pedido, no al doble: la VRAM se comparte con omni-lpr.
                    "arena_extend_strategy": "kSameAsRequested",
                    "cudnn_conv_algo_search": "HEURISTIC",
                }))
            prov.append("CPUExecutionProvider")
            s = ort.InferenceSession(self.ruta, op, providers=prov)
            self.entradas = s.get_inputs()
            self.salidas = [o.name for o in s.get_outputs()]
            self.proveedor = s.get_providers()[0]
            self.abierto_en = time.time()
            self.sesion = s

    @property
    def resolucion(self) -> int:
        if self.sesion is None:
            self._abrir()
        return int(self.entradas[0].shape[-1])

    @property
    def entrada(self) -> str:
        if self.sesion is None:
            self._abrir()
        return self.entradas[0].name

    def correr(self, x: np.ndarray) -> dict[str, np.ndarray]:
        if self.sesion is None:
            self._abrir()
        Cola.esperando += 1
        with GPU:
            Cola.esperando -= 1
            Cola.en_vuelo = self.nombre
            t0 = time.perf_counter()
            try:
                out = self.sesion.run(self.salidas, {self.entradas[0].name: x})
            except Exception:
                self.errores += 1
                raise
            finally:
                Cola.en_vuelo = ""
            ms = (time.perf_counter() - t0) * 1000
        self.total += 1
        self._ms.append(ms)
        if len(self._ms) > HISTORIA:
            self._ms = self._ms[-HISTORIA:]
        self.ultimo_ms = ms
        return dict(zip(self.salidas, out))

    def latencias(self) -> dict:
        if not self._ms:
            return {"n": 0}
        a = np.array(self._ms)
        return {"n": int(a.size), "p50": round(float(np.percentile(a, 50)), 1), "p95": round(float(np.percentile(a, 95)), 1)}

    def estado(self) -> dict:
        return {"abierto": self.sesion is not None, "proveedor": self.proveedor, "total": self.total,
                "errores": self.errores, "latencia_ms": self.latencias()}
