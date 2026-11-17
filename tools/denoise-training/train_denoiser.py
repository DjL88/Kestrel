#!/usr/bin/env python3
"""Train a small RAW denoiser on the pairs from make_pairs.py / raw_to_pairs.py, on a CPU, and export it to ONNX.

    pip install numpy torch onnx onnxruntime     # CPU build: --index-url https://download.pytorch.org/whl/cpu
    python tools/denoise-training/train_denoiser.py PAIRS_FOLDER RUN_FOLDER --minutes 30

The network sees the packed sensor mosaic (R, G1, G2, B at half resolution) plus a map of the expected noise level,
and predicts the noise to subtract. Training draws FRESH noise from the clean crops every time, at a random ISO, using
noise_model.py, so a few thousand crops behave like many more. Validation uses the stored noisy crops of held-out
source files (whole files are held out, never single crops of a file seen in training), so the score is repeatable.

Writes to RUN_FOLDER: `denoiser.pt` (checkpoint, resumed automatically), `denoiser.onnx` (opset 17, any height and
width; inputs `noisy` [1,4,H,W] and `sigma` [1,1,H,W]; output `clean` [1,4,H,W]) and `report.json` with the
validation PSNR before and after denoising, overall and by ISO band.

What this is NOT: the noise model is a generic full-frame model, not calibrated to any camera, so the numbers say how
well the network removes THAT noise. Judging it on real high-ISO frames is a separate, by-eye step.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch
from torch import nn

sys.path.insert(0, str(Path(__file__).parent))
from noise_model import noise_params, sample_iso  # noqa: E402


def sigma_map(noisy: torch.Tensor, a: torch.Tensor, b: torch.Tensor) -> torch.Tensor:
    """Expected noise standard deviation per pixel, from the Poisson-Gaussian model, as one extra input plane."""
    level = noisy.mean(dim=1, keepdim=True).clamp(min=0.0)
    return torch.sqrt(a.view(-1, 1, 1, 1) * level + b.view(-1, 1, 1, 1) ** 2)


def block(cin: int, cout: int) -> nn.Sequential:
    return nn.Sequential(nn.Conv2d(cin, cout, 3, padding=1), nn.LeakyReLU(0.1, inplace=True),
                         nn.Conv2d(cout, cout, 3, padding=1), nn.LeakyReLU(0.1, inplace=True))


class SmallUNet(nn.Module):
    """Three-level U-Net, about 0.26 M parameters at width 24: small enough to train on a laptop CPU."""

    def __init__(self, width: int = 24):
        super().__init__()
        w = width
        self.enc1, self.enc2, self.enc3 = block(5, w), block(w, 2 * w), block(2 * w, 4 * w)
        self.pool = nn.AvgPool2d(2)
        self.up2, self.dec2 = nn.ConvTranspose2d(4 * w, 2 * w, 2, stride=2), block(4 * w, 2 * w)
        self.up1, self.dec1 = nn.ConvTranspose2d(2 * w, w, 2, stride=2), block(2 * w, w)
        self.out = nn.Conv2d(w, 4, 1)

    def forward(self, noisy: torch.Tensor, sigma: torch.Tensor) -> torch.Tensor:
        # Scale by the noise level so dark and bright crops look alike to the network, then undo it at the end.
        scale = sigma.mean(dim=(2, 3), keepdim=True).clamp(min=1e-4)
        x = torch.cat([noisy / scale, sigma / scale], dim=1)
        # Pad to a multiple of 4 so any picture size works, and crop back afterwards.
        h, w = x.shape[-2:]
        ph, pw = (-h) % 4, (-w) % 4
        x = nn.functional.pad(x, (0, pw, 0, ph), mode="replicate")
        e1 = self.enc1(x)
        e2 = self.enc2(self.pool(e1))
        e3 = self.enc3(self.pool(e2))
        d2 = self.dec2(torch.cat([self.up2(e3), e2], dim=1))
        d1 = self.dec1(torch.cat([self.up1(d2), e1], dim=1))
        residual = self.out(d1)[..., :h, :w] * scale
        return noisy - residual


def source_of(path: Path) -> str:
    """Pairs are named <source>-<index>.npz; everything before the last dash identifies the source file."""
    return path.stem.rsplit("-", 1)[0]


def load(paths: list[Path], keys: tuple[str, ...]) -> dict[str, np.ndarray]:
    columns = defaultdict(list)
    for path in paths:
        with np.load(path) as data:
            for key in keys:
                columns[key].append(data[key])
    return {key: np.stack(values) for key, values in columns.items()}


def psnr(estimate: torch.Tensor, clean: torch.Tensor) -> torch.Tensor:
    """Per-crop PSNR with the crop's own peak, so dim crops are judged fairly against bright ones."""
    mse = ((estimate - clean) ** 2).mean(dim=(1, 2, 3)).clamp(min=1e-12)
    peak = clean.amax(dim=(1, 2, 3)).clamp(min=1e-3)
    return 10 * torch.log10(peak ** 2 / mse)


def band(iso: float) -> str:
    return "<=1600" if iso <= 1600 else "1601-6400" if iso <= 6400 else "6401-25600" if iso <= 25600 else ">25600"


@torch.no_grad()
def evaluate(model: nn.Module, val: dict[str, np.ndarray]) -> dict:
    model.eval()
    noisy, clean = torch.from_numpy(val["noisy"]), torch.from_numpy(val["clean"])
    a = torch.from_numpy(val["a"].astype(np.float32))
    b = torch.from_numpy(val["b"].astype(np.float32))
    before, after = [], []
    for start in range(0, len(noisy), 32):
        part = slice(start, start + 32)
        estimate = model(noisy[part], sigma_map(noisy[part], a[part], b[part]))
        before.append(psnr(noisy[part], clean[part]))
        after.append(psnr(estimate, clean[part]))
    before, after = torch.cat(before).numpy(), torch.cat(after).numpy()
    bands = defaultdict(list)
    for iso, x, y in zip(val["iso"], before, after):
        bands[band(float(iso))].append((x, y))
    model.train()
    return {
        "crops": int(len(before)),
        "psnr_noisy": round(float(before.mean()), 2), "psnr_denoised": round(float(after.mean()), 2),
        "by_iso": {k: {"crops": len(v), "psnr_noisy": round(float(np.mean([x for x, _ in v])), 2),
                       "psnr_denoised": round(float(np.mean([y for _, y in v])), 2)} for k, v in sorted(bands.items())},
    }


def export_onnx(model: nn.Module, path: Path) -> float:
    """Export, then check onnxruntime gives the same answer as PyTorch on a picture of a different size."""
    import onnxruntime

    model.eval()
    noisy = torch.rand(1, 4, 96, 136) * 0.2
    sigma = torch.full((1, 1, 96, 136), 0.01)
    torch.onnx.export(model, (noisy, sigma), str(path), input_names=["noisy", "sigma"], output_names=["clean"],
                      dynamic_axes={"noisy": {2: "h", 3: "w"}, "sigma": {2: "h", 3: "w"}, "clean": {2: "h", 3: "w"}},
                      opset_version=17, dynamo=False)
    test_noisy, test_sigma = torch.rand(1, 4, 70, 90) * 0.2, torch.full((1, 1, 70, 90), 0.01)
    expected = model(test_noisy, test_sigma).detach().numpy()
    session = onnxruntime.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    got = session.run(None, {"noisy": test_noisy.numpy(), "sigma": test_sigma.numpy()})[0]
    model.train()
    return float(np.abs(got - expected).max())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("pairs", type=Path)
    parser.add_argument("run", type=Path)
    parser.add_argument("--minutes", type=float, default=30, help="training time budget (resumes from the checkpoint)")
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--patch", type=int, default=64, help="random sub-crop size used for training")
    parser.add_argument("--width", type=int, default=24)
    parser.add_argument("--lr", type=float, default=2e-4)
    parser.add_argument("--val-fraction", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=1)
    args = parser.parse_args()

    files = sorted(args.pairs.glob("*.npz"))
    sources = sorted({source_of(p) for p in files})
    if len(sources) < 2:
        parser.error("need pairs from at least two source files")
    random.Random(args.seed).shuffle(sources)
    held_out = set(sources[:max(1, round(len(sources) * args.val_fraction))])
    train_files = [p for p in files if source_of(p) not in held_out]
    val_files = [p for p in files if source_of(p) in held_out]
    train = load(train_files, ("clean",))["clean"]
    val = load(val_files, ("noisy", "clean", "iso", "a", "b"))
    print(f"{len(train)} training crops from {len(sources) - len(held_out)} files; "
          f"{len(val['clean'])} validation crops from {len(held_out)} held-out files")

    torch.manual_seed(args.seed)
    rng = np.random.default_rng(args.seed)
    args.run.mkdir(parents=True, exist_ok=True)
    checkpoint = args.run / "denoiser.pt"
    model = SmallUNet(args.width)
    optimiser = torch.optim.Adam(model.parameters(), lr=args.lr)
    step = 0
    if checkpoint.exists():
        state = torch.load(checkpoint, weights_only=False)
        model.load_state_dict(state["model"])
        optimiser.load_state_dict(state["optimiser"])
        step = state["step"]
        print(f"resumed at step {step}")
    print(f"{sum(p.numel() for p in model.parameters()):,} parameters, {torch.get_num_threads()} CPU threads")

    start, last_report, losses = time.time(), time.time(), []
    size, patch = train.shape[-1], args.patch
    while time.time() - start < args.minutes * 60:
        index = rng.integers(0, len(train), args.batch)
        y, x = rng.integers(0, size - patch + 1, 2)
        clean = train[index, :, y:y + patch, x:x + patch].copy()
        # Like make_pairs: half the crops darkened first, as an underexposed frame lifted later.
        dim = rng.random(args.batch) < 0.5
        clean[dim] *= np.exp(rng.uniform(math.log(0.1), 0.0, dim.sum())).astype(np.float32)[:, None, None, None]
        params = [noise_params(sample_iso(rng)) for _ in range(args.batch)]
        a = np.array([p[0] for p in params], dtype=np.float32)
        b = np.array([p[1] for p in params], dtype=np.float32)
        x_clean = np.clip(clean, 0, None)
        noisy = rng.poisson(x_clean / a[:, None, None, None]) * a[:, None, None, None]
        noisy = (noisy + rng.normal(0, 1, clean.shape) * b[:, None, None, None]).astype(np.float32)

        noisy_t, clean_t = torch.from_numpy(noisy), torch.from_numpy(clean)
        a_t, b_t = torch.from_numpy(a), torch.from_numpy(b)
        sigma = sigma_map(noisy_t, a_t, b_t)
        estimate = model(noisy_t, sigma)
        # L1 in units of the noise level, so every ISO counts equally rather than the noisiest dominating.
        loss = ((estimate - clean_t).abs() / sigma.mean(dim=(2, 3), keepdim=True).clamp(min=1e-4)).mean()
        optimiser.zero_grad()
        loss.backward()
        optimiser.step()
        losses.append(loss.item())
        step += 1
        if time.time() - last_report > 60:
            print(f"step {step}  loss {np.mean(losses):.4f}  {(time.time() - start) / 60:.1f} min", flush=True)
            losses, last_report = [], time.time()
            torch.save({"model": model.state_dict(), "optimiser": optimiser.state_dict(), "step": step,
                        "width": args.width}, checkpoint)

    torch.save({"model": model.state_dict(), "optimiser": optimiser.state_dict(), "step": step, "width": args.width},
               checkpoint)
    report = {"step": step, "parameters": sum(p.numel() for p in model.parameters()),
              "train_crops": int(len(train)), "validation": evaluate(model, val)}
    report["onnx_max_difference"] = export_onnx(model, args.run / "denoiser.onnx")
    (args.run / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
