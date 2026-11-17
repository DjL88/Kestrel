#!/usr/bin/env python3
"""Read what you did to your photos in a Lightroom Classic catalog (.lrcat), without changing the catalog.

A catalog is an SQLite database holding, for every photo, the develop settings you chose. This tool opens it strictly
read-only and writes a small JSON-lines file of those settings, plus a summary. It never writes to the catalog, never
reads or copies your photos or previews, and sends nothing anywhere. Python's standard library is all it needs.

    python read_lrcat.py "C:\\Users\\you\\Pictures\\Lightroom\\Lightroom Catalog.lrcat" recipes.jsonl
    python read_lrcat.py "<catalog>" recipes.jsonl --no-paths      # file names are replaced by short hashes
    python read_lrcat.py "<catalog>" --schema                      # list tables and columns, to check a layout

Work on a COPY of the catalog if Lightroom is open, so nothing is mid-write. Output, per photo: camera, ISO, rating, the
develop settings (exposure, tone, white balance, noise reduction, sharpening, crop) and whether local masks exist.

The table layout used here is from how Lightroom Classic catalogs are generally organised and has NOT been checked
against a real catalog on the machine this was written on. If a table or column differs, the tool says exactly which one
and carries on with what it can read; run --schema and send that listing to adapt it.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path
from statistics import median

# Develop settings worth keeping. Other keys are ignored, so the output stays small and readable.
KEEP = {
    "ProcessVersion", "Exposure2012", "Contrast2012", "Highlights2012", "Shadows2012", "Whites2012", "Blacks2012",
    "Texture", "Clarity2012", "Dehaze", "Vibrance", "Saturation", "Temperature", "Tint", "WhiteBalance",
    "Sharpness", "SharpenRadius", "SharpenDetail", "SharpenEdgeMasking",
    "LuminanceSmoothing", "LuminanceNoiseReductionDetail", "LuminanceNoiseReductionContrast",
    "ColorNoiseReduction", "ColorNoiseReductionDetail", "ColorNoiseReductionSmoothness",
    "CropTop", "CropLeft", "CropBottom", "CropRight", "CropAngle", "HasCrop",
    "Vignette", "PostCropVignetteAmount", "GrainAmount", "ConvertToGrayscale", "AutoLateralCA", "LensProfileEnable",
}
SCALAR = re.compile(r'([A-Za-z0-9_]+)\s*=\s*(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|"[^"]*"|true|false)\s*(?:,|$)')


def top_level_text(text: str) -> str:
    """Only the characters directly inside the outer `s = { ... }`, so settings inside masks or curves never leak.
    Real catalogs write keys with no indentation (and the first key on the `s = {` line), so depth is tracked by braces,
    ignoring braces inside quoted strings."""
    kept, depth, quoted = [], 0, False
    for char in text:
        if char == '"':
            quoted = not quoted
        elif not quoted and char == "{":
            depth += 1
            if depth > 1:
                kept.append(" ")
            continue
        elif not quoted and char == "}":
            depth -= 1
            continue
        if depth == 1:
            kept.append(char)
    return "".join(kept)


def parse_settings(text: str) -> dict:
    """Pick the wanted top-level numbers, strings and flags out of Lightroom's develop-settings text."""
    found: dict = {}
    for key, raw in SCALAR.findall(top_level_text(text or "")):
        if key not in KEEP:
            continue
        found[key] = True if raw == "true" else False if raw == "false" else raw.strip('"') if raw.startswith('"') else float(raw)
    found["has_masks"] = "MaskGroupBasedCorrections" in (text or "")
    found["has_local_adjustments"] = "RetouchInfo" in (text or "") or found["has_masks"]
    return found


def open_read_only(path: Path) -> sqlite3.Connection:
    """Open the catalog so that writing is impossible, even by mistake."""
    uri = path.resolve().as_uri() + "?mode=ro&immutable=1"
    return sqlite3.connect(uri, uri=True)


def tables(connection: sqlite3.Connection) -> dict[str, list[str]]:
    result = {}
    for (name,) in connection.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
        result[name] = [row[1] for row in connection.execute(f'PRAGMA table_info("{name}")')]
    return result


def read_photos(connection: sqlite3.Connection, hide_paths: bool):
    """Yield one dict per photo. Missing tables or columns are reported once, and the rest still comes through."""
    layout = tables(connection)
    problems = []
    needed = {
        "Adobe_images": {"id_local", "rootFile", "rating", "captureTime"},
        "AgLibraryFile": {"id_local", "folder", "baseName", "extension"},
        "AgLibraryFolder": {"id_local", "rootFolder", "pathFromRoot"},
        "AgLibraryRootFolder": {"id_local", "absolutePath"},
        "Adobe_imageDevelopSettings": {"image", "text"},
    }
    for table, columns in needed.items():
        if table not in layout:
            problems.append(f"missing table {table}")
        elif not columns <= set(layout[table]):
            problems.append(f"table {table} lacks columns {sorted(columns - set(layout[table]))}")
    if problems:
        raise LookupError("; ".join(problems))

    camera_sql, iso_sql = "NULL", "NULL"
    join = ""
    exif = layout.get("AgHarvestedExifMetadata", [])
    if "image" in exif and "isoSpeedRating" in exif:
        iso_sql = "e.isoSpeedRating"
        join = "LEFT JOIN AgHarvestedExifMetadata e ON e.image = i.id_local"
        if "cameraModelRef" in exif and "AgInternedExifCameraModel" in layout:
            camera_sql = "m.value"
            join += " LEFT JOIN AgInternedExifCameraModel m ON m.id_local = e.cameraModelRef"
    rows = connection.execute(f"""
        SELECT i.id_local, r.absolutePath, d.pathFromRoot, f.baseName, f.extension, i.rating, i.captureTime,
               {camera_sql}, {iso_sql}, s.text
        FROM Adobe_images i
        JOIN AgLibraryFile f ON f.id_local = i.rootFile
        JOIN AgLibraryFolder d ON d.id_local = f.folder
        JOIN AgLibraryRootFolder r ON r.id_local = d.rootFolder
        LEFT JOIN Adobe_imageDevelopSettings s ON s.image = i.id_local
        {join}
    """)
    for image_id, root, folder, base, extension, rating, captured, camera, iso, text in rows:
        full = f"{root or ''}{folder or ''}{base}.{extension}"
        yield {
            "id": image_id,
            "file": hashlib.sha1(full.encode("utf-8")).hexdigest()[:12] if hide_paths else full,
            "extension": (extension or "").lower(),
            "camera": camera, "iso": iso, "rating": rating, "captured": captured,
            "develop": parse_settings(text or ""),
            "edited": bool(text and "Exposure2012" in text or text and "MaskGroupBasedCorrections" in text),
        }


def summarise(photos: list[dict]) -> dict:
    """What was chosen overall, and how much noise reduction at each ISO band: the useful part for Kestrel's defaults."""
    bands: dict[str, list[dict]] = defaultdict(list)
    for photo in photos:
        iso = photo["iso"]
        band = "unknown" if not iso else "<=400" if iso <= 400 else "401-1600" if iso <= 1600 else "1601-6400" if iso <= 6400 else ">6400"
        bands[band].append(photo["develop"])
    pick = lambda items, key: [d[key] for d in items if isinstance(d.get(key), float)]
    return {
        "photos": len(photos),
        "with_edits": sum(1 for p in photos if p["edited"]),
        "with_local_masks": sum(1 for p in photos if p["develop"].get("has_masks")),
        "by_iso_band": {
            band: {
                "photos": len(items),
                "median_luminance_noise_reduction": median(pick(items, "LuminanceSmoothing")) if pick(items, "LuminanceSmoothing") else None,
                "median_colour_noise_reduction": median(pick(items, "ColorNoiseReduction")) if pick(items, "ColorNoiseReduction") else None,
                "median_exposure": median(pick(items, "Exposure2012")) if pick(items, "Exposure2012") else None,
                "median_sharpening": median(pick(items, "Sharpness")) if pick(items, "Sharpness") else None,
            }
            for band, items in sorted(bands.items())
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("catalog", type=Path)
    parser.add_argument("out", type=Path, nargs="?", help="JSON-lines file to write")
    parser.add_argument("--no-paths", action="store_true", help="replace file paths with short hashes")
    parser.add_argument("--schema", action="store_true", help="list tables and columns, then stop")
    args = parser.parse_args()
    if not args.catalog.is_file():
        print(f"no such file: {args.catalog}")
        return 2
    connection = open_read_only(args.catalog)
    try:
        if args.schema:
            for name, columns in tables(connection).items():
                print(f"{name}: {', '.join(columns)}")
            return 0
        if args.out is None:
            parser.error("give an output file, or use --schema")
        try:
            photos = list(read_photos(connection, args.no_paths))
        except LookupError as problem:
            print(f"This catalog is laid out differently from what this tool expects: {problem}\nRun with --schema and share that listing.")
            return 1
    finally:
        connection.close()
    with open(args.out, "w", encoding="utf-8") as handle:
        for photo in photos:
            handle.write(json.dumps(photo) + "\n")
    summary = summarise(photos)
    args.out.with_suffix(".summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
