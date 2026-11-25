#!/usr/bin/env python3
"""Turn each scene tag's prompts (and its 'against' prompts) into one vector each, for the app's scene tags.

    python tools/scene-tags/make_scene_vectors.py

Reads src/assets/scene/labels.json and writes src/assets/scene/vectors.json. Uses the same CLIP text model and tokenizer
as tools/subject-router/make_category_vectors.py (tools/subject-router/models/, git-ignored, MIT), so the vectors sit in
the same space as the app's CLIP ViT-B/32 image model. Offline; numpy, onnxruntime and tokenizers only.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "subject-router"))
from make_category_vectors import MODELS, ROOT, embed_prompts, quantise, sha256  # noqa: E402


def mean_vector(session: ort.InferenceSession, tokenizer: Tokenizer, prompts: list[str]) -> np.ndarray:
    mean = embed_prompts(session, tokenizer, prompts).mean(axis=0)
    return mean / np.linalg.norm(mean)


def encoded(vector: np.ndarray) -> dict[str, object]:
    v, scale = quantise(vector)
    return {"v": v, "scale": scale}


def main() -> int:
    labels = json.loads((ROOT / "src/assets/scene/labels.json").read_text(encoding="utf-8"))
    session = ort.InferenceSession(str(MODELS / "text_model_int8.onnx"), providers=["CPUExecutionProvider"])
    tokenizer = Tokenizer.from_file(str(MODELS / "tokenizer.json"))
    tags = {}
    for tag in labels["tags"]:
        tags[tag["id"]] = {"for": encoded(mean_vector(session, tokenizer, tag["prompts"])),
                           "against": encoded(mean_vector(session, tokenizer, tag["against"]))}
    out = {
        "model": "clip-vit-base-patch32",
        "licence": "MIT (OpenAI CLIP); ONNX conversion Xenova/clip-vit-base-patch32, MIT",
        "labelsVersion": labels["version"],
        "dim": 512,
        "textModelSha256": sha256(MODELS / "text_model_int8.onnx"),
        "tokenizerSha256": sha256(MODELS / "tokenizer.json"),
        "tags": tags,
    }
    target = ROOT / "src/assets/scene/vectors.json"
    target.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"{len(tags)} scene tags written to {target.relative_to(ROOT)} ({target.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
