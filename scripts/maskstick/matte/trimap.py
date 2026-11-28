"""A trimap (certain subject, certain background, uncertain band) from the focus map and a colour cue. No learned weights.

1. Sharp, textured pixels are the subject's seed; blurred, textured pixels and everything far from the seed are the
   background's.
2. Colour histograms (Lab, a few thousand cells, no fitted network) from those two seeds say, for smooth pixels the
   focus map cannot judge, whether they look more like the subject or the background. Smooth pixels near the seed that
   look like the subject join it.
3. The uncertain band is a ring around the grown region: narrow inside (the seed is already sharp there) and wider
   outside (barbs, fur and out-of-focus tips lie beyond the sharp core).

Honest limits: if the background is as sharp as the subject, the seed is both and the result is wrong; if the colours
match, smooth areas leak. `Trimap.confidence` and `reason` say when the cues did not separate the frame, so a caller can
refuse instead of guessing.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage as ndi

from .focus import FocusMap, focus_map, otsu


@dataclass
class Trimap:
    foreground: np.ndarray  # certain subject (bool)
    background: np.ndarray  # certain background (bool)
    subject: np.ndarray  # the grown region the band was drawn around (bool)
    seed: np.ndarray  # sharp, textured seed (bool)
    focus: FocusMap | None = None
    confidence: float = 0.0
    reason: str = "ok"
    evidence: np.ndarray | None = None  # colour log-ratio, positive = subject-like
    stats: dict = field(default_factory=dict)

    @property
    def unknown(self) -> np.ndarray:
        return ~(self.foreground | self.background)


def disk(radius: float) -> np.ndarray:
    r = int(np.ceil(radius))
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return (x * x + y * y) <= radius * radius + 0.5


def srgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    c = np.asarray(rgb, np.float32)
    if c.max() > 1.5:
        c = c / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]], np.float32)
    xyz = lin @ m.T / np.array([0.95047, 1.0, 1.08883], np.float32)
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], axis=-1)


def _cells(lab: np.ndarray, bins: int = 14) -> np.ndarray:
    l = np.clip(lab[..., 0] / 100.0, 0, 0.9999)
    a = np.clip((lab[..., 1] + 70) / 140.0, 0, 0.9999)
    b = np.clip((lab[..., 2] + 70) / 140.0, 0, 0.9999)
    return (l * bins).astype(np.int32) * bins * bins + (a * bins).astype(np.int32) * bins + (b * bins).astype(np.int32)


def colour_evidence(rgb: np.ndarray, fg_seed: np.ndarray, bg_seed: np.ndarray, bins: int = 14) -> np.ndarray:
    """Log-ratio of how common each pixel's colour is in the subject seed versus the background seed (positive = subject).
    Histograms are smoothed so a colour just outside what the seed showed still counts as near it."""
    cells = _cells(srgb_to_lab(rgb), bins)
    size = bins ** 3

    def hist(mask):
        h = np.bincount(cells[mask], minlength=size).astype(np.float64).reshape(bins, bins, bins)
        h = ndi.gaussian_filter(h, 1.0)
        return h / max(h.sum(), 1e-9)

    pf, pb = hist(fg_seed), hist(bg_seed)
    floor = 1e-4
    ratio = np.log((pf.ravel() + floor / size) / (pb.ravel() + floor / size))
    return ratio[cells].astype(np.float32)


def build_trimap(rgb: np.ndarray, long_edge: float | None = None, *, inner: float = 18.0, outer: float = 6.0, grow: float = 0.06,
                 min_seed: float = 0.002, max_seed: float = 0.65) -> Trimap:
    """`inner`/`outer` are band half-widths in px (inside/outside the grown region) at a 1024-px working size; `grow` is how
    far (as a share of the long edge) colour may carry the subject past the sharp seed."""
    h, w = rgb.shape[:2]
    scale = (long_edge or max(h, w)) / 1024.0
    focus = focus_map(rgb, window=3.0 * max(scale, 0.5))
    cut, separability = otsu(focus.score.ravel())
    sharp = (focus.score > cut) & (focus.ratio > 0.12)
    blurred = focus.score <= cut
    texture = np.ones((h, w), bool)
    stats = {"otsu": cut, "separability": separability, "sharp_share": float(sharp.mean())}

    # The seed: textured sharp pixels, joined and cleaned. Specks are dropped; pieces separated by less than a few px merge.
    r = max(2.0, 5.0 * scale)
    seed = ndi.binary_opening(sharp, disk(1.0))
    seed = ndi.binary_closing(seed, disk(r), border_value=0)
    seed = ndi.binary_fill_holes(seed)
    labels, count = ndi.label(seed)
    if count:
        areas = ndi.sum(seed, labels, np.arange(1, count + 1))
        yy, xx = np.mgrid[0:h, 0:w]
        cy = ndi.mean(yy, labels, np.arange(1, count + 1)) / h - 0.5
        cx = ndi.mean(xx, labels, np.arange(1, count + 1)) / w - 0.5
        score = areas * np.exp(-(cx ** 2 + cy ** 2) / 0.18)  # larger and more central wins; small specks cannot
        keep = [i + 1 for i in range(count) if areas[i] >= 0.3 * areas.max() and areas[i] >= min_seed * h * w]
        # The best single piece always stays; others stay only when comparable in size (a second bird, a wing apart).
        keep = keep or [int(np.argmax(score)) + 1]
        seed = np.isin(labels, keep)
    share = float(seed.sum() / (h * w))
    stats["seed_share"] = share

    def finish(reason: str, confidence: float, subject: np.ndarray | None = None) -> Trimap:
        empty = np.zeros((h, w), bool)
        return Trimap(foreground=empty, background=np.ones((h, w), bool), subject=empty, seed=seed, focus=focus,
                      confidence=confidence, reason=reason, stats=stats) if subject is None else Trimap(
            foreground=empty, background=empty, subject=subject, seed=seed, focus=focus, confidence=confidence, reason=reason, stats=stats)

    if share < min_seed:
        return finish("no-sharp-subject", 0.0)
    if share > max_seed:
        # Most of the frame is sharp: nothing is defocused, so focus cannot say what is subject.
        return finish("sharp-everywhere", 0.0)

    # Colour cue: seeds are the interior of the sharp region and the blurred / distant pixels.
    fg_seed = ndi.binary_erosion(seed, disk(max(2.0, 3.0 * scale)))
    far = ~ndi.binary_dilation(seed, disk(max(6.0, 0.05 * max(h, w))))
    bg_seed = (blurred & ~ndi.binary_dilation(seed, disk(4.0))) | far
    if fg_seed.sum() < 50 or bg_seed.sum() < 50:
        return finish("seeds-too-small", 0.0)
    evidence = colour_evidence(rgb, fg_seed, bg_seed)
    stats["colour_gap"] = float(np.clip(np.median(evidence[fg_seed]) - np.median(evidence[bg_seed]), 0, 20))

    # Smooth pixels near the seed that look like the subject join it; textured-and-blurred pixels never do.
    reach = ndi.binary_dilation(seed, disk(max(4.0, grow * max(h, w))))
    candidate = (evidence > 0.3) & reach & ~(blurred & ~ndi.binary_dilation(seed, disk(2.0)))
    grown = ndi.binary_propagation(seed, mask=candidate | seed)
    grown = ndi.binary_opening(grown, disk(1.0)) | fg_seed
    grown = ndi.binary_closing(grown, disk(r))
    grown = ndi.binary_fill_holes(grown)

    fg = ndi.binary_erosion(grown, disk(inner * scale))
    bg = ~ndi.binary_dilation(grown, disk(outer * scale))
    # Confident-sharp pixels are never background, and confident-blurred ones far from the subject never foreground.
    bg &= ~seed
    fg &= ~(blurred & ~ndi.binary_dilation(seed, disk(3.0)))
    stats["grown_share"] = float(grown.sum() / (h * w))
    stats["band_share"] = float(((~fg) & (~bg)).sum() / (h * w))
    confidence = float(np.clip(separability, 0, 1)) * float(np.clip(stats["colour_gap"] / 4.0, 0.25, 1.0))
    return Trimap(foreground=fg, background=bg, subject=grown, seed=seed, focus=focus, confidence=confidence, evidence=evidence, stats=stats)
