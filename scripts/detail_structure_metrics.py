"""Read-only gradient agreement analysis for matched 16-bit RGB TIFF crops.

Diagnostics are not ground truth: references can be noisy or processed.
"""
import numpy as np


def _luminance(rgb):
    rgb = np.asarray(rgb, dtype=np.float32)
    if rgb.ndim != 3 or rgb.shape[2] != 3 or min(rgb.shape[:2]) < 3:
        raise ValueError("Expected an RGB crop of at least 3x3 pixels")
    if not np.all(np.isfinite(rgb)):
        raise ValueError("Non-finite RGB values are not valid")
    return (rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722) / 65535.0


def _gradients(luma):
    dx = (luma[1:-1, 2:] - luma[1:-1, :-2]) * 0.5
    dy = (luma[2:, 1:-1] - luma[:-2, 1:-1]) * 0.5
    return dx, dy


def compare_detail_structure(reference, candidate, *, edge_floor=1.0 / 1024):
    """Describe aligned, missing and extra edge energy.

    Candidate-only edges are suspicious relative to a reference, not proof
    of hallucination. Use blind visual inspection before quality decisions.
    """
    ref = _luminance(reference)
    cand = _luminance(candidate)
    if ref.shape != cand.shape:
        raise ValueError("Reference and candidate crop dimensions differ")
    if not (0 < edge_floor < 1):
        raise ValueError("edge_floor must be between zero and one")
    rx, ry = _gradients(ref)
    cx, cy = _gradients(cand)
    rmag = np.hypot(rx, ry)
    cmag = np.hypot(cx, cy)
    re = rmag > edge_floor
    ce = cmag > edge_floor
    paired = re & ce
    if np.any(paired):
        dot = rx[paired] * cx[paired] + ry[paired] * cy[paired]
        cosine = np.clip(dot / np.maximum(rmag[paired] * cmag[paired], 1e-12), -1, 1)
        agreement = float(cosine.mean())
    else:
        agreement = None
    n = ce.size
    return {
        "reference_edge_fraction": float(re.sum() / n),
        "candidate_edge_fraction": float(ce.sum() / n),
        "shared_edge_fraction": float(paired.sum() / n),
        "candidate_only_edge_fraction": float((ce & ~re).sum() / n),
        "reference_only_edge_fraction": float((re & ~ce).sum() / n),
        "mean_shared_edge_direction_cosine": agreement,
    }
