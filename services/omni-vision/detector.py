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
import math
import time
from dataclasses import dataclass, field

import numpy as np
from PIL import Image, ImageOps

# Normalización ImageNet: la que usa el backbone DINOv2 de RF-DETR al entrenar.
MEDIAS = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape(3, 1, 1)
DESVIOS = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape(3, 1, 1)

# Cuántos pares (consulta, clase) se miran antes de cortar por umbral; el modelo tiene 300 consultas.
TOP_K = 300


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
    # Qué consulta del modelo lo produjo: con eso se buscan su silueta o sus puntos. No se publica.
    consulta: int = -1
    # Lo que agregan las otras tareas: silueta, puntos, atributos, pista.
    extra: dict = field(default_factory=dict)

    def a_dict(self) -> dict:
        return {
            **({"alternativa": self.alternativa} if self.alternativa else {}),
            "clase": self.clase, "nombre": self.nombre, "grupo": self.grupo,
            "confianza": round(self.confianza, 4),
            "caja": [round(v, 1) for v in self.caja],
            "caja_norm": [round(v, 4) for v in self.caja_norm],
            **self.extra,
        }


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-x))


def abrir_imagen(datos: bytes) -> Image.Image:
    return ImageOps.exif_transpose(Image.open(io.BytesIO(datos))).convert("RGB")


def preparar(imagen: Image.Image, resolucion: int, medias=MEDIAS, desvios=DESVIOS) -> np.ndarray:
    """La imagen como la espera el modelo: 1×3×R×R float32 normalizada."""
    rgb = imagen.convert("RGB").resize((resolucion, resolucion), Image.BILINEAR)
    x = np.asarray(rgb, dtype=np.float32).transpose(2, 0, 1) / 255.0
    x = (x - medias) / desvios
    return x[None].astype(np.float32)


def _caja(cajas: np.ndarray, consulta: int, ancho: int, alto: int):
    cx, cy, w, h = (float(v) for v in cajas[0, consulta])
    x1 = min(max((cx - w / 2), 0.0), 1.0); y1 = min(max((cy - h / 2), 0.0), 1.0)
    x2 = min(max((cx + w / 2), 0.0), 1.0); y2 = min(max((cy + h / 2), 0.0), 1.0)
    return [x1 * ancho, y1 * alto, x2 * ancho, y2 * alto], [x1, y1, x2, y2]


def decodificar(cajas: np.ndarray, logits: np.ndarray, ancho: int, alto: int, umbral: float,
                una_por_caja: bool = True, clases: dict[int, str] | None = None) -> list[Objeto]:
    """De las salidas crudas (1×Q×4 cxcywh normalizado, 1×Q×C logits) a objetos.

    `una_por_caja`: rfdetr devuelve cada par (consulta, clase) sobre el umbral, así que una misma
    caja puede salir como "auto" y como "camión". Para contar y verificar, una caja es un objeto:
    gana la clase más probable y la otra queda como `alternativa`. La comprobación de paridad
    lo apaga para comparar contra rfdetr tal cual.
    """
    clases = clases or CLASES_COCO
    prob = _sigmoid(logits[0])  # Q×C
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
        clase = clases.get(clase_id)
        if clase is None:
            continue  # ids vacíos del esquema COCO de 91: no son clases
        nombre, grupo = nombre_y_grupo(clase)
        if una_por_caja and consulta in por_consulta:
            previo = por_consulta[consulta]
            if previo.alternativa is None:
                previo.alternativa = {"clase": clase, "nombre": nombre, "confianza": round(p, 4)}
            continue
        caja, norm = _caja(cajas, consulta, ancho, alto)
        o = Objeto(clase, nombre, grupo, p, caja, norm, consulta=consulta)
        por_consulta[consulta] = o
        salida.append(o)
    return salida


# ─────────────────────────── siluetas ───────────────────────────

# Lado mayor al que se lleva la máscara antes de sacarle el contorno. La máscara del modelo es de
# 96×96 sobre la imagen entera; agrandarla a la foto completa (2560 px) para dibujar un polígono
# es gastar CPU en precisión que el operador no ve.
LADO_MASCARA = 640
# Simplificación del contorno, en fracción del perímetro: 0,4 % deja la silueta reconocible
# con decenas de puntos en vez de cientos.
SIMPLIFICAR = 0.004
# Contornos más chicos que esto (fracción del área de la imagen) son ruido de la máscara.
AREA_MIN = 0.0002


def mascara(logits_96: np.ndarray, ancho: int, alto: int) -> np.ndarray:
    """La máscara de una consulta (96×96 logits) llevada a ancho×alto, booleana (logit > 0)."""
    import cv2
    m = cv2.resize(logits_96.astype(np.float32), (ancho, alto), interpolation=cv2.INTER_LINEAR)
    return m > 0.0


def silueta(logits_96: np.ndarray, ancho: int, alto: int) -> dict:
    """Polígonos normalizados de la silueta y la fracción de la imagen que ocupa."""
    import cv2
    escala = min(1.0, LADO_MASCARA / max(ancho, alto))
    w, h = max(1, round(ancho * escala)), max(1, round(alto * escala))
    m = mascara(logits_96, w, h).astype(np.uint8)
    contornos, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    poligonos = []
    for c in sorted(contornos, key=cv2.contourArea, reverse=True):
        if cv2.contourArea(c) < AREA_MIN * w * h:
            continue
        a = cv2.approxPolyDP(c, SIMPLIFICAR * cv2.arcLength(c, True), True).reshape(-1, 2)
        if len(a) >= 3:
            poligonos.append([[round(float(x) / w, 4), round(float(y) / h, 4)] for x, y in a])
    return {"silueta": poligonos, "area": round(float(m.sum()) / (w * h), 5)}


# ─────────────────────────── pose ───────────────────────────

PUNTOS = ["nariz", "ojo izq.", "ojo der.", "oreja izq.", "oreja der.", "hombro izq.", "hombro der.",
          "codo izq.", "codo der.", "muñeca izq.", "muñeca der.", "cadera izq.", "cadera der.",
          "rodilla izq.", "rodilla der.", "tobillo izq.", "tobillo der."]
# El modelo de pose tiene dos clases: 0 (sin puntos) y 1 = persona con 17 puntos.
CLASES_POSE = {1: "person"}
PUNTOS_POR_CLASE = [0, 17]
# Un punto con menos de esto de "se ve" no se usa para la postura (queda en la respuesta igual).
PUNTO_VISIBLE = 0.3
# Inclinación del torso respecto de la vertical a partir de la cual la persona está acostada.
ACOSTADA_GRADOS = 60
# Cadera-tobillo más corto que esto (en largos de torso) = agachada o sentada.
AGACHADA_PIERNA = 0.6


def _postura(p: np.ndarray) -> dict:
    """De pie / agachada / acostada, con los puntos que se ven. Sin los cuatro del torso, no se dice."""
    def medio(a, b):
        if p[a, 2] < PUNTO_VISIBLE or p[b, 2] < PUNTO_VISIBLE:
            return None
        return (p[a, :2] + p[b, :2]) / 2
    hombros, caderas = medio(5, 6), medio(11, 12)
    if hombros is None or caderas is None:
        return {"postura": None, "motivo": "no se ven hombros y caderas"}
    dx, dy = caderas - hombros
    torso = math.hypot(dx, dy)
    if torso < 1e-6:
        return {"postura": None, "motivo": "torso sin largo"}
    grados = math.degrees(math.atan2(abs(dx), abs(dy)))
    if grados >= ACOSTADA_GRADOS:
        return {"postura": "acostada", "inclinacion": round(grados)}
    tobillos = medio(15, 16)
    if tobillos is not None and (tobillos[1] - caderas[1]) < AGACHADA_PIERNA * torso:
        return {"postura": "agachada", "inclinacion": round(grados)}
    return {"postura": "de pie", "inclinacion": round(grados)}


def decodificar_pose(salidas: dict, ancho: int, alto: int, umbral: float) -> list[Objeto]:
    """Personas con sus 17 puntos.

    rfdetr además corrige el puntaje de la persona con la incertidumbre de sus puntos (trace
    fusion); acá se usa el puntaje de clase tal cual, así que el umbral equivale a uno algo más
    permisivo. Las coordenadas sí son las mismas (verificar_paridad.py).
    """
    objetos = decodificar(salidas["dets"], salidas["labels"], ancho, alto, umbral, clases=CLASES_POSE)
    kp = salidas["keypoints"][0]  # Q × (C·17) × D
    q, slots, d = kp.shape
    kp = kp.reshape(q, len(PUNTOS_POR_CLASE), max(PUNTOS_POR_CLASE), d)
    for o in objetos:
        crudo = kp[o.consulta, 1, :17]
        p = np.stack([crudo[:, 0] * ancho, crudo[:, 1] * alto, _sigmoid(crudo[:, 2])], axis=1)
        o.extra["puntos"] = [[round(float(x) / ancho, 4), round(float(y) / alto, 4), round(float(c), 3)] for x, y, c in p]
        o.extra.update(_postura(p))
    return objetos


# ─────────────────────────── el servicio ───────────────────────────

class Detector:
    """Detección sola, con su modelo: lo que usa verificar_paridad.py en la construcción."""

    def __init__(self, ruta_onnx: str, usar_gpu: bool = True):
        from motor import Modelo
        self.modelo = Modelo(ruta_onnx, "detectar", usar_gpu)

    def detectar(self, datos: bytes, umbral: float, una_por_caja: bool = True) -> dict:
        img = abrir_imagen(datos)
        ancho, alto = img.size
        s = self.modelo.correr(preparar(img, self.modelo.resolucion))
        objetos = decodificar(s["dets"], s["labels"], ancho, alto, umbral, una_por_caja)
        return {"ancho": ancho, "alto": alto, "ms_inferencia": round(float(self.modelo.ultimo_ms), 1),
                "objetos": [o.a_dict() for o in objetos]}


def segmentar(modelo, img: Image.Image, umbral: float, una_por_caja: bool = True) -> list[Objeto]:
    ancho, alto = img.size
    s = modelo.correr(preparar(img, modelo.resolucion))
    objetos = decodificar(s["dets"], s["labels"], ancho, alto, umbral, una_por_caja)
    for o in objetos:
        o.extra.update(silueta(s["masks"][0, o.consulta], ancho, alto))
    return objetos


def pose(modelo, img: Image.Image, umbral: float) -> list[Objeto]:
    ancho, alto = img.size
    return decodificar_pose(modelo.correr(preparar(img, modelo.resolucion)), ancho, alto, umbral)
