"""Summarise local Nikon pixel-comparison coverage for explicitly selected builds and firmware."""

import argparse
import json
import re
from pathlib import Path


COMPRESSIONS = ("lossless", "HE", "HE*")
SHA256 = re.compile(r"[0-9a-f]{64}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reports", nargs="+", type=Path)
    parser.add_argument("--z8-firmware", action="append", required=True)
    parser.add_argument("--z5ii-firmware", action="append", required=True)
    parser.add_argument("--nx-studio-build", required=True)
    parser.add_argument("--candidate-build", required=True)
    args = parser.parse_args()

    samples = {
        (body, firmware, compression): set()
        for body, versions in (("Z8", args.z8_firmware), ("Z5II", args.z5ii_firmware))
        for firmware in versions
        for compression in COMPRESSIONS
    }
    ignored = 0
    for path in args.reports:
        try:
            report = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(report, dict):
                raise ValueError("expected a comparison report object")
        except (OSError, ValueError) as error:
            parser.exit(2, f"{path}: {error}\n")
        details = report.get("reported_benchmark_details")
        if not isinstance(details, dict):
            ignored += 1
            continue

        dimensions = (details.get("body"), details.get("firmware"), details.get("compression"))
        fingerprints = [report.get(key) for key in (
            "source_nef_sha256", "reference_tiff_sha256", "candidate_tiff_sha256", "icc_profile_sha256",
        )]
        if (
            not all(isinstance(value, str) for value in dimensions)
            or dimensions not in samples
            or details.get("nx_studio_build") != args.nx_studio_build
            or details.get("candidate_build") != args.candidate_build
            or not all(isinstance(value, str) and SHA256.fullmatch(value) for value in fingerprints)
            # A copied NX Studio TIFF is not independent decoder evidence.
            or fingerprints[1] == fingerprints[2]
            or report.get("byte_identical_exports") is True
        ):
            ignored += 1
            continue
        samples[dimensions].add(fingerprints[0])

    coverage = [
        {"body": body, "firmware": firmware, "compression": compression, "compared_samples": len(checksums)}
        for (body, firmware, compression), checksums in samples.items()
    ]
    print(json.dumps({
        "nx_studio_build": args.nx_studio_build,
        "candidate_build": args.candidate_build,
        "ignored_reports": ignored,
        "coverage": coverage,
    }, indent=2))


if __name__ == "__main__":
    main()
