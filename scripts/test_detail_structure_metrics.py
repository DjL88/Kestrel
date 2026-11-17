import unittest
import numpy as np
from detail_structure_metrics import compare_detail_structure


class StructureTests(unittest.TestCase):
    def image(self, arr):
        return np.repeat(np.asarray(arr, dtype=np.uint16)[:, :, None], 3, axis=2)

    def test_identical_feathers_have_matching_edges(self):
        pattern = np.tile([1000, 1000, 50000, 50000, 1000, 1000, 50000], (9, 1))
        img = self.image(pattern)
        result = compare_detail_structure(img, img)
        self.assertGreater(result["shared_edge_fraction"], 0)
        self.assertEqual(result["candidate_only_edge_fraction"], 0)
        self.assertAlmostEqual(result["mean_shared_edge_direction_cosine"], 1)

    def test_alternating_one_pixel_feather_lines_are_not_invisible(self):
        # A centred difference mistakenly reports zero for ABAB patterns.
        # Fine single-pixel texture must remain visible to the benchmark.
        pattern = np.tile([1000, 60000] * 6, (12, 1))
        stripes = self.image(pattern)
        flat = self.image(np.full((12, 12), 30000))
        same = compare_detail_structure(stripes, stripes)
        missing = compare_detail_structure(stripes, flat)
        self.assertGreater(same["reference_edge_fraction"], 0.5)
        self.assertGreater(same["shared_edge_fraction"], 0.5)
        self.assertEqual(same["candidate_only_edge_fraction"], 0)
        self.assertGreater(missing["reference_only_edge_fraction"], 0.5)

    def test_extra_detail_detected_when_reference_is_flat(self):
        reference = self.image(np.full((12, 12), 20000))
        candidate = np.full((12, 12), 20000, dtype=np.uint16)
        candidate[::3, :] = 50000
        result = compare_detail_structure(reference, self.image(candidate))
        self.assertGreater(result["candidate_only_edge_fraction"], 0)
        self.assertIsNone(result["mean_shared_edge_direction_cosine"])

    def test_missing_detail_detected_when_candidate_flat(self):
        reference = np.full((12, 12), 10000, dtype=np.uint16)
        reference[::3, :] = 50000
        result = compare_detail_structure(self.image(reference), self.image(np.full((12, 12), 20000)))
        self.assertGreater(result["reference_only_edge_fraction"], 0)
        self.assertEqual(result["candidate_only_edge_fraction"], 0)

    def test_flat_both_has_no_direction_score(self):
        img = self.image(np.full((6, 6), 30000))
        result = compare_detail_structure(img, img)
        self.assertIsNone(result["mean_shared_edge_direction_cosine"])
        self.assertEqual(result["shared_edge_fraction"], 0)

    def test_invalid_inputs_fail_closed(self):
        img = self.image(np.full((6, 6), 30000))
        with self.assertRaises(ValueError):
            compare_detail_structure(img, img[:3])
        with self.assertRaises(ValueError):
            compare_detail_structure(img[:2], img[:2])
        with self.assertRaises(ValueError):
            compare_detail_structure(img, img, edge_floor=0)
        bad = img.astype(float)
        bad[1, 1, 0] = np.nan
        with self.assertRaises(ValueError):
            compare_detail_structure(bad, bad)


if __name__ == "__main__":
    unittest.main()
