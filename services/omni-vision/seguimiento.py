"""
Seguimiento: a cada objeto un número que se mantiene mientras se mueve entre cuadros.

ByteTrack (paquete `trackers` de Roboflow, Apache-2.0). No es otro modelo: asocia las cajas
del detector de un cuadro con las del anterior (IoU + un filtro de Kalman que predice dónde
debería estar). Por eso sólo funciona con cuadros SEGUIDOS de la misma cámara.

Cada cámara que se sigue es una "sesión" con su propio rastreador. Las sesiones viven en
memoria y se tiran solas al rato sin cuadros: si el contenedor se reinicia, los números
vuelven a empezar, y eso está bien — un número de pista no es una identidad.
"""

from __future__ import annotations

import threading
import time

import numpy as np

# Sin cuadros durante esto, la sesión se olvida.
SESION_TTL_S = 120
# Sesiones simultáneas: más que esto es un cliente que no reusa la suya.
MAX_SESIONES = 32
# Cuántos cuadros puede faltar un objeto (tapado, fuera de foco) antes de dar su pista por perdida.
# A 2 cuadros por segundo, 6 son 3 s: alguien que pasa detrás de un árbol conserva su número.
CUADROS_PERDIDO = 6
# Con qué confianza un objeto abre una pista nueva. ByteTrack trae 0,7/0,6, pensado para un
# detector que devuelve todo desde 0,1; acá ya llega filtrado por el umbral del pedido (0,4 por
# defecto) y con 0,6 una persona a 0,57 nunca tenía número.
ACTIVAR = 0.4


class Sesiones:
    def __init__(self):
        self._s: dict[str, dict] = {}
        self._c = threading.Lock()

    def _nueva(self, fps: float):
        from trackers import ByteTrackTracker
        return ByteTrackTracker(lost_track_buffer=CUADROS_PERDIDO, frame_rate=fps,
                                track_activation_threshold=ACTIVAR, high_conf_det_threshold=ACTIVAR,
                                minimum_consecutive_frames=2)

    def actualizar(self, sesion: str, objetos, fps: float) -> dict:
        """Pone `pista` (número, o None si todavía no se confirmó) en cada objeto."""
        import supervision as sv
        ahora = time.time()
        with self._c:
            for k in [k for k, v in self._s.items() if ahora - v["t"] > SESION_TTL_S]:
                del self._s[k]
            if sesion not in self._s:
                if len(self._s) >= MAX_SESIONES:
                    del self._s[min(self._s, key=lambda k: self._s[k]["t"])]
                self._s[sesion] = {"r": self._nueva(fps), "t": ahora, "cuadros": 0, "vistas": set()}
            s = self._s[sesion]
            s["t"] = ahora
            s["cuadros"] += 1
            if objetos:
                clases = sorted({o.clase for o in objetos})
                d = sv.Detections(
                    xyxy=np.array([o.caja for o in objetos], dtype=float),
                    confidence=np.array([o.confianza for o in objetos], dtype=float),
                    class_id=np.array([clases.index(o.clase) for o in objetos]),
                )
                d.data["i"] = np.arange(len(objetos))
                r = s["r"].update(d)
                ids = {int(i): int(t) for i, t in zip(r.data["i"], r.tracker_id)}
            else:
                s["r"].update(sv.Detections.empty())
                ids = {}
            for i, o in enumerate(objetos):
                t = ids.get(i, -1)
                o.extra["pista"] = t if t >= 0 else None
                if t >= 0:
                    s["vistas"].add(t)
            return {"cuadro": s["cuadros"], "pistas_vistas": len(s["vistas"])}

    def cuantas(self) -> int:
        return len(self._s)
