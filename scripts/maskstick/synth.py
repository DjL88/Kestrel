"""Synthetic bird-like scenes with a true soft alpha, for tests and for controlled failure-mode runs.

Fully procedural (no photographs, no licences). The subject is an ellipse body, head, tail wedge and wing blob with
hundreds of thin "barbs" growing off the outline, so the true alpha has the fine, partly transparent edge that real
feathers and fur have. The background is multi-scale noise texture that can be defocused by a chosen blur, and its
colour can be made close to the subject's. This is NOT a stand-in for real photographs: it shows which cues work and
where they break, under control. Real scores need the owner's hand-fixed masks.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

SUPERSAMPLE = 4


@dataclass
class Scene:
    image: np.ndarray  # uint8 H x W x 3
    alpha: np.ndarray  # float32 H x W, the true soft alpha of the SUBJECT (the bird), never of a distractor
    kind: str
    bg_blur: float
    colour_gap: float
    #: Where a camera focusing on the subject would put its AF box (x, y, w, h in px), for the AF cue; None without one.
    af: tuple[float, float, float, float] | None = None
    #: With `distractor`, the soft alpha of a sharp pillar in the same focal plane (not the subject).
    distractor_alpha: np.ndarray | None = None


def _texture(rng: np.random.Generator, shape: tuple[int, int], sigmas=(0.8, 1.6, 3.5, 8.0), weights=(1.0, 1.0, 0.8, 0.6)) -> np.ndarray:
    """Zero-mean, unit-ish-variance multi-scale noise: fine detail when in focus, soft blobs once blurred."""
    out = np.zeros(shape, np.float32)
    for s, w in zip(sigmas, weights):
        n = ndi.gaussian_filter(rng.standard_normal(shape).astype(np.float32), s)
        out += w * n / (n.std() + 1e-6)
    return out / (out.std() + 1e-6)


def _bar_alpha(rng: np.random.Generator, h: int, w: int) -> np.ndarray:
    """A tall, slightly wavy sharp pillar at the left (a post or trunk in the focal plane): bigger than the subject, apart from it."""
    S = SUPERSAMPLE
    big = Image.new("L", (w * S, h * S), 0)
    d = ImageDraw.Draw(big)
    ys = np.linspace(h * 0.08, h * 0.92, 40)
    wiggle = 0.012 * w * np.sin(ys / h * 7 + rng.uniform(0, 6))
    left, right = w * rng.uniform(0.03, 0.05), w * rng.uniform(0.21, 0.23)
    d.polygon([((left + dx) * S, y * S) for y, dx in zip(ys, wiggle)] + [((right + dx) * S, y * S) for y, dx in zip(ys[::-1], wiggle[::-1])], fill=255)
    return np.asarray(big, np.float32).reshape(h, S, w, S).mean(axis=(1, 3)) / 255.0


def _subject_alpha(rng: np.random.Generator, h: int, w: int, barbs: int = 220, cx_range=(0.42, 0.58), scale: float = 1.0) -> np.ndarray:
    S = SUPERSAMPLE
    big = Image.new("L", (w * S, h * S), 0)
    d = ImageDraw.Draw(big)
    cx, cy = w * rng.uniform(*cx_range), h * rng.uniform(0.45, 0.58)
    a, b = w * rng.uniform(0.18, 0.24) * scale, h * rng.uniform(0.13, 0.19) * scale
    ang = rng.uniform(-0.35, 0.35)
    t = np.linspace(0, 2 * np.pi, 120)
    ex = cx + a * np.cos(t) * np.cos(ang) - b * np.sin(t) * np.sin(ang)
    ey = cy + a * np.cos(t) * np.sin(ang) + b * np.sin(t) * np.cos(ang)
    d.polygon([(x * S, y * S) for x, y in zip(ex, ey)], fill=255)
    # head
    hx, hy, hr = cx + a * 0.95, cy - b * 0.5, b * 0.55
    d.ellipse([(hx - hr) * S, (hy - hr) * S, (hx + hr) * S, (hy + hr) * S], fill=255)
    # tail wedge and a wing lobe
    d.polygon([((cx - a * 0.8) * S, (cy - b * 0.2) * S), ((cx - a * 1.7) * S, (cy + b * 0.4) * S), ((cx - a * 0.7) * S, (cy + b * 0.5) * S)], fill=255)
    d.ellipse([(cx - a * 0.5) * S, (cy - b * 1.5) * S, (cx + a * 0.5) * S, (cy - b * 0.2) * S], fill=255)
    core = np.asarray(big, np.float32) / 255.0
    # barbs: thin outward strokes from the outline, a few pixels long, 1-2 px wide at output size
    edge = core - ndi.binary_erosion(core > 0.5, iterations=2).astype(np.float32)
    ys, xs = np.nonzero(edge > 0.5)
    if len(ys):
        gy, gx = np.gradient(ndi.gaussian_filter(core, 6 * S))
        picks = rng.choice(len(ys), size=min(barbs, len(ys)), replace=False)
        for p in picks:
            y, x = ys[p], xs[p]
            nx, ny = -gx[y, x], -gy[y, x]
            n = np.hypot(nx, ny)
            if n < 1e-6:
                continue
            ang2 = np.arctan2(ny, nx) + rng.normal(0, 0.35)
            length = rng.uniform(4, 22) * S
            width = int(rng.choice([2, 3, 4]))  # 0.5 to 1 px at output size
            d.line([(x, y), (x + length * np.cos(ang2), y + length * np.sin(ang2))], fill=255, width=width)
    big = np.maximum(core, np.asarray(big, np.float32) / 255.0)
    small = big.reshape(h, S, w, S).mean(axis=(1, 3))
    return np.clip(small, 0, 1).astype(np.float32)


def make_scene(seed: int, size: tuple[int, int] = (512, 768), bg_blur: float = 8.0, colour_gap: float = 0.35,
               noise: float = 0.01, distractor: bool = False) -> Scene:
    """`size` is (height, width). `bg_blur` is the background's Gaussian blur in px (0 = as sharp as the subject).
    `colour_gap` is how far apart the subject and background mean colours are (0 = identical, 0.5 = very different).
    `distractor` adds a big sharp pillar (post, trunk) in the focal plane, larger than the subject and apart from it: the case
    where "the sharp thing" and "the subject" differ. The subject then sits right of centre and `Scene.af` marks where the
    camera focused (the subject)."""
    h, w = size
    rng = np.random.default_rng(seed)
    alpha = _subject_alpha(rng, h, w, cx_range=(0.66, 0.70) if distractor else (0.42, 0.58), scale=0.85 if distractor else 1.0)
    bar = _bar_alpha(rng, h, w) if distractor else None
    direction = rng.standard_normal(3)
    direction /= np.linalg.norm(direction)
    fg_mean = np.clip(rng.uniform(0.3, 0.7, 3), 0.15, 0.85)
    bg_mean = np.clip(fg_mean + direction * colour_gap, 0.05, 0.95)
    fg_tex = _texture(rng, (h, w)) * 0.10
    fg_rgb = fg_mean[None, None, :] + fg_tex[..., None] * rng.uniform(0.6, 1.0, 3)[None, None, :]
    bg_tex = _texture(rng, (h, w), sigmas=(0.8, 1.6, 3.5, 8.0, 20.0), weights=(1.0, 1.0, 0.9, 0.9, 1.2)) * 0.12
    bg_rgb = bg_mean[None, None, :] + bg_tex[..., None] * rng.uniform(0.6, 1.0, 3)[None, None, :]
    if bg_blur > 0:
        # A defocused background keeps its large colour shapes and loses its fine texture (and its contrast with it).
        bg_rgb = np.stack([ndi.gaussian_filter(bg_rgb[..., c], bg_blur) for c in range(3)], axis=-1)
        bg_rgb = bg_mean[None, None, :] + (bg_rgb - bg_mean[None, None, :]) * (1.0 + 0.9 * min(1.0, bg_blur / 8.0))
    if bar is None:
        rgb = alpha[..., None] * fg_rgb + (1 - alpha[..., None]) * bg_rgb
    else:
        pillar_mean = np.clip(np.array([0.36, 0.26, 0.16]) + rng.normal(0, 0.03, 3), 0.05, 0.9)
        pillar_rgb = pillar_mean[None, None, :] + (_texture(rng, (h, w)) * 0.09)[..., None]
        total = np.clip(alpha + bar, 0, 1)
        rgb = (alpha[..., None] * fg_rgb + bar[..., None] * pillar_rgb) + (1 - total[..., None]) * bg_rgb
    rgb = rgb + rng.normal(0, noise, rgb.shape)
    image = (np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8)
    ys, xs = np.nonzero(alpha > 0.5)
    af = None
    if distractor and len(xs):
        side = 0.05 * max(h, w)
        af = (float(xs.mean() - side / 2), float(ys.mean() - side / 2), side, side)
    return Scene(image=image, alpha=alpha, kind="bird", bg_blur=bg_blur, colour_gap=colour_gap, af=af, distractor_alpha=bar)


def ground_truth_from_alpha(alpha: np.ndarray, band: float = 0.15) -> np.ndarray:
    """What an owner might paint from a true alpha: subject where alpha is high, 'uncertain band' where it is partial.
    Used only to check the scorer end to end on synthetic scenes."""
    gt = np.zeros(alpha.shape, np.uint8)
    gt[alpha >= 0.5 + band] = 255
    gt[(alpha > 0.5 - band) & (alpha < 0.5 + band)] = 128
    return gt


def save_scene(scene: Scene, folder: str, key: str) -> None:
    import os
    os.makedirs(folder, exist_ok=True)
    Image.fromarray(scene.image).save(os.path.join(folder, key + ".png"))
    Image.fromarray((scene.alpha * 255 + 0.5).astype(np.uint8)).save(os.path.join(folder, key + "_alpha.png"))
