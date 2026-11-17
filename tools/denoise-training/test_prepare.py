"""Run with:  python3 -m unittest discover -s tools/denoise-training -p 'test_*.py'"""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from prepare_crops import pick_crops, summarise  # noqa: E402


class Prepare(unittest.TestCase):
    def test_noise_summary_takes_the_median_per_camera_and_iso(self):
        records = [
            {"camera": "Z 8", "iso": 800, "noise": {"a": 1e-4, "b2": 4e-6}},
            {"camera": "Z 8", "iso": 800, "noise": {"a": 3e-4, "b2": 16e-6}},
            {"camera": "Z 8", "iso": 800, "noise": {"a": 2e-4, "b2": 9e-6}},
            {"camera": "Z 8", "iso": 100, "noise": {"a": 3e-5, "b2": 1e-6}},
            {"camera": "Z 8", "iso": 100, "noise": None},        # no usable estimate: ignored
            {"camera": "unknown", "iso": None},                   # a file that could not be read
        ]
        profile = summarise(records)
        self.assertEqual(set(profile), {"Z 8"})
        self.assertEqual(profile["Z 8"]["800"]["files"], 3)
        self.assertAlmostEqual(profile["Z 8"]["800"]["a"], 2e-4)
        self.assertAlmostEqual(profile["Z 8"]["800"]["b"], 3e-3, places=6)
        self.assertEqual(profile["Z 8"]["100"]["files"], 1)

    def test_crops_come_from_pictures_with_detail_and_are_stored_as_16_bit(self):
        rng = np.random.default_rng(6)
        planes = rng.uniform(0.1, 0.6, size=(4, 300, 300))
        crops = pick_crops(planes, 3, 64, rng)
        self.assertEqual(len(crops), 3)
        self.assertEqual(crops[0].dtype, np.uint16)
        self.assertEqual(crops[0].shape, (4, 64, 64))
        self.assertEqual(pick_crops(np.zeros((4, 300, 300)), 3, 64, rng), [])
        self.assertEqual(pick_crops(planes[:, :20, :20], 3, 64, rng), [])


if __name__ == "__main__":
    unittest.main()
