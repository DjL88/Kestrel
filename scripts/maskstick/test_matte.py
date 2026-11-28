import unittest

try:
    import numpy as np
    import scipy  # noqa: F401
except ImportError as e:
    raise unittest.SkipTest(f"the matte prototype needs numpy and scipy: {e}")

from . import metrics as M
from . import synth
from .matte.focus import focus_map, otsu
from .matte.levin import solve_alpha
from .matte.pipeline import matte
from .matte.trimap import colour_evidence, srgb_to_lab


class LevinTests(unittest.TestCase):
    def test_recovers_a_known_linear_mix_between_two_flat_colours(self):
        h, w = 40, 60
        alpha = np.clip((np.arange(w) - 20) / 20.0, 0, 1)[None, :].repeat(h, 0)
        fg = np.array([0.9, 0.2, 0.1])
        bg = np.array([0.1, 0.3, 0.8])
        rgb = alpha[..., None] * fg + (1 - alpha[..., None]) * bg
        known_fg = np.zeros((h, w), bool)
        known_bg = np.zeros((h, w), bool)
        known_fg[:, 44:] = True
        known_bg[:, :16] = True
        got = solve_alpha(rgb, known_fg, known_bg)
        self.assertLess(float(np.abs(got - alpha)[:, 16:44].mean()), 0.03)
        self.assertTrue((got[known_fg] == 1).all() and (got[known_bg] == 0).all())

    def test_no_unknown_pixels_returns_the_constraints(self):
        rgb = np.random.default_rng(0).random((10, 10, 3))
        fg = np.zeros((10, 10), bool)
        fg[:, 5:] = True
        out = solve_alpha(rgb, fg, ~fg)
        self.assertTrue((out == fg).all())


class FocusTests(unittest.TestCase):
    def test_textured_area_scores_above_a_blurred_one(self):
        s = synth.make_scene(4, size=(240, 360), bg_blur=8)
        fm = focus_map(s.image)
        inside = s.alpha > 0.99
        outside = s.alpha < 0.01
        self.assertGreater(float(np.median(fm.score[inside])), float(np.median(fm.score[outside])) + 0.3)

    def test_otsu_splits_two_clusters(self):
        values = np.concatenate([np.full(500, 0.1), np.full(500, 0.8)])
        cut, sep = otsu(values)
        self.assertTrue(0.1 < cut < 0.8)
        self.assertGreater(sep, 0.9)


class ColourTests(unittest.TestCase):
    def test_evidence_separates_two_colours(self):
        img = np.zeros((20, 40, 3), np.float32)
        img[:, :20] = (0.8, 0.2, 0.2)
        img[:, 20:] = (0.2, 0.3, 0.8)
        fg = np.zeros((20, 40), bool)
        fg[:, :20] = True
        e = colour_evidence(img, fg, ~fg)
        self.assertTrue((e[fg] > 0).all() and (e[~fg] < 0).all())
        self.assertEqual(srgb_to_lab(img).shape, img.shape)


class PipelineTests(unittest.TestCase):
    def test_defocused_background_gives_a_good_matte(self):
        s = synth.make_scene(11, size=(384, 576), bg_blur=8, colour_gap=0.35)
        result = matte(s.image)
        self.assertIsNotNone(result.alpha)
        row = M.score_pair(result.alpha, synth.ground_truth_from_alpha(s.alpha))
        self.assertGreater(row["iou"], 0.8)

    def test_sharp_everywhere_is_refused_not_guessed(self):
        s = synth.make_scene(11, size=(384, 576), bg_blur=0, colour_gap=0.35)
        result = matte(s.image)
        self.assertIsNone(result.alpha)
        self.assertIn(result.reason, {"sharp-everywhere", "no-sharp-subject", "cues-do-not-separate"})

    def test_blank_frame_is_refused(self):
        flat = np.full((200, 300, 3), 128, np.uint8)
        self.assertIsNone(matte(flat).alpha)


if __name__ == "__main__":
    unittest.main()
