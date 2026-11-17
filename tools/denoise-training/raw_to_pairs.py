#!/usr/bin/env python3
"""Noisy/clean training pairs straight from RAW files, with no Rust toolchain and no 90 MB dumps on disk.

This is the Windows-friendly route to the same pairs `make_pairs.py` builds from `raw_dump` output. It decodes each RAW
in memory with LibRaw (the `rawpy` package), packs the sensor mosaic as R, G1, G2, B, and reuses `make_pairs` unchanged,
so the pairs are identical in form. Originals are only ever opened for reading.

    pip install numpy rawpy
    # clean frames picked from a Lightroom catalog, via tools/lightroom/read_lrcat.py output:
    python tools/denoise-training/raw_to_pairs.py out-pairs --recipes recipes.jsonl --max-iso 400
    # or any RAW files:
    python tools/denoise-training/raw_to_pairs.py out-pairs D:/shoot/a.NEF D:/shoot/b.NEF

LibRaw cannot decode Nikon High Efficiency (HE / HE*) NEFs; those files are skipped with a message. Converting them with
Adobe DNG Converter (which keeps the mosaic) gives DNGs that work here.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from make_pairs import OFFSETS, make_pairs, normalise, pack_rggb  # noqa: E402

RAW_EXTENSIONS = {"nef", "dng", "arw", "cr2", "cr3", "raf", "orf", "rw2", "pef"}


def pattern_name(raw_pattern: np.ndarray, color_desc: bytes) -> str:
    """LibRaw's 2 x 2 index pattern plus its colour letters ('RGBG') as a name like 'RGGB'."""
    letters = color_desc.decode("ascii")
    return "".join(letters[int(i)] for i in np.asarray(raw_pattern)[:2, :2].flatten())


def decode(path: Path) -> tuple[np.ndarray, dict]:
    """A RAW file to packed R, G1, G2, B planes in 0..1, plus the facts make_pairs records."""
    import rawpy

    with rawpy.imread(str(path)) as raw:
        if raw.num_colors != 3 or raw.raw_pattern is None or raw.raw_pattern.shape != (2, 2):
            raise ValueError("not a 2 x 2 Bayer mosaic")
        pattern = pattern_name(raw.raw_pattern, raw.color_desc)
        if pattern not in OFFSETS:
            raise ValueError(f"unsupported colour filter pattern {pattern!r}")
        mosaic = raw.raw_image_visible.copy()
        black = float(np.mean(raw.black_level_per_channel))
        white = float(raw.white_level)
    return pack_rggb(normalise(mosaic, black, white), pattern), {"cfa": pattern, "black": black, "white": white}


def from_recipes(path: Path, max_iso: float, min_rating: int) -> list[tuple[Path, dict]]:
    """Clean candidates from read_lrcat.py output: RAW, at or below max_iso, rated at least min_rating, still on disk."""
    chosen = []
    for line in path.read_text(encoding="utf-8").splitlines():
        photo = json.loads(line)
        if photo.get("extension") not in RAW_EXTENSIONS or not photo.get("iso") or photo["iso"] > max_iso:
            continue
        if (photo.get("rating") or 0) < min_rating:
            continue
        file = Path(photo["file"])
        if file.is_file():
            chosen.append((file, {"camera": photo.get("camera"), "source_iso": photo["iso"]}))
    return chosen


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("out", type=Path, help="folder for the .npz pairs")
    parser.add_argument("files", type=Path, nargs="*", help="RAW files (or use --recipes)")
    parser.add_argument("--recipes", type=Path, help="read_lrcat.py JSON-lines output to pick clean frames from")
    parser.add_argument("--max-iso", type=float, default=400, help="only frames at or below this ISO count as clean")
    parser.add_argument("--min-rating", type=int, default=0, help="only frames rated at least this in Lightroom")
    parser.add_argument("--limit", type=int, default=0, help="stop after this many usable files (0 = all)")
    parser.add_argument("--crops", type=int, default=8, help="crops per RAW file")
    parser.add_argument("--size", type=int, default=128, help="crop size in packed pixels")
    parser.add_argument("--seed", type=int, default=1)
    args = parser.parse_args()

    sources = [(f, {"camera": None, "source_iso": None}) for f in args.files]
    if args.recipes:
        sources += from_recipes(args.recipes, args.max_iso, args.min_rating)
    if not sources:
        parser.error("give RAW files or --recipes")
    rng = np.random.default_rng(args.seed)
    args.out.mkdir(parents=True, exist_ok=True)
    used = made = skipped = 0
    for path, facts in sources:
        # Name pairs by a hash of the full path: originals in different folders often share a file name.
        stem = f"{path.stem}-{hashlib.sha1(str(path).encode('utf-8')).hexdigest()[:8]}"
        if any(args.out.glob(f"{stem}-*.npz")):
            used += 1
            continue  # already done on an earlier run
        try:
            planes, meta = decode(path)
        except Exception as problem:  # LibRaw raises its own types; any failure just skips the file
            skipped += 1
            print(f"skipped {path.name}: {problem}")
            continue
        pairs = make_pairs(planes, args.crops, args.size, rng)
        for index, pair in enumerate(pairs):
            np.savez_compressed(args.out / f"{stem}-{index:02d}.npz", noisy=pair["noisy"], clean=pair["clean"],
                                iso=pair["iso"], a=pair["a"], b=pair["b"], model=facts["camera"] or "",
                                source_iso=facts["source_iso"] or 0, cfa=meta["cfa"])
        made += len(pairs)
        used += 1
        print(f"{path.name} ({facts['camera'] or '?'}, {meta['cfa']}): {len(pairs)} pairs")
        if args.limit and used >= args.limit:
            break
    print(f"{made} pairs from {used} files written to {args.out}; {skipped} files skipped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
