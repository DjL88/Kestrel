import unittest

try:
    import numpy as np
    import scipy  # noqa: F401
except ImportError as e:  # CI installs numpy and pillow; scipy is needed only here
    raise unittest.SkipTest(f"maskstick metrics need numpy and scipy: {e}")

from . import metrics as M


def disc(shape, cx, cy, r):
    y, x = np.mgrid[0:shape[0], 0:shape[1]]
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


class IouTests(unittest.TestCase):
    def test_identical_and_disjoint(self):
        a = disc((100, 100), 40, 40, 20)
        self.assertEqual(M.iou(a, a), 1.0)
        self.assertEqual(M.iou(a, ~a), 0.0)

    def test_both_empty_is_perfect(self):
        z = np.zeros((10, 10), bool)
        self.assertEqual(M.iou(z, z), 1.0)

    def test_ignore_band_is_not_counted(self):
        gt = np.zeros((10, 10), bool)
        gt[:, :5] = True
        pred = np.zeros((10, 10), bool)
        pred[:, :6] = True  # one extra column
        ignore = np.zeros((10, 10), bool)
        ignore[:, 5] = True
        self.assertLess(M.iou(pred, gt), 1.0)
        self.assertEqual(M.iou(pred, gt, ignore), 1.0)

    def test_soft_iou_rewards_a_soft_edge_in_the_right_place(self):
        gt = np.zeros((20, 20), bool)
        gt[:, :10] = True
        hard = gt.astype(np.float32)
        wrong = np.roll(hard, 3, axis=1)
        self.assertEqual(M.soft_iou(hard, gt), 1.0)
        self.assertLess(M.soft_iou(wrong, gt), 1.0)


class BoundaryTests(unittest.TestCase):
    def test_identical_masks_score_one(self):
        a = disc((120, 120), 60, 60, 30)
        self.assertEqual(M.boundary_f(a, a, 2)["f"], 1.0)

    def test_small_shift_passes_loose_tolerance_but_not_tight(self):
        a = disc((160, 160), 80, 80, 40)
        b = disc((160, 160), 84, 80, 40)  # 4 px to the right
        tight, loose = M.boundary_f(b, a, 1)["f"], M.boundary_f(b, a, 8)["f"]
        self.assertLess(tight, 0.5)
        self.assertGreater(loose, 0.95)

    def test_both_empty_and_one_empty(self):
        z = np.zeros((30, 30), bool)
        a = disc((30, 30), 15, 15, 8)
        self.assertEqual(M.boundary_f(z, z, 2)["f"], 1.0)
        self.assertEqual(M.boundary_f(z, a, 2)["f"], 0.0)
        self.assertEqual(M.boundary_f(a, z, 2)["f"], 0.0)

    def test_frame_edge_is_not_a_boundary(self):
        full = np.ones((20, 20), bool)
        self.assertFalse(M.boundary(full).any())

    def test_larger_tolerance_never_scores_lower_with_a_band(self):
        gt = disc((200, 200), 100, 100, 60)
        band = disc((200, 200), 100, 100, 64) & ~disc((200, 200), 100, 100, 56)
        subject = gt & ~band
        pred = disc((200, 200), 104, 99, 62)
        f = [M.boundary_f(pred, subject, t, band)["f"] for t in (2, 4, 8)]
        self.assertLessEqual(f[0], f[1] + 1e-9)
        self.assertLessEqual(f[1], f[2] + 1e-9)

    def test_uncertain_band_waives_the_boundary_inside_it(self):
        gt = np.zeros((100, 100), bool)
        gt[:, :50] = True
        ignore = np.zeros_like(gt)
        ignore[:, 50:60] = True  # the owner could not tell where the edge is within this band
        pred = np.zeros_like(gt)
        pred[:, :56] = True      # edge lands inside the band
        without = M.boundary_f(pred, gt, 2)["f"]
        with_band = M.boundary_f(pred, gt, 2, ignore)
        self.assertLess(without, 0.5)
        self.assertEqual(with_band["f"], 1.0)
        self.assertGreater(with_band["waived"], 0.9)


class EffortTests(unittest.TestCase):
    def test_perfect_mask_costs_nothing(self):
        a = disc((100, 100), 50, 50, 20)
        e = M.effort_to_fix(a, a)
        self.assertEqual((e.strokes, e.regions), (0, 0))

    def test_one_missing_blob_is_one_region(self):
        gt = disc((200, 200), 100, 100, 40)
        pred = gt & ~disc((200, 200), 100, 100, 12)  # a hole
        e = M.effort_to_fix(pred, gt)
        self.assertEqual(e.regions, 1)
        self.assertGreaterEqual(e.strokes, 1)
        self.assertGreater(e.false_negative_frac, 0)
        self.assertEqual(e.false_positive_frac, 0)

    def test_more_scattered_errors_cost_more(self):
        gt = disc((300, 300), 150, 150, 100)
        few = gt & ~disc((300, 300), 150, 150, 10)
        many = few.copy()
        for cx, cy in [(100, 100), (200, 100), (100, 200), (200, 200), (150, 80)]:
            many &= ~disc((300, 300), cx, cy, 8)
        self.assertGreater(M.effort_to_fix(many, gt).strokes, M.effort_to_fix(few, gt).strokes)

    def test_specks_are_not_counted(self):
        gt = disc((100, 100), 50, 50, 30)
        pred = gt.copy()
        pred[50, 50] = False
        self.assertEqual(M.effort_to_fix(pred, gt).regions, 0)


class ScorePairTests(unittest.TestCase):
    def test_perfect_prediction(self):
        gt = np.zeros((80, 120), np.uint8)
        gt[20:60, 30:90] = 255
        row = M.score_pair(gt.astype(np.float32) / 255, gt)
        self.assertAlmostEqual(row["iou"], 1.0)
        self.assertAlmostEqual(row["f2"], 1.0)
        self.assertEqual(row["effort_strokes"], 0)

    def test_prediction_at_another_size_is_resized(self):
        gt = np.zeros((80, 120), np.uint8)
        gt[20:60, 30:90] = 255
        small = (gt[::2, ::2] > 0).astype(np.float32)
        row = M.score_pair(small, gt)
        self.assertGreater(row["iou"], 0.9)

    def test_wrong_aspect_is_refused(self):
        gt = np.zeros((80, 120), np.uint8)
        with self.assertRaises(M.SizeMismatch):
            M.score_pair(np.zeros((120, 80), np.float32), gt)

    def test_ground_truth_bands(self):
        gt = np.array([[0, 64, 65, 128, 191, 192, 255]], np.uint8)
        subject, ignore = M.split_ground_truth(gt)
        self.assertEqual(subject.tolist(), [[False, False, False, False, False, True, True]])
        self.assertEqual(ignore.tolist(), [[False, False, True, True, True, False, False]])


if __name__ == "__main__":
    unittest.main()
