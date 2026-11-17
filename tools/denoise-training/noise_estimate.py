"""Measure a camera's real sensor noise from ordinary photographs, no test chart needed.

In a Bayer sensor the two green pixels in every 2 x 2 tile sit almost on top of each other, so they see nearly the same
light. Their difference is therefore almost pure noise: var(G1 - G2) = 2 * sigma^2, whatever the picture shows. Taking
this over smooth blocks of an image, then grouping blocks by brightness, gives the noise at each brightness. The
Poisson-Gaussian model of noise_model.py says sigma^2 = a * x + b^2, so a straight-line fit gives a and b.

Run on many photos at one ISO, this calibrates the training noise to the real camera, whatever its brand.
Only numpy is needed. Expects planes (4, H, W) in sensor units 0..1: R, G1, G2, B (see make_pairs.pack_rggb).
"""
from __future__ import annotations

import numpy as np


def estimate_noise(planes: np.ndarray, block: int = 16, min_blocks: int = 40) -> dict | None:
    """Return {'a', 'b2', 'blocks'} for one picture, or None when it has too few smooth, usable blocks."""
    _, h, w = planes.shape
    nh, nw = h // block, w // block
    if nh < 2 or nw < 2:
        return None
    g1 = planes[1, : nh * block, : nw * block].reshape(nh, block, nw, block)
    g2 = planes[2, : nh * block, : nw * block].reshape(nh, block, nw, block)
    mean = ((g1 + g2) / 2).mean(axis=(1, 3))
    diff = (g1 - g2)
    # Robust spread of the difference (median absolute deviation) so a stray edge does not inflate the estimate.
    centred = diff - np.median(diff, axis=(1, 3), keepdims=True)
    sigma2 = (1.4826 * np.median(np.abs(centred), axis=(1, 3))) ** 2 / 2.0
    # Smooth blocks only: little change in brightness across the block (brightness slope per pixel).
    smooth_plane = (g1 + g2) / 2
    slope = np.abs(np.diff(smooth_plane, axis=3)).mean(axis=(1, 3)) + np.abs(np.diff(smooth_plane, axis=1)).mean(axis=(1, 3))
    limit = np.median(slope) * 1.25
    usable = (slope <= limit) & (mean > 0.002) & (mean < 0.85)
    if int(usable.sum()) < min_blocks:
        return None
    m, v = mean[usable], sigma2[usable]
    # Average within brightness bins first, so the many dark blocks do not drown out the rest, then fit a straight line.
    edges = np.quantile(m, np.linspace(0, 1, 13))
    xs, ys = [], []
    for low, high in zip(edges[:-1], edges[1:]):
        pick = (m >= low) & (m <= high)
        if int(pick.sum()) >= 5:
            xs.append(float(m[pick].mean()))
            ys.append(float(v[pick].mean()))
    if len(xs) < 4:
        return None
    a, b2 = np.polyfit(xs, ys, 1)
    return {"a": float(max(a, 0.0)), "b2": float(max(b2, 0.0)), "blocks": int(usable.sum())}
