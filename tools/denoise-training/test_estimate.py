"""Run with:  python3 -m unittest discover -s tools/denoise-training -p 'test_*.py'"""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from noise_estimate import estimate_noise  # noqa: E402
from noise_model import add_noise  # noqa: E402


def scene(h=256, w=256):
    """Four packed planes of a smooth gradient with a gentle texture, like a blurred background."""
    y, x = np.mgrid[0:h, 0:w]
    base = 0.05 + 0.6 * (x / w) * 0.7 + 0.25 * (y / h)
    return np.stack([base * k for k in (0.9, 1.0, 1.0, 0.8)]).astype(np.float64)


class Estimate(unittest.TestCase):
    def test_known_noise_is_recovered_from_a_picture_alone(self):
        rng = np.random.default_rng(11)
        for a, b in ((2e-3, 1e-3), (8e-4, 3e-3), (5e-3, 2e-3)):
            noisy = add_noise(scene(512, 512), a, b, rng)
            got = estimate_noise(noisy)
            self.assertIsNotNone(got)
            self.assertAlmostEqual(got["a"], a, delta=0.35 * a, msg=f"shot gain for a={a}")
            self.assertAlmostEqual(got["b2"], b * b, delta=max(0.5 * b * b, 4e-6), msg=f"read floor for b={b}")

    def test_more_noise_reads_as_more_noise(self):
        rng = np.random.default_rng(12)
        quiet = estimate_noise(add_noise(scene(), 5e-4, 5e-4, rng))
        loud = estimate_noise(add_noise(scene(), 5e-3, 3e-3, rng))
        self.assertGreater(loud["a"], quiet["a"])
        self.assertGreater(loud["b2"], quiet["b2"])

    def test_pictures_with_nothing_usable_give_no_answer_rather_than_a_guess(self):
        self.assertIsNone(estimate_noise(np.zeros((4, 256, 256))))
        self.assertIsNone(estimate_noise(np.zeros((4, 8, 8))))

    def test_edges_and_texture_do_not_inflate_the_answer(self):
        rng = np.random.default_rng(13)
        base = scene(512, 512)
        base[:, :, 256:] += 0.25  # a hard vertical edge through the middle
        got = estimate_noise(add_noise(base, 2e-3, 1e-3, rng))
        self.assertIsNotNone(got)
        self.assertAlmostEqual(got["a"], 2e-3, delta=0.5 * 2e-3)


if __name__ == "__main__":
    unittest.main()
