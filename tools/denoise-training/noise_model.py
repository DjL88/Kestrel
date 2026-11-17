"""Camera-agnostic sensor noise for building denoiser training pairs.

Raw sensor noise has two parts that matter: shot noise (light arrives in whole photons, so its variance grows with the
signal) and read noise (a fixed floor added by the electronics). In sensor units normalised to 0..1 the variance of a
pixel with true value x is

    var(x) = a * x + b**2          (the "Poisson-Gaussian" model)

where `a` rises with ISO (more gain, fewer electrons per unit) and `b` is the read-noise floor. This is the model used
by the research literature and it fits every Bayer sensor to a first approximation, whatever the brand. The defaults
below are plausible values for a modern full-frame sensor, NOT measurements of any one camera: they must be calibrated
per camera from dark frames and flat fields before any claim about a particular body.

Only numpy is needed.
"""
from __future__ import annotations

import numpy as np

BASE_ISO = 100.0
# Normalised units: one electron is about 1 / full-well-capacity. A modern full-frame sensor holds about 50,000 e- at
# base ISO, so a is about 2e-5 at ISO 100 and scales with the gain.
SHOT_GAIN_AT_BASE_ISO = 2.0e-5
# Read noise in electrons at base ISO, falling a little as the gain rises (modern sensors switch to a lower-noise path).
READ_NOISE_E_AT_BASE = 3.0


def noise_params(iso: float) -> tuple[float, float]:
    """Return (a, b): shot-noise gain and read-noise standard deviation, in normalised sensor units, at this ISO."""
    if iso <= 0:
        raise ValueError("ISO must be positive")
    gain = iso / BASE_ISO
    a = SHOT_GAIN_AT_BASE_ISO * gain
    # In electrons, read noise falls slowly as gain rises (modern sensors switch to a quieter path), so use gain ** -0.25.
    read_electrons = READ_NOISE_E_AT_BASE / max(gain, 1.0) ** 0.25
    b = SHOT_GAIN_AT_BASE_ISO * gain * read_electrons
    return float(a), float(b)


def add_noise(clean: np.ndarray, a: float, b: float, rng: np.random.Generator) -> np.ndarray:
    """Return a noisy copy of `clean` (floats, 0..1 sensor units). The input is never modified."""
    if a < 0 or b < 0:
        raise ValueError("noise parameters must not be negative")
    x = np.clip(np.asarray(clean, dtype=np.float64), 0.0, None)
    if a > 0:
        shot = rng.poisson(x / a).astype(np.float64) * a
    else:
        shot = x
    return (shot + rng.normal(0.0, b, size=x.shape)).astype(np.float32)


def sample_iso(rng: np.random.Generator, low: float = 400.0, high: float = 51200.0) -> float:
    """A log-uniform ISO, so every stop of sensitivity is equally represented in the training set."""
    return float(np.exp(rng.uniform(np.log(low), np.log(high))))
