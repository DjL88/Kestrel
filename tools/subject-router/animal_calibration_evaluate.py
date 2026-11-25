"""Record the category gate on the animal calibration set, for a before-and-after when a route or category changes.

    python tools/subject-router/animal_calibration_evaluate.py <calibration folder> <out.json>

For every photo in the folder's manifest.json: the gate's top category and its share, whether that is confident under
ROUTER_THRESHOLDS (src/core/subjectRouter.ts: at least 0.45, and 0.15 ahead of the next), and whether the species step
is allowed (species-routed animal categories together at least 0.6, as try_router.py). Prints a summary per kind.
The maths is try_router.py's, which mirrors the app; the app stays the reference. Thresholds are not changed here.
"""
import json, sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import onnxruntime as ort

sys.path.insert(0, str(Path(__file__).parent))
from try_router import HERE, LOGIT_SCALE, load_categories, preprocess  # noqa: E402

MIN_PROBABILITY, MIN_MARGIN = 0.45, 0.15

folder, target = Path(sys.argv[1]), Path(sys.argv[2])
manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
session = ort.InferenceSession(str(HERE / "models/vision_model_uint8.onnx"), providers=["CPUExecutionProvider"])
taxonomy, vectors = load_categories()
results = []
for item in manifest:
    embedding = session.run(None, {"pixel_values": preprocess(str(folder / item["file"]))})[0][0].astype(np.float64)
    embedding /= np.linalg.norm(embedding)
    logits = LOGIT_SCALE * vectors @ embedding
    p = np.exp(logits - logits.max()); p /= p.sum()
    order = np.argsort(-p)
    species = float(sum(p[i] for i, c in enumerate(taxonomy) if c["group"] == "animal" and c["identify"] == "species"))
    animal = float(sum(p[i] for i, c in enumerate(taxonomy) if c["group"] == "animal"))
    top, second = order[0], order[1]
    results.append({"file": item["file"], "kind": item["kind"], "top": taxonomy[top]["id"], "share": round(float(p[top]), 4),
                    "confident": bool(p[top] >= MIN_PROBABILITY and p[top] - p[second] >= MIN_MARGIN),
                    "gate": "allow" if species >= 0.6 else "block" if 1 - animal >= 0.6 else "strict", "species": round(species, 4)})
target.write_text(json.dumps(results, indent=1), encoding="utf-8")
by_kind = defaultdict(list)
for r in results:
    by_kind[r["kind"]].append(r)
for kind, rows in by_kind.items():
    tops = Counter(r["top"] for r in rows).most_common(3)
    confident = sum(r["confident"] for r in rows)
    gates = Counter(r["gate"] for r in rows)
    print(f"{kind:17} n={len(rows):2}  confident={confident:2}  gate allow/strict/block={gates['allow']}/{gates['strict']}/{gates['block']}  top: {tops}")
