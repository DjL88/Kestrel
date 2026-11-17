import tempfile
import unittest
from pathlib import Path

import numpy as np
import tifffile

from audit_truedetail_tiff import audit


class TrueDetailTiffAuditTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)

    def write(self, name, pixels, *, icc=b"test-icc", **options):
        path = self.root / name
        tags = [(34675, "B", len(icc), icc, False)] if icc else []
        tifffile.imwrite(path, pixels, photometric="rgb", extratags=tags, **options)
        return path

    def test_true_sixteen_bit_variation_and_icc_pass(self):
        rng = np.random.default_rng(17)
        pixels = rng.integers(100, 65000, (32, 40, 3), dtype=np.uint16)
        report = audit(self.write("good.tif", pixels), minimum_width=40, minimum_height=32)
        self.assertEqual(report["warnings"], [])
        self.assertTrue(report["ready_for_colour_reference_comparison"])
        self.assertLess(report["eight_bit_expansion_lattice_fraction"], 0.1)
        self.assertEqual(report["bits_per_channel"], 16)

    def test_warning_for_expanded_eight_bit_image_without_icc(self):
        pixels = np.arange(48 * 48 * 3, dtype=np.uint16).reshape(48, 48, 3) % 240
        pixels = pixels * 257
        report = audit(self.write("expanded.tif", pixels, icc=b""))
        self.assertIn("missing_embedded_icc_profile", report["warnings"])
        self.assertIn("all_sampled_codes_on_8bit_expansion_lattice", report["warnings"])
        self.assertFalse(report["ready_for_colour_reference_comparison"])

    def test_flat_image_does_not_get_lattice_warning(self):
        pixels = np.zeros((12, 12, 3), dtype=np.uint16)
        report = audit(self.write("flat.tif", pixels))
        self.assertNotIn("all_sampled_codes_on_8bit_expansion_lattice", report["warnings"])

    def test_refuses_incorrect_bitdepth_and_minimum_dimensions(self):
        pixels = np.full((8, 10, 3), 10000, dtype=np.uint16)
        good = self.write("small.tif", pixels)
        with self.assertRaisesRegex(ValueError, "below the required"):
            audit(good, minimum_width=11)
        bad = self.write("8bit.tif", pixels.astype(np.uint8))
        with self.assertRaisesRegex(ValueError, "RGB16"):
            audit(bad)

    def test_refuses_compression_and_wrong_orientation(self):
        pixels = np.zeros((32, 32, 3), dtype=np.uint16)
        compressed = self.write("compressed.tif", pixels, compression="deflate")
        with self.assertRaisesRegex(ValueError, "uncompressed"):
            audit(compressed)
        oriented = self.root / "rotated.tif"
        tifffile.imwrite(oriented, pixels, photometric="rgb",
                         extratags=[(274, "H", 1, 6, False)])
        with self.assertRaisesRegex(ValueError, "top-left"):
            audit(oriented)


if __name__ == "__main__":
    unittest.main()
