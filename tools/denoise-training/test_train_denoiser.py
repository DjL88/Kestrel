"""Run with:  python -m pytest tools/denoise-training/test_train_denoiser.py   (skipped when torch is not installed)"""
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

try:
    import torch
except ImportError:  # the data tools only need numpy; training is optional
    torch = None

sys.path.insert(0, str(Path(__file__).parent))


@unittest.skipIf(torch is None, "torch not installed")
class Trainer(unittest.TestCase):
    def setUp(self):
        from train_denoiser import SmallUNet, export_onnx, sigma_map, source_of
        self.SmallUNet, self.export_onnx, self.sigma_map, self.source_of = SmallUNet, export_onnx, sigma_map, source_of

    def test_any_picture_size_comes_back_the_same_size(self):
        model = self.SmallUNet(8)
        for h, w in [(64, 64), (61, 90), (33, 47)]:
            noisy = torch.rand(2, 4, h, w) * 0.1
            sigma = self.sigma_map(noisy, torch.tensor([1e-4, 2e-3]), torch.tensor([1e-3, 5e-3]))
            self.assertEqual(model(noisy, sigma).shape, noisy.shape)

    def test_noise_level_grows_with_signal_and_iso(self):
        dark, bright = torch.full((1, 4, 4, 4), 0.01), torch.full((1, 4, 4, 4), 0.5)
        a, b = torch.tensor([1e-3]), torch.tensor([1e-3])
        self.assertLess(float(self.sigma_map(dark, a, b).mean()), float(self.sigma_map(bright, a, b).mean()))
        self.assertLess(float(self.sigma_map(bright, a, b).mean()), float(self.sigma_map(bright, a * 4, b).mean()))

    def test_crops_of_one_file_share_a_source_so_they_are_held_out_together(self):
        self.assertEqual(self.source_of(Path("_DSC0449-1a2b3c4d-07.npz")), "_DSC0449-1a2b3c4d")
        self.assertEqual(self.source_of(Path("PXL_2024-RAW-02.ORIGINAL-9f9f9f9f-15.npz")), "PXL_2024-RAW-02.ORIGINAL-9f9f9f9f")

    def test_onnx_export_matches_pytorch(self):
        try:
            import onnxruntime  # noqa: F401
        except ImportError:
            self.skipTest("onnxruntime not installed")
        with tempfile.TemporaryDirectory() as folder:
            difference = self.export_onnx(self.SmallUNet(8), Path(folder) / "d.onnx")
        self.assertLess(difference, 1e-4)


if __name__ == "__main__":
    unittest.main()
