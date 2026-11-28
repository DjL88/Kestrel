#!/usr/bin/env python3
"""Is a soft alpha good enough to blend two filtered versions of a photo without halos? (Synthetic scenes with a true alpha.)

    cd scripts && python3 -m maskstick.blend_check --run /tmp/maskstick-synth

Reuses the scenes and mask folders `bench_synth.py` wrote (`scenes/`, `matte/`, `shipped/`). The test blend is the one a
region-aware denoiser would make: the subject kept as it is, the background strongly smoothed (a Gaussian blur is the harshest
stand-in, it shows every halo), joined by the alpha:  out = alpha * original + (1 - alpha) * smoothed.  Against the same blend
made with the TRUE alpha it reports, in the 12 px zone around the true edge:
  * the mean absolute difference (0-255), and that as a share of the whole difference between original and smoothed;
  * `rim`: effective width in px of background still treated as subject (alpha above 0 outside the true subject). The background
    next to the subject stays unsmoothed: a sharp, noisy halo.
  * `bite`: effective width in px of subject edge treated as background (alpha below 1 inside). The subject's own edge is smeared.
Both are 'area of error / length of the true edge'. Rule of thumb used in FINDINGS: both under 1 px and under 25 % of the
difference. Nothing here is a denoiser; it only measures the alpha.
"""
from __future__ import annotations

import argparse
import os

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

from . import synth


def read_alpha(path: str, shape: tuple[int, int]) -> np.ndarray | None:
    if not os.path.exists(path):
        return None
    with Image.open(path) as im:
        a = np.asarray(im.convert("L"), np.float32) / 255.0
    return a if a.shape == shape else None


def measure(image: np.ndarray, truth: np.ndarray, alpha: np.ndarray, sigma: float = 4.0, zone: float = 12.0) -> dict:
    img = image.astype(np.float32)
    smooth = np.stack([ndi.gaussian_filter(img[..., c], sigma) for c in range(3)], axis=-1)
    blend = lambda a: a[..., None] * img + (1 - a[..., None]) * smooth  # noqa: E731
    inside = truth >= 0.5
    edge = inside & ~ndi.binary_erosion(inside)
    near = ndi.distance_transform_edt(~edge) <= zone
    diff = np.abs(blend(alpha) - blend(truth)).mean(axis=-1)
    full = np.abs(img - smooth).mean(axis=-1)
    length = max(int(edge.sum()), 1)
    return {
        "error": float(diff[near].mean()), "error_share": float(diff[near].sum() / max(full[near].sum(), 1e-9)),
        "rim": float(alpha[truth < 0.02].sum() / length), "bite": float((1 - alpha[truth > 0.98]).sum() / length),
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run", required=True, help="a bench_synth.py output folder")
    ap.add_argument("--sources", nargs="+", default=["matte", "shipped"])
    ap.add_argument("--min-blur", type=int, default=3, help="skip scenes with a sharper background (the matte declines those)")
    a = ap.parse_args(argv)
    scenes = os.path.join(a.run, "scenes")
    rows: dict[str, list[dict]] = {s: [] for s in a.sources}
    for name in sorted(os.listdir(scenes)):
        if not name.endswith("_raw.jpg"):
            continue
        key = name[:-len("_raw.jpg")]
        blur, gap, seed = int(key[1:3]), float(key.split("_g")[1].split("_")[0]), int(key.split("_s")[1])
        if blur < a.min_blur:
            continue
        with Image.open(os.path.join(scenes, name)) as im:
            image = np.asarray(im.convert("RGB"))
        truth = synth.make_scene(seed, size=image.shape[:2], bg_blur=blur, colour_gap=gap).alpha
        for source in a.sources:
            alpha = read_alpha(os.path.join(a.run, source, key + ".png"), truth.shape)
            if alpha is not None:
                rows[source].append({**measure(image, truth, alpha), "gap": gap})
    lines = ["| source | scenes | gap | mean abs error (0-255) | share of the full difference | rim (px) | bite (px) |", "|---|---|---|---|---|---|---|"]
    for source, rs in rows.items():
        for gap in sorted({r["gap"] for r in rs}):
            sel = [r for r in rs if r["gap"] == gap]
            lines.append(f"| {source} | {len(sel)} | {gap:.2f} | {np.mean([r['error'] for r in sel]):.1f} | {np.mean([r['error_share'] for r in sel]):.0%} | "
                         f"{np.mean([r['rim'] for r in sel]):.2f} | {np.mean([r['bite'] for r in sel]):.2f} |")
    text = "\n".join(lines)
    print(text)
    with open(os.path.join(a.run, "blend-report.md"), "w") as f:
        f.write(text + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
