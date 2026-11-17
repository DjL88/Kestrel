"""Tests for the catalogue-to-model pipeline. Run with:

    python -m unittest discover -s tools/denoise-training -p "test_*.py"

Needs numpy only; the training tests also need torch (and onnxruntime for the export check) and are skipped without.
No real photos are used: a fake Lightroom catalogue and a stand-in raw_dump that writes synthetic sensor data.
"""
import csv
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import textwrap
import types
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
import build_dataset  # noqa: E402
import calibrate_noise  # noqa: E402
import index_photos  # noqa: E402
import raw_source  # noqa: E402
from make_pairs import pack_rggb, unpack_rggb  # noqa: E402
from noise_model import NoiseProfile, add_noise, noise_params  # noqa: E402

try:
    import torch  # noqa: F401
    HAVE_TORCH = True
except ImportError:
    HAVE_TORCH = False


def make_catalogue(path: Path, root: str, rows: list[dict]) -> None:
    """A catalogue with the subset of Lightroom Classic's schema that index_photos reads."""
    db = sqlite3.connect(path)
    db.executescript("""
        CREATE TABLE AgLibraryRootFolder (id_local INTEGER PRIMARY KEY, absolutePath TEXT, name TEXT);
        CREATE TABLE AgLibraryFolder (id_local INTEGER PRIMARY KEY, pathFromRoot TEXT, rootFolder INTEGER);
        CREATE TABLE AgLibraryFile (id_local INTEGER PRIMARY KEY, baseName TEXT, extension TEXT, folder INTEGER);
        CREATE TABLE Adobe_images (id_local INTEGER PRIMARY KEY, rootFile INTEGER, pick REAL, rating REAL,
                                   masterImage INTEGER, fileFormat TEXT);
        CREATE TABLE AgInternedExifCameraModel (id_local INTEGER PRIMARY KEY, value TEXT);
        CREATE TABLE AgHarvestedExifMetadata (id_local INTEGER PRIMARY KEY, image INTEGER, isoSpeedRating REAL,
                                              cameraModelRef INTEGER);
        CREATE TABLE Adobe_imageDevelopSettings (id_local INTEGER PRIMARY KEY, image INTEGER, text TEXT);
    """)
    db.execute("INSERT INTO AgLibraryRootFolder VALUES (1, ?, 'Photos')", (root,))
    db.execute("INSERT INTO AgLibraryFolder VALUES (1, '2026/birds/', 1)")
    db.execute("INSERT INTO AgInternedExifCameraModel VALUES (1, 'NIKON Z 8')")
    for i, row in enumerate(rows, start=1):
        db.execute("INSERT INTO AgLibraryFile VALUES (?, ?, ?, 1)", (i, row["base"], row["ext"]))
        db.execute("INSERT INTO Adobe_images VALUES (?, ?, ?, ?, ?, 'RAW')",
                   (i, i if not row.get("copy_of") else row["copy_of"], row.get("pick", 0), row.get("rating", 0),
                    row.get("copy_of")))
        db.execute("INSERT INTO AgHarvestedExifMetadata VALUES (?, ?, ?, 1)", (i, i, row.get("iso")))
        if "develop" in row:
            db.execute("INSERT INTO Adobe_imageDevelopSettings VALUES (?, ?, ?)", (i, i, row["develop"]))
    db.commit()
    db.close()


class Catalogue(unittest.TestCase):
    def test_reads_raws_with_iso_flags_and_noise_reduction_and_leaves_the_catalogue_untouched(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            photos = tmp / "Photos" / "2026" / "birds"
            photos.mkdir(parents=True)
            for name in ("kite.NEF", "owl.NEF", "wren.CR3"):
                (photos / name).write_bytes(b"x")
            catalogue = tmp / "Lightroom" / "Lightroom Catalog-v13.lrcat"
            catalogue.parent.mkdir()
            root = str(tmp / "Photos").replace("\\", "/") + "/"
            make_catalogue(catalogue, root, [
                {"base": "kite", "ext": "NEF", "iso": 200, "pick": 1, "rating": 4,
                 "develop": "s = { LuminanceSmoothing = 10, ColorNoiseReduction = 25, }"},
                {"base": "owl", "ext": "NEF", "iso": 12800, "pick": -1,
                 "develop": "s = { LuminanceSmoothing = 40, ColorNoiseReduction = 25, }"},
                {"base": "wren", "ext": "CR3", "iso": 12000},
                {"base": "gone", "ext": "NEF", "iso": 100},           # listed but deleted from disk
                {"base": "kite", "ext": "jpg", "iso": 200},           # not a RAW
                {"base": "kite", "ext": "NEF", "iso": 200, "copy_of": 1},  # virtual copy
            ])
            before = catalogue.read_bytes()
            (tmp / "Photos" / "extra.ARW").write_bytes(b"not really a raw")

            out = tmp / "work" / "photos.csv"
            argv = ["index_photos.py", "--lightroom", str(catalogue.parent), "--folder", str(tmp / "Photos"),
                    "--out", str(out)]
            with mock.patch.object(sys, "argv", argv):
                self.assertEqual(index_photos.main(), 0)
            self.assertEqual(catalogue.read_bytes(), before)
            with open(out, newline="") as handle:
                rows = {Path(r["path"]).name: r for r in csv.DictReader(handle)}
            self.assertEqual(sorted(rows), ["extra.ARW", "kite.NEF", "owl.NEF", "wren.CR3"])
            self.assertEqual(rows["kite.NEF"]["iso"], "200")
            self.assertEqual(rows["kite.NEF"]["camera"], "NIKON Z 8")
            self.assertEqual(rows["owl.NEF"]["pick"], "-1")
            self.assertEqual(rows["owl.NEF"]["lr_luminance_nr"], "40")
            self.assertEqual(rows["extra.ARW"]["source"], "folder")
            self.assertEqual(rows["extra.ARW"]["iso"], "")
            summary = json.loads((out.parent / "lightroom-nr.json").read_text())
            self.assertEqual([s["iso"] for s in summary], [200, 12800])
            self.assertEqual(summary[1]["median_luminance_nr"], 40)

    def test_develop_values_and_newest_catalogue(self):
        self.assertEqual(index_photos.develop_value("a = { LuminanceSmoothing = 33, }", "LuminanceSmoothing"), 33)
        self.assertIsNone(index_photos.develop_value("a = {}", "LuminanceSmoothing"))
        self.assertIsNone(index_photos.develop_value(None, "LuminanceSmoothing"))
        with tempfile.TemporaryDirectory() as tmp:
            old, new = Path(tmp) / "old.lrcat", Path(tmp) / "new.lrcat"
            old.write_text("")
            new.write_text("")
            os.utime(old, (1, 1))
            self.assertEqual(index_photos.find_catalogue(Path(tmp)), new)
            with self.assertRaises(FileNotFoundError):
                index_photos.find_catalogue(Path(tmp) / "nothing-here")


class Reading(unittest.TestCase):
    def test_libraw_patterns_map_to_bayer_names(self):
        self.assertEqual(raw_source.pattern_name(np.array([[0, 1], [3, 2]]), b"RGBG"), "RGGB")
        self.assertEqual(raw_source.pattern_name(np.array([[1, 0], [2, 3]]), b"RGBG"), "GRBG")
        with self.assertRaises(raw_source.UnsupportedRaw):
            raw_source.pattern_name(np.zeros((6, 6), dtype=int), b"RGBG")  # X-Trans

    def test_black_is_subtracted_per_site_and_clipping_is_optional(self):
        mosaic = np.array([[110, 220], [230, 140]], dtype=np.uint16)
        black = np.array([[100, 200], [200, 100]], dtype=np.float32)
        clipped = raw_source.normalise_per_site(mosaic, black, 1200, clip=True)
        np.testing.assert_allclose(clipped, [[0.01, 0.02], [0.03, 0.04]], atol=1e-6)
        low = raw_source.normalise_per_site(np.array([[90, 200], [200, 100]]), black, 1200, clip=False)
        self.assertLess(low[0, 0], 0)

    def test_rawpy_reader_packs_the_visible_mosaic(self):
        mosaic = np.full((8, 8), 600, dtype=np.uint16)
        mosaic[0::2, 0::2] = 1600  # red sites (pattern GRBG puts red at row 0, column 1 -> check alignment)
        fake = mock.MagicMock()
        fake.__enter__.return_value = fake
        fake.num_colors = 3
        fake.raw_image_visible = mosaic
        fake.raw_pattern = np.array([[0, 1], [3, 2]])
        fake.color_desc = b"RGBG"
        fake.black_level_per_channel = [600, 600, 600, 600]
        fake.white_level = 2600
        module = types.SimpleNamespace(imread=lambda path: fake)
        with mock.patch.dict(sys.modules, {"rawpy": module}):
            planes = raw_source.read_planes(Path("x.nef"))
        self.assertEqual(planes.shape, (4, 4, 4))
        np.testing.assert_allclose(planes[0], 0.5)
        np.testing.assert_allclose(planes[1:], 0.0)


class Calibration(unittest.TestCase):
    def test_measures_known_noise_from_a_textured_picture(self):
        rng = np.random.default_rng(1)
        y, x = np.mgrid[0:900, 0:1200] / 600
        scene = 0.02 + 0.6 * (x / 2) ** 2 * (0.5 + 0.5 * np.sin(y * 3))
        scene[300:500, 300:700] += 0.2 * (np.sin(x[300:500, 300:700] * 300) > 0)
        a, b = noise_params(6400)
        planes = np.stack([add_noise(scene * gain, a, b, rng) for gain in (0.5, 1, 1, 0.7)])
        ea, eb, used = calibrate_noise.estimate_noise(planes)
        self.assertAlmostEqual(ea / a, 1, delta=0.1)
        self.assertAlmostEqual(eb / b, 1, delta=0.2)
        self.assertGreater(used, 1000)

    def test_profile_interpolates_measured_cameras_and_falls_back_otherwise(self):
        points = [{"iso": iso, "a": 1e-5 * iso / 100, "b": 2e-4 * (iso / 100) ** 0.5} for iso in (1600, 6400, 25600)]
        profile = NoiseProfile({"NIKON Z 8": {"points": points}})
        a, b = profile.params("NIKON Z 8", 3200)
        self.assertAlmostEqual(a, 3.2e-4, delta=1e-6)
        self.assertAlmostEqual(b, 2e-4 * 32 ** 0.5, delta=1e-6)
        self.assertTrue(profile.measured("NIKON Z 8"))
        self.assertEqual(profile.params("Other", 800), noise_params(800))
        single = NoiseProfile({"Cam": {"points": [{"iso": 3200, "a": 1e-3, "b": 1e-3}]}})
        self.assertAlmostEqual(single.params("Cam", 6400)[0], 2e-3, delta=1e-9)
        self.assertEqual(NoiseProfile.load(None).cameras, {})

    def test_chooses_a_few_photos_per_camera_and_stop(self):
        rows = [{"camera": "A", "iso": str(iso), "path": f"{iso}-{i}"} for iso in (200, 3200, 6400) for i in range(10)]
        rows.append({"camera": "", "iso": "6400", "path": "no-camera"})
        chosen = calibrate_noise.choose(rows, 1600, 3)
        self.assertEqual(len(chosen), 6)
        self.assertTrue(all(int(r["iso"]) >= 1600 and r["camera"] for r in chosen))


FAKE_RAW_DUMP = textwrap.dedent("""
    import json, sys
    from pathlib import Path
    import numpy as np
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    if b"broken" in src.read_bytes():
        sys.exit("cannot decode")
    rng = np.random.default_rng(len(src.name))
    y, x = np.mgrid[0:700, 0:900]
    scene = 0.3 + 0.25 * np.sin(x / 7.0) * np.cos(y / 11.0) + 0.1 * rng.random((700, 900))
    raw = (512 + scene * (16383 - 512)).astype("<u2")
    raw.tofile(out / (src.stem + ".u16"))
    meta = {"name": src.stem, "make": "Test", "model": "Cam", "width": 900, "height": 700, "cpp": 1, "cfa": "RGGB",
            "cfa_width": 2, "cfa_height": 2, "black": [512, 512, 512, 512], "white": [16383], "iso": 100}
    (out / (src.stem + ".json")).write_text(json.dumps(meta))
""")


class Dataset(unittest.TestCase):
    def test_selection_rules(self):
        rows = [{"path": "a", "iso": "100", "pick": "1", "rating": "3"},
                {"path": "b", "iso": "100", "pick": "-1", "rating": "5"},
                {"path": "c", "iso": "3200", "pick": "0", "rating": "0"},
                {"path": "d", "iso": "", "pick": "0", "rating": "0"},
                {"path": "e", "iso": "400", "pick": "0", "rating": "1"}]
        pick = lambda **kw: [r["path"] for r in build_dataset.select(rows, **kw)]  # noqa: E731
        base = dict(max_iso=400, min_rating=0, allow_unknown_iso=False, picks_only=False)
        self.assertEqual(pick(**base), ["a", "e"])
        self.assertEqual(pick(**{**base, "allow_unknown_iso": True}), ["a", "d", "e"])
        self.assertEqual(pick(**{**base, "min_rating": 2}), ["a"])
        self.assertEqual(pick(**{**base, "picks_only": True}), ["a"])

    def test_validation_split_is_stable_and_small(self):
        names = [f"C:/Photos/DSC_{i:04d}.NEF" for i in range(2000)]
        share = sum(build_dataset.is_validation(n) for n in names) / len(names)
        self.assertGreater(share, 0.02)
        self.assertLess(share, 0.09)
        self.assertEqual(build_dataset.is_validation(names[5]), build_dataset.is_validation(names[5].lower()))

    def test_binning_halves_size_and_clipped_crops_are_refused(self):
        planes = np.arange(4 * 8 * 8, dtype=np.float32).reshape(4, 8, 8)
        self.assertEqual(build_dataset.bin2(planes).shape, (4, 4, 4))
        self.assertAlmostEqual(float(build_dataset.bin2(planes)[0, 0, 0]), (0 + 1 + 8 + 9) / 4)
        rng = np.random.default_rng(1)
        blown = np.ones((4, 64, 64), dtype=np.float32)
        self.assertEqual(build_dataset.crops_from(blown, 3, 32, rng), [])

    def test_end_to_end_from_catalogue_rows_to_crops_and_a_resumable_log(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            fake = tmp / "raw_dump.py"
            fake.write_text(FAKE_RAW_DUMP)
            if os.name == "nt":
                tool = tmp / "raw_dump.cmd"
                tool.write_text(f'@"{sys.executable}" "{fake}" %*\n')
            else:
                tool = tmp / "raw_dump"
                tool.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{fake}" "$@"\n')
                tool.chmod(0o755)
            for name, body in (("a.NEF", b"ok"), ("bb.NEF", b"ok"), ("bad.NEF", b"broken")):
                (tmp / name).write_bytes(body)
            photos = tmp / "photos.csv"
            with open(photos, "w", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=index_photos.FIELDS)
                writer.writeheader()
                for name in ("a.NEF", "bb.NEF", "bad.NEF"):
                    writer.writerow({"path": str(tmp / name), "camera": "Cam", "iso": 100, "pick": 0, "rating": 0,
                                     "lr_luminance_nr": "", "lr_colour_nr": "", "source": "lightroom"})
            crops = tmp / "crops"
            cmd = [sys.executable, str(HERE / "build_dataset.py"), str(photos), str(crops), "--crops", "3",
                   "--size", "96", "--workers", "1", "--raw-dump", str(tool)]
            first = subprocess.run(cmd, capture_output=True, text=True)
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertIn("skipped bad.NEF", first.stdout)
            files = sorted(crops.rglob("*.npz"))
            self.assertEqual(len(files), 6)
            data = np.load(files[0])
            self.assertEqual(data["clean"].dtype, np.float16)
            self.assertEqual(data["clean"].shape, (4, 96, 96))
            self.assertEqual(str(data["camera"]), "Cam")
            self.assertTrue(0 <= float(data["clean"].min()) and float(data["clean"].max()) <= 1)
            again = subprocess.run(cmd, capture_output=True, text=True)
            self.assertIn("3 done before, 0 to do", again.stdout)
            self.assertEqual(len(list(crops.rglob("*.npz"))), 6)


@unittest.skipUnless(HAVE_TORCH, "torch not installed")
class Training(unittest.TestCase):
    def test_bayer_flips_match_flipping_the_sensor(self):
        import train
        rng = np.random.default_rng(2)
        mosaic = rng.random((12, 16)).astype(np.float32)
        planes = pack_rggb(mosaic, "RGGB")
        flipped = train.flip_bayer(planes, True, False)
        # Flipping the mosaic left-right and dropping the first and last columns keeps an RGGB layout.
        expected = pack_rggb(np.ascontiguousarray(mosaic[:, ::-1][:, 1:-1]), "RGGB")
        np.testing.assert_array_equal(flipped, expected)
        both = train.flip_bayer(planes, True, True)
        np.testing.assert_array_equal(both, pack_rggb(np.ascontiguousarray(mosaic[::-1, ::-1][1:-1, 1:-1]), "RGGB"))
        np.testing.assert_array_equal(unpack_rggb(train.flip_bayer(planes, False, False)), mosaic)

    def test_untrained_network_changes_little_and_short_training_helps(self):
        import torch
        import train
        torch.manual_seed(0)
        model = train.BayerUNet(width=8)
        x = torch.rand(2, 8, 32, 48)
        torch.testing.assert_close(model(x), x[:, :4], atol=0.01, rtol=0)

        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            rng = np.random.default_rng(3)
            for part, count in (("train", 12), ("val", 3)):
                (tmp / "crops" / part).mkdir(parents=True)
                for i in range(count):
                    y, x2 = np.mgrid[0:80, 0:80]
                    smooth = 0.3 + 0.2 * np.sin(x2 / (4 + i)) * np.cos(y / 6) + rng.uniform(-0.05, 0.05)
                    clean = np.stack([smooth * g for g in (0.6, 1, 1, 0.8)]).astype(np.float16)
                    np.savez(tmp / "crops" / part / f"c{i}.npz", clean=clean, camera="Cam", iso=100.0, binned=False)
            argv = ["train.py", str(tmp / "crops"), str(tmp / "model"), "--epochs", "3", "--steps", "800",
                    "--batch", "8", "--patch", "48", "--width", "8", "--workers", "0", "--device", "cpu",
                    "--iso-min", "6400", "--iso-max", "12800", "--lr", "2e-3"]
            with mock.patch.object(sys, "argv", argv):
                self.assertEqual(train.main(), 0)
            card = json.loads((tmp / "model" / "denoise.json").read_text())
            for iso, score in card["validation"].items():
                self.assertGreater(score["denoised_psnr"], score["noisy_psnr"], f"ISO {iso}")
            self.assertTrue((tmp / "model" / "denoise.onnx").exists())
            self.assertEqual(len(card["sha256"]), 64)
            # Running again continues rather than starting over.
            with mock.patch.object(sys, "argv", argv[:4] + ["4"] + argv[5:]):
                self.assertEqual(train.main(), 0)
            state = torch.load(tmp / "model" / "last.pt", weights_only=False)
            self.assertEqual(state["epoch"], 4)

    def test_tiled_inference_covers_the_whole_frame_exactly_once(self):
        import try_model
        planes = np.random.default_rng(1).random((4, 300, 530)).astype(np.float32)
        out = try_model.denoise(lambda x: x[:, :4], planes, 1e-4, 1e-4, tile=128, overlap=16)
        np.testing.assert_allclose(out, planes, atol=1e-5)


if __name__ == "__main__":
    unittest.main()
