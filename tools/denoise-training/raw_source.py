"""Read a RAW file into four normalised Bayer planes (R, G1, G2, B), for any 2 x 2 Bayer camera.

Two readers:
  * rawpy (LibRaw), installed with `pip install rawpy`. It has ready-built wheels for Windows, macOS and Linux, so no
    Rust or C compiler is needed. This is the default.
  * Kestrel's own decoder through `raw_dump` (src-tauri/examples/raw_dump.rs), for cameras where you want exactly
    what the app sees. Pass the path of the built raw_dump(.exe).

Neither reads Nikon High Efficiency (TicoRAW) NEFs; those files are reported and skipped. So are Fujifilm X-Trans
and files that are already demosaiced (linear DNGs): they need their own packing.

`black_level_unclipped` keeps values below the black level negative instead of clipping them at zero, which the noise
calibration needs (clipping hides half of the read noise in the shadows).
"""
from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np

from make_pairs import OFFSETS, pack_rggb


class UnsupportedRaw(ValueError):
    """The file is readable but not a 2 x 2 Bayer mosaic, or the reader does not support it."""


def pattern_name(raw_pattern: np.ndarray, color_desc: bytes) -> str:
    """LibRaw's 2 x 2 index pattern and colour list (such as b'RGBG') to a name such as 'RGGB'."""
    if raw_pattern.shape != (2, 2):
        raise UnsupportedRaw(f"colour filter is {raw_pattern.shape[0]} x {raw_pattern.shape[1]}, not 2 x 2 Bayer")
    letters = color_desc.decode("ascii") if isinstance(color_desc, bytes) else str(color_desc)
    name = "".join(letters[int(i)] for i in raw_pattern.flatten())
    if name not in OFFSETS:
        raise UnsupportedRaw(f"colour filter pattern {name!r} is not a plain Bayer layout")
    return name


def normalise_per_site(mosaic: np.ndarray, black: np.ndarray, white: float, clip: bool) -> np.ndarray:
    """Subtract a 2 x 2 black-level tile (one value per filter site) and scale so white is 1."""
    tiled = np.tile(black, (mosaic.shape[0] // 2 + 1, mosaic.shape[1] // 2 + 1))[: mosaic.shape[0], : mosaic.shape[1]]
    scale = float(white) - float(black.max())
    if scale <= 0:
        raise UnsupportedRaw("white level is not above the black level")
    out = (mosaic.astype(np.float32) - tiled) / scale
    return np.clip(out, 0.0, 1.0) if clip else np.minimum(out, 1.0)


def read_with_rawpy(path: Path, clip: bool = True) -> np.ndarray:
    import rawpy

    try:
        raw = rawpy.imread(str(path))
    except Exception as problem:  # LibRaw raises its own error types for unsupported files
        raise UnsupportedRaw(f"LibRaw cannot read it ({type(problem).__name__})") from problem
    with raw:
        if raw.num_colors < 3 or raw.raw_image_visible.ndim != 2:
            raise UnsupportedRaw("already demosaiced (linear DNG or similar)")
        name = pattern_name(np.asarray(raw.raw_pattern), raw.color_desc)
        black = np.array(raw.black_level_per_channel, dtype=np.float32)[np.asarray(raw.raw_pattern)]
        mosaic = np.array(raw.raw_image_visible, copy=True)
        white = float(raw.white_level)
    return pack_rggb(normalise_per_site(mosaic, black, white, clip), name)


def read_with_raw_dump(path: Path, raw_dump: Path, clip: bool = True) -> np.ndarray:
    with tempfile.TemporaryDirectory(prefix="kestrel-dump-") as scratch:
        result = subprocess.run([str(raw_dump), str(path), scratch], capture_output=True, text=True)
        if result.returncode != 0:
            raise UnsupportedRaw(f"raw_dump failed: {result.stderr.strip()[-200:]}")
        meta_path = next(Path(scratch).glob("*.json"))
        meta = json.loads(meta_path.read_text())
        if meta["cpp"] != 1 or meta["cfa"] not in OFFSETS:
            raise UnsupportedRaw(f"not a 2 x 2 Bayer mosaic (cfa={meta['cfa']!r}, channels={meta['cpp']})")
        mosaic = np.fromfile(meta_path.with_suffix(".u16"), dtype="<u2").reshape(meta["height"], meta["width"])
    # Same as make_pairs: one black value (the mean), since the per-site order of rawler's list is not pinned down.
    black = np.full((2, 2), float(np.mean(meta["black"])), dtype=np.float32)
    return pack_rggb(normalise_per_site(mosaic, black, float(meta["white"][0]), clip), meta["cfa"])


def read_planes(path: Path, raw_dump: Path | None = None, clip: bool = True) -> np.ndarray:
    """Four planes (4, H/2, W/2), float32, 0..1 above black (below 0 allowed when clip is False)."""
    if raw_dump:
        return read_with_raw_dump(path, raw_dump, clip)
    return read_with_rawpy(path, clip)
