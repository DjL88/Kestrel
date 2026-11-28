"""Mask metrics: mean IoU, boundary F-score at several pixel tolerances, and an effort-to-fix proxy.

Conventions
-----------
* A prediction is a float alpha in [0, 1] (soft or binary). It is binarised at 0.5 for IoU and boundary scores.
  `soft_iou` keeps the softness (sum of min over sum of max).
* A ground truth is an 8-bit grey image made by the fixer tool (or any paint program):
    255 (>= 192)  subject
    128 (65..191) "uncertain edge band" (feather tips, fur): the owner could not say. Ignored by every metric, so a
                  source is neither rewarded nor punished for how it treats pixels the owner could not decide.
      0 (<= 64)   background
* All scores are computed at the ground truth's own size. Tolerances are in pixels of that size (the owner-pairs
  previews are 1024 px on the long edge, so 2/4/8 px are about 0.2/0.4/0.8 % of the frame).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, asdict

import numpy as np
from scipy import ndimage as ndi

FG_MIN = 192
BAND_MIN = 65  # BAND_MIN..FG_MIN-1 is the uncertain band
DEFAULT_TOLERANCES = (2, 4, 8)
#: An error region smaller than this (pixels) is edge wobble, not something a person would fix.
MIN_ERROR_AREA = 12
#: One brush stroke or lasso run is taken to cover about this much error boundary (pixels).
STROKE_LENGTH = 120


class SizeMismatch(ValueError):
    """Prediction and ground truth do not have the same shape (after allowing for rounding)."""


def split_ground_truth(gt_u8: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(subject, ignore) boolean masks from an 8-bit ground truth."""
    gt = np.asarray(gt_u8)
    if gt.ndim == 3:
        gt = gt[..., 0]
    return gt >= FG_MIN, (gt >= BAND_MIN) & (gt < FG_MIN)


def binarise(alpha: np.ndarray, threshold: float = 0.5) -> np.ndarray:
    return np.asarray(alpha, dtype=np.float32) >= threshold


def iou(pred: np.ndarray, subject: np.ndarray, ignore: np.ndarray | None = None) -> float:
    """Intersection over union of two boolean masks, ignoring `ignore` pixels. Both empty counts as perfect."""
    keep = np.ones(pred.shape, bool) if ignore is None else ~ignore
    p, g = pred & keep, subject & keep
    union = int(np.count_nonzero(p | g))
    return 1.0 if union == 0 else float(np.count_nonzero(p & g)) / union


def soft_iou(alpha: np.ndarray, subject: np.ndarray, ignore: np.ndarray | None = None) -> float:
    """Alpha-weighted IoU: sum(min(alpha, gt)) / sum(max(alpha, gt)). Rewards a soft edge that falls where it should."""
    keep = np.ones(alpha.shape, bool) if ignore is None else ~ignore
    a = np.asarray(alpha, dtype=np.float32)[keep]
    g = subject[keep].astype(np.float32)
    top = float(np.maximum(a, g).sum())
    return 1.0 if top == 0 else float(np.minimum(a, g).sum()) / top


def boundary(mask: np.ndarray) -> np.ndarray:
    """One-pixel inner boundary. The frame edge does not count as a boundary (a subject cut off by the frame has no edge there)."""
    return mask & ~ndi.binary_erosion(mask, border_value=1)


def boundary_f(pred: np.ndarray, subject: np.ndarray, tolerance: float, ignore: np.ndarray | None = None) -> dict:
    """Boundary precision, recall and F1: a boundary pixel is right when the other mask's boundary is within `tolerance` px.

    Where the ground truth has an uncertain band, boundary pixels within `tolerance` of the band are left out on both
    sides (the owner said "can't tell here"). `waived` is the share of the ground-truth boundary left out that way, so a
    reader can see how much of the boundary the score does not cover.
    """
    gb_all = boundary(subject)
    pb_all = boundary(pred)
    if ignore is not None and ignore.any():
        near_band = ndi.distance_transform_edt(~ignore) <= tolerance
    else:
        near_band = np.zeros(pred.shape, bool)
    g_eval = gb_all & ~near_band
    p_eval = pb_all & ~near_band
    waived = 1.0 - (np.count_nonzero(g_eval) / np.count_nonzero(gb_all)) if gb_all.any() else 0.0
    n_g, n_p = int(np.count_nonzero(g_eval)), int(np.count_nonzero(p_eval))
    if n_g == 0 and n_p == 0:
        return {"precision": 1.0, "recall": 1.0, "f": 1.0, "waived": waived}
    if n_g == 0 or n_p == 0:
        return {"precision": 0.0, "recall": 0.0, "f": 0.0, "waived": waived}
    # Distances use the full boundaries, so a pixel next to the waived zone still finds its partner inside it.
    to_g = ndi.distance_transform_edt(~gb_all) if gb_all.any() else np.full(pred.shape, np.inf)
    to_p = ndi.distance_transform_edt(~pb_all) if pb_all.any() else np.full(pred.shape, np.inf)
    precision = float(np.count_nonzero(to_g[p_eval] <= tolerance)) / n_p
    recall = float(np.count_nonzero(to_p[g_eval] <= tolerance)) / n_g
    f = 0.0 if precision + recall == 0 else 2 * precision * recall / (precision + recall)
    return {"precision": precision, "recall": recall, "f": f, "waived": waived}


@dataclass
class Effort:
    #: Rough number of brush strokes or lassos to fix the mask: 1 per error region plus 1 per `STROKE_LENGTH` px of its edge.
    strokes: int
    #: Separate error regions a person would see (specks under MIN_ERROR_AREA are not counted).
    regions: int
    #: Wrongly included (subject missing from the truth) and wrongly left out, as shares of the picture.
    false_positive_frac: float
    false_negative_frac: float


def effort_to_fix(pred: np.ndarray, subject: np.ndarray, ignore: np.ndarray | None = None) -> Effort:
    """An effort proxy in the spirit of IS-Net's HCE: count what a person would have to touch to turn `pred` into the truth.

    Each connected error region (wrong in or wrong out, after joining pieces one pixel apart) costs one stroke, plus one
    more for every STROKE_LENGTH pixels of its outline, because long thin errors (a missed wing, a leaked branch) take
    several strokes while a compact blob takes one fill. It is a proxy: the fixer logs the owner's real seconds per
    mask so the proxy can be checked against them (see score.py).
    """
    keep = np.ones(pred.shape, bool) if ignore is None else ~ignore
    fp = pred & ~subject & keep
    fn = ~pred & subject & keep
    strokes = regions = 0
    for error in (fp, fn):
        joined = ndi.binary_dilation(error, structure=np.ones((3, 3), bool))
        labels, count = ndi.label(joined, structure=np.ones((3, 3), bool))
        if count == 0:
            continue
        # Area of the real error pixels in each joined region, and its outline length (half the perimeter pixels).
        area = ndi.sum(error, labels, index=np.arange(1, count + 1))
        outline = boundary(joined)
        edge = ndi.sum(outline, labels, index=np.arange(1, count + 1))
        for a, e in zip(np.asarray(area), np.asarray(edge)):
            if a < MIN_ERROR_AREA:
                continue
            regions += 1
            strokes += 1 + int(e / 2 // STROKE_LENGTH)
    total = pred.size
    return Effort(strokes=strokes, regions=regions,
                  false_positive_frac=float(np.count_nonzero(fp)) / total,
                  false_negative_frac=float(np.count_nonzero(fn)) / total)


def resize_alpha(alpha: np.ndarray, shape: tuple[int, int]) -> np.ndarray:
    """Bilinear resize of a float alpha to (height, width)."""
    if alpha.shape == shape:
        return alpha
    h, w = shape
    zoom = (h / alpha.shape[0], w / alpha.shape[1])
    if abs(zoom[0] / zoom[1] - 1) > 0.02:
        raise SizeMismatch(f"prediction {alpha.shape[::-1]} and ground truth {(w, h)} have different shapes")
    out = ndi.zoom(np.asarray(alpha, dtype=np.float32), zoom, order=1, mode="nearest", grid_mode=True)
    # zoom can be off by a pixel from rounding; pad or crop to the exact shape.
    out = out[:h, :w]
    if out.shape != (h, w):
        out = np.pad(out, ((0, h - out.shape[0]), (0, w - out.shape[1])), mode="edge")
    return np.clip(out, 0, 1)


def score_pair(alpha: np.ndarray, gt_u8: np.ndarray, tolerances=DEFAULT_TOLERANCES) -> dict:
    """All metrics for one photo. `alpha` is float 0..1 (any size with the same aspect); `gt_u8` is the 8-bit truth."""
    subject, ignore = split_ground_truth(gt_u8)
    alpha = resize_alpha(np.asarray(alpha, dtype=np.float32), subject.shape)
    pred = binarise(alpha)
    row: dict = {"iou": iou(pred, subject, ignore), "soft_iou": soft_iou(alpha, subject, ignore)}
    for t in tolerances:
        b = boundary_f(pred, subject, t, ignore)
        row[f"f{t}"] = b["f"]
        row[f"precision{t}"] = b["precision"]
        row[f"recall{t}"] = b["recall"]
    row["boundary_waived"] = boundary_f(pred, subject, tolerances[0], ignore)["waived"]
    row.update({f"effort_{k}": v for k, v in asdict(effort_to_fix(pred, subject, ignore)).items()})
    row["subject_frac"] = float(np.count_nonzero(subject)) / subject.size
    row["pred_frac"] = float(np.count_nonzero(pred)) / pred.size
    row["ignored_frac"] = float(np.count_nonzero(ignore)) / ignore.size
    return row


def mean_or_nan(values) -> float:
    v = [x for x in values if x is not None and not math.isnan(x)]
    return float(sum(v) / len(v)) if v else float("nan")
