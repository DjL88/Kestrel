#!/usr/bin/env python3
"""Measure each scene tag's threshold on an openly licensed evaluation set, with the app's own image model.

    python -I tools/scene-tags/measure_thresholds.py <folder from fetch_eval_set.py>

Runs public/models/clip-vit-b32-vision-uint8.onnx (the app's model, same file and checksum) on every picture's centre
square, scores each tag exactly as src/core/sceneTags.ts does (two-way softmax at CLIP's logit scale between the tag's
prompts and its 'against' prompts), and picks the lowest threshold whose precision is at least TARGET_PRECISION. A tag
that cannot reach it with a useful recall is switched off (threshold null): no tag is better than a guess.

Honesty checks written into the result: the threshold is chosen on half the pictures and its precision reported on the
other half, and each tag's positives and negatives are counted. Negatives are the positives of every tag that should
not co-occur with it (RELATED lists the ones that legitimately can). The random Quality images are not negatives (they
include real birds, landscapes and blue skies, unlabelled); instead the share of them each tag fires on is reported.
Writes src/assets/scene/thresholds.json.
"""
from __future__ import annotations

import base64
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent.parent
MODEL = ROOT / "public/models/clip-vit-b32-vision-uint8.onnx"
MODEL_SHA256 = "b95448754a6ae56964ec80c570c80bb9863787ee85f51b664abed8c0e5f22a7a"
MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)
LOGIT_SCALE = 100.0
TARGET_PRECISION = 0.9
MINIMUM_RECALL = 0.15
MINIMUM_THRESHOLD = 0.5

RELATED_GROUPS = [
    {"light.backlit", "light.silhouette"},
    {"light.moon", "light.milky-way", "genre.astro"},
    {"weather.fog", "weather.overcast", "weather.rain", "weather.snow"},
    {"style.panning-blur", "style.motion-blur", "genre.motorsport", "genre.sport", "genre.aviation"},
    {"style.shallow-dof", "genre.portrait", "genre.birds", "genre.wildlife", "genre.macro"},
    {"genre.wildlife", "genre.birds", "weather.snow"},
    {"genre.street", "genre.documentary", "genre.portrait", "weather.rain", "style.motion-blur"},
    {"genre.landscape", "weather.fog", "weather.snow", "weather.overcast", "weather.clear", "light.backlit",
     "light.silhouette", "style.minimalist", "light.milky-way", "genre.astro", "style.motion-blur"},
    {"style.minimalist", "light.silhouette", "light.moon", "genre.birds", "weather.fog", "genre.aviation"},
    {"genre.sport", "genre.motorsport"},
    {"weather.clear", "genre.aviation", "genre.birds"},
    {"genre.portrait", "light.backlit", "light.silhouette"},
    {"genre.street", "weather.clear", "weather.overcast", "style.panning-blur", "light.silhouette"},
    {"genre.documentary", "genre.sport", "genre.motorsport", "light.silhouette"},
]


def related(tag: str) -> set[str]:
    out = {tag}
    for group in RELATED_GROUPS:
        if tag in group:
            out |= group
    return out


def decode(entry: dict) -> np.ndarray:
    ints = np.frombuffer(base64.b64decode(entry["v"]), dtype=np.int8).astype(np.float64)
    vector = ints * entry["scale"]
    return vector / np.linalg.norm(vector)


def preprocess(path: Path) -> np.ndarray:
    image = Image.open(path).convert("RGB")
    side = min(image.size)
    left, top = (image.width - side) // 2, (image.height - side) // 2
    image = image.crop((left, top, left + side, top + side)).resize((224, 224), Image.BICUBIC)
    pixels = (np.asarray(image, dtype=np.float32) / 255.0 - MEAN) / STD
    return pixels.transpose(2, 0, 1)[None]


def precision_recall(pos: np.ndarray, neg: np.ndarray, threshold: float) -> tuple[float, float, int, int]:
    tp, fp = int((pos >= threshold).sum()), int((neg >= threshold).sum())
    precision = tp / (tp + fp) if tp + fp else 1.0
    return precision, tp / len(pos) if len(pos) else 0.0, tp, fp


def choose(pos: np.ndarray, neg: np.ndarray) -> float | None:
    """The lowest threshold whose precision (and every higher one's) is at least the target."""
    best = None
    for threshold in sorted(set(np.round(np.concatenate([pos, neg]), 4)), reverse=True):
        if threshold < MINIMUM_THRESHOLD:
            break
        precision, _, tp, _ = precision_recall(pos, neg, threshold)
        if precision < TARGET_PRECISION:
            break
        if tp:
            best = float(threshold)
    return best


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    folder = Path(sys.argv[1])
    if hashlib.sha256(MODEL.read_bytes()).hexdigest() != MODEL_SHA256:
        raise SystemExit("public/models/clip-vit-b32-vision-uint8.onnx is not the app's model")
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))["files"]
    vectors = json.loads((ROOT / "src/assets/scene/vectors.json").read_text(encoding="utf-8"))
    tags = {tag: (decode(entry["for"]), decode(entry["against"])) for tag, entry in vectors["tags"].items()}
    session = ort.InferenceSession(str(MODEL), providers=["CPUExecutionProvider"])
    embeddings, labels = [], []
    for entry in manifest:
        try:
            output = session.run(None, {session.get_inputs()[0].name: preprocess(folder / entry["file"])})
        except Exception as error:  # noqa: BLE001 - a broken thumbnail is skipped and counted
            print(f"skipped {entry['file']}: {error}")
            continue
        names = [o.name for o in session.get_outputs()]
        vector = output[names.index("image_embeds")] if "image_embeds" in names else output[0]
        vector = np.asarray(vector, dtype=np.float64).reshape(-1)
        embeddings.append(vector / np.linalg.norm(vector))
        labels.append(entry["tag"])
    embeddings = np.stack(embeddings)
    labels = np.array(labels)
    half = np.arange(len(labels)) % 2 == 0
    results = {}
    for tag, (for_vector, against_vector) in tags.items():
        logits = LOGIT_SCALE * (embeddings @ for_vector - embeddings @ against_vector)
        scores = 1 / (1 + np.exp(-logits))
        positive = labels == tag
        negative = ~np.isin(labels, list(related(tag)) + ["background"])
        threshold = choose(scores[positive], scores[negative])
        held = choose(scores[positive & half], scores[negative & half])
        held_precision = held_recall = None
        if held is not None:
            held_precision, held_recall, _, _ = precision_recall(scores[positive & ~half], scores[negative & ~half], held)
        precision = recall = 0.0
        if threshold is not None:
            precision, recall, _, _ = precision_recall(scores[positive], scores[negative], threshold)
            if recall < MINIMUM_RECALL:
                threshold = None
        background = scores[labels == "background"]
        fires = float((background >= threshold).mean()) if threshold is not None and len(background) else None
        results[tag] = {
            "backgroundShare": None if fires is None else round(fires, 3),
            "threshold": None if threshold is None else round(threshold, 4),
            "precision": round(precision, 3), "recall": round(recall, 3),
            "heldOutPrecision": None if held_precision is None else round(held_precision, 3),
            "heldOutRecall": None if held_recall is None else round(held_recall, 3),
            "positives": int(positive.sum()), "negatives": int(negative.sum()),
        }
        print(f"{tag:22} t={results[tag]['threshold']}  P={precision:.2f} R={recall:.2f}  held-out P={held_precision} R={held_recall}"
              f"  ({int(positive.sum())} pos, {int(negative.sum())} neg)")
    out = {
        "note": "Measured by tools/scene-tags/measure_thresholds.py. A null threshold means the tag is switched off: it did not reach the target precision with a useful recall.",
        "model": MODEL.name, "modelSha256": MODEL_SHA256, "labelsVersion": vectors["labelsVersion"],
        "targetPrecision": TARGET_PRECISION, "minimumRecall": MINIMUM_RECALL,
        "evaluation": {"source": "Wikimedia Commons, CC0 / public domain / CC BY / CC BY-SA, 320 px thumbnails, chosen by Commons category (tools/scene-tags/fetch_eval_set.py); file list with authors and licences in tools/scene-tags/eval-manifest.json",
                       "pictures": int(len(labels)),
                       "backgroundShare": "share of 160 random Commons Quality images the tag fires on (informational: their true labels are unknown)"},
        "tags": results,
    }
    (ROOT / "src/assets/scene/thresholds.json").write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
