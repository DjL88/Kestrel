"""Read-only TIFF-region benchmark for Kestrel RAW detail experiments.

These metrics do not prove genuine recovered detail. Inspect crops for noise,
hallucinated texture, haloes, colour errors and sharpening artefacts.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from compare_nikon_tiffs import read_rgb16, sha256_file


def parse_region(spec):
    try:
        v = tuple(int(n) for n in spec.split(","))
    except ValueError as exc:
        raise ValueError("Region must be x,y,width,height in integer pixels") from exc
    if len(v) != 4 or any(n < 0 for n in v[:2]) or any(n <= 0 for n in v[2:]):
        raise ValueError("Region must be x,y,width,height with positive dimensions")
    return v


def region_metrics(pixels):
    rgb = np.asarray(pixels, dtype=np.float32) / 65535.0
    luma = rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722
    gradients = np.concatenate((np.abs(np.diff(luma, axis=1)).ravel(),
                                np.abs(np.diff(luma, axis=0)).ravel()))
    return {
        "mean_luminance": float(luma.mean()),
        "luminance_stddev": float(luma.std()),
        "mean_neighbor_difference": float(gradients.mean()),
        "p95_neighbor_difference": float(np.percentile(gradients, 95)),
        "clipped_black_fraction": float(np.mean(np.all(pixels == 0, axis=2))),
        "clipped_white_fraction": float(np.mean(np.all(pixels == 65535, axis=2))),
    }


def benchmark(reference_path, candidate_path, regions):
    reference_path, candidate_path = Path(reference_path), Path(candidate_path)
    if reference_path.samefile(candidate_path):
        raise ValueError("Reference and candidate are the same file")
    reference, profile = read_rgb16(reference_path)
    candidate, candidate_profile = read_rgb16(candidate_path)
    if reference.shape != candidate.shape:
        raise ValueError("Dimensions differ: use matching full-size, uncropped TIFFs")
    if profile != candidate_profile:
        raise ValueError("ICC profiles differ: use the same output profile")
    height, width, _ = reference.shape
    report = {
        "reference_tiff_sha256": sha256_file(reference_path),
        "candidate_tiff_sha256": sha256_file(candidate_path),
        "image_dimensions": [width, height],
        "regions": [],
    }
    for name, spec in regions:
        x, y, w, h = parse_region(spec)
        if w < 3 or h < 3 or x + w > width or y + h > height:
            raise ValueError(f"{name}: region must be at least 3x3 and inside image bounds")
        window = np.s_[y:y+h, x:x+w]
        ref, cand = reference[window], candidate[window]
        delta = np.abs(ref.astype(np.int32) - cand.astype(np.int32))
        report["regions"].append({
            "name": name, "bounds": [x, y, w, h],
            "reference": region_metrics(ref),
            "candidate": region_metrics(cand),
            "mean_absolute_rgb_difference": float(delta.mean() / 65535.0),
        })
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("--region", nargs=2, action="append", metavar=("NAME", "X,Y,W,H"),
                        required=True, help="Repeat for eye, feathers, sky etc")
    args = parser.parse_args()
    try:
        report = benchmark(args.reference, args.candidate, args.region)
    except (OSError, ValueError) as exc:
        parser.exit(2, f"{exc}\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
