"""
El detector de omni-vision: RF-DETR exportado a ONNX, corrido con ONNX Runtime.

Por qué RF-DETR y no YOLO26: YOLO26 es AGPL-3.0 y Ultralytics pide su Licencia Enterprise
para usarlo detrás de un servicio; Nico decidió no pagar licencias (9/10). RF-DETR Nano,
Small, Medium y Large son Apache-2.0 (los XL y 2XL son PML 1.0 y NO se usan) y rinden igual o
mejor que YOLO11 en el mismo tiempo. El contrato HTTP no depende del modelo: si mañana hay
otro detector libre mejor, se cambia acá y nada más.

Por qué ONNX Runtime y no PyTorch: es la misma pila que omni-lpr (CUDA 13 + cuDNN 9, ya
probada en esta 3050), la imagen es varias veces más chica y el consumo de VRAM se puede topar
(ver TOPE_VRAM_MB). PyTorch sólo se usa al construir la imagen, para exportar.

El pre y posproceso replican los de `rfdetr` 1.11 (ver verificar_paridad.py):
  · RGB, estirado a la resolución del modelo (sin bandas), bilineal, /255, normalizado ImageNet.
  · sigmoid sobre las 91 clases COCO, top-K sobre (consulta × clase), cajas cxcywh normalizadas.
"""

from __future__ import annotations

import io
import os
import threading
import time
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageOps

# Normalización ImageNet: la que usa el backbone DINOv2 de RF-DETR al entrenar.
MEDIAS = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape(3, 1, 1)
DESVIOS = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape(3, 1, 1)

# Cuántos pares (consulta, clase) se miran antes de cortar por umbral; el modelo tiene 300 consultas.
TOP_K = 300

# Tope de memoria de GPU para el área de ONNX Runtime. La 3050 tiene 6 GB y omni-lpr vive ahí:
# sin tope, el área crece a potencias de dos y puede quedarse con gigas que no devuelve.
TOPE_VRAM_MB = int(os.environ.get("VISION_TOPE_VRAM_MB", "1536"))

# Ids COCO (con huecos, 1..90) tal como los emite el modelo.
CLASES_COCO = {
    1: "person", 2: "bicycle", 3: "car", 4: "motorcycle", 5: "airplane", 6: "bus", 7: "train",
    8: "truck", 9: "boat", 10: "traffic light", 11: "fire hydrant", 13: "stop sign",
    14: "parking meter", 15: "bench", 16: "bird", 17: "cat", 18: "dog", 19: "horse", 20: "sheep",
    21: "cow", 22: "elephant", 23: "bear", 24: "zebra", 25: "giraffe", 27: "backpack",
    28: "umbrella", 31: "handbag", 32: "tie", 33: "suitcase", 34: "frisbee", 35: "skis",
    36: "snowboard", 37: "sports ball", 38: "kite", 39: "baseball bat", 40: "baseball glove",
    41: "skateboard", 42: "surfboard", 43: "tennis racket", 44: "bottle", 46: "wine glass",
    47: "cup", 48: "fork", 49: "knife", 50: "spoon", 51: "bowl", 52: "banana", 53: "apple",
    54: "sandwich", 55: "orange", 56: "broccoli", 57: "carrot", 58: "hot dog", 59: "pizza",
    60: "donut", 61: "cake", 62: "chair", 63: "couch", 64: "potted plant", 65: "bed",
    67: "dining table", 70: "toilet", 72: "tv", 73: "laptop", 74: "mouse", 75: "remote",
    76: "keyboard", 77: "cell phone", 78: "microwave", 79: "oven", 80: "toaster", 81: "sink",
    82: "refrigerator", 84: "book", 85: "clock", 86: "vase", 87: "scissors", 88: "teddy bear",
    89: "hair drier", 90: "toothbrush",
}

# Lo que a OmniAccess le importa, en su idioma, y a qué grupo pertenece. El grupo es lo que usan
# las reglas (verificación de intrusión, acceso): "vehiculo" junta auto, camioneta y ómnibus.
NOMBRES = {
    "person": ("persona", "persona"),
    "bicycle": ("bicicleta", "vehiculo"),
    "car": ("auto", "vehiculo"),
    "motorcycle": ("moto", "vehiculo"),
    "bus": ("ómnibus", "vehiculo"),
    "truck": ("camión o camioneta", "vehiculo"),
    "train": ("tren", "vehiculo"),
    "boat": ("bote", "vehiculo"),
    "bird": ("pájaro", "animal"),
    "cat": ("gato", "animal"),
    "dog": ("perro", "animal"),
    "horse": ("caballo", "animal"),
    "sheep": ("oveja", "animal"),
    "cow": ("vaca", "animal"),
    "backpack": ("mochila", "objeto"),
    "handbag": ("bolso", "objeto"),
    "suitcase": ("valija", "objeto"),
    "umbrella": ("paraguas", "objeto"),
    "cell phone": ("celular", "objeto"),
    "bottle": ("botella", "objeto"),
    "chair": ("silla", "objeto"),
    "bench": ("banco", "objeto"),
    "skateboard": ("patineta", "objeto"),
    "sports ball": ("pelota", "objeto"),
}


def nombre_y_grupo(clase: str) -> tuple[str, str]:
    return NOMBRES.get(clase, (clase, "otro"))


@dataclass
class Objeto:
    clase: str
    nombre: str
    grupo: str
    confianza: float
    caja: list[float]  # x1, y1, x2, y2 en píxeles de la imagen original
    caja_norm: list[float]  # lo mismo, de 0 a 1
    # La segunda clase que el modelo vio en la MISMA caja (auto 0,52 / camioneta 0,44): se informa
    # en vez de devolver dos objetos, porque es uno solo y contarlo dos veces mentiría.
    alternativa: dict | None = None

    def a_dict(self) -> dict:
        return {
            **({"alternativa": self.alternativa} if self.alternativa else {}),
            "clase": self.clase, "nombre": self.nombre, "grupo": self.grupo,
            "confianza": round(self.confianza, 4),
            "caja": [round(v, 1) for v in self.caja],
            "caja_norm": [round(v, 4) for v in self.caja_norm],
        }


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-x))


def preparar(imagen: Image.Image, resolucion: int) -> np.ndarray:
    """La imagen como la espera el modelo: 1×3×R×R float32 normalizada."""
    rgb = imagen.convert("RGB").resize((resolucion, resolucion), Image.BILINEAR)
    x = np.asarray(rgb, dtype=np.float32).transpose(2, 0, 1) / 255.0
    x = (x - MEDIAS) / DESVIOS
    return x[None].astype(np.float32)


def decodificar(cajas: np.ndarray, logits: np.ndarray, ancho: int, alto: int, umbral: float,
                una_por_caja: bool = True) -> list[Objeto]:
    """De las salidas crudas (1×300×4 cxcywh normalizado, 1×300×91 logits) a objetos.

    `una_por_caja`: rfdetr devuelve cada par (consulta, clase) sobre el umbral, así que una misma
    caja puede salir como "auto" y como "camión". Para contar y verificar, una caja es un objeto:
    gana la clase más probable y la otra queda como `alternativa`. La comprobación de paridad
    lo apaga para comparar contra rfdetr tal cual.
    """
    prob = _sigmoid(logits[0])  # 300×91
    plano = prob.reshape(-1)
    k = min(TOP_K, plano.size)
    # Mismo desempate que rfdetr: puntaje descendente y, a igual puntaje, índice ascendente.
    orden = np.argsort(-plano, kind="stable")[:k]
    n_clases = prob.shape[1]
    salida: list[Objeto] = []
    por_consulta: dict[int, Objeto] = {}
    for idx in orden:
        p = float(plano[idx])
        if p <= umbral:
            break
        consulta, clase_id = divmod(int(idx), n_clases)
        clase = CLASES_COCO.get(clase_id)
        if clase is None:
            continue  # ids vacíos del esquema COCO de 91: no son clases
        nombre, grupo = nombre_y_grupo(clase)
        if una_por_caja and consulta in por_consulta:
            previo = por_consulta[consulta]
            if previo.alternativa is None:
                previo.alternativa = {"clase": clase, "nombre": nombre, "confianza": round(p, 4)}
            continue
        cx, cy, w, h = (float(v) for v in cajas[0, consulta])
        x1 = min(max((cx - w / 2), 0.0), 1.0); y1 = min(max((cy - h / 2), 0.0), 1.0)
        x2 = min(max((cx + w / 2), 0.0), 1.0); y2 = min(max((cy + h / 2), 0.0), 1.0)
        o = Objeto(clase, nombre, grupo, p, [x1 * ancho, y1 * alto, x2 * ancho, y2 * alto], [x1, y1, x2, y2])
        por_consulta[consulta] = o
        salida.append(o)
    return salida


class Detector:
    """Una sesión de ONNX Runtime y UNA inferencia a la vez.

    Una sola en vuelo a propósito: con omni-lpr, dos inferencias simultáneas en la misma GPU
    envenenaron el contexto de CUDA (cudaErrorIllegalAddress). El cerrojo serializa; quien
    llama decide cuánto esperar.
    """

    def __init__(self, ruta_onnx: str, usar_gpu: bool = True):
        import onnxruntime as ort

        self.ruta = ruta_onnx
        opciones = ort.SessionOptions()
        opciones.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        # Pocos hilos de CPU: el CT comparte núcleos con la app, go2rtc y el worker de seguimiento.
        opciones.intra_op_num_threads = int(os.environ.get("VISION_HILOS_CPU", "2"))
        proveedores: list = []
        if usar_gpu and "CUDAExecutionProvider" in ort.get_available_providers():
            proveedores.append(("CUDAExecutionProvider", {
                "device_id": 0,
                "gpu_mem_limit": TOPE_VRAM_MB * 1024 * 1024,
                # Crecer sólo lo pedido, no al doble: la VRAM se comparte con omni-lpr.
                "arena_extend_strategy": "kSameAsRequested",
                "cudnn_conv_algo_search": "HEURISTIC",
            }))
        proveedores.append("CPUExecutionProvider")
        self.sesion = ort.InferenceSession(ruta_onnx, opciones, providers=proveedores)
        self.proveedor = self.sesion.get_providers()[0]
        entrada = self.sesion.get_inputs()[0]
        self.nombre_entrada = entrada.name
        self.resolucion = int(entrada.shape[-1])
        self.salidas = [o.name for o in self.sesion.get_outputs()]
        self._cerrojo = threading.Lock()
        self.en_vuelo = 0
        self.esperando = 0
        self.total = 0
        self.errores = 0
        self._ms: list[float] = []

    def detectar(self, datos: bytes, umbral: float, una_por_caja: bool = True) -> dict:
        imagen = Image.open(io.BytesIO(datos))
        imagen = ImageOps.exif_transpose(imagen)
        ancho, alto = imagen.size
        x = preparar(imagen, self.resolucion)
        self.esperando += 1
        with self._cerrojo:
            self.esperando -= 1
            self.en_vuelo = 1
            t0 = time.perf_counter()
            try:
                salidas = dict(zip(self.salidas, self.sesion.run(self.salidas, {self.nombre_entrada: x})))
            except Exception:
                self.errores += 1
                raise
            finally:
                self.en_vuelo = 0
            ms = (time.perf_counter() - t0) * 1000
        self.total += 1
        self._ms.append(ms)
        if len(self._ms) > 200:
            self._ms = self._ms[-200:]
        objetos = decodificar(salidas["dets"], salidas["labels"], ancho, alto, umbral, una_por_caja)
        return {"ancho": ancho, "alto": alto, "ms_inferencia": round(float(ms), 1), "objetos": [o.a_dict() for o in objetos]}

    def latencias(self) -> dict:
        if not self._ms:
            return {"n": 0}
        a = np.array(self._ms)
        return {"n": int(a.size), "p50": round(float(np.percentile(a, 50)), 1), "p95": round(float(np.percentile(a, 95)), 1)}
