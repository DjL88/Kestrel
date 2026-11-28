"""Tonal-and-colour zones: the picture cut into regions that follow contours, as candidate regions for the trimap.

The editor's brightness-range masks (`TONAL_PRESETS` in `src/core/maskTypes.ts`: blacks 0-0.12, shadows to 0.35, the middle,
highlights from 0.65, whites from 0.88, on the picture's encoded Rec. 709 brightness as in `lumaFromRgba8`) cut an image into
tonal areas that hug edges. This module uses the same boundaries as five disjoint brightness zones, splits each by a coarse
hue sector (plus one "neutral" sector for grey), takes connected components, and folds fragments that are too small into
their neighbours. The result is a superpixel-like partition with no training data.

A zone is only a candidate: `Trimap` votes each zone subject or background from how much of it the focus map calls sharp,
so a zone that straddles the edge (subject and background alike in tone and hue) stays uncertain and is solved by matting.
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage as ndi

#: Boundaries between the editor's tonal presets (blacks | shadows-only | midtones | highlights-only | whites).
TONAL_EDGES = (0.12, 0.35, 0.65, 0.88)
HUE_SECTORS = 6


def brightness(rgb: np.ndarray) -> np.ndarray:
    """Rec. 709 weights on the encoded values, 0..1: the same brightness the editor's tonal masks measure."""
    x = np.asarray(rgb, np.float32)
    if x.max() > 1.5:
        x = x / 255.0
    return 0.2126 * x[..., 0] + 0.7152 * x[..., 1] + 0.0722 * x[..., 2]


def tonal_colour_zones(rgb: np.ndarray, smooth: float = 1.5, min_area: int = 60, neutral_chroma: float = 8.0) -> tuple[np.ndarray, int]:
    """Zone labels (0..n-1, int32, H x W) and n. `smooth` (px) stops grain splitting a zone; `min_area` folds slivers away."""
    from .trimap import srgb_to_lab  # local import: trimap imports this module's consumers
    x = np.asarray(rgb, np.float32)
    if x.max() > 1.5:
        x = x / 255.0
    sm = np.stack([ndi.gaussian_filter(x[..., c], smooth) for c in range(3)], axis=-1)
    band = np.digitize(brightness(sm), TONAL_EDGES)
    lab = srgb_to_lab(sm)
    chroma = np.hypot(lab[..., 1], lab[..., 2])
    hue = np.arctan2(lab[..., 2], lab[..., 1])
    sector = np.where(chroma < neutral_chroma, 0, 1 + (((hue + np.pi) / (2 * np.pi)) * HUE_SECTORS).astype(np.int32) % HUE_SECTORS)
    code = band * (HUE_SECTORS + 1) + sector
    labels = np.zeros(code.shape, np.int32)
    next_label = 0
    for c in np.unique(code):
        comp, n = ndi.label(code == c)
        labels[comp > 0] = comp[comp > 0] + next_label
        next_label += n
    areas = np.bincount(labels.ravel(), minlength=next_label + 1)
    big = (areas[labels] >= min_area)
    if big.any() and not big.all():
        _, (iy, ix) = ndi.distance_transform_edt(~big, return_indices=True)
        labels = labels[iy, ix]
    _, compact = np.unique(labels, return_inverse=True)
    compact = compact.reshape(labels.shape).astype(np.int32)
    return compact, int(compact.max()) + 1


def zone_share(zones: np.ndarray, region: np.ndarray) -> np.ndarray:
    """For each zone, the share of its pixels inside `region`."""
    n = int(zones.max()) + 1
    size = np.bincount(zones.ravel(), minlength=n).astype(np.float64)
    inside = np.bincount(zones.ravel(), weights=region.ravel().astype(np.float64), minlength=n)
    return inside / np.maximum(size, 1)


def edge_adherence(zones: np.ndarray, truth_edge: np.ndarray, tolerance: float = 2.0) -> float:
    """Share of the true edge (boolean image) lying within `tolerance` px of a zone boundary: do the zones follow the contour?"""
    boundary = np.zeros(zones.shape, bool)
    boundary[:, 1:] |= zones[:, 1:] != zones[:, :-1]
    boundary[1:, :] |= zones[1:, :] != zones[:-1, :]
    near = ndi.distance_transform_edt(~boundary) <= tolerance
    return float(near[truth_edge].mean()) if truth_edge.any() else 1.0
