"""
El detector propio: el RF-DETR afinado en OmniVision › Entrenar › Objetos nuevos, corriendo al
lado del de fábrica.

Vive en una carpeta montada (/propio ← /opt/OmniAccess/entrenamientos/activo): `modelo.onnx` y
`modelo.json` (clases, umbral medido, preprocesamiento). Activarlo o cambiarlo es copiar esos dos
archivos —lo hace la app— y acá se nota solo: se mira la fecha de `modelo.json` cada tanto y se
recarga. Sin la carpeta, no hay detector propio y todo sigue igual.

Va aparte de detector.py a propósito: detector.py entra en la primera etapa de la imagen (la que
exporta los modelos de fábrica y comprueba su paridad); cambiarlo obliga a exportar todo de nuevo.
"""

from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path

import numpy as np
from PIL import Image

import detector as D
from motor import Modelo

CARPETA = Path(os.environ.get("VISION_PROPIO", "/propio"))
# Cada cuánto se mira si cambió el modelo activo: activar uno nuevo tarda a lo sumo esto.
MIRAR_CADA_S = 20
# El grupo con que salen sus objetos: el seguimiento, el registro y la pantalla los separan así.
GRUPO = "propio"


def preparar_lineal(imagen: Image.Image, resolucion: int, medias=D.MEDIAS, desvios=D.DESVIOS) -> np.ndarray:
    """Igual que `D.preparar`, pero achicando SIN antialias, como rfdetr (F.resize(antialias=False) ≡
    cv2.INTER_LINEAR) al entrenar y en `predict`.

    Los modelos de fábrica siguen con `D.preparar` (PIL, con antialias): pasan la paridad con 0,05
    de tolerancia y cambiarles la entrada es cambiar lo que ya está verificado. Uno afinado con
    pocas fotos es más sensible: medido el 10/10 sobre cuadros de 704×576, con PIL la confianza se
    corría hasta 0,13 y aparecían cajas que rfdetr no da. Con esto, paridad exacta.
    """
    import cv2
    x = np.asarray(imagen.convert("RGB"), dtype=np.float32) / 255.0
    x = cv2.resize(x, (resolucion, resolucion), interpolation=cv2.INTER_LINEAR).transpose(2, 0, 1)
    x = (x - medias) / desvios
    return x[None].astype(np.float32)


class Propio:
    def __init__(self):
        self.modelo: Modelo | None = None
        self.meta: dict | None = None
        self._firma = None
        self._mirado = 0.0
        self._c = threading.Lock()
        self.error: str | None = None

    def _mirar(self) -> None:
        if time.time() - self._mirado < MIRAR_CADA_S:
            return
        with self._c:
            self._mirado = time.time()
            j = CARPETA / "modelo.json"
            try:
                firma = j.stat().st_mtime if j.exists() and (CARPETA / "modelo.onnx").exists() else None
            except OSError:
                firma = None
            if firma == self._firma:
                return
            self._firma = firma
            self.modelo, self.meta, self.error = None, None, None
            if firma is None:
                return
            try:
                self.meta = json.loads(j.read_text())
                self.modelo = Modelo(str(CARPETA / "modelo.onnx"), "propio")
            except Exception as e:  # un modelo roto no puede tirar la detección de fábrica
                self.error = f"{type(e).__name__}: {e}"
                self.modelo, self.meta = None, None

    def activo(self) -> bool:
        self._mirar()
        return self.modelo is not None

    def detectar(self, img: Image.Image) -> list[D.Objeto]:
        """Los objetos propios de la imagen, con el umbral que se midió al entrenar."""
        if not self.activo():
            return []
        m, meta = self.modelo, self.meta
        ancho, alto = img.size
        clases = {int(c["indice"]): f"propio:{c['id']}" for c in meta["clases"]}
        nombres = {f"propio:{c['id']}": c["nombre"] for c in meta["clases"]}
        s = m.correr(preparar_lineal(img, m.resolucion))
        objetos = D.decodificar(s["dets"], s["labels"], ancho, alto, float(meta.get("umbral", 0.4)), True, clases=clases)
        for o in objetos:
            o.nombre, o.grupo = nombres.get(o.clase, o.clase), GRUPO
            if o.alternativa:
                o.alternativa["nombre"] = nombres.get(o.alternativa["clase"], o.alternativa["clase"])
        return objetos

    def estado(self) -> dict:
        self._mirar()
        if not self.modelo:
            return {"activo": False, **({"error": self.error} if self.error else {})}
        return {"activo": True, "entrenamiento": self.meta.get("entrenamiento"), "clases": [c["nombre"] for c in self.meta["clases"]],
                "umbral": self.meta.get("umbral"), **self.modelo.estado()}
