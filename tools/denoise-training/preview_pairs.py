#!/usr/bin/env python3
"""Make a picture of some training pairs (clean on the left, noisy on the right) to check the noise looks real.

    python3 tools/denoise-training/preview_pairs.py raw-samples/pairs preview.png --count 6

Needs numpy and Pillow. Colours are a rough preview only (simple white balance, gamma), not a developed photo.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


def to_rgb(planes: np.ndarray, gains=(2.0, 1.0, 1.6)) -> np.ndarray:
    r, g1, g2, b = planes
    rgb = np.stack([r * gains[0], (g1 + g2) / 2 * gains[1], b * gains[2]], axis=-1)
    return (np.clip(rgb, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("pairs", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--count", type=int, default=6)
    parser.add_argument("--scale", type=int, default=3)
    args = parser.parse_args()
    files = sorted(args.pairs.glob("*.npz"))
    step = max(1, len(files) // args.count)
    chosen = files[::step][: args.count]
    tiles = []
    for path in chosen:
        data = np.load(path)
        pair = np.concatenate([to_rgb(data["clean"]), to_rgb(data["noisy"])], axis=1)
        tile = Image.fromarray(pair).resize((pair.shape[1] * args.scale, pair.shape[0] * args.scale), Image.NEAREST)
        draw = ImageDraw.Draw(tile)
        draw.text((4, 2), f"{str(data['model'])[:14]}  ISO {float(data['iso']):.0f}", fill=(255, 255, 0))
        tiles.append(tile)
    columns = 2
    rows = (len(tiles) + columns - 1) // columns
    sheet = Image.new("RGB", (tiles[0].width * columns, tiles[0].height * rows))
    for index, tile in enumerate(tiles):
        sheet.paste(tile, ((index % columns) * tile.width, (index // columns) * tile.height))
    sheet.save(args.out)
    print(f"{len(tiles)} pairs shown in {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
