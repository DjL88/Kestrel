#!/usr/bin/env python3
"""What can be said about two mask sources BEFORE anyone has fixed any masks: coverage, refusals and agreement.

    cd scripts && python3 -m maskstick.diagnose --manifest heldout.json --source shipped=DIR --source matte=DIR [--out FILE]

This is not accuracy. Two sources agreeing does not make either right, and disagreeing does not say who is wrong. It shows
how often each source declines or finds nothing, how big its mask is, and where the two disagree most, so the owner's
limited fixing time can go to the photos that settle the question. Photos stay on disk; only numbers are written.
"""
from __future__ import annotations

import argparse
import json
import os

import numpy as np
from PIL import Image

from . import metrics as M
from .matte.trimap import build_trimap


def read_mask(folder: str, key: str, shape=None):
    path = os.path.join(folder, key + ".png")
    if not os.path.exists(path):
        return None
    with Image.open(path) as im:
        a = np.asarray(im.convert("L"), np.float32) / 255.0
    return a if shape is None else M.resize_alpha(a, shape)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--source", action="append", required=True, metavar="NAME=DIR", help="exactly two sources are compared")
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    with open(a.manifest) as f:
        manifest = json.load(f)
    sources = [(s.partition("=")[0], os.path.expanduser(s.partition("=")[2])) for s in a.source]
    if len(sources) != 2:
        ap.error("give exactly two --source values")
    (na, da), (nb, db) = sources
    rows = []
    for p in manifest["photos"]:
        key = p["key"]
        with Image.open(os.path.join(manifest["previews"], key + manifest.get("suffix", "_raw") + ".jpg")) as im:
            im = im.convert("RGB")
            im.thumbnail((1024, 1024), Image.LANCZOS)
            rgb = np.asarray(im)
        ma, mb = read_mask(da, key, rgb.shape[:2]), read_mask(db, key, rgb.shape[:2])
        row = {"key": key, "easy": p.get("likely_defocused"), "lens": p.get("lens_group"), "f": p.get("f"), "focal": p.get("focal"),
               f"{na}_made": ma is not None, f"{nb}_made": mb is not None,
               f"{na}_share": None if ma is None else float((ma >= 0.5).mean()), f"{nb}_share": None if mb is None else float((mb >= 0.5).mean())}
        if ma is not None and mb is not None:
            row["agreement_iou"] = M.iou(ma >= 0.5, mb >= 0.5)
            row["agreement_f4"] = M.boundary_f(ma >= 0.5, mb >= 0.5, 4)["f"]
        tri = build_trimap(rgb.astype(np.float32) / 255.0)
        row.update({"focus_separability": tri.stats.get("separability"), "colour_gap": tri.stats.get("colour_gap"), "matte_reason": tri.reason,
                    "matte_confidence": tri.confidence})
        rows.append(row)
    lines = [f"# Before the owner fixes anything: {na} against {nb} on {len(rows)} held-out previews", ""]
    for label, sel in (("all", rows), ("focus statistic says defocused background", [r for r in rows if r["easy"]]),
                       ("focus statistic says sharp or busy background", [r for r in rows if not r["easy"]])):
        n = len(sel)
        both = [r for r in sel if "agreement_iou" in r]
        lines.append(f"- **{label}** (n={n}): {na} made a mask for {sum(r[f'{na}_made'] for r in sel)}, {nb} for {sum(r[f'{nb}_made'] for r in sel)}; "
                     f"both for {len(both)}, where mean agreement IoU is {np.mean([r['agreement_iou'] for r in both]):.2f} and boundary agreement F@4 is "
                     f"{np.mean([r['agreement_f4'] for r in both]):.2f}." if both else f"- **{label}** (n={n}): no photo has both masks.")
    lines += ["", "Lowest agreement (these photos settle the question fastest once fixed):", ""]
    for r in sorted([r for r in rows if "agreement_iou" in r], key=lambda r: r["agreement_iou"])[:8]:
        lines.append(f"- {r['key'][:10]} IoU {r['agreement_iou']:.2f}, {na} covers {r[f'{na}_share']:.0%}, {nb} covers {r[f'{nb}_share']:.0%}, f/{r['f']}, {r['focal']} mm, {r['lens']}")
    text = "\n".join(lines) + "\n"
    print(text)
    if a.out:
        with open(a.out, "w") as f:
            f.write(text)
        with open(os.path.splitext(a.out)[0] + ".json", "w") as f:
            json.dump(rows, f, indent=1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
