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


class NoiseProfile:
    """Measured noise per camera (from calibrate_noise.py), with the generic model above as the fallback.

    The JSON holds, for each camera, the measured (ISO, a, b) points. Between and beyond them, log(a) and log(b) are
    fitted as straight lines against log(ISO); with a single ISO measured, the generic slopes are used (a grows in step
    with ISO, b a little slower)."""

    def __init__(self, cameras: dict | None = None):
        self.cameras = cameras or {}
        self._fits: dict[str, tuple[tuple[float, float], tuple[float, float]]] = {}
        for camera, entry in self.cameras.items():
            points = [p for p in entry.get("points", []) if p["a"] > 0 and p["b"] > 0]
            if points:
                self._fits[camera] = (_fit_log(points, "a", 1.0), _fit_log(points, "b", 0.75))

    @classmethod
    def load(cls, path) -> "NoiseProfile":
        import json
        from pathlib import Path

        if path is None or not Path(path).exists():
            return cls()
        return cls(json.loads(Path(path).read_text()).get("cameras", {}))

    def measured(self, camera: str) -> bool:
        return camera in self._fits

    def params(self, camera: str, iso: float) -> tuple[float, float]:
        if iso <= 0:
            raise ValueError("ISO must be positive")
        fit = self._fits.get(camera)
        if fit is None:
            return noise_params(iso)
        (a0, a1), (b0, b1) = fit
        x = float(np.log(iso))
        return float(np.exp(a0 + a1 * x)), float(np.exp(b0 + b1 * x))


def _fit_log(points: list[dict], key: str, default_slope: float) -> tuple[float, float]:
    """Intercept and slope of log(value) against log(ISO); the default slope when only one ISO was measured."""
    x = np.log([p["iso"] for p in points])
    y = np.log([p[key] for p in points])
    if np.ptp(x) < 0.3:  # less than about half a stop of spread: a slope would be noise
        return float(np.mean(y) - default_slope * np.mean(x)), default_slope
    slope, intercept = np.polyfit(x, y, 1)
    return float(intercept), float(slope)
