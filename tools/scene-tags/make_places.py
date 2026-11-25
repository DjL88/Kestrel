#!/usr/bin/env python3
"""Build the offline place-name table the app uses to name where a photo was taken, from GeoNames (CC BY 4.0).

    python -I tools/scene-tags/make_places.py <empty download folder>

Downloads cities1000.zip (every populated place with at least 1,000 people, or a seat of government) and
admin1CodesASCII.txt from https://download.geonames.org/export/dump/ into the folder you name, and writes
public/places/geonames-cities1000.bin. GeoNames data is licensed CC BY 4.0: credited in NOTICE.md and in the app.

Format (little-endian): b'KGN1', u32 count, u32 regions, then count × i32 latitude×1e5, count × i32 longitude×1e5,
count × u32 GeoNames id, count × u16 region index, then a UTF-8 block of region lines ("GB\\tWales") and a UTF-8 block
of place names, each block preceded by its u32 byte length and with one entry per line.
"""
from __future__ import annotations

import io
import struct
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
BASE = "https://download.geonames.org/export/dump/"
AGENT = "InFlight-places-build/1.0"


def fetch(folder: Path, name: str) -> bytes:
    path = folder / name
    if not path.exists():
        request = urllib.request.Request(BASE + name, headers={"User-Agent": AGENT})
        with urllib.request.urlopen(request, timeout=120) as response:
            path.write_bytes(response.read())
    return path.read_bytes()


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    folder = Path(sys.argv[1])
    folder.mkdir(parents=True, exist_ok=True)
    admin = {}
    for line in fetch(folder, "admin1CodesASCII.txt").decode("utf-8").splitlines():
        parts = line.split("\t")
        if len(parts) >= 2:
            admin[parts[0]] = parts[1]
    with zipfile.ZipFile(io.BytesIO(fetch(folder, "cities1000.zip"))) as archive:
        text = archive.read("cities1000.txt").decode("utf-8")
    regions: dict[tuple[str, str], int] = {}
    rows = []
    for line in text.splitlines():
        f = line.split("\t")
        if len(f) < 11:
            continue
        geonameid, name, lat, lon, country, admin1 = int(f[0]), f[1].strip(), float(f[4]), float(f[5]), f[8], f[10]
        if not name or "\n" in name or len(country) != 2:
            continue
        region_name = admin.get(f"{country}.{admin1}", "")
        key = (country, region_name)
        if key not in regions:
            regions[key] = len(regions)
        rows.append((round(lat * 1e5), round(lon * 1e5), geonameid, regions[key], name))
    if len(regions) > 65535:
        raise SystemExit("too many regions for u16")
    rows.sort(key=lambda row: (row[0], row[1]))
    out = io.BytesIO()
    out.write(b"KGN1")
    out.write(struct.pack("<II", len(rows), len(regions)))
    for column, fmt in ((0, "i"), (1, "i"), (2, "I"), (3, "H")):
        out.write(struct.pack(f"<{len(rows)}{fmt}", *(row[column] for row in rows)))
    region_lines = [""] * len(regions)
    for (country, region_name), index in regions.items():
        region_lines[index] = f"{country}\t{region_name}"
    for block in ("\n".join(region_lines), "\n".join(row[4] for row in rows)):
        data = block.encode("utf-8")
        out.write(struct.pack("<I", len(data)))
        out.write(data)
    target = ROOT / "public/places/geonames-cities1000.bin"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(out.getvalue())
    print(f"{len(rows)} places, {len(regions)} regions -> {target.relative_to(ROOT)} ({target.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
