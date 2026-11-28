"""Focus / defocus map from local gradient energy. No learned weights.

A photographed subject in focus has fine texture (barbs, fur, scales); a defocused background keeps its large soft shapes
and loses its fine texture. So the share of local energy that sits in the finest band tells sharp from blurred, as long
as there is any texture to judge. Where there is none (a smooth belly, a clear sky) the map says "cannot tell" through
`confidence`, never "blurred": flat pixels are not evidence of defocus.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import ndimage as ndi


@dataclass
class FocusMap:
    #: 0 (blurred or flat) to 1 (strongly textured at the finest scale): log of the fine-band energy above the noise floor.
    score: np.ndarray
    #: Share of local band energy that sits in the finest band (0 to 1). In focus a textured area keeps a good share there;
    #: a soft edge of any contrast has almost none. Used to veto "sharp" calls that come from contrast alone.
    ratio: np.ndarray
    #: Fine-band and mid-band local energy after removing the noise floor (for diagnostics).
    fine: np.ndarray
    mid: np.ndarray
    noise_floor: float


def luma(rgb: np.ndarray) -> np.ndarray:
    x = np.asarray(rgb, np.float32)
    if x.max() > 1.5:
        x = x / 255.0
    return 0.299 * x[..., 0] + 0.587 * x[..., 1] + 0.114 * x[..., 2]


def focus_map(rgb: np.ndarray, window: float = 3.0, fine_sigma: float = 1.0, mid_sigma: float = 2.5) -> FocusMap:
    """`window` is the local averaging scale in px (for a working size of about 1024 px on the long edge)."""
    L = luma(rgb)
    g1 = ndi.gaussian_filter(L, fine_sigma)
    g2 = ndi.gaussian_filter(L, mid_sigma)
    fine = ndi.gaussian_filter((L - g1) ** 2, window)
    mid = ndi.gaussian_filter((g1 - g2) ** 2, window)
    # Noise floor: the quietest few percent of the picture. A frame that is sharp everywhere has no quiet part, so its
    # floor is high and its score range is squashed: `build_trimap` reads that as "nothing is defocused".
    nf_fine = float(np.percentile(fine, 3)) + 1e-9
    nf_mid = float(np.percentile(mid, 3)) + 1e-9
    fine_c = np.maximum(fine - nf_fine, 0)
    mid_c = np.maximum(mid - nf_mid, 0)
    z = np.log10(1.0 + fine_c / nf_fine)  # decades of fine-band energy above the floor
    top = max(float(np.percentile(z, 97)), 1.0)
    score = np.clip(z / top, 0, 1).astype(np.float32)
    ratio = (fine_c / (fine_c + mid_c + 1e-12)).astype(np.float32)
    return FocusMap(score=score, ratio=ratio, fine=fine_c.astype(np.float32), mid=mid_c.astype(np.float32), noise_floor=nf_fine)


def otsu(values: np.ndarray, weights: np.ndarray | None = None, bins: int = 64) -> tuple[float, float]:
    """Otsu threshold of values in [0, 1] and its separability (between-class variance over total variance, 0..1)."""
    hist, edges = np.histogram(values, bins=bins, range=(0, 1), weights=weights)
    hist = hist.astype(np.float64)
    total = hist.sum()
    if total <= 0:
        return 0.5, 0.0
    centres = (edges[:-1] + edges[1:]) / 2
    w0 = np.cumsum(hist)
    w1 = total - w0
    m0 = np.cumsum(hist * centres) / np.maximum(w0, 1e-12)
    m1 = (np.sum(hist * centres) - np.cumsum(hist * centres)) / np.maximum(w1, 1e-12)
    between = w0 * w1 * (m0 - m1) ** 2 / (total * total)
    k = int(np.argmax(between))
    mean = np.sum(hist * centres) / total
    var = np.sum(hist * (centres - mean) ** 2) / total
    return float(centres[k]), float(between[k] / var) if var > 1e-12 else 0.0
