"""Synthetic regression: Nikon benchmark never rewrites source or reference files."""

import hashlib
import struct
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

    def test_hardlinked_exports_and_source_aliases_are_rejected_without_writes(self):
        # Hard links have different names but refer to the same original bytes.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference = root / "nx-reference.tif"
            pixels = np.full((4, 5, 3), 1234, dtype=np.uint16)
            profile = b"synthetic-icc"
            tifffile.imwrite(reference, pixels, photometric="rgb",
                             extratags=[(34675, "B", len(profile), profile, False)])
            alias = root / "renamed-candidate.tif"
            alias.hardlink_to(reference)
            before = digest(reference)
            with self.assertRaisesRegex(ValueError, "same file"):
                compare(reference, alias)
            self.assertEqual(digest(reference), before)
            self.assertEqual(digest(alias), before)

            candidate = root / "independent-candidate.tif"
            tifffile.imwrite(candidate, pixels, photometric="rgb",
                             extratags=[(34675, "B", len(profile), profile, False)])
            nef_alias = root / "synthetic-original.NEF"
            nef_alias.hardlink_to(reference)
            before_candidate = digest(candidate)
            with self.assertRaisesRegex(ValueError, "separate from both TIFF"):
                compare(reference, candidate, source_nef=nef_alias)
            self.assertEqual(digest(reference), before)
            self.assertEqual(digest(nef_alias), before)
            self.assertEqual(digest(candidate), before_candidate)

    def test_invalid_tiff_does_not_modify_original_or_valid_export(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "synthetic-original.NEF"
            source.write_bytes(b"synthetic only; not a Nikon file")
            reference = root / "reference.tif"
            pixels = np.zeros((4, 5, 3), dtype=np.uint16)
            profile = b"synthetic-icc"
            tifffile.imwrite(reference, pixels, photometric="rgb",
                             extratags=[(34675, "B", len(profile), profile, False)])
            corrupt = root / "truncated.tif"
            corrupt.write_bytes(b"II*\x00")
            before = {path: digest(path) for path in (source, reference, corrupt)}
            with self.assertRaises((ValueError, tifffile.TiffFileError, OSError, struct.error)):
                compare(reference, corrupt, source_nef=source)
            self.assertEqual({path: digest(path) for path in before}, before)

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
