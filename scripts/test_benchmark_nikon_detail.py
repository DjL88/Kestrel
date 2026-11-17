import tempfile
import unittest
from pathlib import Path

import numpy as np
import tifffile

from benchmark_nikon_detail import benchmark, parse_region


class NikonDetailTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def write(self, name, pixels, profile=b"test-icc"):
        path = self.root / name
        tags = [(34675, "B", len(profile), profile, False)] if profile else []
        tifffile.imwrite(path, pixels, photometric="rgb", extratags=tags)
        return path

    def test_identical_images_have_matching_detail_metrics(self):
        rng = np.random.default_rng(4)
        pixels = rng.integers(1000, 60000, (16, 16, 3), dtype=np.uint16)
        a = self.write("a.tif", pixels)
        b = self.write("b.tif", pixels)
        result = benchmark(a, b, [("feathers", "2,3,9,8")])
        region = result["regions"][0]
        self.assertEqual(region["mean_absolute_rgb_difference"], 0)
        self.assertEqual(region["reference"], region["candidate"])
        self.assertEqual(result["image_dimensions"], [16, 16])

    def test_smoothing_reduces_neighbor_differences(self):
        pixels = np.zeros((10, 10, 3), dtype=np.uint16)
        pixels[:, ::2, :] = 60000
        a = self.write("a.tif", pixels)
        b = self.write("b.tif", np.full_like(pixels, 30000))
        region = benchmark(a, b, [("feathers", "0,0,10,10")])["regions"][0]
        self.assertGreater(region["reference"]["mean_neighbor_difference"],
                           region["candidate"]["mean_neighbor_difference"])
        self.assertGreater(region["mean_absolute_rgb_difference"], 0)

    def test_rejects_bad_regions_duplicate_inputs_and_mismatched_profiles(self):
        for bad in ("1,2,3", "-1,0,4,4", "0,0,0,4", "a,1,2,3"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                parse_region(bad)
        pixels = np.ones((8, 8, 3), dtype=np.uint16)
        a = self.write("a.tif", pixels)
        b = self.write("b.tif", pixels, profile=b"other-icc")
        c = self.write("c.tif", pixels)
        with self.assertRaisesRegex(ValueError, "same file"):
            benchmark(a, a, [("eye", "0,0,4,4")])
        with self.assertRaisesRegex(ValueError, "ICC profiles differ"):
            benchmark(a, b, [("eye", "0,0,4,4")])
        with self.assertRaisesRegex(ValueError, "inside image bounds"):
            benchmark(a, c, [("eye", "7,7,4,4")])


if __name__ == "__main__":
    unittest.main()
