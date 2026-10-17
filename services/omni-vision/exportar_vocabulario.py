"""
Trae OWLv2 (vocabulario abierto) a la carpeta de modelos, al construir la imagen.

No se exporta acá: el ONNX es el de Xenova/onnx-community, con revisión fija, y se COMPARA contra
el modelo original de Google en PyTorch (verificar_vocabulario.py) con nuestro pre y posproceso.
Si no da lo mismo, la construcción falla: un detector que se equivoca en silencio es peor que
no tenerlo.

    python exportar_vocabulario.py /modelos
"""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

ONNX_REPO = "Xenova/owlv2-base-patch16-ensemble"
ONNX_REV = "3e255bc9bf304b3358a8c1945c0a9514eefe7f10"
ORIGINAL = "google/owlv2-base-patch16-ensemble"
ORIGINAL_REV = "cfd3195ba4ea9592eec887ded089f4c08eff231d"
PRUEBA = "a photo of a wheelbarrow"


def bajar(repo: str, rev: str, archivo: str, destino: Path) -> None:
    url = f"https://huggingface.co/{repo}/resolve/{rev}/{archivo}"
    with urllib.request.urlopen(url, timeout=600) as r, open(destino, "wb") as f:
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            f.write(b)


def main(carpeta: str) -> None:
    out = Path(carpeta)
    out.mkdir(parents=True, exist_ok=True)
    bajar(ONNX_REPO, ONNX_REV, "onnx/model.onnx", out / "owlv2.onnx")
    bajar(ONNX_REPO, ONNX_REV, "tokenizer.json", out / "owlv2-tokenizer.json")
    from tokenizers import Tokenizer
    tok = Tokenizer.from_file(str(out / "owlv2-tokenizer.json"))
    pad = tok.token_to_id("!")
    # Los ids de una frase de prueba: la imagen final los vuelve a calcular con su versión de
    # tokenizers y, si no coinciden, no abre el modelo (vocabulario.py).
    tok.enable_padding(length=16, pad_id=pad, pad_token="!")
    tok.enable_truncation(16)
    meta = {
        "modelo": "OWLv2 base patch16 ensemble", "licencia": "Apache-2.0",
        "onnx": f"{ONNX_REPO}@{ONNX_REV[:8]}", "original": f"{ORIGINAL}@{ORIGINAL_REV[:8]}",
        "pad": pad, "prueba": PRUEBA, "prueba_ids": tok.encode(PRUEBA).ids,
    }
    (out / "owlv2.json").write_text(json.dumps(meta))
    # Las cabezas de clase y de objectness, del modelo original: el índice de fotos las usa para
    # guardar de cada foto lo que hace falta para compararla después contra cualquier frase.
    import numpy as np
    from transformers import Owlv2ForObjectDetection
    m = Owlv2ForObjectDetection.from_pretrained(ORIGINAL, revision=ORIGINAL_REV)
    cab = {k.replace(".", "_"): v.detach().numpy().astype(np.float32) for k, v in m.state_dict().items()
           if k.startswith(("class_head.", "objectness_head."))}
    np.savez(out / "owlv2-cabezas.npz", **cab)
    print("owlv2:", meta["onnx"], "pad", pad, "listo")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/modelos")
