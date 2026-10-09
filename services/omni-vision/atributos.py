"""
Atributos de un objeto ya detectado: color y carrocería de un vehículo, color de la ropa y
qué lleva una persona. Con SigLIP 2 (Google, Apache-2.0), que compara una imagen con frases.

Por qué frases fijas y precalculadas: el modelo tiene dos mitades, una para imágenes y otra
para texto. Las frases de los atributos no cambian, así que su mitad se corre UNA vez al
construir la imagen y se guardan los vectores (atributos.npz). En ejecución sólo corre la
mitad de imágenes, sobre el recorte del objeto: menos VRAM y sin tokenizador. La búsqueda
libre por texto (fase 3) sí va a necesitar la mitad de texto en vivo.

Cómo se decide cada atributo:
  · "uno" (color, carrocería): las opciones compiten entre sí y gana la más parecida. Se
    informa con su probabilidad relativa; si ninguna se despega (< MARGEN_MIN sobre la
    segunda), se dice "dudoso" en vez de elegir al azar.
  · "si_no" (lleva mochila, chaleco…): cada uno es un par de frases (lo tiene / no lo tiene)
    que compiten entre sí. Una frase sola contra la imagen da números chicos sin escala
    (SigLIP es así); el par da una proporción que se puede leer.

Las frases van en inglés porque es donde el modelo está más afinado; lo que se muestra va
en español. Este archivo lo usan la exportación (para calcular los vectores) y el servicio
(para nombrar el resultado), así que no puede importar onnxruntime ni torch arriba.
"""

from __future__ import annotations

COLORES = [
    ("blanco", "white"), ("negro", "black"), ("gris", "gray"), ("plateado", "silver"),
    ("rojo", "red"), ("azul", "blue"), ("verde", "green"), ("amarillo", "yellow"),
    ("marrón o beige", "brown"), ("naranja", "orange"),
]
COLORES_ROPA = [c for c in COLORES if c[0] != "plateado"]

# Para qué clase COCO se calcula cada atributo, y cómo se nombra el objeto en la frase.
SUJETO = {"car": "car", "truck": "truck", "bus": "bus", "motorcycle": "motorcycle", "person": "person"}

ATRIBUTOS: list[dict] = [
    {
        "id": "color", "nombre": "Color", "tipo": "uno", "clases": ["car", "truck", "bus", "motorcycle"],
        "opciones": [(es, f"a photo of a {en} {{s}}") for es, en in COLORES],
    },
    {
        "id": "carroceria", "nombre": "Carrocería", "tipo": "uno", "clases": ["car", "truck"],
        "opciones": [
            ("sedán", "a photo of a sedan car"),
            ("hatchback", "a photo of a small hatchback car"),
            ("SUV", "a photo of an SUV"),
            ("pickup", "a photo of a pickup truck"),
            ("furgón", "a photo of a delivery van"),
            ("camión", "a photo of a large cargo truck"),
        ],
    },
    {
        "id": "ropa", "nombre": "Ropa (arriba)", "tipo": "uno", "clases": ["person"],
        "opciones": [(es, f"a photo of a person wearing a {en} top") for es, en in COLORES_ROPA],
    },
    {
        "id": "chaleco", "nombre": "Chaleco reflectivo", "tipo": "si_no", "clases": ["person"],
        "opciones": [("sí", "a photo of a person wearing a high-visibility reflective safety vest"),
                     ("no", "a photo of a person wearing ordinary clothes")],
    },
    {
        "id": "casco", "nombre": "Casco", "tipo": "si_no", "clases": ["person", "motorcycle"],
        "opciones": [("sí", "a photo of a person wearing a helmet"),
                     ("no", "a photo of a person with no helmet, head uncovered")],
    },
    {
        "id": "mochila", "nombre": "Mochila o bolso", "tipo": "si_no", "clases": ["person"],
        "opciones": [("sí", "a photo of a person carrying a backpack or a bag"),
                     ("no", "a photo of a person with empty hands and no bag")],
    },
    {
        "id": "nino", "nombre": "Niño", "tipo": "si_no", "clases": ["person"],
        "opciones": [("sí", "a photo of a child"), ("no", "a photo of an adult")],
    },
]

# Una opción tiene que ganarle a la segunda por esto (en probabilidad relativa) para no ser "dudoso".
MARGEN_MIN = 0.15
# En un par sí/no, por debajo de esto no se afirma ninguna de las dos.
SI_NO_MIN = 0.65


def frases() -> list[tuple[str, str, str, str]]:
    """(atributo, clase, opción, frase) para cada vector a precalcular."""
    out = []
    for a in ATRIBUTOS:
        for clase in a["clases"]:
            for es, frase in a["opciones"]:
                out.append((a["id"], clase, es, frase.replace("{s}", SUJETO[clase])))
    return out


# ─────────────────────────── en ejecución ───────────────────────────

# Cuántos objetos por imagen se describen: los de mayor confianza. Cada uno es un recorte más
# por la mitad de imágenes de SigLIP (~10 ms); sin tope, una calle llena demora la respuesta.
MAX_OBJETOS = 8
# Margen alrededor de la caja al recortar: el modelo reconoce mejor un auto con un poco de calle.
MARGEN = 0.08
# Un recorte más chico que esto (en píxeles del lado menor) no tiene color ni casco legibles.
LADO_MIN = 24


class Describidor:
    """La mitad de imágenes de SigLIP y los vectores de las frases, ya cargados."""

    def __init__(self, carpeta, usar_gpu: bool = True):
        import json
        import numpy as np
        from motor import Modelo
        self.meta = json.loads((carpeta / "siglip.json").read_text())
        self.vectores = np.load(carpeta / "atributos.npz")["vectores"]
        self.modelo = Modelo(str(carpeta / "siglip2-imagen.onnx"), "atributos", usar_gpu)
        # (atributo, clase) → [(opción, fila de `vectores`)]
        self.indice: dict[tuple[str, str], list[tuple[str, int]]] = {}
        for i, (attr, clase, op, _f) in enumerate(self.meta["frases"]):
            self.indice.setdefault((attr, clase), []).append((op, i))
        self.media = np.array(self.meta["media"], dtype=np.float32).reshape(3, 1, 1)
        self.desvio = np.array(self.meta["desvio"], dtype=np.float32).reshape(3, 1, 1)

    def describir(self, img, objetos) -> int:
        """Agrega `atributos` a los objetos que tienen; devuelve cuántos se describieron."""
        import numpy as np
        from PIL import Image
        W, H = img.size
        candidatos = [o for o in objetos if any(o.clase in a["clases"] for a in ATRIBUTOS)]
        candidatos = sorted(candidatos, key=lambda o: -o.confianza)[:MAX_OBJETOS]
        lotes, cuales = [], []
        for o in candidatos:
            x1, y1, x2, y2 = o.caja
            mw, mh = (x2 - x1) * MARGEN, (y2 - y1) * MARGEN
            r = (max(0, x1 - mw), max(0, y1 - mh), min(W, x2 + mw), min(H, y2 + mh))
            if min(r[2] - r[0], r[3] - r[1]) < LADO_MIN:
                o.extra["atributos"] = []
                o.extra["atributos_motivo"] = "muy chico para describir"
                continue
            rec = img.crop(tuple(int(v) for v in r)).resize((self.meta["ancho"], self.meta["alto"]), Image.BILINEAR)
            x = np.asarray(rec, dtype=np.float32).transpose(2, 0, 1) / 255.0
            lotes.append(((x - self.media) / self.desvio).astype(np.float32))
            cuales.append(o)
        if not lotes:
            return 0
        v = self.modelo.correr(np.stack(lotes))["vector"]
        v = v / np.linalg.norm(v, axis=1, keepdims=True)
        for o, vec in zip(cuales, v):
            o.extra["atributos"] = self._leer(o.clase, vec)
        return len(cuales)

    def _leer(self, clase: str, vec) -> list[dict]:
        import numpy as np
        out = []
        for a in ATRIBUTOS:
            ops = self.indice.get((a["id"], clase))
            if not ops:
                continue
            filas = [i for _, i in ops]
            logits = self.meta["escala"] * (self.vectores[filas] @ vec) + self.meta["sesgo"]
            p = np.exp(logits - logits.max()); p = p / p.sum()
            orden = np.argsort(-p)
            mejor, segunda = float(p[orden[0]]), float(p[orden[1]]) if len(orden) > 1 else 0.0
            valor = ops[orden[0]][0]
            if a["tipo"] == "si_no":
                dudoso = mejor < SI_NO_MIN
            else:
                dudoso = (mejor - segunda) < MARGEN_MIN
            out.append({
                "id": a["id"], "nombre": a["nombre"], "tipo": a["tipo"], "valor": valor,
                "prob": round(mejor, 3), "dudoso": bool(dudoso),
                "opciones": [{"valor": ops[j][0], "prob": round(float(p[j]), 3)} for j in orden[:3]],
            })
        return out
