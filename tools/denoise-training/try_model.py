#!/usr/bin/env python3
"""Run the exported denoiser on one of your real high-ISO RAW files and save a before/after picture.

    python tools/denoise-training/try_model.py work/model/denoise.onnx "C:/Users/me/Desktop/Photos/owl_iso12800.NEF" ^
        owl-before-after.png

The noise level is measured from the photo itself (as calibrate_noise.py does), so no camera profile is needed. The
whole sensor is denoised in overlapping tiles; the picture shows a 100% crop (or --full for the whole frame, reduced).
Colours are a rough preview (fixed white balance, gamma), not a developed photo: judge the noise and detail, not the
colour. Needs numpy, Pillow, rawpy and onnxruntime.
"""
from __future__ import annotations

import argparse
import hashlib
import math
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from calibrate_noise import estimate_noise  # noqa: E402
from preview_pairs import to_rgb  # noqa: E402
from raw_source import read_planes  # noqa: E402

MULTIPLE = 16


def tile_starts(length: int, tile: int, step: int) -> list[int]:
    last = max(0, length - tile)
    return [*range(0, last, step), last]


def denoise(run, planes: np.ndarray, a: float, b: float, tile: int = 512, overlap: int = 32) -> np.ndarray:
    """Denoise normalized (4, H, W) Bayer planes with validated ONNX tiles."""
    if planes.ndim != 3 or planes.shape[0] != 4 or min(planes.shape[1:]) < 1:
        raise ValueError("Expected four non-empty Bayer planes")
    if planes.dtype != np.float32 or not np.isfinite(planes).all() or planes.min() < 0 or planes.max() > 1:
        raise ValueError("Expected finite float32 Bayer samples in [0, 1]")
    if not all(math.isfinite(value) and value >= 0 for value in (a, b)):
        raise ValueError("Expected finite, non-negative shot and read noise")
    if tile < MULTIPLE or tile % MULTIPLE or not 0 < overlap * 2 < tile:
        raise ValueError("Expected a tile divisible by 16 and positive overlap below half the tile")

    _, h, w = planes.shape
    step = tile - 2 * overlap
    out = np.zeros_like(planes)
    weight = np.zeros((h, w), dtype=np.float32)
    ramp = np.minimum(np.arange(tile) + 1, np.arange(tile)[::-1] + 1).astype(np.float32)
    window = np.minimum(np.minimum.outer(ramp, ramp), overlap) / overlap
    for y in tile_starts(h, tile, step):
        for x in tile_starts(w, tile, step):
            piece = planes[:, y:y + tile, x:x + tile]
            ph, pw = piece.shape[1:]
            pads = ((0, 0), (0, (-ph) % MULTIPLE), (0, (-pw) % MULTIPLE))
            padded = np.pad(piece, pads, mode="reflect")
            noise = np.sqrt(a * padded + b * b)
            model_input = np.concatenate([padded, noise])[None].astype(np.float32)
            if not np.isfinite(model_input).all():
                raise ValueError("Noise calibration produced non-finite model input")
            clean = run(model_input)
            if not isinstance(clean, np.ndarray) or clean.dtype != np.float32 or clean.shape != (1, *padded.shape):
                raise ValueError("Model must return one float32 tensor of four clean Bayer planes")
            if not np.isfinite(clean).all():
                raise ValueError("Model returned non-finite Bayer samples")
            win = window[:ph, :pw]
            out[:, y:y + ph, x:x + pw] += np.clip(clean[0, :, :ph, :pw], 0, 1) * win
            weight[y:y + ph, x:x + pw] += win
    out /= weight
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("model", type=Path)
    parser.add_argument("raw", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--raw-dump", type=Path, help="path to Kestrel’s native RAW mosaic reader")
    parser.add_argument("--crop", type=int, default=400, help="size of the 100%% crop, in packed pixels")
    parser.add_argument("--at", type=float, nargs=2, default=(0.5, 0.5), metavar=("X", "Y"),
                        help="crop centre as fractions of width and height")
    parser.add_argument("--full", action="store_true", help="show the whole frame, reduced, instead of a crop")
    parser.add_argument("--brighten", type=float, default=1.0, help="exposure multiplier for the preview only")
    args = parser.parse_args()
    if args.out.suffix.lower() != ".png":
        parser.error("the comparison output must have a .png extension")
    if args.out.exists():
        parser.error("the comparison output already exists; choose a new filename")

    import onnxruntime as ort

    providers = [p for p in ("CUDAExecutionProvider", "DmlExecutionProvider", "CPUExecutionProvider")
                 if p in ort.get_available_providers()]
    model = args.model.read_bytes()
    session = ort.InferenceSession(model, providers=providers)
    print(f"model SHA-256 {hashlib.sha256(model).hexdigest()}")
    planes = read_planes(args.raw, raw_dump=args.raw_dump, clip=False)
    a, b, _ = estimate_noise(planes)
    planes = np.clip(planes, 0.0, 1.0)
    print(f"{args.raw.name}: {planes.shape[2]}x{planes.shape[1]} per plane, measured noise a={a:.3g} b={b:.3g}, "
          f"running on {session.get_providers()[0]}")
    began = time.time()
    clean = denoise(lambda x: session.run(["clean"], {"input": x})[0], planes, a, b)
    print(f"denoised in {time.time() - began:.1f} s")

    if args.full:
        before, after = planes, clean
        scale = max(1, planes.shape[2] // 1200)
        before, after = before[:, ::scale, ::scale], after[:, ::scale, ::scale]
    else:
        size = min(args.crop, planes.shape[1], planes.shape[2])
        cy = int(args.at[1] * planes.shape[1]) - size // 2
        cx = int(args.at[0] * planes.shape[2]) - size // 2
        cy, cx = max(0, min(cy, planes.shape[1] - size)), max(0, min(cx, planes.shape[2] - size))
        before = planes[:, cy:cy + size, cx:cx + size]
        after = clean[:, cy:cy + size, cx:cx + size]
    picture = np.concatenate([to_rgb(before * args.brighten), to_rgb(after * args.brighten)], axis=1)
    image = Image.fromarray(picture)
    if not args.full:
        image = image.resize((image.width * 2, image.height * 2), Image.NEAREST)
    with args.out.open("xb") as output:
        image.save(output, format="PNG")
    print(f"before (left) and after (right) saved to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
