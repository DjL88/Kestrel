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


def denoise(run, planes: np.ndarray, a: float, b: float, tile: int = 512, overlap: int = 32) -> np.ndarray:
    """Denoise (4, H, W) planes with an onnxruntime session `run(input) -> output`, tile by tile, blending overlaps."""
    _, h, w = planes.shape
    step = tile - 2 * overlap
    out = np.zeros_like(planes, dtype=np.float32)
    weight = np.zeros((h, w), dtype=np.float32)
    ramp = np.minimum(np.arange(tile) + 1, np.arange(tile)[::-1] + 1).astype(np.float32)
    window = np.minimum(np.minimum.outer(ramp, ramp), overlap) / overlap
    for y in range(0, max(1, h - 2 * overlap), step):
        for x in range(0, max(1, w - 2 * overlap), step):
            y0, x0 = min(y, max(0, h - tile)), min(x, max(0, w - tile))
            piece = planes[:, y0:y0 + tile, x0:x0 + tile]
            ph, pw = piece.shape[1:]
            pad_h, pad_w = (-ph) % MULTIPLE, (-pw) % MULTIPLE
            padded = np.pad(piece, ((0, 0), (0, pad_h), (0, pad_w)), mode="reflect")
            noise = np.sqrt(a * np.clip(padded, 0, None) + b * b)
            result = run(np.concatenate([padded, noise])[None].astype(np.float32))[0, :, :ph, :pw]
            win = window[:ph, :pw]
            out[:, y0:y0 + ph, x0:x0 + pw] += result * win
            weight[y0:y0 + ph, x0:x0 + pw] += win
    return out / np.maximum(weight, 1e-6)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("model", type=Path)
    parser.add_argument("raw", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--crop", type=int, default=400, help="size of the 100%% crop, in packed pixels")
    parser.add_argument("--at", type=float, nargs=2, default=(0.5, 0.5), metavar=("X", "Y"),
                        help="crop centre as fractions of width and height")
    parser.add_argument("--full", action="store_true", help="show the whole frame, reduced, instead of a crop")
    parser.add_argument("--brighten", type=float, default=1.0, help="exposure multiplier for the preview only")
    args = parser.parse_args()

    import onnxruntime as ort

    providers = [p for p in ("CUDAExecutionProvider", "DmlExecutionProvider", "CPUExecutionProvider")
                 if p in ort.get_available_providers()]
    session = ort.InferenceSession(str(args.model), providers=providers)
    planes = read_planes(args.raw, clip=False)
    a, b, _ = estimate_noise(planes)
    planes = np.clip(planes, 0.0, 1.0)
    print(f"{args.raw.name}: {planes.shape[2]}x{planes.shape[1]} per plane, measured noise a={a:.3g} b={b:.3g}, "
          f"running on {session.get_providers()[0]}")
    began = time.time()
    clean = denoise(lambda x: session.run(None, {"input": x})[0], planes, a, b)
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
    image.save(args.out)
    print(f"before (left) and after (right) saved to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
