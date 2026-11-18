#!/usr/bin/env python3
"""List your RAW photos, with camera, ISO and your own flags, from a Lightroom Classic catalogue and/or a folder.

    python tools/denoise-training/index_photos.py --lightroom "C:/Users/me/Pictures/Lightroom" ^
        --folder "C:/Users/me/Desktop/Photos" --out work/photos.csv

Writes:
  photos.csv          one row per RAW file that exists on disk: path, camera, ISO, pick, rating, Lightroom noise reduction
  lightroom-nr.json   how much luminance and colour noise reduction you applied in Lightroom at each ISO (a guide for
                      Kestrel's default slider strength; empty if no catalogue was given)

The catalogue is never opened in place. It is copied (with its -wal journal, if any) to a temporary folder and the copy
is read, so Lightroom can stay open and nothing in your catalogue can change. Files listed in the catalogue that are no
longer on disk are left out. Files in the folder that the catalogue does not know about get their ISO and camera from
the file's EXIF (needs the `exifread` package; Canon CR3 has no EXIF that exifread can read, so those keep ISO blank
unless the catalogue lists them).

Only the standard library is needed for the catalogue part.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import shutil
import sqlite3
import statistics
import sys
import tempfile
from pathlib import Path

RAW_EXTENSIONS = {".nef", ".nrw", ".cr2", ".cr3", ".crw", ".arw", ".srf", ".sr2", ".raf", ".rw2", ".orf", ".pef",
                  ".dng", ".srw", ".3fr", ".iiq", ".x3f", ".erf", ".mef", ".mos", ".kdc"}
FIELDS = ["path", "camera", "iso", "pick", "rating", "lr_luminance_nr", "lr_colour_nr", "source"]

CATALOGUE_QUERY = """
SELECT root.absolutePath || folder.pathFromRoot || file.baseName || '.' || file.extension AS path,
       camera.value AS camera,
       exif.isoSpeedRating AS iso,
       image.pick AS pick,
       image.rating AS rating,
       develop.text AS develop
FROM Adobe_images image
JOIN AgLibraryFile file ON file.id_local = image.rootFile
JOIN AgLibraryFolder folder ON folder.id_local = file.folder
JOIN AgLibraryRootFolder root ON root.id_local = folder.rootFolder
LEFT JOIN AgHarvestedExifMetadata exif ON exif.image = image.id_local
LEFT JOIN AgInternedExifCameraModel camera ON camera.id_local = exif.cameraModelRef
LEFT JOIN Adobe_imageDevelopSettings develop ON develop.image = image.id_local
WHERE image.masterImage IS NULL
"""


def find_catalogue(location: Path) -> Path:
    """A .lrcat file, or the newest one directly inside a folder (Lightroom's Backups folder is not searched)."""
    if location.is_file():
        return location
    found = sorted(location.glob("*.lrcat"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not found:
        raise FileNotFoundError(f"no .lrcat file in {location}")
    return found[0]


# One parser for Lightroom's develop-settings text, shared with tools/lightroom/read_lrcat.py, which has been checked
# against a real 25,000-photo catalogue (keys unindented, first key on the `s = {` line; mask and curve contents ignored).
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lightroom"))
from read_lrcat import parse_settings  # noqa: E402


def develop_value(text: str | None, name: str) -> int | None:
    """One top-level number, such as LuminanceSmoothing, from Lightroom's develop-settings text."""
    value = parse_settings(text or "").get(name)
    return round(value) if isinstance(value, float) else None


def read_catalogue(catalogue: Path) -> list[dict]:
    """Every RAW master photo in the catalogue (virtual copies are left out), read from a temporary copy."""
    with tempfile.TemporaryDirectory(prefix="kestrel-lrcat-") as scratch:
        copy = Path(scratch) / catalogue.name
        shutil.copy2(catalogue, copy)
        for journal in ("-wal", "-shm"):
            side = catalogue.with_name(catalogue.name + journal)
            if side.exists():
                shutil.copy2(side, copy.with_name(copy.name + journal))
        connection = sqlite3.connect(copy)
        try:
            connection.row_factory = sqlite3.Row
            try:
                rows = connection.execute(CATALOGUE_QUERY).fetchall()
            except sqlite3.OperationalError as problem:
                if "masterImage" not in str(problem):
                    raise
                # Older catalogues have no virtual-copy column; every row is then a master photo.
                rows = connection.execute(CATALOGUE_QUERY.replace("WHERE image.masterImage IS NULL", "")).fetchall()
        finally:
            connection.close()
    photos = []
    for row in rows:
        path = Path(row["path"])
        if path.suffix.lower() not in RAW_EXTENSIONS:
            continue
        photos.append({
            "path": str(path),
            "camera": row["camera"] or "",
            "iso": int(row["iso"]) if row["iso"] else None,
            "pick": int(row["pick"] or 0),
            "rating": int(row["rating"] or 0),
            "lr_luminance_nr": develop_value(row["develop"], "LuminanceSmoothing"),
            "lr_colour_nr": develop_value(row["develop"], "ColorNoiseReduction"),
            "source": "lightroom",
        })
    return photos


def exif_details(path: Path) -> tuple[str, int | None]:
    """Camera model and ISO from a RAW file's EXIF, or ("", None) when it cannot be read."""
    try:
        import exifread
    except ImportError:
        return "", None
    try:
        with open(path, "rb") as handle:
            tags = exifread.process_file(handle, details=False, stop_tag="EXIF ISOSpeedRatings")
    except Exception:  # exifread raises many kinds of error on formats it does not know
        return "", None
    camera = str(tags.get("Image Model", "")).strip()
    iso_tag = tags.get("EXIF ISOSpeedRatings") or tags.get("EXIF PhotographicSensitivity")
    try:
        iso = int(str(iso_tag).split(",")[0].strip("[] ")) if iso_tag else None
    except ValueError:
        iso = None
    return camera, iso


def scan_folder(folder: Path, known: set[str]) -> list[dict]:
    photos = []
    for path in sorted(folder.rglob("*")):
        if path.suffix.lower() not in RAW_EXTENSIONS or not path.is_file():
            continue
        if normalised_key(path) in known:
            continue
        camera, iso = exif_details(path)
        photos.append({"path": str(path), "camera": camera, "iso": iso, "pick": 0, "rating": 0,
                       "lr_luminance_nr": None, "lr_colour_nr": None, "source": "folder"})
    return photos


def normalised_key(path: str | Path) -> str:
    """Lightroom stores Windows paths with forward slashes; compare paths regardless of slash direction and case."""
    return str(path).replace("\\", "/").lower()


def nr_summary(photos: list[dict]) -> list[dict]:
    """Median Lightroom noise reduction you used per ISO stop, from photos that have develop settings."""
    bands: dict[int, list[dict]] = {}
    for photo in photos:
        if photo["iso"] and photo["lr_luminance_nr"] is not None:
            stop = 100 * 2 ** round(math.log2(photo["iso"] / 100))
            bands.setdefault(int(stop), []).append(photo)
    summary = []
    for stop in sorted(bands):
        group = bands[stop]
        colour = [p["lr_colour_nr"] for p in group if p["lr_colour_nr"] is not None]
        summary.append({"iso": stop, "photos": len(group),
                        "median_luminance_nr": statistics.median(p["lr_luminance_nr"] for p in group),
                        "median_colour_nr": statistics.median(colour) if colour else None})
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--lightroom", type=Path, help="a .lrcat file, or the folder that holds it")
    parser.add_argument("--folder", type=Path, action="append", default=[], help="a folder of RAW files (repeatable)")
    parser.add_argument("--out", type=Path, required=True, help="CSV to write")
    args = parser.parse_args()
    if not args.lightroom and not args.folder:
        parser.error("give --lightroom, --folder or both")

    photos: list[dict] = []
    if args.lightroom:
        catalogue = find_catalogue(args.lightroom)
        listed = read_catalogue(catalogue)
        present = [p for p in listed if Path(p["path"]).is_file()]
        print(f"{catalogue.name}: {len(listed)} RAW photos listed, {len(present)} found on disk")
        photos.extend(present)
    known = {normalised_key(p["path"]) for p in photos}
    for folder in args.folder:
        extra = scan_folder(folder, known)
        known.update(normalised_key(p["path"]) for p in extra)
        print(f"{folder}: {len(extra)} more RAW files not in the catalogue")
        photos.extend(extra)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        for photo in photos:
            writer.writerow({k: "" if photo[k] is None else photo[k] for k in FIELDS})
    summary = nr_summary(photos)
    (args.out.parent / "lightroom-nr.json").write_text(json.dumps(summary, indent=2))

    cameras: dict[str, int] = {}
    for photo in photos:
        cameras[photo["camera"] or "unknown camera"] = cameras.get(photo["camera"] or "unknown camera", 0) + 1
    print(f"{len(photos)} RAW files written to {args.out}")
    for camera, count in sorted(cameras.items(), key=lambda kv: -kv[1]):
        print(f"  {count:6d}  {camera}")
    no_iso = sum(1 for p in photos if not p["iso"])
    if no_iso:
        print(f"  {no_iso} files have no ISO; they are used only if you allow unknown ISO")
    return 0


if __name__ == "__main__":
    sys.exit(main())
