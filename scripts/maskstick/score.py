#!/usr/bin/env python3
"""Score one or more mask sources against hand-fixed masks.

    cd scripts && python3 -m maskstick.score --gt DIR --source shipped=DIR --source matte=DIR \
        --compare matte shipped --out report/

Folders hold one 8-bit grey PNG per photo, named <key>.png. A ground-truth folder may also hold <key>.json written by
the fixer (status, start_source, seconds). Predictions are any size with the photo's aspect; they are resized to the
ground truth. Nothing is uploaded and nothing outside --out is written.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys

import numpy as np
from PIL import Image

from . import metrics as M

METRIC_COLUMNS = ["iou", "soft_iou", "f2", "f4", "f8", "effort_strokes", "effort_regions"]
HIGHER_IS_BETTER = {"effort_strokes": False, "effort_regions": False}


def read_gray(path: str) -> np.ndarray:
    with Image.open(path) as im:
        return np.asarray(im.convert("L"))


def load_ground_truth(gt_dir: str) -> tuple[dict[str, dict], list[str]]:
    """({key: {'gt': uint8 array, 'meta': dict}}, skipped keys). Photos the owner marked skip are left out and listed."""
    out: dict[str, dict] = {}
    skipped: list[str] = []
    for name in sorted(os.listdir(gt_dir)):
        if not name.endswith(".png"):
            continue
        key = name[:-4]
        meta_path = os.path.join(gt_dir, key + ".json")
        meta = {}
        if os.path.exists(meta_path):
            with open(meta_path) as f:
                meta = json.load(f)
        if meta.get("status") == "skip":
            skipped.append(key)
            continue
        out[key] = {"gt": read_gray(os.path.join(gt_dir, name)), "meta": meta}
    return out, skipped


def score_source(name: str, pred_dir: str, truth: dict[str, dict], missing: str = "error") -> dict:
    """Per-photo rows for one source. `missing` is 'error' (stop), 'skip' (leave the photo out) or 'empty' (score as an empty mask)."""
    rows: dict[str, dict] = {}
    absent: list[str] = []
    for key, item in truth.items():
        path = os.path.join(pred_dir, key + ".png")
        if not os.path.exists(path):
            absent.append(key)
            if missing == "error":
                raise FileNotFoundError(f"{name}: no mask for {key} in {pred_dir} (use --missing skip|empty)")
            if missing == "skip":
                continue
            alpha = np.zeros(item["gt"].shape, np.float32)
        else:
            alpha = read_gray(path).astype(np.float32) / 255.0
        row = M.score_pair(alpha, item["gt"])
        start = item["meta"].get("start_source")
        row["anchored"] = start == name  # the owner began from this source's own mask: its score is flattered
        if "seconds" in item["meta"]:
            row["owner_seconds"] = item["meta"]["seconds"]
        rows[key] = row
    return {"name": name, "rows": rows, "missing": absent}


def summarise(rows: dict[str, dict]) -> dict:
    out: dict = {"n": len(rows)}
    for col in METRIC_COLUMNS:
        out[col] = M.mean_or_nan([r[col] for r in rows.values()])
    out["f_mean"] = M.mean_or_nan([(r["f2"] + r["f4"] + r["f8"]) / 3 for r in rows.values()])
    fresh = {k: r for k, r in rows.items() if not r["anchored"]}
    out["n_unanchored"] = len(fresh)
    for col in ("iou", "f4", "effort_strokes"):
        out[col + "_unanchored"] = M.mean_or_nan([r[col] for r in fresh.values()])
    return out


def bootstrap_difference(a: dict[str, dict], b: dict[str, dict], column: str, rounds: int = 4000, seed: int = 1) -> dict:
    """Paired difference a - b on the photos both have, with a percentile bootstrap 95 % interval and win/loss counts."""
    keys = sorted(set(a) & set(b))
    d = np.array([a[k][column] - b[k][column] for k in keys], dtype=float)
    if len(d) == 0:
        return {"n": 0, "mean": float("nan"), "lo": float("nan"), "hi": float("nan"), "wins": 0, "losses": 0, "ties": 0}
    rng = random.Random(seed)
    means = sorted(sum(d[rng.randrange(len(d))] for _ in range(len(d))) / len(d) for _ in range(rounds))
    better_is_higher = HIGHER_IS_BETTER.get(column, True)
    wins = int((d > 1e-9).sum() if better_is_higher else (d < -1e-9).sum())
    losses = int((d < -1e-9).sum() if better_is_higher else (d > 1e-9).sum())
    return {"n": len(d), "mean": float(d.mean()), "lo": means[int(0.025 * rounds)], "hi": means[int(0.975 * rounds) - 1],
            "wins": wins, "losses": losses, "ties": len(d) - wins - losses}


def spearman(x: list[float], y: list[float]) -> float:
    if len(x) < 4:
        return float("nan")
    rx = np.argsort(np.argsort(x)).astype(float)
    ry = np.argsort(np.argsort(y)).astype(float)
    if rx.std() == 0 or ry.std() == 0:
        return float("nan")
    return float(np.corrcoef(rx, ry)[0, 1])


def effort_check(rows: dict[str, dict]) -> dict:
    """Does the effort proxy track the owner's real seconds? Only rows the owner started from this source qualify."""
    pairs = [(r["effort_strokes"], r["owner_seconds"]) for r in rows.values() if r["anchored"] and "owner_seconds" in r]
    return {"n": len(pairs), "spearman": spearman([p[0] for p in pairs], [p[1] for p in pairs]) if pairs else float("nan")}


def fmt(v: float, digits: int = 3) -> str:
    return "n/a" if v is None or (isinstance(v, float) and math.isnan(v)) else f"{v:.{digits}f}"


def markdown(results: list[dict], compare: tuple[str, str] | None, skipped: list[str]) -> str:
    lines = ["# Mask measuring stick", ""]
    n = max((len(r["rows"]) for r in results), default=0)
    lines.append(f"Photos scored: {n}. Skipped by the owner: {len(skipped)}. Boundary F is at 2, 4 and 8 px of the ground truth's own size.")
    lines.append("")
    lines.append("| source | n | mean IoU | soft IoU | F@2 | F@4 | F@8 | strokes to fix | regions | IoU, not own-start | F@4, not own-start |")
    lines.append("|---|---|---|---|---|---|---|---|---|---|---|")
    for r in results:
        s = summarise(r["rows"])
        lines.append(f"| {r['name']} | {s['n']} | {fmt(s['iou'])} | {fmt(s['soft_iou'])} | {fmt(s['f2'])} | {fmt(s['f4'])} | {fmt(s['f8'])} | "
                     f"{fmt(s['effort_strokes'], 1)} | {fmt(s['effort_regions'], 1)} | {fmt(s['iou_unanchored'])} (n={s['n_unanchored']}) | {fmt(s['f4_unanchored'])} |")
    lines.append("")
    lines.append("`strokes to fix` is a proxy (lower is better). `not own-start` leaves out photos where the owner began from that source's own mask, "
                 "because starting from a mask flatters it.")
    if compare:
        a = next(r for r in results if r["name"] == compare[0])
        b = next(r for r in results if r["name"] == compare[1])
        lines += ["", f"## {compare[0]} minus {compare[1]} (paired, 95 % bootstrap interval)", "",
                  "| metric | mean difference | 95 % interval | wins | losses | ties |", "|---|---|---|---|---|---|"]
        for col in ["iou", "f2", "f4", "f8", "effort_strokes"]:
            d = bootstrap_difference(a["rows"], b["rows"], col)
            lines.append(f"| {col} | {fmt(d['mean'], 3)} | {fmt(d['lo'], 3)} to {fmt(d['hi'], 3)} | {d['wins']} | {d['losses']} | {d['ties']} |")
        lines.append("")
        lines.append("A difference counts only when its interval stays on one side of zero. For `effort_strokes` a negative difference is better.")
    for r in results:
        check = effort_check(r["rows"])
        if check["n"]:
            lines.append(f"\nEffort proxy against the owner's seconds, {r['name']}: Spearman {fmt(check['spearman'], 2)} over {check['n']} photos started from it.")
    lines += ["", "## Worst photos per source (lowest IoU)", ""]
    for r in results:
        worst = sorted(r["rows"].items(), key=lambda kv: kv[1]["iou"])[:5]
        lines.append(f"- **{r['name']}**: " + ", ".join(f"{k[:8]} ({fmt(v['iou'], 2)})" for k, v in worst))
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--gt", required=True, help="folder of hand-fixed masks (<key>.png, optional <key>.json)")
    ap.add_argument("--source", action="append", required=True, metavar="NAME=DIR", help="a mask source; repeat for several")
    ap.add_argument("--compare", nargs=2, metavar=("A", "B"), help="paired difference A minus B")
    ap.add_argument("--missing", choices=["error", "skip", "empty"], default="error")
    ap.add_argument("--out", help="folder for report.md and report.json")
    a = ap.parse_args(argv)

    truth, skipped = load_ground_truth(a.gt)
    if not truth:
        print("No ground-truth masks found. Run the fixer first.", file=sys.stderr)
        return 2
    results = []
    for spec in a.source:
        name, _, folder = spec.partition("=")
        results.append(score_source(name, folder, truth, a.missing))
    text = markdown(results, tuple(a.compare) if a.compare else None, skipped)
    print(text)
    if a.out:
        os.makedirs(a.out, exist_ok=True)
        with open(os.path.join(a.out, "report.md"), "w") as f:
            f.write(text)
        with open(os.path.join(a.out, "report.json"), "w") as f:
            json.dump({r["name"]: {"summary": summarise(r["rows"]), "rows": r["rows"], "missing": r["missing"]} for r in results}, f, indent=1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
