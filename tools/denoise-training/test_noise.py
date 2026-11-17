"""Run with:  python3 -m unittest discover -s tools/denoise-training -p 'test_*.py'"""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from make_pairs import has_content, make_pairs, normalise, pack_rggb, unpack_rggb  # noqa: E402
from noise_model import add_noise, noise_params, sample_iso  # noqa: E402


class NoiseModel(unittest.TestCase):
    def test_variance_follows_signal_plus_floor(self):
        rng = np.random.default_rng(3)
        a, b = 1e-3, 2e-3
        for x in (0.05, 0.2, 0.6):
            noisy = add_noise(np.full((400, 400), x), a, b, rng)
            self.assertAlmostEqual(float(noisy.var()), a * x + b * b, delta=0.06 * (a * x + b * b), msg=f"signal {x}")
            self.assertAlmostEqual(float(noisy.mean()), x, delta=3e-4)

    def test_more_iso_means_more_noise_in_every_part_of_the_range(self):
        previous = (0.0, 0.0)
        for iso in (100, 400, 1600, 6400, 25600):
            a, b = noise_params(iso)
            self.assertGreater(a, previous[0])
            self.assertGreater(b, previous[1])
            previous = (a, b)

    def test_input_is_untouched_and_results_repeat_with_the_same_seed(self):
        clean = np.full((16, 16), 0.3, dtype=np.float32)
        before = clean.copy()
        one = add_noise(clean, 1e-3, 1e-3, np.random.default_rng(9))
        two = add_noise(clean, 1e-3, 1e-3, np.random.default_rng(9))
        np.testing.assert_array_equal(clean, before)
        np.testing.assert_array_equal(one, two)

    def test_bad_values_are_refused(self):
        with self.assertRaises(ValueError):
            noise_params(0)
        with self.assertRaises(ValueError):
            add_noise(np.zeros(4), -1.0, 0.0, np.random.default_rng(1))

    def test_iso_is_spread_evenly_across_stops(self):
        rng = np.random.default_rng(5)
        isos = np.array([sample_iso(rng) for _ in range(4000)])
        self.assertGreaterEqual(isos.min(), 400.0)
        self.assertLessEqual(isos.max(), 51200.0)
        self.assertAlmostEqual(float(np.median(np.log2(isos))), float(np.log2(400 * 51200) / 2), delta=0.3)


class Packing(unittest.TestCase):
    def test_every_pattern_packs_to_red_green_green_blue(self):
        # A 4 x 4 mosaic built so each colour has a known value, in each of the four possible layouts.
        value = {"R": 10, "G": 20, "B": 30}
        layouts = {"RGGB": ["RG", "GB"], "GRBG": ["GR", "BG"], "GBRG": ["GB", "RG"], "BGGR": ["BG", "GR"]}
        for pattern, tile in layouts.items():
            mosaic = np.zeros((6, 6), dtype=np.float32)
            for y in range(6):
                for x in range(6):
                    mosaic[y, x] = value[tile[y % 2][x % 2]]
            # Shift by the pattern's red offset so the packer has to realign it.
            from make_pairs import OFFSETS
            dy, dx = OFFSETS[pattern]
            planes = pack_rggb(mosaic, pattern)
            self.assertEqual(planes.shape[0], 4)
            self.assertTrue((planes[0] == 10).all(), pattern)  # red
            self.assertTrue((planes[3] == 30).all(), pattern)  # blue
            self.assertTrue((planes[1] == 20).all() and (planes[2] == 20).all(), pattern)  # greens
            self.assertGreaterEqual(dy + dx, 0)

    def test_pack_and_unpack_round_trip_and_odd_sizes_are_trimmed(self):
        mosaic = np.arange(8 * 10, dtype=np.float32).reshape(8, 10)
        np.testing.assert_array_equal(unpack_rggb(pack_rggb(mosaic, "RGGB")), mosaic)
        self.assertEqual(pack_rggb(np.zeros((7, 9)), "RGGB").shape, (4, 3, 4))

    def test_unknown_patterns_are_refused_rather_than_guessed(self):
        with self.assertRaises(ValueError):
            pack_rggb(np.zeros((6, 6)), "GGRGGB")

    def test_black_and_white_levels_map_to_zero_and_one(self):
        out = normalise(np.array([500, 1000, 15000, 20000]), 1000, 15000)
        np.testing.assert_allclose(out, [0.0, 0.0, 1.0, 1.0], atol=1e-6)
        with self.assertRaises(ValueError):
            normalise(np.array([1]), 5, 5)


class Pairs(unittest.TestCase):
    def test_pairs_have_matching_shapes_and_noise_that_grows_with_iso(self):
        rng = np.random.default_rng(2)
        planes = rng.uniform(0.1, 0.5, size=(4, 200, 200)).astype(np.float32)
        pairs = make_pairs(planes, 12, 64, rng)
        self.assertEqual(len(pairs), 12)
        for pair in pairs:
            self.assertEqual(pair["noisy"].shape, pair["clean"].shape)
            self.assertEqual(pair["clean"].shape, (4, 64, 64))
        low = min(pairs, key=lambda p: p["iso"])
        high = max(pairs, key=lambda p: p["iso"])
        self.assertGreater(float((high["noisy"] - high["clean"]).std() / (high["clean"].mean() + 1e-6)),
                           float((low["noisy"] - low["clean"]).std() / (low["clean"].mean() + 1e-6)))

    def test_black_and_flat_crops_are_skipped_and_real_detail_is_kept(self):
        rng = np.random.default_rng(4)
        self.assertFalse(has_content(np.zeros((4, 64, 64), dtype=np.float32)))
        self.assertFalse(has_content(np.full((4, 64, 64), 0.5, dtype=np.float32)))
        textured = rng.uniform(0.1, 0.6, size=(4, 64, 64)).astype(np.float32)
        self.assertTrue(has_content(textured))
        self.assertEqual(make_pairs(np.zeros((4, 200, 200), dtype=np.float32), 5, 64, rng), [])

    def test_sensor_noise_on_a_flat_dark_field_is_not_mistaken_for_detail(self):
        # Like a linear RAW of clear sky: dim, flat, with the source frame's own ISO 100 noise on it.
        rng = np.random.default_rng(5)
        a, b = noise_params(100)
        sky = add_noise(np.full((4, 128, 128), 0.08, dtype=np.float32), a, b, rng)
        self.assertFalse(has_content(sky))
        # The same brightness with real structure (stripes of feather-like contrast) is kept.
        stripes = np.where((np.arange(128) // 6) % 2 == 0, 0.05, 0.11).astype(np.float32)
        feathers = add_noise(np.broadcast_to(stripes, (4, 128, 128)).copy(), a, b, rng)
        self.assertTrue(has_content(feathers))

    def test_a_crop_larger_than_the_image_is_refused(self):
        with self.assertRaises(ValueError):
            make_pairs(np.zeros((4, 10, 10), dtype=np.float32), 1, 64, np.random.default_rng(1))


if __name__ == "__main__":
    unittest.main()
