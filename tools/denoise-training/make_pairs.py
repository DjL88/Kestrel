#!/usr/bin/env python3
"""Turn clean RAW dumps into noisy/clean training pairs, for any camera brand with a 2 x 2 Bayer sensor.

Step 1, once per RAW file (uses Kestrel's own decoder, so any camera the app opens works):
    cd src-tauri && cargo run --release --example raw_dump -- ../raw-samples/some.CR3 ../raw-samples/dump

Step 2, build pairs from every dump:
    python3 tools/denoise-training/make_pairs.py raw-samples/dump out-pairs --crops 8

Each pair holds four colour planes (R, G1, G2, B) at half resolution, noisy and clean, so a network sees the sensor
mosaic itself and can learn denoising and demosaicing together. Fujifilm X-Trans (6 x 6) and files already developed
to three colour channels are skipped with a message: they need their own packing and are not covered yet.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from noise_model import add_noise, noise_params, sample_iso  # noqa: E402

# Where the first red pixel sits (row, column offset) for each 2 x 2 pattern, so every file packs as R, G1, G2, B.
OFFSETS = {"RGGB": (0, 0), "GRBG": (0, 1), "GBRG": (1, 0), "BGGR": (1, 1)}


def normalise(raw: np.ndarray, black: float, white: float) -> np.ndarray:
    """Sensor counts to 0..1 above the black level."""
    if white <= black:
        raise ValueError("white level must be above black level")
    return np.clip((raw.astype(np.float32) - black) / (white - black), 0.0, 1.0)


def pack_rggb(mosaic: np.ndarray, pattern: str) -> np.ndarray:
    """A 2 x 2 Bayer mosaic (H, W) to four planes (4, H/2, W/2) in the order R, G1, G2, B, whatever the pattern."""
    if pattern not in OFFSETS:
        raise ValueError(f"unsupported colour filter pattern {pattern!r}")
    dy, dx = OFFSETS[pattern]
    h = (mosaic.shape[0] - dy) // 2 * 2
    w = (mosaic.shape[1] - dx) // 2 * 2
    m = mosaic[dy:dy + h, dx:dx + w]
    return np.stack([m[0::2, 0::2], m[0::2, 1::2], m[1::2, 0::2], m[1::2, 1::2]])


def unpack_rggb(planes: np.ndarray) -> np.ndarray:
    """Inverse of pack_rggb for an RGGB mosaic."""
    _, h, w = planes.shape
    out = np.zeros((h * 2, w * 2), dtype=planes.dtype)
    out[0::2, 0::2], out[0::2, 1::2], out[1::2, 0::2], out[1::2, 1::2] = planes
    return out


def load_dump(meta_path: Path) -> tuple[np.ndarray, dict]:
    meta = json.loads(meta_path.read_text())
    if meta["cpp"] != 1 or meta["cfa"] not in OFFSETS:
        raise ValueError(f"{meta['name']}: not a 2 x 2 Bayer mosaic (cfa={meta['cfa']!r}, channels={meta['cpp']})")
    raw = np.fromfile(meta_path.with_suffix(".u16"), dtype="<u2").reshape(meta["height"], meta["width"])
    black = float(np.mean(meta["black"]))
    white = float(meta["white"][0])
    return pack_rggb(normalise(raw, black, white), meta["cfa"]), meta


def has_content(crop: np.ndarray, minimum_mean: float = 0.005, minimum_detail: float = 0.02, block: int = 4) -> bool:
    """False for crops that are nearly black or featureless: they teach a network nothing about real detail.

    Detail is measured on block-averaged luma, so the source frame's own pixel noise does not count as detail, and
    relative to brightness, because linear sensor data is dark (a well-exposed bird is often 0.05-0.2). Measured on
    real Nikon and Pixel frames: flat sky scores about 0.003, feathers and foliage 0.04 and up."""
    luma = crop.mean(axis=0)
    mean = float(luma.mean())
    if mean < minimum_mean:
        return False
    h, w = luma.shape[0] // block * block, luma.shape[1] // block * block
    coarse = luma[:h, :w].reshape(h // block, block, w // block, block).mean(axis=(1, 3))
    detail = (float(np.abs(np.diff(coarse, axis=0)).mean()) + float(np.abs(np.diff(coarse, axis=1)).mean())) / 2
    return detail / mean >= minimum_detail


def make_pairs(planes: np.ndarray, count: int, size: int, rng: np.random.Generator,
               iso_range: tuple[float, float] = (400.0, 51200.0), attempts: int = 20) -> list[dict]:
    """Random crops with noise at a random ISO. Some are also darkened first, like an underexposed shot lifted later.
    Crops without content are skipped; a picture that has none to offer simply gives fewer pairs."""
    _, h, w = planes.shape
    if h < size or w < size:
        raise ValueError("image smaller than the crop size")
    pairs = []
    for _ in range(count):
        clean = None
        for _try in range(attempts):
            y, x = int(rng.integers(0, h - size + 1)), int(rng.integers(0, w - size + 1))
            candidate = planes[:, y:y + size, x:x + size]
            if has_content(candidate):
                clean = candidate.copy()
                break
        if clean is None:
            continue
        if rng.random() < 0.5:
            clean *= float(np.exp(rng.uniform(np.log(0.1), 0.0)))
        iso = sample_iso(rng, *iso_range)
        a, b = noise_params(iso)
        pairs.append({"clean": clean, "noisy": add_noise(clean, a, b, rng), "iso": iso, "a": a, "b": b})
    return pairs


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("dumps", type=Path, help="folder holding raw_dump output (.json and .u16)")
    parser.add_argument("out", type=Path, help="folder for the .npz pairs")
    parser.add_argument("--crops", type=int, default=8, help="crops per RAW file")
    parser.add_argument("--size", type=int, default=128, help="crop size in packed pixels (a quarter of that many sensor rows)")
    parser.add_argument("--seed", type=int, default=1)
    args = parser.parse_args()
    rng = np.random.default_rng(args.seed)
    args.out.mkdir(parents=True, exist_ok=True)
    made = 0
    for meta_path in sorted(args.dumps.glob("*.json")):
        try:
            planes, meta = load_dump(meta_path)
        except ValueError as problem:
            print(f"skipped {problem}")
            continue
        for index, pair in enumerate(make_pairs(planes, args.crops, args.size, rng)):
            np.savez_compressed(args.out / f"{meta['name']}-{index:02d}.npz", noisy=pair["noisy"], clean=pair["clean"],
                                iso=pair["iso"], a=pair["a"], b=pair["b"], make=meta["make"], model=meta["model"])
            made += 1
        print(f"{meta['make']} {meta['model']}: {args.crops} pairs")
    print(f"{made} pairs written to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
