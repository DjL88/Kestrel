#!/usr/bin/env python3
"""Measure how noisy each of your cameras really is, from your own high-ISO RAW files.

    python tools/denoise-training/calibrate_noise.py work/photos.csv work/noise-profile.json

For each camera it picks a few photos at each ISO stop from --min-iso upwards, and fits the sensor noise as
variance = a * signal + b**2 (see noise_model.py). The training step then adds noise of exactly that shape to clean
crops, so the denoiser learns your sensors rather than a textbook one.

How it measures without a test chart: the two green sites in each 2 x 2 Bayer block see almost the same light, so
their difference is nearly pure noise. Small blocks where the picture itself is busy (edges, feathers) are rejected,
and the noise in the rest is binned by brightness. Photos with in-camera raw noise reduction will measure as quieter
than the sensor really is; that is fine, because it is what the denoiser will be given.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from raw_source import UnsupportedRaw, read_planes  # noqa: E402


def estimate_noise(planes: np.ndarray, block: int = 16, bins: int = 32) -> tuple[float, float, int]:
    """(a, b, blocks used) for one picture's planes (unclipped, normalised 0..1)."""
    g1, g2 = planes[1], planes[2]
    h = g1.shape[0] // block * block
    w = g1.shape[1] // block * block
    signal = ((g1 + g2) / 2)[:h, :w].reshape(h // block, block, w // block, block)
    diff = ((g1 - g2) / math.sqrt(2))[:h, :w].reshape(h // block, block, w // block, block)
    mean = signal.mean(axis=(1, 3))
    noise_var = diff.var(axis=(1, 3))
    signal_var = signal.var(axis=(1, 3))
    # A flat block's averaged-green variance is about half the per-pixel noise variance; texture makes it much larger.
    flat = (signal_var <= noise_var) & (mean < 0.85) & (mean > -0.01)
    m, v = mean[flat], noise_var[flat]
    if m.size < 50:
        raise ValueError("too few flat areas to measure (a very busy or very dark picture)")
    edges = np.quantile(m, np.linspace(0, 1, bins + 1))
    xs, ys, ws = [], [], []
    for low, high in zip(edges[:-1], edges[1:]):
        chosen = (m >= low) & (m <= high)
        if chosen.sum() >= 10:
            xs.append(float(np.median(m[chosen])))
            ys.append(float(np.median(v[chosen])))
            ws.append(float(chosen.sum()))
    if len(xs) < 3:
        raise ValueError("brightness range too narrow to separate shot noise from read noise")
    # Weighted least squares for v = a * x + c, then c = b**2. Negative results are clamped, not trusted.
    design = np.stack([np.array(xs), np.ones(len(xs))], axis=1) * np.sqrt(ws)[:, None]
    (a, c), *_ = np.linalg.lstsq(design, np.array(ys) * np.sqrt(ws), rcond=None)
    a = max(float(a), 1e-9)
    b = math.sqrt(max(float(c), 1e-12))
    return a, b, int(m.size)


def choose(rows: list[dict], min_iso: int, per_stop: int) -> list[dict]:
    """A few photos per camera per ISO stop, spread through the list rather than the first few."""
    groups: dict[tuple[str, int], list[dict]] = {}
    for row in rows:
        if row["iso"] and int(row["iso"]) >= min_iso and row["camera"]:
            stop = round(math.log2(int(row["iso"]) / 100))
            groups.setdefault((row["camera"], stop), []).append(row)
    picked = []
    for _, group in sorted(groups.items()):
        step = max(1, len(group) // per_stop)
        picked.extend(group[::step][:per_stop])
    return picked


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("photos", type=Path, help="photos.csv from index_photos.py")
    parser.add_argument("out", type=Path, help="noise profile JSON to write")
    parser.add_argument("--min-iso", type=int, default=1600)
    parser.add_argument("--per-stop", type=int, default=3, help="photos measured per camera per ISO stop")
    parser.add_argument("--raw-dump", type=Path, help="use Kestrel's raw_dump(.exe) instead of rawpy")
    args = parser.parse_args()
    with open(args.photos, newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    chosen = choose(rows, args.min_iso, args.per_stop)
    if not chosen:
        print(f"no photos at ISO {args.min_iso} or above with a known camera; the generic noise model will be used")
        return 1
    cameras: dict[str, dict] = {}
    for row in chosen:
        try:
            planes = read_planes(Path(row["path"]), args.raw_dump, clip=False)
            a, b, used = estimate_noise(planes)
        except (UnsupportedRaw, ValueError, OSError) as problem:
            print(f"skipped {Path(row['path']).name}: {problem}")
            continue
        cameras.setdefault(row["camera"], {"points": []})["points"].append(
            {"iso": int(row["iso"]), "a": a, "b": b, "blocks": used, "file": Path(row["path"]).name})
        print(f"{row['camera']}  ISO {int(row['iso']):6d}  a={a:.3g}  b={b:.3g}  ({used} flat blocks)")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({"model": "variance = a * signal + b**2, signal 0..1 above black",
                                    "cameras": cameras}, indent=2))
    print(f"profile for {len(cameras)} camera(s) written to {args.out}")
    return 0 if cameras else 1


if __name__ == "__main__":
    sys.exit(main())
