#!/usr/bin/env python3
"""Train and evaluate a small raw-domain denoiser. Camera-agnostic: it sees only packed Bayer planes and the noise level.

    tools/denoise-training/.venv/bin/python tools/denoise-training/train.py raw-samples/dump --steps 3000

The network takes the four packed colour planes (R, G1, G2, B) plus a per-pixel noise map worked out from the ISO's
noise parameters, so one model covers every ISO and the strength is not guessed. It predicts the correction to add to
the noisy planes. Noise is made fresh on every step from clean crops (Poisson-Gaussian, see noise_model.py), so a small
set of clean RAWs gives unlimited training pairs. Whole files are held out for evaluation, never single crops.

Everything here is a first, small baseline. Numbers on a handful of low-ISO files are a sanity check, not a result.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import torch
from torch import nn

sys.path.insert(0, str(Path(__file__).parent))
from make_pairs import has_content, load_dump  # noqa: E402
from noise_model import add_noise, noise_params, sample_iso  # noqa: E402


def noise_map(noisy: torch.Tensor, a: torch.Tensor, b: torch.Tensor) -> torch.Tensor:
    """Per-pixel noise standard deviation implied by the noisy value and the ISO's parameters, shape like `noisy`."""
    return torch.sqrt(torch.clamp(noisy, min=0.0) * a.view(-1, 1, 1, 1) + b.view(-1, 1, 1, 1) ** 2)


def block(inputs: int, outputs: int) -> nn.Sequential:
    return nn.Sequential(nn.Conv2d(inputs, outputs, 3, padding=1), nn.GELU(), nn.Conv2d(outputs, outputs, 3, padding=1), nn.GELU())


class Denoiser(nn.Module):
    """A small three-level U-Net. About a million weights, so it runs on a laptop and exports to ONNX."""

    def __init__(self, width: int = 32):
        super().__init__()
        self.enc1, self.enc2, self.enc3 = block(8, width), block(width, width * 2), block(width * 2, width * 4)
        self.down = nn.MaxPool2d(2)
        self.up2 = nn.ConvTranspose2d(width * 4, width * 2, 2, stride=2)
        self.dec2 = block(width * 4, width * 2)
        self.up1 = nn.ConvTranspose2d(width * 2, width, 2, stride=2)
        self.dec1 = block(width * 2, width)
        self.out = nn.Conv2d(width, 4, 1)

    def forward(self, noisy: torch.Tensor, a: torch.Tensor, b: torch.Tensor) -> torch.Tensor:
        x = torch.cat([noisy, noise_map(noisy, a, b)], dim=1)
        e1 = self.enc1(x)
        e2 = self.enc2(self.down(e1))
        e3 = self.enc3(self.down(e2))
        d2 = self.dec2(torch.cat([self.up2(e3), e2], dim=1))
        d1 = self.dec1(torch.cat([self.up1(d2), e1], dim=1))
        return noisy + self.out(d1)  # the network only has to learn the correction


def stabilise(x: torch.Tensor) -> torch.Tensor:
    """Square-root transform: noise becomes roughly equal everywhere, so shadows count as much as highlights in the loss."""
    return torch.sqrt(torch.clamp(x, min=0.0) + 0.01)


def psnr(a: np.ndarray, b: np.ndarray) -> float:
    """PSNR on gamma-encoded values (what a viewer sees), 0..1 range."""
    mse = float(np.mean((np.clip(a, 0, 1) ** (1 / 2.2) - np.clip(b, 0, 1) ** (1 / 2.2)) ** 2))
    return float(10 * np.log10(1.0 / max(mse, 1e-12)))


def gaussian_blur(planes: np.ndarray) -> np.ndarray:
    """The simplest classical baseline: a 3 x 3 blur of every plane."""
    k = np.array([1, 2, 1], dtype=np.float32) / 4.0
    out = planes.copy()
    for axis in (1, 2):
        padded = np.pad(out, [(0, 0), (1, 1) if axis == 1 else (0, 0), (1, 1) if axis == 2 else (0, 0)], mode="edge")
        sl = lambda s: tuple(slice(s, s + n) if i == axis else slice(None) for i, n in enumerate(out.shape))
        out = k[0] * padded[sl(0)] + k[1] * padded[sl(1)] + k[2] * padded[sl(2)]
    return out


def collect(dumps: Path, crops: int, size: int, holdout: list[str], rng: np.random.Generator):
    train, valid, names = [], [], {"train": [], "valid": []}
    for meta_path in sorted(dumps.glob("*.json")):
        try:
            planes, meta = load_dump(meta_path)
        except ValueError as problem:
            print(f"skipped {problem}")
            continue
        _, h, w = planes.shape
        kept = []
        for _ in range(crops * 6):
            if len(kept) >= crops:
                break
            y, x = int(rng.integers(0, h - size + 1)), int(rng.integers(0, w - size + 1))
            crop = planes[:, y:y + size, x:x + size]
            if has_content(crop):
                kept.append(crop.astype(np.float16))
        is_valid = any(token in meta["name"] for token in holdout)
        (valid if is_valid else train).extend(kept)
        names["valid" if is_valid else "train"].append(f"{meta['make']} {meta['model']} ({len(kept)} crops)")
    return np.stack(train), np.stack(valid) if valid else None, names


def batch(source: np.ndarray, size: int, count: int, rng: np.random.Generator, device):
    index = rng.integers(0, len(source), count)
    cleans, noisies, aas, bs = [], [], [], []
    for i in index:
        _, h, w = source[i].shape
        y, x = int(rng.integers(0, h - size + 1)), int(rng.integers(0, w - size + 1))
        clean = source[i][:, y:y + size, x:x + size].astype(np.float32)
        if rng.random() < 0.5:
            clean = clean * float(np.exp(rng.uniform(np.log(0.1), 0.0)))
        a, b = noise_params(sample_iso(rng))
        cleans.append(clean)
        noisies.append(add_noise(clean, a, b, rng))
        aas.append(a)
        bs.append(b)
    to = lambda arr: torch.from_numpy(np.asarray(arr, dtype=np.float32)).to(device)
    return to(noisies), to(cleans), to(aas), to(bs)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("dumps", type=Path)
    parser.add_argument("--steps", type=int, default=3000)
    parser.add_argument("--batch", type=int, default=24)
    parser.add_argument("--patch", type=int, default=64)
    parser.add_argument("--crops", type=int, default=250, help="clean crops kept per RAW file")
    parser.add_argument("--holdout", nargs="*", default=["IMGP9854", "DSC06681"], help="file names held out for evaluation")
    parser.add_argument("--out", type=Path, default=Path("raw-samples/models"))
    parser.add_argument("--seed", type=int, default=1)
    args = parser.parse_args()

    rng = np.random.default_rng(args.seed)
    torch.manual_seed(args.seed)
    device = torch.device("mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu")
    train, valid, names = collect(args.dumps, args.crops, 128, args.holdout, rng)
    print(f"device {device}; train files {names['train']}; held out {names['valid']}")
    if valid is None:
        print("no held-out files found; give --holdout names that exist")
        return 1

    model = Denoiser().to(device)
    print(f"{sum(p.numel() for p in model.parameters()):,} weights")
    optimiser = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-4)
    schedule = torch.optim.lr_scheduler.CosineAnnealingLR(optimiser, args.steps)
    started = time.time()
    for step in range(1, args.steps + 1):
        noisy, clean, a, b = batch(train, args.patch, args.batch, rng, device)
        loss = torch.mean(torch.abs(stabilise(model(noisy, a, b)) - stabilise(clean)))
        optimiser.zero_grad(set_to_none=True)
        loss.backward()
        optimiser.step()
        schedule.step()
        if step % 250 == 0 or step == 1:
            print(f"step {step:5d}  loss {loss.item():.4f}  {time.time() - started:5.0f}s")

    # Held-out evaluation at fixed ISOs with fixed noise, on whole held-out crops.
    model.eval()
    results, eval_rng = [], np.random.default_rng(99)
    shown = []
    with torch.no_grad():
        for iso in (1600, 6400, 25600):
            a, b = noise_params(iso)
            scores = {"noisy": [], "blur": [], "model": []}
            for crop in valid[:40]:
                clean = crop.astype(np.float32)
                noisy = add_noise(clean, a, b, eval_rng)
                tensor = lambda arr: torch.from_numpy(arr[None]).to(device)
                got = model(tensor(noisy), torch.tensor([a], device=device), torch.tensor([b], device=device))[0].cpu().numpy()
                scores["noisy"].append(psnr(noisy, clean))
                scores["blur"].append(psnr(gaussian_blur(noisy), clean))
                scores["model"].append(psnr(got, clean))
                if len(shown) < 3 and iso == 6400:
                    shown.append((clean, noisy, got))
            row = {"iso": iso, **{k: round(float(np.mean(v)), 2) for k, v in scores.items()}}
            results.append(row)
            print(f"ISO {iso:6d}  noisy {row['noisy']:6.2f} dB   3x3 blur {row['blur']:6.2f} dB   model {row['model']:6.2f} dB")

    args.out.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), args.out / "denoise-v0.pt")
    (args.out / "denoise-v0.json").write_text(json.dumps({"results_psnr_db": results, "steps": args.steps, "train": names["train"], "held_out": names["valid"]}, indent=2))
    np.savez_compressed(args.out / "examples.npz", **{f"{k}{i}": arr for i, trio in enumerate(shown) for k, arr in zip(("clean", "noisy", "model"), trio)})
    print(f"saved {args.out / 'denoise-v0.pt'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
