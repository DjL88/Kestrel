import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class SummariseNikonCoverageTests(unittest.TestCase):
    def test_coverage_keeps_firmware_builds_and_compression_separate(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = {
                "source_nef_sha256": "a" * 64,
                "reference_tiff_sha256": "b" * 64,
                "candidate_tiff_sha256": "c" * 64,
                "icc_profile_sha256": "d" * 64,
                "reported_benchmark_details": {
                    "body": "Z8", "firmware": "C 3.10", "compression": "HE*",
                    "nx_studio_build": "nx-test", "candidate_build": "sdk-test",
                },
            }
            paths = []
            for index, override in enumerate(({}, {}, {"candidate_build": "other"}, {"firmware": "C 2.00"})):
                path = root / f"{index}.json"
                details = {**report["reported_benchmark_details"], **override}
                path.write_text(json.dumps({**report, "reported_benchmark_details": details}), encoding="utf-8")
                paths.append(path)
            legacy = root / "legacy.json"
            legacy.write_text("{}", encoding="utf-8")
            script = Path(__file__).with_name("summarise_nikon_coverage.py")
            output = subprocess.check_output([
                sys.executable, script, *paths, legacy,
                "--z8-firmware", "C 3.10", "--z5ii-firmware", "C 1.00",
                "--nx-studio-build", "nx-test", "--candidate-build", "sdk-test",
            ], text=True)
            summary = json.loads(output)
            self.assertEqual(summary["ignored_reports"], 3)
            self.assertEqual(len(summary["coverage"]), 6)
            self.assertEqual(
                [row for row in summary["coverage"] if row["compared_samples"]],
                [{"body": "Z8", "firmware": "C 3.10", "compression": "HE*", "compared_samples": 1}],
            )
            self.assertNotIn(directory, output)


    def test_invalid_hash_and_unknown_compression_never_count_as_verified(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            base = {
                "source_nef_sha256": "a" * 64,
                "reference_tiff_sha256": "b" * 64,
                "candidate_tiff_sha256": "c" * 64,
                "icc_profile_sha256": "d" * 64,
                "reported_benchmark_details": {
                    "body": "Z5II", "firmware": "C 1.00", "compression": "HE",
                    "nx_studio_build": "nx-test", "candidate_build": "sdk-test",
                },
            }
            reports = [
                base,
                {**base, "icc_profile_sha256": "not-a-sha256"},
                {**base, "reported_benchmark_details": {
                    **base["reported_benchmark_details"], "compression": "unverified"}},
            ]
            paths = []
            for index, report in enumerate(reports):
                path = root / f"sample-{index}.json"
                path.write_text(json.dumps(report), encoding="utf-8")
                paths.append(path)
            output = subprocess.check_output([
                sys.executable, Path(__file__).with_name("summarise_nikon_coverage.py"),
                *paths, "--z8-firmware", "C 3.10", "--z5ii-firmware", "C 1.00",
                "--nx-studio-build", "nx-test", "--candidate-build", "sdk-test",
            ], text=True)
            summary = json.loads(output)
            self.assertEqual(summary["ignored_reports"], 2)
            self.assertEqual(
                [row for row in summary["coverage"] if row["compared_samples"]],
                [{"body": "Z5II", "firmware": "C 1.00", "compression": "HE", "compared_samples": 1}],
            )

    def test_malformed_report_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "broken.json"
            path.write_text("{", encoding="utf-8")
            result = subprocess.run([
                sys.executable, Path(__file__).with_name("summarise_nikon_coverage.py"),
                path, "--z8-firmware", "C 3.10", "--z5ii-firmware", "C 1.00",
                "--nx-studio-build", "nx-test", "--candidate-build", "sdk-test",
            ], text=True, capture_output=True, check=False)
            self.assertEqual(result.returncode, 2)
            self.assertIn("broken.json", result.stderr)


if __name__ == "__main__":
    unittest.main()
