"""
Índice de las fotos para el vocabulario abierto: buscar «carretilla» en un mes de fotos en un
segundo, sin volver a pasar cada foto por el modelo.

Por qué (17/10, Nico: «es demasiado lento al buscar»): mirar cada foto con OWLv2 cuesta ~0,25 s
en GPU más la decodificación; un día de San Nicolás son ~1.700 fotos → 7 minutos por búsqueda.
Pero OWLv2 separa limpio la parte que depende de la FOTO (la red de imagen, la cara) de la que
depende de la FRASE (una cuenta chica al final). Lo caro se hace UNA vez por foto, al llegar, y se
guarda; buscar es multiplicar lo guardado por el vector de la frase.

Qué se guarda por foto: los K parches con más «objetualidad» (la cabeza de objectness de OWLv2;
medido: lo buscado queda entre los primeros 10 de 3600), y de cada uno lo que necesita la cabeza
de clases para comparar contra una frase cualquiera: su vector de clase normalizado (512, int8 con
su escala), el corrimiento y la escala del logit, y la caja. Son ~21 KB por foto.

Formato, uno por día (UTC), sólo agregar:
  AAAA-MM-DD.emb    int8   [N, K, 512]
  AAAA-MM-DD.f16    float16 [N, K, 7]   escala, shift, scale, x1, y1, x2, y2 (caja 0-1 de la foto)
  AAAA-MM-DD.jsonl  {"id", "ts" (ms), "dev"} — se escribe ÚLTIMO: una línea sólo existe si sus datos
                    ya están, así quien busca mientras se indexa nunca lee un registro a medias.
"""

from __future__ import annotations

import json
import os
import threading
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import numpy as np

K = 40
DIM = 512
COLS = 7
CARPETA = Path(os.environ.get("VISION_VOCAB_INDICE", "/indice"))
RETENCION_DIAS = int(os.environ.get("VISION_VOCAB_INDICE_DIAS", "30"))


def _dia(ts_ms: int) -> str:
    return datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


class Indice:
    def __init__(self, carpeta: Path = CARPETA):
        self.carpeta = carpeta
        self._c = threading.Lock()
        self._metas: dict[str, tuple[float, list[dict]]] = {}   # día → (mtime, filas)
        self._ids: dict[str, set[str]] = {}
        try:
            self.carpeta.mkdir(parents=True, exist_ok=True)
            self.disponible = os.access(self.carpeta, os.W_OK)
        except Exception:
            self.disponible = False

    # ── escribir ──
    def _ids_de(self, dia: str) -> set[str]:
        if dia not in self._ids:
            self._ids[dia] = {m["id"] for m in self._leer_metas(dia)}
        return self._ids[dia]

    def tiene(self, id_: str, ts_ms: int) -> bool:
        return id_ in self._ids_de(_dia(ts_ms))

    def agregar(self, id_: str, ts_ms: int, dev: str | None, emb: np.ndarray, f16: np.ndarray) -> bool:
        dia = _dia(ts_ms)
        with self._c:
            if id_ in self._ids_de(dia):
                return False
            base = self.carpeta / dia
            with open(f"{base}.emb", "ab") as f:
                f.write(np.ascontiguousarray(emb, dtype=np.int8).tobytes())
            with open(f"{base}.f16", "ab") as f:
                f.write(np.ascontiguousarray(f16, dtype=np.float16).tobytes())
            with open(f"{base}.jsonl", "a") as f:
                f.write(json.dumps({"id": id_, "ts": int(ts_ms), "dev": dev}) + "\n")
            self._ids[dia].add(id_)
        return True

    # ── leer ──
    def _leer_metas(self, dia: str) -> list[dict]:
        p = self.carpeta / f"{dia}.jsonl"
        if not p.exists():
            return []
        mt = p.stat().st_mtime
        ya = self._metas.get(dia)
        if ya and ya[0] == mt:
            return ya[1]
        filas = []
        for linea in p.read_text().splitlines():
            try:
                filas.append(json.loads(linea))
            except Exception:
                break  # una línea cortada (corte de luz): lo de después no es confiable
        self._metas[dia] = (mt, filas)
        return filas

    def dias(self) -> list[str]:
        return sorted(p.stem for p in self.carpeta.glob("*.jsonl"))

    def estado(self) -> dict:
        ds = self.dias()
        conteo = {d: len(self._leer_metas(d)) for d in ds}
        ultimo = None
        if ds:
            m = self._leer_metas(ds[-1])
            ultimo = max((x["ts"] for x in m), default=None)
        bytes_ = sum(p.stat().st_size for p in self.carpeta.glob("*.*")) if self.disponible else 0
        return {"disponible": self.disponible, "dias": conteo, "fotos": sum(conteo.values()), "ultimo_ts": ultimo,
                "mb": round(bytes_ / 1e6, 1), "k": K, "retencion_dias": RETENCION_DIAS}

    def buscar(self, consultas: np.ndarray, desde_ms: int, hasta_ms: int, dispositivos: set[str] | None,
               umbral: float, maximo: int) -> tuple[list[dict], int]:
        """consultas: Q×512 normalizadas. → (resultados, fotos revisadas)."""
        res: list[dict] = []
        revisadas = 0
        d0 = datetime.fromtimestamp(desde_ms / 1000, tz=timezone.utc).date()
        d1 = datetime.fromtimestamp(hasta_ms / 1000, tz=timezone.utc).date()
        T = consultas.astype(np.float32).T  # 512×Q
        dia = d0
        while dia <= d1:
            nombre = dia.strftime("%Y-%m-%d")
            dia += timedelta(days=1)
            metas = self._leer_metas(nombre)
            if not metas:
                continue
            base = self.carpeta / nombre
            n_emb = os.path.getsize(f"{base}.emb") // (K * DIM)
            n_f = os.path.getsize(f"{base}.f16") // (K * COLS * 2)
            n = min(len(metas), n_emb, n_f)
            sel = [i for i in range(n) if desde_ms <= metas[i]["ts"] <= hasta_ms and (not dispositivos or metas[i].get("dev") in dispositivos)]
            if not sel:
                continue
            revisadas += len(sel)
            E = np.memmap(f"{base}.emb", dtype=np.int8, mode="r", shape=(n_emb, K, DIM))
            F = np.memmap(f"{base}.f16", dtype=np.float16, mode="r", shape=(n_f, K, COLS))
            # De a bloques: un día entero en float32 son cientos de MB.
            for b in range(0, len(sel), 512):
                idx = np.array(sel[b:b + 512])
                f = F[idx].astype(np.float32)                       # n×K×7
                e = E[idx].astype(np.float32) * f[..., :1]          # n×K×512
                lg = (e @ T + f[..., 1:2]) * f[..., 2:3]            # n×K×Q
                p = 1.0 / (1.0 + np.exp(-lg))
                mejor = p.argmax(axis=1)                            # n×Q
                pm = np.take_along_axis(p, mejor[:, None, :], axis=1)[:, 0, :]  # n×Q
                for j, i in enumerate(idx):
                    for q in np.where(pm[j] >= umbral)[0]:
                        k = mejor[j, q]
                        res.append({"id": metas[i]["id"], "ts": metas[i]["ts"], "dev": metas[i].get("dev"),
                                    "q": int(q), "score": float(pm[j, q]), "caja_norm": [round(float(v), 4) for v in f[j, k, 3:7]]})
        res.sort(key=lambda r: -r["score"])
        return res[:maximo], revisadas

    def podar(self) -> int:
        """Borra los días más viejos que la retención."""
        limite = (datetime.now(timezone.utc) - timedelta(days=RETENCION_DIAS)).strftime("%Y-%m-%d")
        n = 0
        for d in self.dias():
            if d < limite:
                for ext in ("emb", "f16", "jsonl"):
                    try:
                        (self.carpeta / f"{d}.{ext}").unlink()
                    except FileNotFoundError:
                        pass
                self._metas.pop(d, None)
                self._ids.pop(d, None)
                n += 1
        return n
