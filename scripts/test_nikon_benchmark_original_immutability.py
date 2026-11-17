"""Synthetic regression: Nikon benchmark never rewrites source or reference files."""

import hashlib
import tempfile
import unittest
from pathlib import Path

import numpy as np
import tifffile

from compare_nikon_tiffs import compare


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class NikonBenchmarkReadOnlyTests(unittest.TestCase):
    def test_success_and_rejected_comparisons_preserve_all_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "synthetic-z8-he-star.NEF"
            source.write_bytes(b"synthetic fixture, not a Nikon RAW")
            reference = root / "nx-reference.tif"
            candidate = root / "kestrel-candidate.tif"
            pixels = np.full((65, 17, 3), 12000, dtype=np.uint16)
            tags = [(34675, "B", 12, b"test-profile", False)]
            tifffile.imwrite(reference, pixels, photometric="rgb", extratags=tags)
            edited = pixels.copy()
            edited[64, 16, 0] = 12500
            tifffile.imwrite(candidate, edited, photometric="rgb", extratags=tags)
            inputs = (source, reference, candidate)
            before = {path: digest(path) for path in inputs}

            result = compare(reference, candidate, source_nef=source)
            self.assertEqual(result["width"], 17)
            self.assertEqual(result["height"], 65)
            self.assertEqual(result["changed_pixels"], 1)
            self.assertEqual(result["source_nef_sha256"], before[source])
            self.assertEqual({path: digest(path) for path in inputs}, before)

            with self.assertRaisesRegex(ValueError, "same file"):
                compare(reference, reference, source_nef=source)
            self.assertEqual({path: digest(path) for path in inputs}, before)

            with self.assertRaisesRegex(ValueError, "separate from both TIFF"):
                compare(reference, candidate, source_nef=candidate)
            self.assertEqual({path: digest(path) for path in inputs}, before)

    def test_mismatched_profile_rejection_preserves_source_and_exports(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "synthetic-z5ii-he.NEF"
            source.write_bytes(b"not a real NEF")
            pixels = np.zeros((8, 8, 3), dtype=np.uint16)
            reference = root / "reference.tif"
            candidate = root / "candidate.tif"
            for path, profile in ((reference, b"profile-one"), (candidate, b"profile-two")):
                tifffile.imwrite(path, pixels, photometric="rgb",
                                 extratags=[(34675, "B", len(profile), profile, False)])
            inputs = (source, reference, candidate)
            before = {path: digest(path) for path in inputs}
            with self.assertRaisesRegex(ValueError, "profiles differ"):
                compare(reference, candidate, source_nef=source)
            self.assertEqual({path: digest(path) for path in inputs}, before)


if __name__ == "__main__":
    unittest.main()
