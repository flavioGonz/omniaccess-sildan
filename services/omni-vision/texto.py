"""
Leer texto en la imagen (OCR de escena): rotulados de camionetas, carteles, matrículas de
motos, números de puerta, el modelo de un auto ("GLC300").

RapidOCR (Apache-2.0) con los modelos PP-OCR de PaddleOCR (Apache-2.0) que trae el paquete,
en ONNX Runtime: dos pasos, uno que encuentra dónde hay texto y otro que lo lee. No es un
lector de matrículas — para eso está omni-lpr —, es el que lee lo demás.

Corre bajo el MISMO turno de GPU que los modelos de visión (motor.GPU): RapidOCR abre sus
propias sesiones de ONNX Runtime, y dos inferencias simultáneas en la GPU ya envenenaron el
contexto CUDA de omni-lpr.

Además de leer, marca dos cosas que hacen falta para usar el texto:
  · `sobreimpreso`: lo que escribe la propia cámara (fecha, hora, "Camera Info…", el nombre
    del canal). Es texto de verdad pero no es de la escena, y en una cámara LPR es la mitad.
  · `dentro`: el objeto detectado que contiene el texto (si se pidió con detección). "Texto
    sobre una camioneta" es un rotulado; suelto, un cartel.
"""

from __future__ import annotations

import math
import re
import time

import numpy as np

import motor

# Por debajo de esto, lo leído es ruido (rayas, hojas, rejas).
CONFIANZA_MIN = 0.6
# Lado mayor de la imagen para encontrar texto: a 2000 px una foto de 2560 apenas se achica;
# más grande no mejora y tarda.
LADO_MAX = 2000
# El lector de renglones recibe lotes de ancho variable (el del renglón más largo). En la GPU,
# cada forma nueva le cuesta ~1,2 s a ONNX Runtime (planifica de nuevo); con la misma forma,
# 17 ms. Medido el 9/10 en la 3050: 1,85 s por foto sólo en leer 9 renglones. Por eso los lotes
# se rellenan a anchos fijos (múltiplos de esto) y a lote completo: pocas formas, todas
# conocidas después de las primeras fotos.
ANCHO_PASO = 320

# Lo que imprime la cámara sobre la imagen: fecha, hora, y la franja de datos de las Hikvision
# LPR ("Camera Info: Device No.…", "Vehicle Color", "Confidence"). Se reconoce por el texto, no
# por la posición: cada instalación pone el sobreimpreso en otro lado.
SOBREIMPRESO = re.compile(
    r"(\d{2}[-/.]\d{2}[-/.]\d{2,4})|(\d{1,2}:\d{2}:\d{2})|camera\s*info|capture\s*time|device\s*no|"
    r"vehicle\s*(color|type|brand)|moving\s*dire|conf\s*idence|plate\s*no|camera\s*no|matricula\s*-\s*p\d|^ip\s*\d",
    re.IGNORECASE,
)
# Una matrícula uruguaya (3 letras + 4 números, con o sin espacio) o del formato viejo (letra + 6).
# Con 3 números también entraba "GLC300", el modelo de un Mercedes.
MATRICULA = re.compile(r"^[A-Z]{3}\s?\d{4}$|^[A-Z]\s?\d{6}$")


class Lector:
    def __init__(self, usar_gpu: bool = True):
        self.usar_gpu = usar_gpu
        self.motor = None
        self.total = 0
        self.errores = 0
        self._ms: list[float] = []
        self.ultimo_ms = 0.0
        self.proveedor = None

    def _abrir(self):
        from rapidocr import RapidOCR
        self.motor = RapidOCR(params={
            "Global.log_level": "error",
            "Global.max_side_len": LADO_MAX,
            "EngineConfig.onnxruntime.use_cuda": self.usar_gpu,
            # Igual que los otros modelos: crecer sólo lo pedido y buscar algoritmo por heurística
            # (EXHAUSTIVE prueba todos al arrancar y tarda segundos por cada tamaño nuevo).
            "EngineConfig.onnxruntime.cuda_ep_cfg.arena_extend_strategy": "kSameAsRequested",
            "EngineConfig.onnxruntime.cuda_ep_cfg.cudnn_conv_algo_search": "HEURISTIC",
            "EngineConfig.onnxruntime.intra_op_num_threads": motor.HILOS_CPU,
            # Sin el clasificador de orientación: endereza texto dado vuelta (180°), que en una
            # cámara de calle casi no existe, y es un modelo más por foto.
            "Global.use_cls": False,
        })
        self._parchado = False
        import onnxruntime as ort
        en_gpu = self.usar_gpu and "CUDAExecutionProvider" in ort.get_available_providers()
        self.proveedor = "CUDAExecutionProvider" if en_gpu else "CPUExecutionProvider"

    def _rellenar_lotes(self):
        """Envuelve la sesión del lector de renglones para que siempre vea las mismas formas."""
        rec = getattr(self.motor, "text_rec", None)
        # RapidOCR carga sus modelos recién en la primera foto: hasta entonces no hay qué envolver.
        if rec is None or self._parchado:
            return
        original = rec.session
        lote = int(rec.rec_batch_num)

        class Relleno:
            def __call__(self, x):
                n, c, h, w = x.shape
                ancho = max(ANCHO_PASO, int(math.ceil(w / ANCHO_PASO) * ANCHO_PASO))
                # Relleno con 0: es lo mismo que pone RapidOCR para emparejar un lote (gris medio
                # una vez normalizado), así que un renglón no cambia por ir acompañado.
                x2 = np.zeros((max(lote, n), c, h, ancho), dtype=np.float32)
                x2[:n, :, :, :w] = x
                return original(x2)[:n]

        rec.session = Relleno()
        self._parchado = True

    def leer(self, img, objetos=None) -> list[dict]:
        if self.motor is None:
            with motor._apertura:
                if self.motor is None:
                    self._abrir()
        motor.Cola.esperando += 1
        with motor.GPU:
            motor.Cola.esperando -= 1
            motor.Cola.en_vuelo = "texto"
            t0 = time.perf_counter()
            try:
                r = self.motor(img)
                self._rellenar_lotes()
            except Exception:
                self.errores += 1
                raise
            finally:
                motor.Cola.en_vuelo = ""
            ms = (time.perf_counter() - t0) * 1000
        self.total += 1
        self.ultimo_ms = ms
        self._ms = (self._ms + [ms])[-motor.HISTORIA:]

        W, H = img.size
        out = []
        cajas = r.boxes if r.boxes is not None else []
        for txt, conf, caja in zip(r.txts or [], r.scores or [], cajas):
            conf = float(conf)
            if conf < CONFIANZA_MIN or not txt.strip():
                continue
            pol = [[round(float(x) / W, 4), round(float(y) / H, 4)] for x, y in np.asarray(caja)]
            limpio = txt.strip()
            t = {
                "texto": limpio, "confianza": round(conf, 3), "poligono": pol,
                "sobreimpreso": bool(SOBREIMPRESO.search(limpio)),
                "tipo": "matricula" if MATRICULA.match(limpio.upper()) else "texto",
            }
            if objetos:
                cx = sum(p[0] for p in pol) / len(pol)
                cy = sum(p[1] for p in pol) / len(pol)
                for i, o in enumerate(objetos):
                    x1, y1, x2, y2 = o.caja_norm
                    if x1 <= cx <= x2 and y1 <= cy <= y2:
                        t["dentro"] = {"indice": i, "clase": o.clase, "nombre": o.nombre}
                        break
            out.append(t)
        return out

    def latencias(self) -> dict:
        if not self._ms:
            return {"n": 0}
        a = np.array(self._ms)
        return {"n": int(a.size), "p50": round(float(np.percentile(a, 50)), 1), "p95": round(float(np.percentile(a, 95)), 1)}

    def estado(self) -> dict:
        return {"abierto": self.motor is not None, "proveedor": self.proveedor, "total": self.total,
                "errores": self.errores, "latencia_ms": self.latencias()}
