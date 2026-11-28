import json
import os
import tempfile
import unittest

try:
    import numpy as np
    import scipy  # noqa: F401
    from PIL import Image
except ImportError as e:
    raise unittest.SkipTest(f"maskstick scoring needs numpy, scipy and pillow: {e}")

from . import score as S
from . import synth


def save_png(path, array):
    Image.fromarray(np.asarray(array, np.uint8)).save(path)


class ScoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        self.gt_dir = os.path.join(self.root, "gt")
        os.makedirs(self.gt_dir)
        rng = np.random.default_rng(1)
        self.keys = []
        for i in range(6):
            gt = np.zeros((96, 144), np.uint8)
            x0, y0 = int(rng.integers(10, 40)), int(rng.integers(10, 30))
            gt[y0:y0 + 40, x0:x0 + 60] = 255
            key = f"photo{i}"
            self.keys.append(key)
            save_png(os.path.join(self.gt_dir, key + ".png"), gt)
            with open(os.path.join(self.gt_dir, key + ".json"), "w") as f:
                json.dump({"status": "ok", "start_source": "a" if i % 2 == 0 else "b", "seconds": 10 + 5 * i}, f)
        self.truth, self.skipped = S.load_ground_truth(self.gt_dir)

    def tearDown(self):
        self.tmp.cleanup()

    def source(self, name, fn):
        d = os.path.join(self.root, name)
        os.makedirs(d, exist_ok=True)
        for key, item in self.truth.items():
            save_png(os.path.join(d, key + ".png"), fn(item["gt"]))
        return d

    def test_perfect_source_beats_shifted_source(self):
        perfect = S.score_source("perfect", self.source("perfect", lambda g: g), self.truth)
        shifted = S.score_source("shifted", self.source("shifted", lambda g: np.roll(g, 6, axis=1)), self.truth)
        p, s = S.summarise(perfect["rows"]), S.summarise(shifted["rows"])
        self.assertAlmostEqual(p["iou"], 1.0, places=3)
        self.assertGreater(p["f2"], s["f2"])
        self.assertGreater(s["f8"], s["f2"])  # a 6 px shift is forgiven at 8 px, not at 2
        d = S.bootstrap_difference(perfect["rows"], shifted["rows"], "iou")
        self.assertEqual((d["wins"], d["losses"]), (6, 0))
        self.assertGreater(d["lo"], 0)

    def test_effort_difference_direction(self):
        perfect = S.score_source("p", self.source("p", lambda g: g), self.truth)
        empty = S.score_source("e", self.source("e", lambda g: np.zeros_like(g)), self.truth)
        d = S.bootstrap_difference(perfect["rows"], empty["rows"], "effort_strokes")
        self.assertLess(d["mean"], 0)       # fewer strokes is better...
        self.assertEqual(d["wins"], 6)      # ...and is counted as a win

    def test_anchored_rows_are_flagged(self):
        a = S.score_source("a", self.source("a", lambda g: g), self.truth)
        self.assertEqual(sum(r["anchored"] for r in a["rows"].values()), 3)
        s = S.summarise(a["rows"])
        self.assertEqual(s["n_unanchored"], 3)

    def test_missing_modes(self):
        d = os.path.join(self.root, "partial")
        os.makedirs(d)
        save_png(os.path.join(d, "photo0.png"), self.truth["photo0"]["gt"])
        with self.assertRaises(FileNotFoundError):
            S.score_source("partial", d, self.truth)
        skip = S.score_source("partial", d, self.truth, missing="skip")
        self.assertEqual(len(skip["rows"]), 1)
        empty = S.score_source("partial", d, self.truth, missing="empty")
        self.assertEqual(len(empty["rows"]), 6)
        self.assertEqual(empty["rows"]["photo3"]["iou"], 0.0)

    def test_skipped_photos_are_left_out_and_listed(self):
        with open(os.path.join(self.gt_dir, "photo5.json"), "w") as f:
            json.dump({"status": "skip"}, f)
        truth, skipped = S.load_ground_truth(self.gt_dir)
        self.assertEqual(skipped, ["photo5"])
        self.assertNotIn("photo5", truth)

    def test_effort_proxy_check_needs_enough_photos(self):
        self.assertTrue(np.isnan(S.spearman([1, 2], [1, 2])))
        self.assertAlmostEqual(S.spearman([1, 2, 3, 4, 5], [10, 20, 30, 40, 50]), 1.0)

    def test_markdown_and_cli(self):
        self.source("good", lambda g: g)
        self.source("bad", lambda g: np.zeros_like(g))
        out = os.path.join(self.root, "out")
        code = S.main(["--gt", self.gt_dir, "--source", f"good={self.root}/good", "--source", f"bad={self.root}/bad",
                       "--compare", "good", "bad", "--out", out])
        self.assertEqual(code, 0)
        with open(os.path.join(out, "report.md")) as f:
            text = f.read()
        self.assertIn("| good |", text)
        self.assertIn("good minus bad", text)
        self.assertTrue(os.path.exists(os.path.join(out, "report.json")))


class SynthTests(unittest.TestCase):
    def test_scene_is_deterministic_with_a_soft_edge(self):
        a = synth.make_scene(5, size=(160, 240))
        b = synth.make_scene(5, size=(160, 240))
        self.assertTrue((a.image == b.image).all())
        partial = ((a.alpha > 0.05) & (a.alpha < 0.95)).sum()
        self.assertGreater(partial, 100)  # barbs and an anti-aliased outline: a genuinely soft edge
        gt = synth.ground_truth_from_alpha(a.alpha)
        self.assertEqual(set(np.unique(gt)) - {0, 128, 255}, set())

    def test_true_alpha_scores_near_perfectly_against_its_own_truth(self):
        from . import metrics as M
        s = synth.make_scene(2, size=(160, 240))
        row = M.score_pair(s.alpha, synth.ground_truth_from_alpha(s.alpha))
        self.assertGreater(row["iou"], 0.98)


if __name__ == "__main__":
    unittest.main()
