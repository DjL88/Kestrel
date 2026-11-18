#!/usr/bin/env python3
"""Try the category gate on photos, outside the app: what does it say, and would the species step be allowed?

    tools/subject-router/.venv/bin/python tools/subject-router/try_router.py photo1.jpg photo2.jpg ...

Needs tools/subject-router/models/vision_model_uint8.onnx (MIT, Xenova/clip-vit-base-patch32) and the generated
src/assets/subject/vectors.json. The maths matches src/core/subjectRouter.ts (the app is the reference; this is a check).
"""
from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
LOGIT_SCALE = 100.0
MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)


def preprocess(path: str, size: int = 224) -> np.ndarray:
    """CLIP's own recipe: shortest side to 224 (bicubic), centre crop, normalise."""
    image = Image.open(path).convert("RGB")
    scale = size / min(image.size)
    image = image.resize((max(size, round(image.width * scale)), max(size, round(image.height * scale))), Image.BICUBIC)
    left, top = (image.width - size) // 2, (image.height - size) // 2
    array = np.asarray(image.crop((left, top, left + size, top + size)), dtype=np.float32) / 255.0
    return ((array - MEAN) / STD).transpose(2, 0, 1)[None]


def load_categories():
    taxonomy = json.loads((ROOT / "src/assets/subject/taxonomy.json").read_text(encoding="utf-8"))["categories"]
    stored = json.loads((ROOT / "src/assets/subject/vectors.json").read_text(encoding="utf-8"))["vectors"]
    vectors = []
    for category in taxonomy:
        entry = stored[category["id"]]
        v = np.frombuffer(base64.b64decode(entry["v"]), dtype=np.int8).astype(np.float64) * entry["scale"]
        vectors.append(v / np.linalg.norm(v))
    return taxonomy, np.stack(vectors)


def main(paths: list[str]) -> int:
    session = ort.InferenceSession(str(HERE / "models/vision_model_uint8.onnx"), providers=["CPUExecutionProvider"])
    taxonomy, vectors = load_categories()
    for path in paths:
        embedding = session.run(None, {"pixel_values": preprocess(path)})[0][0].astype(np.float64)
        embedding /= np.linalg.norm(embedding)
        logits = LOGIT_SCALE * vectors @ embedding
        p = np.exp(logits - logits.max()); p /= p.sum()
        order = np.argsort(-p)
        species = sum(p[i] for i, c in enumerate(taxonomy) if c["group"] == "animal" and c["identify"] == "species")
        animal = sum(p[i] for i, c in enumerate(taxonomy) if c["group"] == "animal")
        gate = "ALLOW" if species >= 0.6 else "BLOCK" if 1 - animal >= 0.6 else "strict"
        top = ", ".join(f"{taxonomy[i]['label']} {p[i]:.0%}" for i in order[:3])
        print(f"{Path(path).name[:34]:34} gate={gate:6} species={species:4.0%} animal={animal:4.0%} | {top}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
