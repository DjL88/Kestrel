"""Find where a (possibly cropped, resized) final sits inside the RAW's embedded preview.

Pure numpy/scipy on small greyscale arrays. Model: the final is an axis-aligned crop of the preview,
same orientation, uniformly scaled. Returns the crop box as fractions plus a normalised
cross-correlation score (1 = perfect). Tone edits change brightness but NCC ignores gain/offset.
"""
import numpy as np
from scipy.signal import fftconvolve
from PIL import Image


def grey(im, long_edge):
    im = im.convert('L')
    s = long_edge / max(im.size)
    return np.asarray(im.resize((max(8, round(im.size[0] * s)), max(8, round(im.size[1] * s))), Image.BILINEAR), dtype=np.float64)


def ncc_map(img, tpl):
    th, tw = tpl.shape
    if img.shape[0] < th or img.shape[1] < tw:
        return None
    t0 = tpl - tpl.mean()
    tn = np.sqrt((t0 ** 2).sum()) + 1e-9
    ones = np.ones_like(tpl)
    s1 = fftconvolve(img, ones[::-1, ::-1], mode='valid')
    s2 = fftconvolve(img ** 2, ones[::-1, ::-1], mode='valid')
    n = tpl.size
    var = np.maximum(s2 - s1 ** 2 / n, 1e-9)
    cross = fftconvolve(img, t0[::-1, ::-1], mode='valid')
    return cross / (np.sqrt(var) * tn)


def best_crop(raw_im, final_im, tpl_edge=96, scales=None):
    """Return dict(box=(x0,y0,x1,y1) fractions of raw, ncc, scale) or None."""
    fw, fh = final_im.size
    rw, rh = raw_im.size
    # Compare in the raw's orientation/aspect; the crop fraction is c of raw width.
    tpl = grey(final_im, tpl_edge)
    th, tw = tpl.shape
    best = None
    for c in (scales if scales is not None else np.geomspace(1.0, 0.08, 28)):
        # the raw is resized so a crop of fraction c of its width is tw wide
        target_w = tw / c
        r = target_w / rw
        img = np.asarray(raw_im.convert('L').resize((max(tw, round(rw * r)), max(th, round(rh * r))), Image.BILINEAR), dtype=np.float64)
        m = ncc_map(img, tpl)
        if m is None:
            continue
        iy, ix = np.unravel_index(np.argmax(m), m.shape)
        v = float(m[iy, ix])
        if best is None or v > best['ncc']:
            best = {'ncc': v, 'c': float(c), 'x': ix / img.shape[1], 'y': iy / img.shape[0], 'w': tw / img.shape[1], 'h': th / img.shape[0]}
    if best is None:
        return None
    # refine the scale around the winner
    for c in np.geomspace(best['c'] * 0.9, min(1.0, best['c'] * 1.1), 9):
        r = (tw / c) / rw
        img = np.asarray(raw_im.convert('L').resize((max(tw, round(rw * r)), max(th, round(rh * r))), Image.BILINEAR), dtype=np.float64)
        m = ncc_map(img, tpl)
        if m is None:
            continue
        iy, ix = np.unravel_index(np.argmax(m), m.shape)
        v = float(m[iy, ix])
        if v > best['ncc']:
            best = {'ncc': v, 'c': float(c), 'x': ix / img.shape[1], 'y': iy / img.shape[0], 'w': tw / img.shape[1], 'h': th / img.shape[0]}
    best['box'] = (best['x'], best['y'], min(1.0, best['x'] + best['w']), min(1.0, best['y'] + best['h']))
    return best
