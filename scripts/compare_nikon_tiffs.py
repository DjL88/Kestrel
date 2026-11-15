"""Compare two matched, full-resolution TIFF renders without modifying either file."""

import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
import tifffile


def read_rgb16(path):
    with tifffile.TiffFile(path) as image:
        if len(image.pages) != 1:
            raise ValueError(f"{path}: expected a single image")
        page = image.pages[0]
        if (
            page.photometric != tifffile.PHOTOMETRIC.RGB
            or page.axes != "YXS"
            or page.dtype.kind != "u"
            or page.dtype.itemsize != 2
            or page.samplesperpixel != 3
        ):
            raise ValueError(f"{path}: expected contiguous 16-bit RGB")
        if page.compression != tifffile.COMPRESSION.NONE or page.is_tiled:
            raise ValueError(f"{path}: export as uncompressed, non-tiled TIFF")
        orientation = page.tags.get("Orientation")
        if orientation is not None and orientation.value != 1:
            raise ValueError(f"{path}: export with top-left orientation")
        profile = page.tags.get(34675)
        if profile is None or not profile.value:
            raise ValueError(f"{path}: export with an embedded ICC profile")
        return page.asarray(out="memmap"), profile.value


def sha256_file(path):
    with open(path, "rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def compare(reference_path, candidate_path, *, source_nef=None):
    # A self-comparison cannot establish agreement between independent renderers.
    if Path(reference_path).samefile(candidate_path):
        raise ValueError("Reference and candidate are the same file. Supply independent TIFF exports.")
    reference, profile = read_rgb16(reference_path)
    candidate, candidate_profile = read_rgb16(candidate_path)
    if reference.shape != candidate.shape:
        raise ValueError("Image dimensions differ. Match orientation and disable resizing and crop.")
    if profile != candidate_profile:
        raise ValueError("ICC profiles differ. Re-export both using the same embedded profile.")

    height, width, _ = reference.shape
    squared = np.zeros(3, dtype=np.float64)
    absolute = np.zeros(3, dtype=np.float64)
    maxima = np.zeros(3, dtype=np.int32)
    changed = 0
    for row in range(0, height, 64):
        strip = slice(row, row + 64)
        delta = np.abs(reference[strip].astype(np.int32) - candidate[strip].astype(np.int32))
        squared += np.square(delta, dtype=np.float64).sum(axis=(0, 1))
        absolute += delta.sum(axis=(0, 1))
        maxima = np.maximum(maxima, delta.max(axis=(0, 1)))
        changed += int(np.count_nonzero(np.any(delta != 0, axis=2)))
    pixel_count = height * width
    report = {
        "reference_tiff_sha256": sha256_file(reference_path),
        "candidate_tiff_sha256": sha256_file(candidate_path),
        "icc_profile_sha256": hashlib.sha256(profile).hexdigest(),
        "width": width,
        "height": height,
        "channels": ["red", "green", "blue"],
        "changed_pixels": changed,
        "mean_absolute_error_rgb": (absolute / pixel_count).tolist(),
        "rmse_rgb": [math.sqrt(float(total) / pixel_count) for total in squared],
        "maximum_channel_error_rgb": maxima.tolist(),
        "sample_range": [0, 65535],
    }

    if source_nef is not None:
        report["source_nef_sha256"] = sha256_file(source_nef)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference", type=Path, help="NX Studio 16-bit TIFF")
    parser.add_argument("candidate", type=Path, help="candidate 16-bit TIFF from the same NEF")
    parser.add_argument("--source-nef", type=Path, help="optional original NEF to fingerprint")
    capture = parser.add_argument_group("optional benchmark details (supply the whole group with --source-nef)")
    capture.add_argument("--body", choices=("Z8", "Z5II"))
    capture.add_argument("--firmware")
    capture.add_argument("--compression", choices=("lossless", "HE", "HE*"))
    capture.add_argument("--nx-studio-build")
    capture.add_argument("--candidate-build")
    args = parser.parse_args()
    details = {
        "body": args.body,
        "firmware": args.firmware,
        "compression": args.compression,
        "nx_studio_build": args.nx_studio_build,
        "candidate_build": args.candidate_build,
    }
    has_details = any(value is not None for value in details.values())
    if has_details and (not args.source_nef or not all(value and value.strip() for value in details.values())):
        parser.error("benchmark details require --source-nef and all five detail flags")
    try:
        result = compare(args.reference, args.candidate, source_nef=args.source_nef)
    except (OSError, ValueError) as error:
        parser.exit(2, f"{error}\n")
    if has_details:
        result["reported_benchmark_details"] = details
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
