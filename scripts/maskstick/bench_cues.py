#!/usr/bin/env python3
"""Do the extra cues help the no-model matte? Tonal-and-colour zones and the camera's AF box, on synthetic scenes.

    cd scripts && python3 -m maskstick.bench_cues --out /tmp/maskstick-cues [--seeds 4]

Four variants of the same matte on the same fresh scenes: plain, + zones, + AF box, + both. The "pillar" scenes add a big
sharp distractor in the focal plane (larger than the subject, apart from it), the case where "sharp" and "the subject" differ
and a camera's AF box can tell them apart. Each scene is scored against the true subject alpha with the same scorer used for the
owner's masks. Synthetic only: it shows whether a cue does what it is meant to, not how it does on real photographs.
"""
from __future__ import annotations

import argparse
import json
import os
import time
from concurrent.futures import ProcessPoolExecutor

import numpy as np

from . import metrics as M
from . import synth
from .matte.pipeline import matte
from .matte.regions import edge_adherence, tonal_colour_zones
from scipy import ndimage as ndi

SEED_BASE = 300  # never used for tuning
CONDITIONS = [  # (label, blur, gap, distractor)
    ("defocused, distinct colours", 6, 0.35, False),
    ("defocused, similar colours", 6, 0.05, False),
    ("sharp pillar in focal plane, distinct", 6, 0.35, True),
    ("sharp pillar in focal plane, similar", 6, 0.05, True),
]
VARIANTS = {"plain": (False, False), "+zones": (True, False), "+AF": (False, True), "+zones+AF": (True, True)}


def one(job: tuple) -> dict:
    cond, variant, seed = job
    label, blur, gap, distractor = CONDITIONS[cond]
    use_zones, use_af = VARIANTS[variant]
    s = synth.make_scene(seed, size=(512, 768), bg_blur=blur, colour_gap=gap, distractor=distractor)
    gt = synth.ground_truth_from_alpha(s.alpha)
    started = time.perf_counter()
    r = matte(s.image, use_zones=use_zones, af_box=s.af if (use_af and s.af) else None)
    seconds = time.perf_counter() - started
    row = {"cond": cond, "variant": variant, "seed": seed, "refused": r.alpha is None, "seconds": seconds,
           "band": r.trimap.stats.get("band_share"), "af": r.trimap.stats.get("af")}
    if r.alpha is not None:
        sc = M.score_pair(r.alpha, gt)
        row.update({k: sc[k] for k in ("iou", "f4", "f8")})
    else:
        row.update({"iou": 0.0, "f4": 0.0, "f8": 0.0})
    if variant == "plain":
        zones, _ = tonal_colour_zones(s.image)
        edge = (s.alpha >= 0.5) & ~ndi.binary_erosion(s.alpha >= 0.5)
        row["zones"] = int(zones.max()) + 1
        row["adherence2"] = edge_adherence(zones, edge, 2.0)
    return row


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--seeds", type=int, default=4)
    ap.add_argument("--workers", type=int, default=6)
    a = ap.parse_args(argv)
    jobs = [(c, v, SEED_BASE + k) for c in range(len(CONDITIONS)) for v in VARIANTS for k in range(a.seeds)]
    with ProcessPoolExecutor(a.workers) as pool:
        rows = list(pool.map(one, jobs))
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "cues.json"), "w") as f:
        json.dump(rows, f, indent=1)
    lines = ["| scene | variant | IoU | F@4 | F@8 | refused | uncertain band (share of frame) | s per photo |", "|---|---|---|---|---|---|---|---|"]
    for c, (label, *_rest) in enumerate(CONDITIONS):
        for v in VARIANTS:
            sel = [r for r in rows if r["cond"] == c and r["variant"] == v]
            bands = [r["band"] for r in sel if r["band"] is not None]
            lines.append(f"| {label} | {v} | {np.mean([r['iou'] for r in sel]):.2f} | {np.mean([r['f4'] for r in sel]):.2f} | {np.mean([r['f8'] for r in sel]):.2f} | "
                         f"{sum(r['refused'] for r in sel)}/{len(sel)} | {np.mean(bands):.3f} | {np.mean([r['seconds'] for r in sel]):.1f} |")
    plain = [r for r in rows if r["variant"] == "plain"]
    lines += ["", f"Zones: {np.mean([r['zones'] for r in plain]):.0f} per scene on average; the true subject edge lies within 2 px of a zone boundary for "
              f"{np.mean([r['adherence2'] for r in plain]):.0%} of its pixels (by condition: " +
              ", ".join(f"{CONDITIONS[c][0]} {np.mean([r['adherence2'] for r in plain if r['cond'] == c]):.0%}" for c in range(len(CONDITIONS))) + ")."]
    text = "\n".join(lines)
    print(text)
    with open(os.path.join(a.out, "cues-report.md"), "w") as f:
        f.write(text + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
