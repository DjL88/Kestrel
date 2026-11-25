#!/usr/bin/env python3
"""Turn the vehicle kinds' and types' prompts into one vector each, for vehicle recognition.

    python tools/subject-router/make_vehicle_vectors.py

Reads src/assets/vehicle/labels.json and writes src/assets/vehicle/vectors.json. Uses the same CLIP text model and
tokenizer as make_category_vectors.py (tools/subject-router/models/, git-ignored, MIT), so the vectors sit in the same
space as the category gate's and the app's CLIP ViT-B/32 image model. Offline; numpy, onnxruntime and tokenizers only.
"""
from __future__ import annotations

import json

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

from make_category_vectors import MODELS, ROOT, embed_prompts, quantise, sha256


def vector(session: ort.InferenceSession, tokenizer: Tokenizer, prompts: list[str]) -> dict[str, object]:
    mean = embed_prompts(session, tokenizer, prompts).mean(axis=0)
    mean /= np.linalg.norm(mean)
    encoded, scale = quantise(mean)
    return {"v": encoded, "scale": scale}


def main() -> int:
    labels = json.loads((ROOT / "src/assets/vehicle/labels.json").read_text(encoding="utf-8"))
    session = ort.InferenceSession(str(MODELS / "text_model_int8.onnx"), providers=["CPUExecutionProvider"])
    tokenizer = Tokenizer.from_file(str(MODELS / "tokenizer.json"))
    kinds = {kind["id"]: vector(session, tokenizer, kind["prompts"]) for kind in labels["kinds"]}
    types = {entry["id"]: vector(session, tokenizer, entry["prompts"]) for entry in labels["types"]}
    out = {
        "model": "clip-vit-base-patch32",
        "licence": "MIT (OpenAI CLIP); ONNX conversion Xenova/clip-vit-base-patch32, MIT",
        "labelsVersion": labels["version"],
        "dim": 512,
        "textModelSha256": sha256(MODELS / "text_model_int8.onnx"),
        "tokenizerSha256": sha256(MODELS / "tokenizer.json"),
        "kinds": kinds,
        "types": types,
    }
    target = ROOT / "src/assets/vehicle/vectors.json"
    target.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"{len(kinds)} kind and {len(types)} type vectors written to {target.relative_to(ROOT)} ({target.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
