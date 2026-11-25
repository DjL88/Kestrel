"""Measure vehicle recognition on the calibration set with the app's own CLIP image model and committed vectors.

    python -I evaluate.py <repo> <images> <vision.onnx>
"""
import base64, json, sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

REPO, IMAGES, MODEL = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)


def decode(entry):
    return np.frombuffer(base64.b64decode(entry["v"]), dtype=np.int8).astype(np.float32) * entry["scale"]


def unit(v):
    return v / np.linalg.norm(v)


def softmax(logits):
    w = np.exp(logits - logits.max())
    return w / w.sum()


taxonomy = json.loads((REPO / "src/assets/subject/taxonomy.json").read_text(encoding="utf-8"))["categories"]
gate_file = json.loads((REPO / "src/assets/subject/vectors.json").read_text(encoding="utf-8"))
gate = np.stack([unit(decode(gate_file["vectors"][c["id"]])) for c in taxonomy])
labels = json.loads((REPO / "src/assets/vehicle/labels.json").read_text(encoding="utf-8"))
vfile = json.loads((REPO / "src/assets/vehicle/vectors.json").read_text(encoding="utf-8"))
kinds = labels["kinds"]
kv = np.stack([unit(decode(vfile["kinds"][k["id"]])) for k in kinds])
types = labels["types"]
tv = np.stack([unit(decode(vfile["types"][t["id"]])) for t in types])

family_of0 = {k["id"]: k["family"] for k in kinds}
session = ort.InferenceSession(MODEL, providers=["CPUExecutionProvider"])
manifest = json.loads((IMAGES / "manifest.json").read_text(encoding="utf-8"))
rows = []
for item in manifest:
    image = Image.open(IMAGES / item["file"]).convert("RGB")
    w, h = image.size
    s = min(w, h)
    image = image.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s)).resize((224, 224), Image.BICUBIC)
    x = ((np.asarray(image, dtype=np.float32) / 255.0 - MEAN) / STD).transpose(2, 0, 1)[None]
    out = session.run(None, {session.get_inputs()[0].name: x})
    names = [o.name for o in session.get_outputs()]
    emb = unit(out[names.index("image_embeds")][0] if "image_embeds" in names else out[0][0])
    gp = softmax(100 * gate @ emb)
    vehicle_mass = float(sum(p for p, c in zip(gp, taxonomy) if c["group"] == "vehicle"))
    kp = softmax(100 * kv @ emb)
    order = np.argsort(-kp)
    kind = kinds[order[0]]
    row = {**item, "vehicleMass": vehicle_mass, "kindBest": kind["id"], "kindP": float(kp[order[0]]), "kindMargin": float(kp[order[0]] - kp[order[1]])}
    fam = {}
    for p, k in zip(kp, kinds):
        if not k.get("decoy"):
            fam[k["family"]] = fam.get(k["family"], 0) + float(p)
    row["familyBest"], row["familyP"] = max(fam.items(), key=lambda kv_: kv_[1])
    true_kind = item["kind"]
    idx = [i for i, t in enumerate(types) if t["kind"] == true_kind]
    if len(idx) >= 2 and item["type"]:
        tp = softmax(100 * tv[idx] @ emb)
        o = np.argsort(-tp)
        row["typeBest"], row["typeP"], row["typeMargin"] = types[idx[o[0]]]["id"], float(tp[o[0]]), float(tp[o[0]] - tp[o[1]])
    famidx = [i for i, t in enumerate(types) if family_of0[t["kind"]] == family_of0[true_kind]]
    if len(famidx) < 2:
        row.update(ftypeBest="", ftypeP=0.0, ftypeMargin=0.0, ftypeKind=""); rows.append(row); continue
    fp_ = softmax(100 * tv[famidx] @ emb)
    o = np.argsort(-fp_)
    row["ftypeBest"], row["ftypeP"], row["ftypeMargin"] = types[famidx[o[0]]]["id"], float(fp_[o[0]]), float(fp_[o[0]] - fp_[o[1]])
    row["ftypeKind"] = types[famidx[o[0]]]["kind"]
    rows.append(row)

(IMAGES / "results.json").write_text(json.dumps(rows, indent=1), encoding="utf-8")
family_of = {k["id"]: k["family"] for k in kinds}
n = len(rows)
print(f"{n} photos")
print(f"gate vehicle mass >= 0.6: {sum(r['vehicleMass'] >= 0.6 for r in rows)}/{n}")
print(f"kind top-1 right: {sum(r['kindBest'] == r['kind'] for r in rows)}/{n}")
print(f"family top-1 right: {sum(r['familyBest'] == family_of[r['kind']] for r in rows)}/{n}")
for pmin, mmin in [(0.4, 0.1), (0.5, 0.2), (0.6, 0.3), (0.7, 0.4)]:
    claimed = [r for r in rows if r["vehicleMass"] >= 0.6 and r["kindP"] >= pmin and r["kindMargin"] >= mmin and not any(k["id"] == r["kindBest"] and k.get("decoy") for k in kinds)]
    right = sum(r["kindBest"] == r["kind"] for r in claimed)
    print(f"kind p>={pmin} m>={mmin}: claimed {len(claimed)}/{n}, right {right} ({right / max(1, len(claimed)):.0%})")
typed = [r for r in rows if "typeBest" in r]
print(f"type top-1 right (given true kind): {sum(r['typeBest'] == r['type'] for r in typed)}/{len(typed)}")
for pmin, mmin in [(0.4, 0.1), (0.55, 0.25), (0.65, 0.35), (0.75, 0.5), (0.85, 0.7)]:
    claimed = [r for r in typed if r["typeP"] >= pmin and r["typeMargin"] >= mmin]
    right = sum(r["typeBest"] == r["type"] for r in claimed)
    print(f"type p>={pmin} m>={mmin}: claimed {len(claimed)}/{len(typed)}, right {right} ({right / max(1, len(claimed)):.0%})")
by_kind = {}
for r in rows:
    by_kind.setdefault(r["kind"], []).append(r["kindBest"])
for k, v in by_kind.items():
    print(f"  {k:20s} {sum(x == k for x in v)}/{len(v)}  got {sorted(set(v))}")
by_type = {}
for r in typed:
    by_type.setdefault(r["type"], []).append(r["typeBest"])
for k, v in by_type.items():
    print(f"  type {k:18s} {sum(x == k for x in v)}/{len(v)}  got {sorted(set(v))}")

print("family-wide type (claims count against every photo of the family; wrong = wrong type or wrong kind):")
for pmin, mmin in [(0.55, 0.25), (0.65, 0.35), (0.75, 0.5), (0.85, 0.7)]:
    claimed = [r for r in rows if r["vehicleMass"] >= 0.6 and r["ftypeP"] >= pmin and r["ftypeMargin"] >= mmin]
    right = sum(r["ftypeBest"] == r["type"] for r in claimed)
    kindright = sum(r["ftypeKind"] == r["kind"] for r in claimed)
    print(f"  p>={pmin} m>={mmin}: claimed {len(claimed)}/{n}, type right {right}, kind right {kindright}", sorted({(r['type'] or r['kind'], r['ftypeBest']) for r in claimed if r['ftypeBest'] != r['type']}))
