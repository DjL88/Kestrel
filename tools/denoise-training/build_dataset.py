#!/usr/bin/env python3
"""Cut clean training crops from your own low-ISO RAW files.

    python tools/denoise-training/build_dataset.py work/photos.csv work/crops --max-iso 400 --crops 6

Chooses photos from photos.csv (index_photos.py) that are low ISO and not flagged as rejected in Lightroom, reads each
one, and saves a few crops that have real detail as four Bayer planes (R, G1, G2, B), 16-bit float. Noise is NOT added
here: train.py adds fresh noise every epoch, shaped by your cameras' noise profile, so the network never sees the same
noisy example twice.

Disk use is about 0.5 MB per crop at the default size. Re-running skips photos already done (listed in done.txt), so
it can be stopped and resumed. About 1 photo in 20, chosen by file name, goes to the validation set (crops/val) and is
never trained on, so the reported score is on pictures the network has not seen.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from make_pairs import has_content  # noqa: E402
from raw_source import UnsupportedRaw, read_planes  # noqa: E402


def is_validation(path: str, share: float = 0.05) -> bool:
    """Stable split by file name, so a photo is always on the same side however often the build is re-run."""
    digest = hashlib.sha1(Path(path).name.lower().encode()).digest()
    return digest[0] / 256 < share


def select(rows: list[dict], max_iso: int, min_rating: int, allow_unknown_iso: bool, picks_only: bool) -> list[dict]:
    chosen = []
    for row in rows:
        if int(row.get("pick") or 0) < 0:
            continue  # rejected in Lightroom: often blurred or badly exposed
        if picks_only and int(row.get("pick") or 0) < 1:
            continue
        if int(row.get("rating") or 0) < min_rating:
            continue
        iso = int(row["iso"]) if row.get("iso") else None
        if iso is None and not allow_unknown_iso:
            continue
        if iso is not None and iso > max_iso:
            continue
        chosen.append(row)
    return chosen


def bin2(planes: np.ndarray) -> np.ndarray:
    """Average 2 x 2 neighbours in each plane: halves the size and the remaining noise, for cleaner targets."""
    _, h, w = planes.shape
    p = planes[:, : h // 2 * 2, : w // 2 * 2]
    return (p[:, 0::2, 0::2] + p[:, 0::2, 1::2] + p[:, 1::2, 0::2] + p[:, 1::2, 1::2]) / 4


def crops_from(planes: np.ndarray, count: int, size: int, rng: np.random.Generator, attempts: int = 30) -> list[np.ndarray]:
    _, h, w = planes.shape
    if h < size or w < size:
        return []
    found = []
    for _ in range(count * attempts):
        if len(found) == count:
            break
        y, x = int(rng.integers(0, h - size + 1)), int(rng.integers(0, w - size + 1))
        crop = planes[:, y:y + size, x:x + size]
        # Skip crops with clipped highlights: there is no true value to learn there.
        if has_content(crop) and float((crop >= 0.98).mean()) < 0.01:
            found.append(crop.copy())
    return found


def process(job: tuple) -> tuple[str, int, str]:
    row, out, count, size, binning, raw_dump, seed = job
    path = Path(row["path"])
    try:
        planes = read_planes(path, raw_dump)
    except (UnsupportedRaw, OSError, ValueError) as problem:
        return row["path"], 0, str(problem)
    except Exception as problem:  # a corrupt file must not stop a run of thousands
        return row["path"], 0, f"{type(problem).__name__}: {problem}"
    if binning:
        planes = bin2(planes)
    rng = np.random.default_rng([seed, int.from_bytes(hashlib.sha1(row["path"].encode()).digest()[:4], "little")])
    target = out / ("val" if is_validation(row["path"]) else "train")
    stem = f"{path.stem}-{hashlib.sha1(row['path'].encode()).hexdigest()[:6]}"
    crops = crops_from(planes, count, size, rng)
    for index, crop in enumerate(crops):
        np.savez(target / f"{stem}-{index:02d}.npz", clean=crop.astype(np.float16), camera=row.get("camera", ""),
                 iso=float(row["iso"]) if row.get("iso") else 0.0, binned=binning)
    return row["path"], len(crops), ""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("photos", type=Path, help="photos.csv from index_photos.py")
    parser.add_argument("out", type=Path, help="folder for the crops")
    parser.add_argument("--max-iso", type=int, default=400, help="cleanest photos only; higher ISO has noise built in")
    parser.add_argument("--min-rating", type=int, default=0, help="only photos with at least this many stars")
    parser.add_argument("--picks-only", action="store_true", help="only photos flagged as picks in Lightroom")
    parser.add_argument("--allow-unknown-iso", action="store_true", help="also use files whose ISO could not be read")
    parser.add_argument("--crops", type=int, default=6, help="crops per photo")
    parser.add_argument("--size", type=int, default=256, help="crop size in packed pixels (twice that on the sensor)")
    parser.add_argument("--bin", action="store_true", help="average 2 x 2 first, for cleaner targets (ISO 800+ sources)")
    parser.add_argument("--limit", type=int, default=0, help="stop after this many photos (0: all)")
    parser.add_argument("--workers", type=int, default=0, help="parallel readers (0: half the CPU cores)")
    parser.add_argument("--raw-dump", type=Path, help="use Kestrel's raw_dump(.exe) instead of rawpy")
    parser.add_argument("--seed", type=int, default=1)
    args = parser.parse_args()

    with open(args.photos, newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    chosen = select(rows, args.max_iso, args.min_rating, args.allow_unknown_iso, args.picks_only)
    for part in ("train", "val"):
        (args.out / part).mkdir(parents=True, exist_ok=True)
    done_file = args.out / "done.txt"
    done = set(done_file.read_text(encoding="utf-8").splitlines()) if done_file.exists() else set()
    todo = [row for row in chosen if row["path"] not in done]
    if args.limit:
        todo = todo[: max(0, args.limit - len(done))]
    print(f"{len(chosen)} photos qualify (ISO <= {args.max_iso}, not rejected); {len(done)} done before, {len(todo)} to do")

    import os
    workers = args.workers or max(1, (os.cpu_count() or 2) // 2)
    jobs = [(row, args.out, args.crops, args.size, args.bin, args.raw_dump, args.seed) for row in todo]
    made = skipped = 0
    with open(done_file, "a", encoding="utf-8") as log, ProcessPoolExecutor(max_workers=workers) as pool:
        for index, (path, count, problem) in enumerate(pool.map(process, jobs, chunksize=2), start=1):
            if problem:
                skipped += 1
                print(f"skipped {Path(path).name}: {problem}")
            made += count
            log.write(path + "\n")
            log.flush()
            if index % 25 == 0 or index == len(jobs):
                print(f"{index}/{len(jobs)} photos, {made} crops")
    train = len(list((args.out / "train").glob("*.npz")))
    val = len(list((args.out / "val").glob("*.npz")))
    print(f"done: {made} new crops ({skipped} photos skipped). Totals: {train} training, {val} validation")
    return 0


if __name__ == "__main__":
    sys.exit(main())
