#!/usr/bin/env python3
"""Prepare training data from a big local folder of RAW files, without uploading or copying the photos.

Reads each RAW in place, keeps a few small crops that have real detail, measures the file's real noise, and writes only
those small results. The RAW files are never changed, copied or sent anywhere. Works for any camera brand LibRaw reads.

Setup (Windows PowerShell, from the Kestrel folder; macOS and Linux are the same with python3):
    python -m venv tools\\denoise-training\\.venv
    tools\\denoise-training\\.venv\\Scripts\\pip install numpy rawpy exifread
Try a small run first:
    tools\\denoise-training\\.venv\\Scripts\\python tools\\denoise-training\\prepare_crops.py "D:\\Photos" prepared --limit 100
Then everything (about an hour for 10,000 files; it can be stopped and run again, finished files are skipped):
    tools\\denoise-training\\.venv\\Scripts\\python tools\\denoise-training\\prepare_crops.py "D:\\Photos" prepared

Output folder:
    crops-<n>.npz   packed Bayer crops (R, G1, G2, B) as 16-bit, with the ISO and camera of each crop
    files.jsonl     one line per RAW: camera, ISO, whether it was used, and its measured noise (a, b)
    noise_profile.json   the median measured noise for each camera and ISO, from all files
`prepared` is small compared with the photos; that folder is what to send or copy, not the photos.
Nikon High Efficiency files are skipped with a note (LibRaw cannot read them); lossless and compressed ones work.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from make_pairs import OFFSETS, has_content, normalise, pack_rggb  # noqa: E402
from noise_estimate import estimate_noise  # noqa: E402

RAW_EXTENSIONS = {".nef", ".nrw", ".cr2", ".cr3", ".arw", ".raf", ".rw2", ".orf", ".pef", ".dng", ".srw", ".sr2"}
COLOUR = {0: "R", 1: "G", 2: "B", 3: "G"}


def read_raw(path: Path):
    """Return (packed planes 0..1, camera, iso) for a 2 x 2 Bayer RAW, or raise ValueError saying why not."""
    import rawpy  # imported here so the rest of the module (and its tests) need only numpy

    with rawpy.imread(str(path)) as raw:
        colours = raw.raw_colors_visible
        pattern = "".join(COLOUR[int(colours[y, x])] for y in (0, 1) for x in (0, 1))
        if raw.raw_type != rawpy.RawType.Flat or pattern not in OFFSETS:
            raise ValueError(f"not a plain 2 x 2 Bayer mosaic ({pattern})")
        black = float(np.mean(raw.black_level_per_channel))
        planes = pack_rggb(normalise(np.array(raw.raw_image_visible), black, float(raw.white_level)), pattern)
    return planes, *exif_details(path)


def exif_details(path: Path):
    try:
        import exifread
        with open(path, "rb") as handle:
            tags = exifread.process_file(handle, details=False)
        iso = tags.get("EXIF ISOSpeedRatings") or tags.get("EXIF PhotographicSensitivity")
        model = str(tags.get("Image Model", "unknown")).strip()
        return model, int(str(iso).split(",")[0]) if iso is not None else None
    except Exception:  # missing tags are normal; the file is still usable
        return "unknown", None


def pick_crops(planes: np.ndarray, count: int, size: int, rng: np.random.Generator) -> list[np.ndarray]:
    _, h, w = planes.shape
    kept = []
    if h < size or w < size:
        return kept
    for _ in range(count * 12):
        if len(kept) >= count:
            break
        y, x = int(rng.integers(0, h - size + 1)), int(rng.integers(0, w - size + 1))
        crop = planes[:, y:y + size, x:x + size]
        if has_content(crop):
            kept.append(np.round(crop * 65535).astype(np.uint16))
    return kept


def summarise(records: list[dict]) -> dict:
    """Median measured noise for each camera and ISO, from every file that gave a usable estimate."""
    groups: dict[tuple[str, int | None], list[dict]] = defaultdict(list)
    for record in records:
        if record.get("noise"):
            groups[(record["camera"], record["iso"])].append(record["noise"])
    profile = {}
    for (camera, iso), values in sorted(groups.items(), key=lambda item: (item[0][0], item[0][1] or 0)):
        profile.setdefault(camera, {})[str(iso)] = {
            "files": len(values),
            "a": float(np.median([v["a"] for v in values])),
            "b": float(np.sqrt(np.median([v["b2"] for v in values]))),
        }
    return profile


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("folder", type=Path, help="folder holding RAW files (searched including sub-folders)")
    parser.add_argument("out", type=Path, help="folder for the small results")
    parser.add_argument("--crops", type=int, default=4, help="crops kept per file")
    parser.add_argument("--size", type=int, default=128, help="crop size in packed pixels")
    parser.add_argument("--limit", type=int, default=0, help="stop after this many files (0 = all)")
    parser.add_argument("--shard", type=int, default=200, help="files per crops-<n>.npz")
    parser.add_argument("--seed", type=int, default=1)
    args = parser.parse_args()

    files = sorted(p for p in args.folder.rglob("*") if p.suffix.lower() in RAW_EXTENSIONS)
    if args.limit:
        files = files[: args.limit]
    args.out.mkdir(parents=True, exist_ok=True)
    log_path = args.out / "files.jsonl"
    done = set()
    records: list[dict] = []
    if log_path.exists():
        for line in log_path.read_text(encoding="utf-8").splitlines():
            record = json.loads(line)
            records.append(record)
            done.add(record["file"])
    print(f"{len(files)} RAW files found, {len(done)} already done")

    rng = np.random.default_rng(args.seed)
    shard_index = len(list(args.out.glob("crops-*.npz")))
    pending_crops, pending_iso, pending_camera = [], [], []

    def flush():
        nonlocal shard_index, pending_crops, pending_iso, pending_camera
        if pending_crops:
            np.savez_compressed(args.out / f"crops-{shard_index:04d}.npz", crops=np.stack(pending_crops),
                                iso=np.array([i or 0 for i in pending_iso]), camera=np.array(pending_camera))
            shard_index += 1
            pending_crops, pending_iso, pending_camera = [], [], []

    used = skipped = 0
    with open(log_path, "a", encoding="utf-8") as log:
        for number, path in enumerate(files, 1):
            key = path.name + "|" + str(path.stat().st_size)  # a name and size, never a full path
            if key in done:
                continue
            record = {"file": key, "camera": "unknown", "iso": None, "used": False, "note": ""}
            try:
                planes, camera, iso = read_raw(path)
                record.update(camera=camera, iso=iso, noise=estimate_noise(planes.astype(np.float64)))
                crops = pick_crops(planes, args.crops, args.size, rng)
                for crop in crops:
                    pending_crops.append(crop)
                    pending_iso.append(iso)
                    pending_camera.append(camera)
                record.update(used=bool(crops), crops=len(crops))
                used += 1
            except Exception as problem:  # one bad or unsupported file must never stop a 10,000-file run
                record["note"] = f"{type(problem).__name__}: {str(problem)[:100]}"
                skipped += 1
            log.write(json.dumps(record) + "\n")
            log.flush()
            records.append(record)
            if len(pending_crops) >= args.shard * args.crops:
                flush()
            if number % 50 == 0:
                print(f"{number}/{len(files)}  used {used}  skipped {skipped}")
    flush()
    profile = summarise(records)
    (args.out / "noise_profile.json").write_text(json.dumps(profile, indent=2), encoding="utf-8")
    print(f"done: {used} files used, {skipped} skipped. Measured noise written for {len(profile)} camera(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
