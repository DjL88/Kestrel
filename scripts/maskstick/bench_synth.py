#!/usr/bin/env python3
"""Controlled failure-mode run on synthetic scenes: the no-model matte against the shipped mask path.

    cd scripts && python3 -m maskstick.bench_synth --out /tmp/maskstick-synth [--seeds 4] [--no-baseline]

Builds a grid of scenes with a known true alpha: background blur (0 = as sharp as the subject) by colour gap between
subject and background (0.05 = almost the same colours). Runs the matte in-process and, unless --no-baseline, the shipped
path through `baseline-shipped.ts` (needs `npm ci` done; models are the ones in src/assets/models). Scores both with the
same scorer used for the owner's hand-fixed masks and prints one row per condition.

Synthetic scenes are NOT photographs: they show which cues work and where they break, under control. A refusal (the
matte declining because focus does not separate subject from background) counts as an empty mask in the "all scenes"
columns and is listed separately, so declining is never hidden.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
from collections import defaultdict

import numpy as np
from PIL import Image

from . import metrics as M
from . import synth
from .matte.pipeline import matte

BLURS = (0, 3, 6, 12)
GAPS = (0.35, 0.05)
SEED_BASE = 100  # development used other seeds; these are only ever used here


def write_json(path: str, value) -> None:
    with open(path, "w") as f:
        json.dump(value, f, indent=1)


def build(out: str, seeds: int, size=(512, 768)) -> list[dict]:
    scenes, gt = os.path.join(out, "scenes"), os.path.join(out, "gt")
    os.makedirs(scenes, exist_ok=True)
    os.makedirs(gt, exist_ok=True)
    items = []
    for blur in BLURS:
        for gap in GAPS:
            for s in range(seeds):
                key = f"b{blur:02d}_g{gap:.2f}_s{SEED_BASE + s}"
                scene = synth.make_scene(SEED_BASE + s, size=size, bg_blur=blur, colour_gap=gap)
                Image.fromarray(scene.image).save(os.path.join(scenes, key + "_raw.jpg"), quality=95)
                Image.fromarray(synth.ground_truth_from_alpha(scene.alpha)).save(os.path.join(gt, key + ".png"))
                write_json(os.path.join(gt, key + ".json"), {"status": "ok"})
                items.append({"key": key, "blur": blur, "gap": gap, "seed": SEED_BASE + s})
    write_json(os.path.join(out, "keys.json"), {"photos": items})
    return items


def run_matte(out: str, items: list[dict]) -> dict[str, str]:
    dest = os.path.join(out, "matte")
    os.makedirs(dest, exist_ok=True)
    refused = {}
    for it in items:
        with Image.open(os.path.join(out, "scenes", it["key"] + "_raw.jpg")) as im:
            rgb = np.asarray(im.convert("RGB"))
        r = matte(rgb)
        if r.alpha is None:
            refused[it["key"]] = r.reason
        else:
            Image.fromarray((r.alpha * 255 + 0.5).astype(np.uint8)).save(os.path.join(dest, it["key"] + ".png"))
    return refused


def run_shipped(out: str, repo: str) -> dict[str, str]:
    dest = os.path.join(out, "shipped")
    subprocess.run(["npx", "tsx", "scripts/maskstick/baseline-shipped.ts", "--in", os.path.join(out, "scenes"), "--keys",
                    os.path.join(out, "keys.json"), "--out", dest], cwd=repo, check=True, stdout=subprocess.DEVNULL)
    with open(os.path.join(dest, "refusals.json")) as f:
        return json.load(f)


def score_all(out: str, items: list[dict], sources: dict[str, dict[str, str]]) -> dict:
    from . import score as S
    truth, _ = S.load_ground_truth(os.path.join(out, "gt"))
    table: dict = {}
    for name in sources:
        result = S.score_source(name, os.path.join(out, name), truth, missing="empty")
        table[name] = result["rows"]
    return table


def report(items: list[dict], table: dict, refused: dict[str, dict[str, str]]) -> str:
    cond = defaultdict(list)
    for it in items:
        cond[(it["blur"], it["gap"])].append(it["key"])
    names = list(table)
    lines = ["| bg blur (px) | colour gap | " + " | ".join(f"{n} IoU / F4 / F8 (all) | {n} IoU (accepted) | {n} refused" for n in names) + " |",
             "|---|---|" + "---|---|---|" * len(names)]
    for (blur, gap), keys in sorted(cond.items()):
        cells = []
        for n in names:
            rows = [table[n][k] for k in keys]
            took = [table[n][k] for k in keys if k not in refused[n]]
            cells += [f"{np.mean([r['iou'] for r in rows]):.2f} / {np.mean([r['f4'] for r in rows]):.2f} / {np.mean([r['f8'] for r in rows]):.2f}",
                      f"{np.mean([r['iou'] for r in took]):.2f}" if took else "n/a", f"{len(keys) - len(took)}/{len(keys)}"]
        lines.append(f"| {blur} | {gap:.2f} | " + " | ".join(cells) + " |")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--seeds", type=int, default=4)
    ap.add_argument("--no-baseline", action="store_true")
    ap.add_argument("--repo", default=os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
    a = ap.parse_args(argv)
    items = build(a.out, a.seeds)
    refused = {"matte": run_matte(a.out, items)}
    if not a.no_baseline:
        refused["shipped"] = run_shipped(a.out, a.repo)
    table = score_all(a.out, items, {n: None for n in refused})
    text = report(items, table, refused)
    print(text)
    with open(os.path.join(a.out, "synth-report.md"), "w") as f:
        f.write(text + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
