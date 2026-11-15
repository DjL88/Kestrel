import tempfile
import unittest
from pathlib import Path

import numpy as np
import tifffile

from compare_nikon_tiffs import compare


class CompareNikonTiffsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def write(self, name, pixels, profile=b"test-profile", orientation=1):
        file = self.root / name
        tags = [(274, "H", 1, orientation, False)]
        if profile:
            tags.append((34675, "B", len(profile), profile, False))
        tifffile.imwrite(file, pixels, photometric="rgb", extratags=tags)
        return file

    def test_reports_channel_error_and_changed_pixels(self):
        reference = np.full((65, 12, 3), 18000, dtype=np.uint16)
        candidate = reference.copy()
        candidate[64, 0, :] = [0, 18000, 65535]
        result = compare(self.write("reference.tif", reference), self.write("candidate.tif", candidate))
        self.assertEqual(result["changed_pixels"], 1)
        self.assertEqual(result["maximum_channel_error_rgb"], [18000, 0, 47535])
        self.assertEqual(result["width"], 12)
        self.assertEqual(result["height"], 65)

    def test_rejects_unmatched_profile_size_orientation_and_depth(self):
        pixels = np.zeros((12, 12, 3), dtype=np.uint16)
        reference = self.write("reference.tif", pixels)
        for candidate, message in [
            (self.write("missing.tif", pixels, b""), "embedded ICC"),
            (self.write("profile.tif", pixels, b"another"), "profiles differ"),
            (self.write("size.tif", pixels[:8]), "dimensions differ"),
            (self.write("orientation.tif", pixels, orientation=6), "top-left orientation"),
            (self.write("depth.tif", pixels.astype(np.uint8)), "16-bit RGB"),
        ]:
            with self.subTest(file=candidate), self.assertRaisesRegex(ValueError, message):
                compare(reference, candidate)


if __name__ == "__main__":
    unittest.main()
