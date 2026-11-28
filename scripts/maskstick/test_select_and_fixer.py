import io
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

try:
    import numpy as np
    import scipy  # noqa: F401
    from PIL import Image
except ImportError as e:
    raise unittest.SkipTest(f"needs numpy, scipy and pillow: {e}")

from http.server import ThreadingHTTPServer

from . import fixer, select_heldout as H


def cand(i, trip, group="tele", easy=True, t=None):
    return {"key": f"k{i:03d}", "trip": trip, "lens_group": group, "likely_defocused": easy, "time": t}


class SelectTests(unittest.TestCase):
    def test_lens_groups(self):
        self.assertEqual(H.lens_group("NIKKOR Z 100-400mm f/4.5-5.6 VR S Z TC-2.0x"), "tele")
        self.assertEqual(H.lens_group("NIKKOR Z MC 105mm f/2.8 VR S"), "macro")
        self.assertEqual(H.lens_group("NIKKOR Z 24-120mm f/4 S"), "zoom")
        self.assertEqual(H.lens_group(None), "other")

    def test_choose_is_deterministic_and_respects_limits(self):
        cands = [cand(i, f"trip{i % 5}", ("tele", "macro", "zoom")[i % 3], easy=i % 3 != 0, t=1000.0 * i) for i in range(120)]
        a = H.choose([dict(c) for c in cands], 30)
        b = H.choose([dict(c) for c in reversed(cands)], 30)
        self.assertEqual(sorted(c["key"] for c in a), sorted(c["key"] for c in b))
        self.assertEqual(len(a), 15)  # 5 trips x at most 3 each
        trips = [c["trip"] for c in a]
        self.assertTrue(all(trips.count(t) <= H.MAX_PER_TRIP for t in set(trips)))

    def test_bursts_within_two_minutes_count_once(self):
        cands = [cand(i, f"trip{i}", t=1000.0 + i) for i in range(10)]  # ten frames within ten seconds
        self.assertEqual(len(H.choose(cands, 10)), 1)

    def test_mix_of_easy_and_hard(self):
        cands = [cand(i, f"trip{i}", easy=i % 2 == 0, t=1000.0 * i) for i in range(60)]
        chosen = H.choose(cands, 30)
        easy = sum(c["likely_defocused"] for c in chosen)
        self.assertEqual(easy, 20)
        order = H.interleave(chosen)
        self.assertEqual(len(order), 30)
        self.assertLessEqual(sum(c["likely_defocused"] for c in order[:9]), 6)  # two easy then one hard, repeated


class FixerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        r = self.tmp.name
        self.previews = os.path.join(r, "previews")
        os.makedirs(self.previews)
        self.key = "a" * 20 + "_" + "b" * 20
        Image.fromarray(np.full((40, 60, 3), 90, np.uint8)).save(os.path.join(self.previews, self.key + "_raw.jpg"))
        os.makedirs(os.path.join(r, "p1"))
        Image.fromarray(np.full((40, 60), 255, np.uint8)).save(os.path.join(r, "p1", self.key + ".png"))
        manifest = os.path.join(r, "m.json")
        with open(manifest, "w") as f:
            json.dump({"previews": self.previews, "suffix": "_raw", "photos": [{"key": self.key}]}, f)
        self.state = fixer.State(manifest, {"p1": os.path.join(r, "p1")}, os.path.join(r, "gt"))
        page = b"<html></html>"
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), fixer.handler(self.state, page))
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def url(self, path):
        return f"http://127.0.0.1:{self.port}{path}"

    def test_start_source_is_stable_and_spread(self):
        sources = ["shipped", "matte"]
        picks = [fixer.pick_start(f"k{i}", sources) for i in range(200)]
        self.assertEqual(picks, [fixer.pick_start(f"k{i}", sources) for i in range(200)])
        self.assertTrue(80 < picks.count("shipped") < 120)
        self.assertIsNone(fixer.pick_start("x", []))

    def test_serves_only_listed_photos(self):
        self.assertEqual(urllib.request.urlopen(self.url("/photo/" + self.key)).status, 200)
        with self.assertRaises(urllib.error.HTTPError) as cm:
            urllib.request.urlopen(self.url("/photo/..%2f..%2fetc%2fpasswd"))
        self.assertEqual(cm.exception.code, 404)
        with self.assertRaises(urllib.error.HTTPError):
            urllib.request.urlopen(self.url("/photo/not-in-the-manifest"))

    def test_save_writes_three_level_mask_and_meta(self):
        grey = np.zeros((40, 60, 4), np.uint8)
        grey[..., 3] = 255
        grey[:, :20, :3] = 255
        grey[:, 20:30, :3] = 128
        grey[:, 30:40, :3] = 140   # near-grey still counts as "can't tell"
        buf = io.BytesIO()
        Image.fromarray(grey, "RGBA").save(buf, "PNG")
        req = urllib.request.Request(self.url(f"/save/{self.key}?status=ok&seconds=12.5&strokes=3"), data=buf.getvalue(), method="POST")
        self.assertEqual(urllib.request.urlopen(req).status, 200)
        saved = np.asarray(Image.open(os.path.join(self.state.gt_dir, self.key + ".png")))
        self.assertEqual(sorted(np.unique(saved).tolist()), [0, 128, 255])
        meta = json.load(open(os.path.join(self.state.gt_dir, self.key + ".json")))
        self.assertEqual((meta["status"], meta["start_source"], meta["seconds"], meta["strokes"]), ("ok", "p1", 12.5, 3))
        self.assertTrue(json.loads(urllib.request.urlopen(self.url("/api/queue")).read())[0]["done"])

    def test_wrong_size_or_unknown_key_is_refused(self):
        buf = io.BytesIO()
        Image.fromarray(np.zeros((10, 10, 4), np.uint8)).save(buf, "PNG")
        for path in (f"/save/{self.key}?status=ok", "/save/other?status=ok"):
            with self.assertRaises(urllib.error.HTTPError) as cm:
                urllib.request.urlopen(urllib.request.Request(self.url(path), data=buf.getvalue(), method="POST"))
            self.assertEqual(cm.exception.code, 400)


if __name__ == "__main__":
    unittest.main()
