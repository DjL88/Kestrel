"""Closed-form alpha matting (Levin, Lischinski and Weiss, 2008), restricted to a band around the edge.

In every 3 x 3 window the photo's colours are assumed to lie on a line between a local foreground colour and a local
background colour, so alpha is an affine function of the pixel's colour inside the window. Eliminating the affine
coefficients gives a sparse quadratic cost  alpha' L alpha  whose minimum, with alpha fixed at 1 in the certain-subject
region and 0 in the certain-background region, is one sparse linear solve. No learned weights and no training data.

Only the pixels of the uncertain band are unknowns, so a 1024-px frame is a system of tens of thousands of unknowns, not
of a million.
"""
from __future__ import annotations

import numpy as np
import scipy.sparse as sp
from scipy import ndimage as ndi
from scipy.sparse.linalg import spsolve, cg

WINDOW = 3  # 3 x 3 windows, as in the paper
_OFFSETS = [(dy, dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1)]


def matting_laplacian(rgb: np.ndarray, centres: np.ndarray, eps: float = 1e-5, chunk: int = 20000) -> sp.csr_matrix:
    """The matting Laplacian of Levin et al., built only from windows centred where `centres` is true.

    `rgb` is float H x W x 3 in 0..1. The result is (H*W) x (H*W); rows for pixels whose every window was included are exact.
    """
    h, w, _ = rgb.shape
    flat = rgb.reshape(-1, 3).astype(np.float64)
    cy, cx = np.nonzero(centres)
    keep = (cy >= 1) & (cy < h - 1) & (cx >= 1) & (cx < w - 1)
    cy, cx = cy[keep], cx[keep]
    rows, cols, vals = [], [], []
    eye9 = np.eye(9)
    for start in range(0, len(cy), chunk):
        y, x = cy[start:start + chunk], cx[start:start + chunk]
        idx = np.stack([(y + dy) * w + (x + dx) for dy, dx in _OFFSETS], axis=1)  # K x 9
        c = flat[idx]  # K x 9 x 3
        mu = c.mean(axis=1, keepdims=True)
        d = c - mu
        cov = np.einsum("kni,knj->kij", d, d) / 9.0 + (eps / 9.0) * np.eye(3)[None]
        inv = np.linalg.inv(cov)
        g = np.einsum("kni,kij,kmj->knm", d, inv, d)  # K x 9 x 9
        v = eye9[None] - (1.0 + g) / 9.0
        rows.append(np.repeat(idx, 9, axis=1).ravel())
        cols.append(np.tile(idx, (1, 9)).ravel())
        vals.append(v.ravel())
    if not rows:
        return sp.csr_matrix((h * w, h * w))
    return sp.coo_matrix((np.concatenate(vals), (np.concatenate(rows), np.concatenate(cols))), shape=(h * w, h * w)).tocsr()


def solve_alpha(rgb: np.ndarray, foreground: np.ndarray, background: np.ndarray, eps: float = 1e-5,
                max_direct: int = 250_000, prior: np.ndarray | None = None, prior_weight: np.ndarray | None = None,
                lam: float = 0.05, smooth: float = 0.0) -> np.ndarray:
    """Alpha (float32, H x W) with 1 on `foreground`, 0 on `background`, solved on everything else.

    `foreground` and `background` are boolean masks (the trimap's certain regions). Pixels in neither are the band.
    `prior` (0..1) and `prior_weight` (0..1) are an optional colour cue added as  lam * w * (alpha - prior)^2 : it pulls
    the matte towards 0 where a pixel's colour looks like the background and towards 1 where it looks like the subject,
    and does nothing where the colours cannot tell (weight 0). `smooth` blurs the photo (sigma, px) before the matting
    Laplacian is built, because the colour-line model breaks on strong fine texture inside the subject.
    """
    h, w, _ = rgb.shape
    if smooth > 0:
        rgb = np.stack([ndi.gaussian_filter(np.asarray(rgb[..., c], np.float64), smooth) for c in range(3)], axis=-1)
    unknown = ~(foreground | background)
    alpha = foreground.astype(np.float64).copy()
    if not unknown.any():
        return alpha.astype(np.float32)
    # Every window that touches an unknown pixel must be present for the unknown rows to be exact.
    centres = ndi.binary_dilation(unknown, structure=np.ones((3, 3), bool))
    L = matting_laplacian(np.asarray(rgb, np.float64), centres, eps)
    u = np.flatnonzero(unknown.ravel())
    k_fg = np.flatnonzero(foreground.ravel())
    rows = L[u]
    A = rows[:, u].tocsc()
    b = -np.asarray(rows[:, k_fg].sum(axis=1)).ravel()  # fixed alpha is 1 on the foreground, 0 on the background
    if prior is not None and prior_weight is not None:
        weight = lam * np.asarray(prior_weight, np.float64).ravel()[u]
        A = A + sp.diags(weight, format="csc")
        b = b + weight * np.asarray(prior, np.float64).ravel()[u]
    A = A + sp.identity(len(u), format="csc") * 1e-9
    if len(u) <= max_direct:
        x = spsolve(A, b)
    else:  # very wide bands: iterate instead of factorising
        x, _ = cg(A, b, rtol=1e-6, maxiter=2000)
    alpha.ravel()[u] = np.clip(x, 0.0, 1.0)
    return alpha.astype(np.float32)
