"""No-model soft-edge matte for shallow depth-of-field subjects: focus map, trimap, closed-form matting.

    cd scripts && python3 -m maskstick.matte.pipeline --previews DIR --keys keys.txt --out DIR [--af afpoints.json] [--zones]

Writes <key>.png (8-bit alpha) for every photo it accepts and a refusals.json listing the ones it declined (frames where
the cues do not separate subject from background). Nothing is read except the preview JPEGs; nothing leaves the machine.
"""
from __future__ import annotations

import argparse
import json
import os
import time
from dataclasses import dataclass

import numpy as np
from PIL import Image

from .levin import solve_alpha
from .trimap import Trimap, build_trimap

#: Below this the cues did not separate subject from background and the matte is withheld ("unknown stays unknown").
MIN_CONFIDENCE = 0.12
WORKING_EDGE = 1024


@dataclass
class MatteResult:
    alpha: np.ndarray | None  # float32 H x W, or None when refused
    trimap: Trimap
    reason: str
    seconds: float
    unknown_pixels: int


def to_float(rgb: np.ndarray) -> np.ndarray:
    return np.asarray(rgb, np.float32) / 255.0 if rgb.dtype == np.uint8 else np.asarray(rgb, np.float32)


def matte(rgb: np.ndarray, *, min_confidence: float = MIN_CONFIDENCE, eps: float = 1e-5, lam: float = 1.0, smooth: float = 0.8,
          use_zones: bool = False, **trimap_options) -> MatteResult:
    """Soft alpha for the in-focus subject of `rgb` (uint8 or float, H x W x 3), or a refusal with the reason."""
    started = time.perf_counter()
    img = to_float(rgb)
    if use_zones and "zones" not in trimap_options:
        from .regions import tonal_colour_zones
        trimap_options["zones"] = tonal_colour_zones(img)[0]
    tri = build_trimap(img, **trimap_options)
    if tri.reason != "ok" or tri.confidence < min_confidence:
        reason = tri.reason if tri.reason != "ok" else "cues-do-not-separate"
        return MatteResult(None, tri, reason, time.perf_counter() - started, 0)
    evidence = tri.evidence if tri.evidence is not None else np.zeros(img.shape[:2], np.float32)
    prior = 1.0 / (1.0 + np.exp(-np.clip(evidence, -30, 30)))
    weight = np.clip(np.abs(evidence) / 3.0, 0.0, 1.0)
    alpha = solve_alpha(img, tri.foreground, tri.background, eps=eps, prior=prior, prior_weight=weight, lam=lam, smooth=smooth)
    return MatteResult(alpha, tri, "ok", time.perf_counter() - started, int(tri.unknown.sum()))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--previews", required=True, help="folder holding <key><suffix>.jpg previews")
    ap.add_argument("--suffix", default="_raw")
    ap.add_argument("--keys", required=True, help="text file, one key per line (or a heldout.json manifest)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--af", help="afpoints.json: pick the sharp piece the camera focused on (where a usable AF box exists)")
    ap.add_argument("--zones", action="store_true", help="narrow the uncertain band with tonal-and-colour zones")
    a = ap.parse_args(argv)
    af_all = {}
    if a.af:
        with open(a.af) as f:
            af_all = json.load(f)
    text = open(a.keys).read()
    keys = [e["key"] for e in json.loads(text)["photos"]] if a.keys.endswith(".json") else text.split()
    os.makedirs(a.out, exist_ok=True)
    refused = {}
    for key in keys:
        with Image.open(os.path.join(a.previews, key + a.suffix + ".jpg")) as im:
            im = im.convert("RGB")
            im.thumbnail((WORKING_EDGE, WORKING_EDGE), Image.LANCZOS)
            rgb = np.asarray(im)
        box = None
        if key in af_all:
            from .. import afpoints
            area, _why = afpoints.area_for_preview(af_all[key], rgb.shape[1], rgb.shape[0])
            box = afpoints.box_pixels(area, rgb.shape[1], rgb.shape[0]) if area else None
        result = matte(rgb, af_box=box, use_zones=a.zones)
        if result.alpha is None:
            refused[key] = result.reason
            print(f"{key[:10]} refused: {result.reason}")
            continue
        Image.fromarray((result.alpha * 255 + 0.5).astype(np.uint8)).save(os.path.join(a.out, key + ".png"))
        print(f"{key[:10]} ok {result.seconds:.1f}s unknown={result.unknown_pixels}" + (f" af={result.trimap.stats.get('af')}" if box else ""))
    json.dump(refused, open(os.path.join(a.out, "refusals.json"), "w"), indent=1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
