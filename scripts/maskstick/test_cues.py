import unittest

try:
    import numpy as np
    import scipy  # noqa: F401
except ImportError as e:
    raise unittest.SkipTest(f"the cue tests need numpy and scipy: {e}")

from . import afpoints as AF
from . import metrics as M
from . import score as S
from . import synth
from .matte.pipeline import matte
from .matte.regions import TONAL_EDGES, brightness, edge_adherence, tonal_colour_zones, zone_share

Z8 = {"AFImageWidth": 8256, "AFImageHeight": 5504, "AFAreaXPosition": 2064, "AFAreaYPosition": 1376, "AFAreaWidth": 400,
      "AFAreaHeight": 300, "AFCoordinatesAvailable": "Yes", "AFAreaMode": "Single", "FocusMode": "AF-C", "FocusResult": "Focus",
      "SubjectDetection": "Birds", "Orientation": "Horizontal (normal)", "Model": "NIKON Z 8"}


class AfTests(unittest.TestCase):
    def test_orientation_matches_the_apps_own_tests(self):
        box = {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.1}
        close = lambda a, b: all(abs(a[k] - b[k]) < 1e-9 for k in b)  # noqa: E731
        self.assertTrue(close(AF.orient_area(box, 6), {"x": 0.7, "y": 0.1, "width": 0.1, "height": 0.3}))
        self.assertTrue(close(AF.orient_area(box, 8), {"x": 0.2, "y": 0.6, "width": 0.1, "height": 0.3}))
        self.assertTrue(close(AF.orient_area(box, 3), {"x": 0.6, "y": 0.7, "width": 0.3, "height": 0.1}))
        self.assertTrue(close(AF.orient_area(box, 1), box))
        for code in range(1, 9):
            t = AF.orient_area(box, code)
            self.assertTrue(t["x"] >= 0 and t["y"] >= 0 and t["x"] + t["width"] <= 1.0001 and t["y"] + t["height"] <= 1.0001)
            self.assertAlmostEqual(t["width"] * t["height"], 0.03)
        self.assertEqual(AF.orientation_code("Rotate 90 CW"), 6)
        self.assertEqual(AF.orientation_code(None), 1)
        self.assertIsNone(AF.orientation_code("Sideways, probably"))

    def test_good_record_is_usable_and_the_box_is_a_fraction_of_the_frame(self):
        r = AF.parse(Z8)
        self.assertTrue(r["usable"])
        self.assertAlmostEqual(r["area"]["x"], (2064 - 200) / 8256)
        self.assertAlmostEqual(r["area"]["height"], 300 / 5504)

    def test_unusable_records_say_why(self):
        self.assertEqual(AF.parse({**Z8, "FocusMode": "Manual"})["usable_reason"], "manual-focus")
        self.assertEqual(AF.parse({**Z8, "FocusResult": "Out of Focus"})["usable_reason"], "camera-says-out-of-focus")
        self.assertEqual(AF.parse({**Z8, "AFCoordinatesAvailable": "No"})["usable_reason"], "no-coordinates")
        self.assertEqual(AF.parse({**Z8, "AFAreaXPosition": 99999})["usable_reason"], "outside-frame")
        self.assertEqual(AF.parse({**Z8, "Orientation": "nonsense"})["usable_reason"], "unreadable-orientation")
        self.assertFalse(AF.parse({})["usable"])

    def test_a_sideways_preview_is_refused_not_misplaced(self):
        r = AF.parse({**Z8, "Orientation": "Rotate 270 CW"})
        self.assertTrue(r["usable"])
        area, why = AF.area_for_preview(r, 1024, 683)  # a landscape preview of a portrait file
        self.assertIsNone(area)
        self.assertEqual(why, "preview-orientation-mismatch")
        area, why = AF.area_for_preview(r, 683, 1024)
        self.assertEqual(why, "ok")
        self.assertIsNone(AF.area_for_preview(AF.parse({**Z8, "FocusMode": "Manual"}), 1024, 683)[0])

    def test_box_stats_on_a_mask(self):
        mask = np.zeros((100, 200), bool)
        mask[:, :100] = True
        on = AF.box_stats({"x": 0.2, "y": 0.4, "width": 0.1, "height": 0.1}, mask)
        off = AF.box_stats({"x": 0.7, "y": 0.4, "width": 0.1, "height": 0.1}, mask)
        self.assertTrue(on["centre_inside"] and on["share_inside"] == 1.0)
        self.assertFalse(off["centre_inside"] or off["share_inside"] > 0)

    def test_af_on_subject_rate_from_fixed_masks(self):
        gt = np.zeros((100, 200), np.uint8)
        gt[20:80, 20:100] = 255
        truth = {"a": {"gt": gt, "meta": {}}, "b": {"gt": gt, "meta": {}}, "c": {"gt": gt, "meta": {}}}
        af = {"a": {"usable": True, "usable_reason": "ok", "area": {"x": 0.25, "y": 0.4, "width": 0.05, "height": 0.1}},
              "b": {"usable": True, "usable_reason": "ok", "area": {"x": 0.8, "y": 0.4, "width": 0.05, "height": 0.1}},
              "c": {"usable": False, "usable_reason": "manual-focus"}}
        rate = S.af_on_subject(truth, af)
        self.assertEqual(rate["n"], 2)
        self.assertEqual(rate["centre_inside"], 0.5)
        self.assertEqual(rate["unusable"], {"manual-focus": 1})


class ZoneTests(unittest.TestCase):
    def test_zones_use_the_editors_tonal_boundaries(self):
        self.assertEqual(TONAL_EDGES, (0.12, 0.35, 0.65, 0.88))  # TONAL_PRESETS in src/core/maskTypes.ts
        grey = np.linspace(0, 1, 100, dtype=np.float32)[None, :, None].repeat(3, 2).repeat(10, 0)
        self.assertAlmostEqual(float(brightness(grey)[0, 50]), float(grey[0, 50, 0]), places=3)

    def test_a_hard_tonal_edge_becomes_a_zone_boundary(self):
        img = np.full((80, 120, 3), 0.2, np.float32)
        img[:, 60:] = 0.8
        zones, n = tonal_colour_zones(img)
        self.assertGreaterEqual(n, 2)
        self.assertNotEqual(zones[40, 10], zones[40, 110])
        edge = np.zeros((80, 120), bool)
        edge[:, 59] = True
        self.assertEqual(edge_adherence(zones, edge, 2.0), 1.0)

    def test_small_fragments_are_folded_in_and_zone_share_votes(self):
        img = np.full((80, 120, 3), 0.5, np.float32)
        img[40, 60] = 0.95  # a single hot pixel must not make a zone of its own
        zones, n = tonal_colour_zones(img, min_area=20)
        self.assertEqual(n, 1)
        region = np.zeros((80, 120), bool)
        region[:, :30] = True
        two, _ = tonal_colour_zones(np.concatenate([np.full((80, 30, 3), 0.2, np.float32), np.full((80, 90, 3), 0.8, np.float32)], axis=1))
        share = zone_share(two, region)
        # the two flat areas vote 1 and 0; the thin transition strip between them (blurred through the middle tones) is in between
        self.assertEqual((float(share.max()), float(share.min())), (1.0, 0.0))
        self.assertEqual(float(share[two[40, 5]]), 1.0)
        self.assertEqual(float(share[two[40, 100]]), 0.0)


class CueTests(unittest.TestCase):
    def test_af_box_picks_the_subject_when_a_bigger_sharp_object_is_in_the_frame(self):
        s = synth.make_scene(301, size=(384, 576), bg_blur=6, colour_gap=0.35, distractor=True)
        self.assertIsNotNone(s.af)
        gt = synth.ground_truth_from_alpha(s.alpha)
        plain = matte(s.image)
        guided = matte(s.image, af_box=s.af)
        self.assertEqual(guided.trimap.stats["af"], "on-seed")
        self.assertGreater(M.score_pair(guided.alpha, gt)["iou"], M.score_pair(plain.alpha, gt)["iou"] + 0.2)

    def test_an_af_box_far_from_anything_sharp_is_ignored_and_says_so(self):
        s = synth.make_scene(301, size=(384, 576), bg_blur=6, colour_gap=0.35)
        far = matte(s.image, af_box=(0.0, 0.0, 20.0, 20.0))
        base = matte(s.image)
        self.assertEqual(far.trimap.stats["af"], "missed")
        self.assertTrue(np.array_equal(far.trimap.seed, base.trimap.seed))

    def test_zones_narrow_the_band(self):
        s = synth.make_scene(302, size=(384, 576), bg_blur=6, colour_gap=0.35)
        plain, zoned = matte(s.image), matte(s.image, use_zones=True)
        self.assertLessEqual(zoned.trimap.stats["band_share"], plain.trimap.stats["band_share"])


if __name__ == "__main__":
    unittest.main()
