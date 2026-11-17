import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import tifffile

from compare_nikon_tiffs import compare


class CompareNikonTiffsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def write(self, name, pixels, profile=b"test-profile", orientation=1):
        file = self.root / name
        tags = [(274, "H", 1, orientation, False)]
        if profile:
            tags.append((34675, "B", len(profile), profile, False))
        tifffile.imwrite(file, pixels, photometric="rgb", extratags=tags)
        return file

    def test_rejects_self_comparison_including_aliases(self):
        pixels = np.zeros((4, 4, 3), dtype=np.uint16)
        reference = self.write("reference.tif", pixels)
        alias = self.root / "alias.tif"
        alias.symlink_to(reference)
        for candidate in (reference, alias):
            with self.subTest(candidate=candidate), self.assertRaisesRegex(ValueError, "same file"):
                compare(reference, candidate)

    def test_rejects_source_nef_aliasing_either_export(self):
        pixels = np.zeros((4, 4, 3), dtype=np.uint16)
        reference = self.write("reference.tif", pixels)
        candidate = self.write("candidate.tif", pixels)
        alias = self.root / "renamed-source.NEF"
        alias.symlink_to(candidate)
        for source in (reference, candidate, alias):
            with self.subTest(source=source), self.assertRaisesRegex(ValueError, "separate from both TIFF"):
                compare(reference, candidate, source_nef=source)

        script = Path(__file__).with_name("compare_nikon_tiffs.py")
        failure = subprocess.run(
            [sys.executable, script, reference, candidate, "--source-nef", alias],
            capture_output=True, text=True,
        )
        self.assertEqual(failure.returncode, 2)
        self.assertIn("separate from both TIFF", failure.stderr)
        self.assertFalse(failure.stdout)

    def test_reports_channel_error_and_changed_pixels(self):
        reference = np.full((65, 12, 3), 18000, dtype=np.uint16)
        candidate = reference.copy()
        candidate[64, 0, :] = [0, 18000, 65535]
        reference_file = self.write("reference.tif", reference)
        candidate_file = self.write("candidate.tif", candidate)
        result = compare(reference_file, candidate_file)
        self.assertEqual(result["reference_tiff_sha256"], hashlib.sha256(reference_file.read_bytes()).hexdigest())
        self.assertEqual(result["candidate_tiff_sha256"], hashlib.sha256(candidate_file.read_bytes()).hexdigest())
        self.assertEqual(result["icc_profile_sha256"], hashlib.sha256(b"test-profile").hexdigest())
        self.assertNotEqual(result["reference_tiff_sha256"], result["candidate_tiff_sha256"])
        self.assertFalse(result["byte_identical_exports"])
        self.assertEqual(result["changed_pixels"], 1)
        self.assertEqual(result["maximum_channel_error_rgb"], [18000, 0, 47535])
        self.assertEqual(result["width"], 12)
        self.assertEqual(result["height"], 65)

    def test_cli_fingerprints_optional_source_without_recording_path(self):
        pixels = np.zeros((12, 12, 3), dtype=np.uint16)
        reference = self.write("reference.tif", pixels)
        candidate = self.write("candidate.tif", pixels)
        source = self.root / "synthetic.NEF"
        source.write_bytes(b"synthetic original")
        script = Path(__file__).with_name("compare_nikon_tiffs.py")
        report = subprocess.check_output(
            [sys.executable, script, reference, candidate, "--source-nef", source],
            text=True,
        )
        self.assertEqual(json.loads(report)["source_nef_sha256"], hashlib.sha256(source.read_bytes()).hexdigest())
        self.assertNotIn(str(source), report)
        self.assertNotIn("source_nef_sha256", compare(reference, candidate))

    def test_cli_keeps_capture_and_renderer_details_with_the_pixel_results(self):
        pixels = np.zeros((4, 4, 3), dtype=np.uint16)
        reference = self.write("reference.tif", pixels)
        candidate = self.write("candidate.tif", pixels)
        source = self.root / "synthetic.NEF"
        source.write_bytes(b"synthetic original")
        script = Path(__file__).with_name("compare_nikon_tiffs.py")
        command = [sys.executable, script, reference, candidate, "--source-nef", source]
        for body, compression in [("Z8", "HE*"), ("Z5II", "HE"), ("Z5II", "lossless")]:
            with self.subTest(body=body, compression=compression):
                output = subprocess.check_output([
                    *command, "--body", body, "--firmware", "C 1.00", "--compression", compression,
                    "--nx-studio-build", "reference-test", "--candidate-build", "candidate-test",
                ], text=True)
                report = json.loads(output)
                self.assertEqual(report["reported_benchmark_details"], {
                    "body": body, "firmware": "C 1.00", "compression": compression,
                    "nx_studio_build": "reference-test", "candidate_build": "candidate-test",
                })
                self.assertEqual(report["changed_pixels"], 0)
                self.assertNotIn(str(self.root), output)

        incomplete = subprocess.run([*command, "--body", "Z8"], capture_output=True, text=True)
        self.assertEqual(incomplete.returncode, 2)
        self.assertIn("all five detail flags", incomplete.stderr)

    def test_reports_new_and_recovered_highlight_shadow_clipping_per_channel(self):
        reference = np.full((65, 2, 3), 32000, dtype=np.uint16)
        candidate = reference.copy()
        # Exercise the final 64-row strip boundary as well as the first strip.
        reference[0, 0, :] = [65535, 0, 65535]
        candidate[0, 0, :] = [32000, 32000, 0]
        reference[64, 1, :] = [32000, 32000, 0]
        candidate[64, 1, :] = [65535, 0, 32000]
        result = compare(
            self.write("reference-clipping.tif", reference),
            self.write("candidate-clipping.tif", candidate),
        )
        self.assertEqual(result["highlight_clipped_channels_added_rgb"], [1, 0, 0])
        self.assertEqual(result["highlight_clipped_channels_lost_rgb"], [1, 0, 1])
        self.assertEqual(result["shadow_clipped_channels_added_rgb"], [0, 1, 1])
        self.assertEqual(result["shadow_clipped_channels_lost_rgb"], [0, 1, 1])
        self.assertEqual(result["changed_pixels"], 2)

    def test_no_clipping_differences_for_identical_pixel_values(self):
        pixels = np.full((4, 4, 3), 65535, dtype=np.uint16)
        pixels[0, 0] = 0
        result = compare(
            self.write("reference-identical.tif", pixels),
            self.write("candidate-identical.tif", pixels),
        )
        self.assertTrue(result["byte_identical_exports"])
        for key in (
            "highlight_clipped_channels_added_rgb",
            "highlight_clipped_channels_lost_rgb",
            "shadow_clipped_channels_added_rgb",
            "shadow_clipped_channels_lost_rgb",
        ):
            self.assertEqual(result[key], [0, 0, 0])

    def test_rejects_compressed_or_tiled_tiffs(self):
        pixels = np.zeros((32, 32, 3), dtype=np.uint16)
        reference = self.write("reference.tif", pixels)
        for name, options in [
            ("compressed.tif", {"compression": "deflate"}),
            ("tiled.tif", {"tile": (16, 16)}),
        ]:
            candidate = self.root / name
            tifffile.imwrite(candidate, pixels, photometric="rgb", extratags=[(34675, "B", 12, b"test-profile", False)], **options)
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "uncompressed, non-tiled"):
                compare(reference, candidate)

    def test_rejects_unmatched_profile_size_orientation_and_depth(self):
        pixels = np.zeros((12, 12, 3), dtype=np.uint16)
        reference = self.write("reference.tif", pixels)
        for candidate, message in [
            (self.write("missing.tif", pixels, b""), "embedded ICC"),
            (self.write("profile.tif", pixels, b"another"), "profiles differ"),
            (self.write("size.tif", pixels[:8]), "dimensions differ"),
            (self.write("orientation.tif", pixels, orientation=6), "top-left orientation"),
            (self.write("depth.tif", pixels.astype(np.uint8)), "16-bit RGB"),
        ]:
            with self.subTest(file=candidate), self.assertRaisesRegex(ValueError, message):
                compare(reference, candidate)


if __name__ == "__main__":
    unittest.main()
