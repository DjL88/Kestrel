#!/usr/bin/env python3
"""Pick the frozen held-out set of owner previews for the mask measuring stick.

    cd scripts && python3 -m maskstick.select_heldout --out ~/code/kestrel-test-photos/maskstick [--n 40]

Reads the owner-pairs index (previews, pairs.json, index.jsonl: all outside Git) and writes heldout.json,
heldout-keys.txt and a README there. Selection uses only metadata and measured numbers (lens, aperture, a focus
statistic computed from the pixels); nobody has to look at the photos. The photos stay where they are and are never
copied, uploaded or committed.

Mix: roughly two thirds frames where the cues for a no-model matte may work (the focus statistic says a clearly
defocused background), one third where they probably do not (sharp or busy backgrounds), so the failures are
measured rather than hidden. Never more than 3 frames per trip folder, never two within two minutes (bursts of one
scene would count as one test several times).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import time
from collections import defaultdict
from datetime import datetime

import numpy as np
from PIL import Image

from .matte.focus import focus_map, otsu

MIN_GAP_SECONDS = 120
MAX_PER_TRIP = 3


def lens_group(lens: str | None) -> str:
    text = (lens or "").lower()
    if "100-400" in text:
        return "tele"
    if "105" in text and "macro" in text or "mc 105" in text:
        return "macro"
    if "24-120" in text:
        return "zoom"
    return "other"


def focus_stats(path: str) -> dict:
    """Numbers only: how much of the frame is blurred, and how cleanly sharp and blurred separate."""
    with Image.open(path) as im:
        im = im.convert("RGB")
        im.thumbnail((1024, 1024), Image.LANCZOS)
        rgb = np.asarray(im)
    fm = focus_map(rgb)
    cut, separability = otsu(fm.score.ravel())
    blurred = float((fm.score <= cut).mean())
    return {"blurred_share": round(blurred, 3), "separability": round(separability, 3), "width": rgb.shape[1], "height": rgb.shape[0]}


def parse_time(value: str | None) -> float | None:
    try:
        return datetime.strptime(value or "", "%Y:%m:%d %H:%M:%S").timestamp()
    except ValueError:
        return None


def stable_order(key: str, salt: str = "maskstick-heldout-v1") -> str:
    return hashlib.sha256((salt + key).encode()).hexdigest()


def choose(candidates: list[dict], n: int, defocused_share: float = 2 / 3) -> list[dict]:
    """Round-robin over (likelihood, lens group) strata, honouring the trip and burst limits. Deterministic."""
    strata: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for c in candidates:
        strata[("easy" if c["likely_defocused"] else "hard", c["lens_group"])].append(c)
    for rows in strata.values():
        rows.sort(key=lambda c: stable_order(c["key"]))
    quota = {"easy": round(n * defocused_share), "hard": n - round(n * defocused_share)}
    chosen: list[dict] = []
    per_trip: dict[str, int] = defaultdict(int)
    times: list[float] = []
    taken = {"easy": 0, "hard": 0}

    def ok(c: dict) -> bool:
        if per_trip[c["trip"]] >= MAX_PER_TRIP:
            return False
        return not (c["time"] is not None and any(abs(c["time"] - t) < MIN_GAP_SECONDS for t in times))

    progress = True
    while len(chosen) < n and progress:
        progress = False
        for likelihood in ("easy", "hard"):
            for group in sorted({g for (l, g) in strata if l == likelihood}):
                if taken[likelihood] >= quota[likelihood] or len(chosen) >= n:
                    continue
                rows = strata[(likelihood, group)]
                while rows:
                    c = rows.pop(0)
                    if ok(c):
                        chosen.append(c)
                        per_trip[c["trip"]] += 1
                        taken[likelihood] += 1
                        if c["time"] is not None:
                            times.append(c["time"])
                        progress = True
                        break
    return chosen


def interleave(chosen: list[dict]) -> list[dict]:
    """Order for the fixer queue: alternate easy and hard so the first 30 are already a balanced sample."""
    easy = [c for c in chosen if c["likely_defocused"]]
    hard = [c for c in chosen if not c["likely_defocused"]]
    out: list[dict] = []
    while easy or hard:
        for _ in range(2):
            if easy:
                out.append(easy.pop(0))
        if hard:
            out.append(hard.pop(0))
    return out


def main(argv: list[str] | None = None) -> int:
    home = os.path.expanduser("~/code/kestrel-test-photos")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pairs-dir", default=os.path.join(home, "owner-pairs"))
    ap.add_argument("--out", default=os.path.join(home, "maskstick"))
    ap.add_argument("--n", type=int, default=40)
    ap.add_argument("--suffix", default="_raw")
    a = ap.parse_args(argv)

    previews = os.path.join(a.pairs_dir, "previews")
    with open(os.path.join(a.pairs_dir, "pairs.json")) as f:
        pairs = {p["raw_hash"] + "_" + p["img_hash"]: p for p in json.load(f) if p.get("status") == "confident"}
    when: dict[str, float | None] = {}
    with open(os.path.join(a.pairs_dir, "index.jsonl")) as f:
        for line in f:
            row = json.loads(line)
            if row.get("kind") == "raw" and row.get("hash"):
                when[row["hash"]] = parse_time(row.get("DateTimeOriginal"))
    candidates = []
    started = time.time()
    for name in sorted(os.listdir(previews)):
        if not name.endswith(a.suffix + ".jpg"):
            continue
        key = name[: -len(a.suffix + ".jpg")]
        pair = pairs.get(key)
        if pair is None:
            continue
        stats = focus_stats(os.path.join(previews, name))
        trip = os.path.basename(os.path.dirname(pair["raw"]))
        candidates.append({
            "key": key, "raw_hash": pair["raw_hash"], "trip": trip, "time": when.get(pair["raw_hash"]),
            "lens": (pair.get("lens") or "").strip(), "lens_group": lens_group(pair.get("lens")), "focal": pair.get("focal"),
            "iso": pair.get("iso"), "f": pair.get("f"), "model": pair.get("model"), **stats,
            "likely_defocused": stats["blurred_share"] >= 0.45 and stats["separability"] >= 0.55,
        })
    chosen = interleave(choose(candidates, a.n))
    os.makedirs(a.out, exist_ok=True)
    keys = [c["key"] for c in chosen]
    digest = hashlib.sha256("\n".join(sorted(keys)).encode()).hexdigest()
    manifest = {
        "version": 1, "frozen": True, "keys_sha256": digest, "created": datetime.now().strftime("%Y-%m-%d"),
        "note": "Held-out for the mask measuring stick. Never train on, tune against, or fine-tune from these photos or their masks.",
        "previews": previews, "suffix": a.suffix, "candidates_considered": len(candidates),
        "photos": [{k: v for k, v in c.items() if k != "time"} for c in chosen],
    }
    with open(os.path.join(a.out, "heldout.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    with open(os.path.join(a.out, "heldout-keys.txt"), "w") as f:
        f.write("\n".join(keys) + "\n")
    easy = sum(c["likely_defocused"] for c in chosen)
    readme = (
        f"# Mask measuring stick: held-out set\n\n{len(chosen)} previews chosen from {len(candidates)} owner-pairs previews on "
        f"{manifest['created']} ({easy} where the focus statistic suggests a defocused background, {len(chosen) - easy} where it does not).\n"
        "Frozen: do not add, swap or train on these. Keys are `<raw hash>_<jpeg hash>`; the preview is `<key>_raw.jpg` in the owner-pairs previews folder.\n"
        f"keys sha256: `{digest}`\n\nFix masks with `python3 -m maskstick.fixer` (see scripts/maskstick/README.md).\n")
    with open(os.path.join(a.out, "README.md"), "w") as f:
        f.write(readme)
    print(f"{len(chosen)} photos ({easy} easy-looking, {len(chosen) - easy} hard-looking) from {len(candidates)} candidates in {time.time() - started:.0f}s -> {a.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
