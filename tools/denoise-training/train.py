#!/usr/bin/env python3
"""Train a RAW denoiser on your own crops and export it to ONNX.

    python tools/denoise-training/train.py work/crops work/model --profile work/noise-profile.json --epochs 40

Uses an NVIDIA GPU (CUDA) or Apple GPU (MPS) when PyTorch can see one, otherwise the CPU (much slower: use it only
for a short test run). Stop at any time with Ctrl+C; run the same command again to continue from the last epoch.

The network sees the sensor mosaic before demosaicing: four Bayer planes (R, G1, G2, B, half resolution, 0..1 above
black) plus four planes giving the expected noise standard deviation at each pixel, sqrt(a * max(noisy, 0) + b**2).
It returns the four clean planes. Every training step draws a fresh ISO (log-uniform between --iso-min and --iso-max)
and fresh noise with the shape measured for the crop's camera (noise-profile.json), falling back to the generic model.
Half the crops are first darkened, like an underexposed shot lifted later.

Outputs in the model folder:
  last.pt, best.pt     PyTorch checkpoints (best by validation score)
  denoise.onnx         the best network, for onnxruntime (input 'input' 1x8xHxW, output 'clean' 1x4xHxW,
                       H and W multiples of 16)
  denoise.json         what it is, how it was trained, size, SHA-256 and validation scores per ISO
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

sys.path.insert(0, str(Path(__file__).parent))
from make_pairs import OFFSETS, pack_rggb, unpack_rggb  # noqa: E402
from noise_model import NoiseProfile, add_noise, sample_iso  # noqa: E402

MULTIPLE = 16  # four halvings in the network
VALIDATION_ISOS = (800, 3200, 12800, 51200)


# ---------------------------------------------------------------- data

def noise_std_map(noisy: np.ndarray, a: float, b: float) -> np.ndarray:
    return np.sqrt(a * np.clip(noisy, 0.0, None) + b * b).astype(np.float32)


def network_input(noisy: np.ndarray, a: float, b: float) -> np.ndarray:
    """(4, H, W) noisy planes to the (8, H, W) network input."""
    return np.concatenate([noisy.astype(np.float32), noise_std_map(noisy, a, b)])


def flip_bayer(planes: np.ndarray, horizontal: bool, vertical: bool) -> np.ndarray:
    """Flip the picture while keeping the planes in R, G1, G2, B order. Flipping the mosaic changes which colour comes
    first, so it is unpacked, flipped and repacked with the new pattern (losing one pixel row/column)."""
    if not (horizontal or vertical):
        return planes
    mosaic = unpack_rggb(planes)
    if horizontal:
        mosaic = mosaic[:, ::-1]
    if vertical:
        mosaic = mosaic[::-1, :]
    pattern = {(True, False): "GRBG", (False, True): "GBRG", (True, True): "BGGR"}[(horizontal, vertical)]
    return pack_rggb(np.ascontiguousarray(mosaic), pattern)


class CropSet(torch.utils.data.Dataset):
    def __init__(self, files: list[Path], profile: NoiseProfile, patch: int, steps: int,
                 iso_range: tuple[float, float], seed: int):
        self.files, self.profile, self.patch, self.steps = files, profile, patch, steps
        self.iso_range, self.seed = iso_range, seed
        self.epoch = 0

    def __len__(self) -> int:
        return self.steps

    def __getitem__(self, index: int):
        rng = np.random.default_rng([self.seed, self.epoch, index])
        data = np.load(self.files[int(rng.integers(len(self.files)))])
        clean = np.asarray(data["clean"], dtype=np.float32)
        camera = str(data["camera"]) if "camera" in data else ""
        clean = flip_bayer(clean, bool(rng.random() < 0.5), bool(rng.random() < 0.5))
        _, h, w = clean.shape
        y, x = int(rng.integers(0, h - self.patch + 1)), int(rng.integers(0, w - self.patch + 1))
        clean = clean[:, y:y + self.patch, x:x + self.patch]
        if rng.random() < 0.5:
            clean = clean * float(np.exp(rng.uniform(math.log(0.1), 0.0)))
        a, b = self.profile.params(camera, sample_iso(rng, *self.iso_range))
        noisy = add_noise(clean, a, b, rng)
        return torch.from_numpy(network_input(noisy, a, b)), torch.from_numpy(np.ascontiguousarray(clean))


def validation_batches(files: list[Path], profile: NoiseProfile, patch: int, limit: int = 64):
    """Fixed noisy/clean pairs at a few ISOs, the same every epoch, so scores can be compared."""
    rng = np.random.default_rng(12345)
    by_iso: dict[int, tuple[torch.Tensor, torch.Tensor]] = {}
    chosen = files[:: max(1, len(files) // limit)][:limit]
    for iso in VALIDATION_ISOS:
        inputs, targets = [], []
        for path in chosen:
            data = np.load(path)
            clean = np.asarray(data["clean"], dtype=np.float32)[:, :patch, :patch]
            camera = str(data["camera"]) if "camera" in data else ""
            a, b = profile.params(camera, iso)
            noisy = add_noise(clean, a, b, rng)
            inputs.append(network_input(noisy, a, b))
            targets.append(clean)
        by_iso[iso] = (torch.from_numpy(np.stack(inputs)), torch.from_numpy(np.stack(targets)))
    return by_iso


# ---------------------------------------------------------------- network

def block(cin: int, cout: int) -> nn.Sequential:
    return nn.Sequential(nn.Conv2d(cin, cout, 3, padding=1), nn.LeakyReLU(0.2, inplace=True),
                         nn.Conv2d(cout, cout, 3, padding=1), nn.LeakyReLU(0.2, inplace=True))


class BayerUNet(nn.Module):
    """A plain U-Net. It predicts a correction that is added to the noisy planes, so the network only has to learn the
    noise. The last layer starts small (not zero, which would stall learning), so an untrained network changes little."""

    def __init__(self, width: int = 32, levels: int = 4):
        super().__init__()
        channels = [width * 2 ** i for i in range(levels + 1)]
        self.down = nn.ModuleList([block(8, channels[0])] +
                                  [block(channels[i], channels[i + 1]) for i in range(levels)])
        self.up = nn.ModuleList([nn.ConvTranspose2d(channels[i + 1], channels[i], 2, stride=2)
                                 for i in reversed(range(levels))])
        self.merge = nn.ModuleList([block(channels[i] * 2, channels[i]) for i in reversed(range(levels))])
        self.out = nn.Conv2d(channels[0], 4, 1)
        with torch.no_grad():
            self.out.weight.mul_(0.01)
            self.out.bias.zero_()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        noisy = x[:, :4]
        skips = []
        h = x
        for index, layer in enumerate(self.down):
            h = layer(h if index == 0 else F.max_pool2d(h, 2))
            skips.append(h)
        skips.pop()
        for up, merge in zip(self.up, self.merge):
            h = merge(torch.cat([up(h), skips.pop()], dim=1))
        return noisy + self.out(h)


# ---------------------------------------------------------------- training

def psnr(prediction: torch.Tensor, target: torch.Tensor) -> float:
    mse = F.mse_loss(prediction.clamp(0, 1), target).item()
    return 10 * math.log10(1.0 / max(mse, 1e-12))


@torch.no_grad()
def evaluate(model: nn.Module, batches: dict, device: torch.device) -> dict:
    model.eval()
    scores = {}
    for iso, (inputs, targets) in batches.items():
        out = torch.cat([model(chunk.to(device)).float().cpu() for chunk in inputs.split(16)])
        scores[iso] = {"noisy_psnr": round(psnr(inputs[:, :4], targets), 2), "denoised_psnr": round(psnr(out, targets), 2)}
    model.train()
    return scores


def pick_device(requested: str) -> torch.device:
    if requested != "auto":
        return torch.device(requested)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def export_onnx(model: nn.Module, path: Path, verify: bool = True) -> None:
    model = model.cpu().eval()
    sample = torch.rand(1, 8, 64, 64) * 0.2
    import warnings
    warnings.filterwarnings("ignore", category=DeprecationWarning)  # the classic exporter is the reliable one here
    torch.onnx.export(model, sample, str(path), input_names=["input"], output_names=["clean"], opset_version=17,
                      dynamic_axes={"input": {2: "height", 3: "width"}, "clean": {2: "height", 3: "width"}},
                      dynamo=False)
    if verify:
        try:
            import onnxruntime as ort
        except ImportError:
            print("onnxruntime not installed: the exported file was not checked")
            return
        check = torch.rand(1, 8, 96, 128) * 0.3
        session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        got = session.run(None, {"input": check.numpy()})[0]
        with torch.no_grad():
            want = model(check).numpy()
        difference = float(np.abs(got - want).max())
        if difference > 1e-4:
            raise RuntimeError(f"ONNX output differs from PyTorch by {difference}")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("crops", type=Path, help="folder from build_dataset.py (with train/ and val/)")
    parser.add_argument("out", type=Path, help="folder for checkpoints and the exported model")
    parser.add_argument("--profile", type=Path, help="noise-profile.json from calibrate_noise.py")
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--steps", type=int, default=2000, help="training crops per epoch")
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--patch", type=int, default=128, help="training crop size (multiple of 16)")
    parser.add_argument("--width", type=int, default=32, help="network width; 32 is about 7.8 M parameters")
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--iso-min", type=float, default=400)
    parser.add_argument("--iso-max", type=float, default=51200)
    parser.add_argument("--workers", type=int, default=4, help="data loader processes")
    parser.add_argument("--device", default="auto", help="auto, cuda, mps or cpu")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--export-only", action="store_true", help="export best.pt to ONNX and stop")
    args = parser.parse_args()
    if args.patch % MULTIPLE:
        parser.error(f"--patch must be a multiple of {MULTIPLE}")

    torch.manual_seed(args.seed)
    args.out.mkdir(parents=True, exist_ok=True)
    device = pick_device(args.device)
    model = BayerUNet(args.width).to(device)
    profile = NoiseProfile.load(args.profile)

    train_files = sorted((args.crops / "train").glob("*.npz"))
    val_files = sorted((args.crops / "val").glob("*.npz")) or train_files[: max(1, len(train_files) // 20)]
    if not train_files and not args.export_only:
        print(f"no training crops in {args.crops / 'train'}; run build_dataset.py first")
        return 1
    smallest = min(np.load(f)["clean"].shape[-1] for f in (train_files + val_files)[:50]) if train_files else 0
    if train_files and smallest <= args.patch:
        parser.error(f"crops are {smallest} pixels; --patch must be smaller")

    optimiser = torch.optim.Adam(model.parameters(), lr=args.lr)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimiser, T_max=args.epochs, eta_min=args.lr / 20)
    start, best, history = 0, -1.0, []
    last = args.out / "last.pt"
    if last.exists():
        state = torch.load(last, map_location=device, weights_only=False)
        if state["width"] != args.width:
            parser.error(f"{last} was trained with --width {state['width']}")
        model.load_state_dict(state["model"])
        optimiser.load_state_dict(state["optimiser"])
        scheduler.load_state_dict(state["scheduler"])
        start, best, history = state["epoch"], state["best"], state["history"]
        print(f"continuing after epoch {start} (best validation {best:.2f} dB)")

    if not args.export_only:
        cameras = sorted({str(np.load(f)["camera"]) for f in train_files[:: max(1, len(train_files) // 200)]})
        for camera in cameras:
            print(f"camera {camera or 'unknown'}: {'measured noise' if profile.measured(camera) else 'generic noise model'}")
        print(f"{len(train_files)} training crops, {len(val_files)} validation crops, {device}, "
              f"{sum(p.numel() for p in model.parameters()) / 1e6:.1f} M parameters")
        dataset = CropSet(train_files, profile, args.patch, args.steps, (args.iso_min, args.iso_max), args.seed)
        checks = validation_batches(val_files, profile, args.patch)
        use_amp = device.type == "cuda"
        scaler = torch.amp.GradScaler("cuda", enabled=use_amp)
        try:
            for epoch in range(start, args.epochs):
                dataset.epoch = epoch
                loader = torch.utils.data.DataLoader(dataset, batch_size=args.batch, shuffle=False,
                                                     num_workers=args.workers, pin_memory=device.type == "cuda",
                                                     persistent_workers=False)
                began, total = time.time(), 0.0
                for inputs, targets in loader:
                    inputs, targets = inputs.to(device, non_blocking=True), targets.to(device, non_blocking=True)
                    with torch.autocast(device.type, enabled=use_amp):
                        loss = F.l1_loss(model(inputs).float(), targets)
                    optimiser.zero_grad(set_to_none=True)
                    scaler.scale(loss).backward()
                    scaler.step(optimiser)
                    scaler.update()
                    total += loss.item()
                scheduler.step()
                scores = evaluate(model, checks, device)
                mean_score = float(np.mean([s["denoised_psnr"] for s in scores.values()]))
                history.append({"epoch": epoch + 1, "loss": total / max(1, len(loader)), "validation": scores})
                line = "  ".join(f"ISO {iso}: {s['noisy_psnr']:.1f}->{s['denoised_psnr']:.1f} dB" for iso, s in scores.items())
                print(f"epoch {epoch + 1}/{args.epochs}  loss {total / max(1, len(loader)):.5f}  {line}  "
                      f"({time.time() - began:.0f} s)")
                state = {"model": model.state_dict(), "optimiser": optimiser.state_dict(),
                         "scheduler": scheduler.state_dict(), "epoch": epoch + 1, "best": max(best, mean_score),
                         "history": history, "width": args.width}
                if mean_score > best:
                    best = mean_score
                    torch.save(state, args.out / "best.pt")
                torch.save(state, last)
        except KeyboardInterrupt:
            print("stopped; run the same command again to continue")

    best_path = args.out / "best.pt"
    if not best_path.exists():
        print("no best.pt yet: train at least one epoch")
        return 1
    state = torch.load(best_path, map_location="cpu", weights_only=False)
    final = BayerUNet(state["width"])
    final.load_state_dict(state["model"])
    onnx_path = args.out / "denoise.onnx"
    export_onnx(final, onnx_path)
    card = {
        "name": "Kestrel RAW denoiser (personal)",
        "file": onnx_path.name, "bytes": onnx_path.stat().st_size, "sha256": sha256(onnx_path),
        "input": "input: float32 1x8xHxW = R,G1,G2,B planes (0..1 above black, half sensor resolution) then the "
                 "noise std of each plane, sqrt(a*max(x,0)+b^2); H and W multiples of 16",
        "output": "clean: float32 1x4xHxW, R,G1,G2,B planes, same scale",
        "trained_epochs": state["epoch"], "width": state["width"],
        "training_crops": len(train_files), "validation_crops": len(val_files),
        "iso_range": [args.iso_min, args.iso_max],
        "noise": {"measured_cameras": sorted(profile.cameras)},
        "validation": state["history"][-1]["validation"] if state["history"] else {},
        "note": "Trained on the owner's own photographs. Validation is on held-out photos of the same owner with "
                "synthetic noise; it is not a measurement on real high-ISO captures.",
    }
    (args.out / "denoise.json").write_text(json.dumps(card, indent=2))
    print(f"exported {onnx_path} ({card['bytes'] / 1e6:.1f} MB), checked against PyTorch")
    return 0


if __name__ == "__main__":
    sys.exit(main())
