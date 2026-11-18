#!/usr/bin/env python3
"""Turn the subject categories' plain-language prompts into one vector each, for the category gate.

    tools/subject-router/.venv/bin/python tools/subject-router/make_category_vectors.py

Reads src/assets/subject/taxonomy.json and writes src/assets/subject/vectors.json. Needs the CLIP text model and tokenizer
in tools/subject-router/models/ (git-ignored, MIT licence, from Xenova/clip-vit-base-patch32 on Hugging Face):
    text_model_int8.onnx   tokenizer.json
The image model is the app's job; this tool only needs the text side, and runs once whenever the taxonomy changes.
Camera-neutral and offline. Only numpy, onnxruntime and tokenizers are needed.
"""
from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
MODELS = HERE / "models"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def quantise(vector: np.ndarray) -> tuple[str, float]:
    """The same int8 scheme the species labels use: one scale per vector, bytes as base64."""
    scale = float(np.max(np.abs(vector)) / 127.0) or 1.0
    ints = np.clip(np.round(vector / scale), -127, 127).astype(np.int8)
    return base64.b64encode(ints.tobytes()).decode("ascii"), scale


def embed_prompts(session: ort.InferenceSession, tokenizer: Tokenizer, prompts: list[str]) -> np.ndarray:
    """One unit-length vector per prompt. Prompts run one at a time at their own length, so no padding is involved."""
    rows = []
    for prompt in prompts:
        ids = np.array([tokenizer.encode(prompt.lower().strip()).ids], dtype=np.int64)
        if ids.shape[1] > 77:
            raise ValueError(f"prompt too long for the model (77 tokens): {prompt!r}")
        out = session.run(None, {"input_ids": ids})[0][0].astype(np.float64)
        rows.append(out / np.linalg.norm(out))
    return np.stack(rows)


def main() -> int:
    taxonomy = json.loads((ROOT / "src/assets/subject/taxonomy.json").read_text(encoding="utf-8"))
    session = ort.InferenceSession(str(MODELS / "text_model_int8.onnx"), providers=["CPUExecutionProvider"])
    tokenizer = Tokenizer.from_file(str(MODELS / "tokenizer.json"))
    vectors = {}
    for category in taxonomy["categories"]:
        mean = embed_prompts(session, tokenizer, category["prompts"]).mean(axis=0)
        mean /= np.linalg.norm(mean)  # average of the prompts, back to unit length
        encoded, scale = quantise(mean)
        vectors[category["id"]] = {"v": encoded, "scale": scale}
    out = {
        "model": "clip-vit-base-patch32",
        "licence": "MIT (OpenAI CLIP); ONNX conversion Xenova/clip-vit-base-patch32, MIT",
        "taxonomyVersion": taxonomy["version"],
        "dim": 512,
        "textModelSha256": sha256(MODELS / "text_model_int8.onnx"),
        "tokenizerSha256": sha256(MODELS / "tokenizer.json"),
        "vectors": vectors,
    }
    target = ROOT / "src/assets/subject/vectors.json"
    target.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"{len(vectors)} category vectors written to {target.relative_to(ROOT)} ({target.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
