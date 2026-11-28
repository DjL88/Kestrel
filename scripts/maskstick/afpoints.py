#!/usr/bin/env python3
"""Where the camera says it focused, as a cue for the subject mask.

    cd scripts && python3 -m maskstick.afpoints --manifest heldout.json --raws raws.tsv --out afpoints.json

`raws.tsv` is one `<key><TAB><path to the RAW>` per line (the owner-pairs index knows them). Only metadata is read, through
`exiftool` (read-only, nothing is opened for writing, no pixels are decoded). What Nikon Z bodies write: the AF area's centre
and size on the sensor (`AFArea*Position/Width/Height` with `AFImageWidth/Height`), the AF area mode, the focus mode, the
focus result ("In Focus" / "Out of Focus") and the subject-detection mode the camera was set to ("Birds", "Animals"...).
There are NO eye coordinates in the maker note: the camera does not say where the eye is, only where the AF area sat.
That is the same record the app reads in `src/core/cameraFocus.ts`; the orientation logic below mirrors `orientFocusArea`.

An AF box is a cue, not the subject: it is unusable when the camera was in manual focus, reported "Out of Focus" or wrote no
coordinates, and even a good AF box can sit on a perch in front of the bird. `usable_reason` says which, so the cue is
never silently trusted. Output is numbers only and stays outside Git.
"""
from __future__ import annotations

import argparse
import json
import subprocess

import numpy as np

TAGS = ["AFAreaMode", "AFCoordinatesAvailable", "AFImageWidth", "AFImageHeight", "AFAreaXPosition", "AFAreaYPosition",
        "AFAreaWidth", "AFAreaHeight", "FocusMode", "FocusResult", "SubjectDetection", "AFDetectionMethod", "Orientation", "Model"]

ORIENTATION_WORDS = {
    "horizontal (normal)": 1, "mirror horizontal": 2, "rotate 180": 3, "mirror vertical": 4,
    "mirror horizontal and rotate 270 cw": 5, "rotate 90 cw": 6, "mirror horizontal and rotate 90 cw": 7, "rotate 270 cw": 8,
}


def orientation_code(value) -> int | None:
    if value is None:
        return 1
    if isinstance(value, int) and 1 <= value <= 8:
        return value
    return ORIENTATION_WORDS.get(str(value).strip().lower())


def orient_area(area: dict, orientation: int) -> dict:
    """A box measured on the sensor (fractions of the frame) turned to the picture as shown (EXIF Orientation 1 to 8)."""
    x, y, w, h = area["x"], area["y"], area["width"], area["height"]
    boxes = {2: (1 - x - w, y, w, h), 3: (1 - x - w, 1 - y - h, w, h), 4: (x, 1 - y - h, w, h), 5: (y, x, h, w),
             6: (1 - y - h, x, h, w), 7: (1 - y - h, 1 - x - w, h, w), 8: (y, 1 - x - w, h, w)}
    bx, by, bw, bh = boxes.get(orientation, (x, y, w, h))
    return {"x": bx, "y": by, "width": bw, "height": bh}


def parse(row: dict) -> dict:
    """One exiftool JSON row to the small record this tool keeps. Never guesses: anything missing gives usable=False."""
    out = {"model": row.get("Model"), "area_mode": row.get("AFAreaMode"), "focus_mode": row.get("FocusMode"),
           "focus_result": row.get("FocusResult"), "subject_detection": row.get("SubjectDetection"),
           "detection_method": row.get("AFDetectionMethod")}
    reason = None
    w, h = row.get("AFImageWidth"), row.get("AFImageHeight")
    cx, cy, aw, ah = (row.get(k) for k in ("AFAreaXPosition", "AFAreaYPosition", "AFAreaWidth", "AFAreaHeight"))
    orientation = orientation_code(row.get("Orientation"))
    if str(row.get("AFCoordinatesAvailable", "")).lower() not in ("yes", "1", "true"):
        reason = "no-coordinates"
    elif not all(isinstance(v, (int, float)) and v > 0 for v in (w, h, cx, cy, aw, ah)):
        reason = "bad-coordinates"
    elif cx > w or cy > h:
        reason = "outside-frame"
    elif orientation is None:
        reason = "unreadable-orientation"
    elif str(row.get("FocusMode", "")).lower().startswith("manual"):
        reason = "manual-focus"
    elif "out of focus" in str(row.get("FocusResult", "")).lower():
        reason = "camera-says-out-of-focus"
    if isinstance(w, (int, float)) and isinstance(h, (int, float)) and w > 0 and h > 0 and all(isinstance(v, (int, float)) for v in (cx, cy, aw, ah)):
        clamp = lambda v: min(1.0, max(0.0, v))  # noqa: E731
        x0, y0, x1, y1 = clamp((cx - aw / 2) / w), clamp((cy - ah / 2) / h), clamp((cx + aw / 2) / w), clamp((cy + ah / 2) / h)
        sensor = {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0}
        out["area"] = orient_area(sensor, orientation or 1)
        out["orientation"] = orientation
    out["usable"] = reason is None and "area" in out
    out["usable_reason"] = reason or ("ok" if "area" in out else "no-area")
    return out


def read_exif(paths: list[str]) -> list[dict]:
    """exiftool -json on each file, read-only. One call per batch keeps it quick."""
    cmd = ["exiftool", "-json", "-G0:0", "-api", "largefilesupport=1"] + [f"-{t}" for t in TAGS] + ["--"] + paths
    run = subprocess.run(cmd, capture_output=True, stdin=subprocess.DEVNULL, timeout=600, check=False)
    rows = json.loads(run.stdout or b"[]")
    by_file = {row.get("SourceFile"): {k.split(":")[-1]: v for k, v in row.items()} for row in rows}
    return [by_file.get(p, {}) for p in paths]  # a file exiftool could not read gives {} and so "unusable", never a shifted row


def area_for_preview(record: dict, width: int, height: int) -> tuple[dict | None, str]:
    """The AF box on a preview of this size, or (None, reason). A preview whose shape disagrees with the file's EXIF Orientation
    (a portrait RAW whose preview was stored sideways) is refused: the box would land on the wrong part of the picture."""
    if not record.get("usable"):
        return None, record.get("usable_reason", "unusable")
    if (height > width) != (record.get("orientation") in (5, 6, 7, 8)):
        return None, "preview-orientation-mismatch"
    return record["area"], "ok"


def box_pixels(area: dict, width: int, height: int) -> tuple[float, float, float, float]:
    return area["x"] * width, area["y"] * height, area["width"] * width, area["height"] * height


def box_stats(area: dict, mask: np.ndarray) -> dict:
    """How an AF box sits on a boolean mask of the picture: is its centre inside, and what share of the box is inside."""
    h, w = mask.shape
    x, y, bw, bh = box_pixels(area, w, h)
    cx, cy = int(min(w - 1, max(0, round(x + bw / 2)))), int(min(h - 1, max(0, round(y + bh / 2))))
    x0, x1, y0, y1 = int(max(0, np.floor(x))), int(min(w, np.ceil(x + bw))), int(max(0, np.floor(y))), int(min(h, np.ceil(y + bh)))
    patch = mask[y0:y1, x0:x1]
    return {"centre_inside": bool(mask[cy, cx]), "share_inside": float(patch.mean()) if patch.size else 0.0}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raws", required=True, help="TSV: key<TAB>path of the RAW")
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    keys, paths = [], []
    with open(a.raws) as f:
        for line in f:
            key, _, path = line.rstrip("\n").partition("\t")
            if key and path:
                keys.append(key)
                paths.append(path)
    result = {}
    for start in range(0, len(paths), 20):
        for key, row in zip(keys[start:start + 20], read_exif(paths[start:start + 20])):
            result[key] = parse(row)
    with open(a.out, "w") as f:
        json.dump(result, f, indent=1)
    usable = sum(r["usable"] for r in result.values())
    print(f"{usable} of {len(result)} usable AF areas -> {a.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
