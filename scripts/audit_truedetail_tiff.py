"""Offline TrueDetail TIFF output audit: inspect precision, profile and dimensions.

Read-only diagnostics. An apparent 8-bit code lattice is a warning, NOT proof
that sensor precision was lost; genuinely flat or quantised scenes can match.
"""
import argparse
import json
from pathlib import Path

import numpy as np
import tifffile

from compare_nikon_tiffs import sha256_file


def audit(path, *, minimum_width=1, minimum_height=1):
    path = Path(path)
    with tifffile.TiffFile(path) as tif:
        if len(tif.pages) != 1:
            raise ValueError("Expected a single TIFF image page")
        page = tif.pages[0]
        if (page.photometric != tifffile.PHOTOMETRIC.RGB
                or page.samplesperpixel != 3 or page.dtype != np.dtype("uint16")
                or page.axes != "YXS"):
            raise ValueError("Expected contiguous, three-channel RGB16 TIFF")
        if page.compression != tifffile.COMPRESSION.NONE or page.is_tiled:
            raise ValueError("Expected uncompressed, non-tiled TIFF")
        orientation = page.tags.get("Orientation")
        if orientation is not None and orientation.value != 1:
            raise ValueError("TIFF pixels must use top-left orientation")
        height, width = page.shape[:2]
        if width < minimum_width or height < minimum_height:
            raise ValueError("TIFF dimensions are below the required sensor size")
        profile = page.tags.get(34675)
        has_icc = bool(profile and profile.value)
        # Reject inconsistent axes before allocating a full-size decoded array.
        samples = page.asarray(out="memmap")
        sample_count = 0
        lattice_count = 0
        observed = set()
        # Bounded row samples: reduces RAM, avoids misleading all-black crops.
        # Sample rows across the full image instead of trusting only one corner.
        for y in np.linspace(0, height - 1, num=min(height, 24), dtype=int):
            row = samples[y, ::max(1, width // 2048), :]
            sample_count += int(row.size)
            lattice_count += int(np.count_nonzero(row % 257 == 0))
            observed.update(int(v) for v in np.unique(row))
        lattice_fraction = lattice_count / sample_count if sample_count else 0.0
        suspicious = len(observed) >= 32 and lattice_fraction == 1.0
        warnings = []
        if not has_icc:
            warnings.append("missing_embedded_icc_profile")
        if suspicious:
            warnings.append("all_sampled_codes_on_8bit_expansion_lattice")
        return {
            "tiff_sha256": sha256_file(path),
            "width": int(width),
            "height": int(height),
            "channels": 3,
            "bits_per_channel": 16,
            "has_embedded_icc_profile": has_icc,
            "sampled_channel_values": sample_count,
            "distinct_sampled_codes": len(observed),
            "eight_bit_expansion_lattice_fraction": lattice_fraction,
            "warnings": warnings,
            "ready_for_colour_reference_comparison": has_icc,
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tiff", type=Path)
    parser.add_argument("--minimum-width", type=int, default=1)
    parser.add_argument("--minimum-height", type=int, default=1)
    args = parser.parse_args()
    if args.minimum_width < 1 or args.minimum_height < 1:
        parser.error("Minimum dimensions must be positive")
    try:
        print(json.dumps(audit(args.tiff, minimum_width=args.minimum_width,
                               minimum_height=args.minimum_height), indent=2))
    except (OSError, ValueError, tifffile.TiffFileError) as exc:
        parser.exit(2, f"{exc}\n")


if __name__ == "__main__":
    main()
