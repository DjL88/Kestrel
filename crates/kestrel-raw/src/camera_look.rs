//! The "As shot look": every RAW starts out looking like the camera's own JPEG.
//!
//! Almost every RAW file carries the JPEG the camera made from it (the picture shown on the camera's screen). It holds
//! the camera's picture style: its tone curve, contrast, white balance rendering and saturation. If the photo looked
//! good on the camera, it should look the same in InFlight from the first frame, and every edit starts from there.
//!
//! Kestrel's own develop (`scene_develop`) still does the work only a RAW develop can do: full resolution, highlight
//! rebuilding, the shoulder, colour noise and capture sharpening. This module then measures, on a small grid, how the
//! camera's JPEG differs from that develop and learns a correction that is applied to every pixel:
//!
//! 1. one smooth, rising tone curve per channel (contrast, black point, tone and white balance rendering), then
//! 2. a 3 x 3 colour mix that keeps neutrals neutral (saturation and the camera's hue shifts).
//!
//! It is honest about what it is: a fit, not the camera's own processing. Local effects the camera adds (Active
//! D-Lighting, HDR tone mapping on phones) are only matched on average. Where the camera's JPEG is clipped to white or
//! black, that sample only says "at least this bright", so it is left out and Kestrel keeps the highlight detail the
//! RAW holds; the curves never go flat, so nothing the sensor recorded is thrown away. When the file has no usable JPEG,
//! or the JPEG is not the same picture (a different crop, a mismatch), nothing is applied and Kestrel's own look is
//! kept.
//!
//! Pure: no files, no clock, no platform calls.

use image::{ImageBuffer, Rgb, RgbImage};
use rawler::decoders::RawDecodeParams;
use rawler::rawsource::RawSource;
use rayon::prelude::*;

/// The text the app can look for in the developed JPEG (`with_comment`). Versioned so it can change safely.
pub const AS_SHOT_LOOK_PREFIX: &str = "InFlight-AsShotLook/1 ";

/// Grid cells along the long edge used to compare the two pictures.
const GRID_LONG: usize = 128;
/// Sample points per grid cell along each axis.
const CELL_SAMPLES: usize = 6;
/// Tone curve bins per channel.
const BINS: usize = 40;
/// Share of the identity line mixed into each curve, so it always rises (no detail is crushed or clipped).
const MIN_SLOPE_MIX: f32 = 0.04;
/// The JPEG is accepted only if, after the fit, the two pictures agree to within this many 8-bit levels on average.
/// A different picture (or the right one the wrong way round) stays far above it, typically 35 to 50.
const MAX_FITTED_ERROR: f32 = 20.0;
/// Pictures whose shapes differ by more than this are not the same frame.
const ASPECT_TOLERANCE: f32 = 0.035;

/// A fitted As shot look.
#[derive(Clone, Debug)]
pub struct CameraLook {
    /// Per channel: display value (16-bit) to curved value (0..1).
    curves: [Vec<f32>; 3],
    /// Applied after the curves, in display space. Each row sums to 1, so neutrals stay neutral.
    matrix: [[f32; 3]; 3],
    /// Mean difference from the camera's JPEG, in 8-bit levels, before and after the fit (on the comparison grid).
    pub before: f32,
    pub after: f32,
}

impl CameraLook {
    /// The text written into the developed JPEG so the app can say the camera's look is in use.
    pub fn comment(&self) -> String {
        format!("{AS_SHOT_LOOK_PREFIX}before={:.1} after={:.1}", self.before, self.after)
    }

    /// Apply the look to a developed picture in place (16-bit display-encoded sRGB).
    pub fn apply(&self, image: &mut ImageBuffer<Rgb<u16>, Vec<u16>>) {
        let m = self.matrix;
        let identity = is_identity(&m);
        let curves = &self.curves;
        let w = image.width() as usize;
        if w == 0 {
            return;
        }
        image.as_mut().par_chunks_mut(w * 3).for_each(|row| {
            for px in row.chunks_exact_mut(3) {
                let c = [curves[0][px[0] as usize], curves[1][px[1] as usize], curves[2][px[2] as usize]];
                let out = if identity { c } else { mix(&m, c) };
                for (slot, v) in px.iter_mut().zip(out) {
                    *slot = (v.clamp(0.0, 1.0) * 65535.0 + 0.5) as u16;
                }
            }
        });
    }

    fn map(&self, v: [f32; 3]) -> [f32; 3] {
        let c = [0, 1, 2].map(|i| self.curves[i][(v[i].clamp(0.0, 1.0) * 65535.0 + 0.5) as usize]);
        mix(&self.matrix, c).map(|x| x.clamp(0.0, 1.0))
    }
}

/// The camera's own JPEG inside the RAW file (the largest preview), if there is one.
pub fn embedded_preview(bytes: &[u8]) -> Option<RgbImage> {
    let found = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let source = RawSource::new_from_slice(bytes);
        let decoder = rawler::get_decoder(&source).ok()?;
        decoder.preview_image(&source, &RawDecodeParams { image_index: 0 }).ok().flatten()
    }))
    .ok()
    .flatten()?;
    let preview = found.to_rgb8();
    // A postage-stamp thumbnail is too coarse to learn a look from.
    (preview.width().max(preview.height()) >= 320).then_some(preview)
}

/// Fit the As shot look of `bytes` to the developed picture `developed` (before orientation) and apply it.
/// Returns the look used, or None when the file has no usable camera JPEG (the picture is then left as it was).
pub fn match_camera(bytes: &[u8], developed: &mut ImageBuffer<Rgb<u16>, Vec<u16>>) -> Option<CameraLook> {
    let preview = embedded_preview(bytes)?;
    let look = fit(developed, &preview)?;
    look.apply(developed);
    Some(look)
}

/// Learn the look that takes `developed` to `reference` (the camera's JPEG). The reference may be stored either way
/// round; each orientation that fits the shape is tried and the closest kept. None when they are not the same picture.
pub fn fit(developed: &ImageBuffer<Rgb<u16>, Vec<u16>>, reference: &RgbImage) -> Option<CameraLook> {
    let (w, h) = (developed.width() as usize, developed.height() as usize);
    let (rw, rh) = (reference.width() as usize, reference.height() as usize);
    if w < 16 || h < 16 || rw < 16 || rh < 16 {
        return None;
    }
    let (gw, gh) = grid_size(w, h);
    let ours = grid(gw, gh, w, h, |x, y| {
        let p = developed.get_pixel(x as u32, y as u32).0;
        [p[0] as f32 / 65535.0, p[1] as f32 / 65535.0, p[2] as f32 / 65535.0]
    });
    let aspect = w as f32 / h as f32;
    let same = ((rw as f32 / rh as f32) / aspect - 1.0).abs() < ASPECT_TOLERANCE;
    let swapped = ((rh as f32 / rw as f32) / aspect - 1.0).abs() < ASPECT_TOLERANCE;
    // Turns of the reference to try: 0 and 180 degrees when the shapes agree, 90 either way when they are swapped.
    let turns: &[u8] = match (same, swapped) {
        (true, true) => &[0, 1, 2, 3],
        (true, false) => &[0, 2],
        (false, true) => &[1, 3],
        _ => return None,
    };
    let reference_px = |x: usize, y: usize| {
        let p = reference.get_pixel(x as u32, y as u32).0;
        [p[0] as f32 / 255.0, p[1] as f32 / 255.0, p[2] as f32 / 255.0]
    };
    turns
        .iter()
        .filter_map(|&turn| {
            // Sample the reference in our picture's frame: (x, y) on our grid, mapped through the turn.
            let (sw, sh) = if turn % 2 == 1 { (rh, rw) } else { (rw, rh) };
            let theirs = grid(gw, gh, sw, sh, |x, y| {
                let (sx, sy) = match turn {
                    0 => (x, y),
                    1 => (y, rh - 1 - x),         // reference is our picture turned 90 degrees anticlockwise
                    2 => (rw - 1 - x, rh - 1 - y),
                    _ => (rw - 1 - y, x),         // turned 90 degrees clockwise
                };
                reference_px(sx, sy)
            });
            fit_grids(&ours, &theirs, gw, gh)
        })
        .min_by(|a, b| a.after.total_cmp(&b.after))
}

fn grid_size(w: usize, h: usize) -> (usize, usize) {
    if w >= h {
        (GRID_LONG, ((GRID_LONG * h + w / 2) / w).max(8))
    } else {
        (((GRID_LONG * w + h / 2) / h).max(8), GRID_LONG)
    }
}

/// Average a picture of size w x h down to gw x gh cells, sampling a few evenly spaced points in each cell.
fn grid(gw: usize, gh: usize, w: usize, h: usize, px: impl Fn(usize, usize) -> [f32; 3] + Sync) -> Vec<[f32; 3]> {
    (0..gw * gh)
        .into_par_iter()
        .map(|i| {
            let (cx, cy) = (i % gw, i / gw);
            let mut sum = [0f32; 3];
            for sy in 0..CELL_SAMPLES {
                for sx in 0..CELL_SAMPLES {
                    let fx = (cx as f32 + (sx as f32 + 0.5) / CELL_SAMPLES as f32) / gw as f32;
                    let fy = (cy as f32 + (sy as f32 + 0.5) / CELL_SAMPLES as f32) / gh as f32;
                    let x = ((fx * w as f32) as usize).min(w - 1);
                    let y = ((fy * h as f32) as usize).min(h - 1);
                    let p = px(x, y);
                    for c in 0..3 {
                        sum[c] += p[c];
                    }
                }
            }
            let n = (CELL_SAMPLES * CELL_SAMPLES) as f32;
            sum.map(|v| v / n)
        })
        .collect()
}

struct Sample {
    ours: [f32; 3],
    theirs: [f32; 3],
    weight: f32,
}

/// Is a reference value clipped (it only says "at least" or "at most" this)?
fn censored(v: f32) -> bool {
    !(1.5 / 255.0..=253.5 / 255.0).contains(&v)
}

fn fit_grids(ours: &[[f32; 3]], theirs: &[[f32; 3]], gw: usize, gh: usize) -> Option<CameraLook> {
    // Compare only the middle of the frame (crops and corner shading differ most at the edges), and trust flat areas
    // more than edges, where a slight misalignment between the two pictures would mislead the fit.
    let luma = |p: &[f32; 3]| 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
    let (mx, my) = (gw / 16 + 1, gh / 16 + 1);
    let mut samples = Vec::with_capacity(gw * gh);
    for y in my..gh - my {
        for x in mx..gw - mx {
            let i = y * gw + x;
            let l = luma(&theirs[i]);
            let gradient = [i - 1, i + 1, i - gw, i + gw]
                .iter()
                .map(|&j| (luma(&theirs[j]) - l).abs().max((luma(&ours[j]) - luma(&ours[i])).abs()))
                .fold(0f32, f32::max);
            let weight = 1.0 / (1.0 + (gradient / 0.03).powi(2));
            samples.push(Sample { ours: ours[i], theirs: theirs[i], weight });
        }
    }
    if samples.len() < 64 {
        return None;
    }
    let curves = steady_white_balance([0, 1, 2].map(|c| fit_curve(&samples, c)));
    let curved: Vec<[f32; 3]> = samples.iter().map(|s| [0, 1, 2].map(|c| curves[c][(s.ours[c] * 65535.0 + 0.5) as usize])).collect();
    let matrix = fit_matrix(&samples, &curved);
    let look = CameraLook { curves, matrix, before: 0.0, after: 0.0 };
    let error = |f: &dyn Fn(&Sample) -> [f32; 3]| {
        let (mut sum, mut total) = (0f32, 0f32);
        for s in &samples {
            let p = f(s);
            for c in 0..3 {
                if !censored(s.theirs[c]) {
                    sum += (p[c] - s.theirs[c]).abs() * s.weight;
                    total += s.weight;
                }
            }
        }
        if total > 0.0 { sum / total * 255.0 } else { f32::INFINITY }
    };
    let before = error(&|s| s.ours);
    let after = error(&|s| look.map(s.ours));
    // The fit must explain most of the difference, unless the two already agree closely.
    if !after.is_finite() || after > MAX_FITTED_ERROR || (before > 4.0 && after > 0.75 * before) || after > before {
        return None;
    }
    Some(CameraLook { before, after, ..look })
}

/// One channel's tone curve: binned averages of the camera's value at each of our values, made rising (pool adjacent
/// violators), joined smoothly (monotone cubic) and mixed with a little of the identity line. 65,536 entries.
fn fit_curve(samples: &[Sample], c: usize) -> Vec<f32> {
    let mut sx = [0f32; BINS];
    let mut sy = [0f32; BINS];
    let mut sw = [0f32; BINS];
    for s in samples.iter().filter(|s| !censored(s.theirs[c])) {
        let b = ((s.ours[c] * BINS as f32) as usize).min(BINS - 1);
        sx[b] += s.ours[c] * s.weight;
        sy[b] += s.theirs[c] * s.weight;
        sw[b] += s.weight;
    }
    // (x, y, weight) per bin with enough evidence, in rising x.
    let mut points: Vec<(f32, f32, f32)> = (0..BINS).filter(|&b| sw[b] >= 1.0).map(|b| (sx[b] / sw[b], sy[b] / sw[b], sw[b])).collect();
    if points.len() < 3 {
        return (0..65536).map(|v| v as f32 / 65535.0).collect();
    }
    // Pool adjacent violators: merge neighbouring bins until y never falls.
    let mut pooled: Vec<(f32, f32, f32)> = Vec::with_capacity(points.len());
    for p in points.drain(..) {
        pooled.push(p);
        while pooled.len() >= 2 && pooled[pooled.len() - 2].1 > pooled[pooled.len() - 1].1 {
            let b = pooled.pop().unwrap();
            let a = pooled.pop().unwrap();
            let w = a.2 + b.2;
            pooled.push(((a.0 * a.2 + b.0 * b.2) / w, (a.1 * a.2 + b.1 * b.2) / w, w));
        }
    }
    let mut knots: Vec<(f32, f32)> = Vec::with_capacity(pooled.len() + 2);
    knots.push((0.0, 0.0));
    for (x, y, _) in pooled {
        if x > knots.last().unwrap().0 + 1e-4 && x < 1.0 - 1e-4 {
            knots.push((x, y.max(knots.last().unwrap().1)));
        }
    }
    knots.push((1.0, 1.0f32.max(knots.last().unwrap().1)));
    let curve = monotone_cubic(&knots);
    (0..65536)
        .map(|v| {
            let x = v as f32 / 65535.0;
            (curve(x) * (1.0 - MIN_SLOPE_MIX) + x * MIN_SLOPE_MIX).clamp(0.0, 1.0)
        })
        .collect()
}

/// Coarse points across the curves for `steady_white_balance` (every 64th of the 65,536 entries, and the last).
const STEADY_POINTS: usize = 1025;

/// Keep one shared tone curve, and let each channel differ from it only by a gentle, steady tint.
///
/// Each channel's curve is learned from grid cells binned by brightness, and at any one brightness most cells are
/// whatever the scene has there: green-brown grass in the mid-tones, blue sky higher up. Fitted on their own, the three
/// curves picked those colours up as if they were the camera's tone response, and pulled apart and back together across
/// the range. A neutral grey then changed hue as it got brighter (on the owner's dawn puffin, a grey went from +16 red
/// at level 160 to -23 blue at level 184), so the smooth shading on a white belly became pink and blue-green blotches the
/// camera's own JPEG doesn't have.
///
/// A camera's white-balance rendering is a steady tint that fades to nothing at black and at white. So each channel's
/// difference from the shared curve is replaced by the closest curve of that kind, x(1-x)(a + bx) (least squares):
/// it can be warmer or cooler, more in the shadows or the highlights, but it cannot swing back and forth with the scene.
fn steady_white_balance(curves: [Vec<f32>; 3]) -> [Vec<f32>; 3] {
    let n = STEADY_POINTS;
    let index = |k: usize| (k * 64).min(65535);
    let x = |k: usize| index(k) as f64 / 65535.0;
    let mean: Vec<f64> = (0..n).map(|k| (0..3).map(|c| curves[c][index(k)] as f64).sum::<f64>() / 3.0).collect();
    curves.map(|curve| {
        // Least squares for difference(x) ~ a * x(1-x) + b * x^2(1-x).
        let (mut s11, mut s12, mut s22, mut r1, mut r2) = (0f64, 0f64, 0f64, 0f64, 0f64);
        for k in 0..n {
            let (u, d) = (x(k), curve[index(k)] as f64 - mean[k]);
            let (p1, p2) = (u * (1.0 - u), u * u * (1.0 - u));
            s11 += p1 * p1; s12 += p1 * p2; s22 += p2 * p2; r1 += p1 * d; r2 += p2 * d;
        }
        let det = s11 * s22 - s12 * s12;
        let (a, b) = if det.abs() > 1e-12 { ((r1 * s22 - r2 * s12) / det, (r2 * s11 - r1 * s12) / det) } else { (0.0, 0.0) };
        let mut coarse: Vec<f32> = (0..n).map(|k| {
            let u = x(k);
            (mean[k] + u * (1.0 - u) * (a + b * u)).clamp(0.0, 1.0) as f32
        }).collect();
        for k in 1..n {
            coarse[k] = coarse[k].max(coarse[k - 1]);
        }
        (0..65536usize).map(|v| {
            let at = v as f32 / 64.0;
            let k = (at as usize).min(n - 2);
            let t = at - k as f32;
            coarse[k] * (1.0 - t) + coarse[k + 1] * t
        }).collect()
    })
}

/// Fritsch-Carlson monotone cubic through rising knots (x strictly rising, y never falling).
fn monotone_cubic(knots: &[(f32, f32)]) -> impl Fn(f32) -> f32 + '_ {
    let n = knots.len();
    let delta: Vec<f32> = (0..n - 1).map(|i| (knots[i + 1].1 - knots[i].1) / (knots[i + 1].0 - knots[i].0)).collect();
    let mut m = vec![0f32; n];
    m[0] = delta[0];
    m[n - 1] = delta[n - 2];
    for i in 1..n - 1 {
        m[i] = if delta[i - 1] * delta[i] <= 0.0 { 0.0 } else { (delta[i - 1] + delta[i]) / 2.0 };
    }
    for i in 0..n - 1 {
        if delta[i] == 0.0 {
            m[i] = 0.0;
            m[i + 1] = 0.0;
        } else {
            let (a, b) = (m[i] / delta[i], m[i + 1] / delta[i]);
            let s = a * a + b * b;
            if s > 9.0 {
                let t = 3.0 / s.sqrt();
                m[i] = t * a * delta[i];
                m[i + 1] = t * b * delta[i];
            }
        }
    }
    move |x: f32| {
        let i = knots.partition_point(|k| k.0 <= x).clamp(1, n - 1) - 1;
        let (x0, y0) = knots[i];
        let (x1, y1) = knots[i + 1];
        let h = x1 - x0;
        let t = ((x - x0) / h).clamp(0.0, 1.0);
        let (t2, t3) = (t * t, t * t * t);
        (2.0 * t3 - 3.0 * t2 + 1.0) * y0 + (t3 - 2.0 * t2 + t) * h * m[i] + (-2.0 * t3 + 3.0 * t2) * y1 + (t3 - t2) * h * m[i + 1]
    }
}

/// The colour mix after the curves: weighted least squares, nudged towards no change, each row summing to 1 so greys
/// stay grey. A mix that looks implausible (a sign of a bad match, not a camera style) is not used.
fn fit_matrix(samples: &[Sample], curved: &[[f32; 3]]) -> [[f32; 3]; 3] {
    const IDENTITY: [[f32; 3]; 3] = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
    let usable: Vec<usize> = (0..samples.len()).filter(|&i| samples[i].theirs.iter().all(|&v| !censored(v))).collect();
    if usable.len() < 200 {
        return IDENTITY;
    }
    let mut a = [[0f64; 3]; 3];
    let mut xty = [[0f64; 3]; 3]; // per output row
    for &i in &usable {
        let (x, y, w) = (curved[i].map(f64::from), samples[i].theirs.map(f64::from), samples[i].weight as f64);
        for r in 0..3 {
            for c in 0..3 {
                a[r][c] += w * x[r] * x[c];
                xty[r][c] += w * x[c] * y[r];
            }
        }
    }
    let lambda = 0.02 * (a[0][0] + a[1][1] + a[2][2]) / 3.0;
    let Some(inv) = invert3([[a[0][0] + lambda, a[0][1], a[0][2]], [a[1][0], a[1][1] + lambda, a[1][2]], [a[2][0], a[2][1], a[2][2] + lambda]]) else {
        return IDENTITY;
    };
    let mut m = IDENTITY;
    for r in 0..3 {
        // Ridge towards the identity row, then the closest row (in the same metric) whose entries sum to 1.
        let rhs = [0, 1, 2].map(|c| xty[r][c] + lambda * if c == r { 1.0 } else { 0.0 });
        let m0 = [0, 1, 2].map(|i| (0..3).map(|j| inv[i][j] * rhs[j]).sum::<f64>());
        let ones = [0, 1, 2].map(|i| (0..3).map(|j| inv[i][j]).sum::<f64>());
        let denom: f64 = ones.iter().sum();
        let excess = m0.iter().sum::<f64>() - 1.0;
        for c in 0..3 {
            m[r][c] = (m0[c] - ones[c] * excess / denom) as f32;
        }
    }
    let plausible = (0..3).all(|r| (0..3).all(|c| if r == c { (0.5..=2.0).contains(&m[r][c]) } else { m[r][c].abs() <= 0.6 }));
    if plausible { m } else { IDENTITY }
}

fn invert3(m: [[f64; 3]; 3]) -> Option<[[f64; 3]; 3]> {
    let det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
        + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    if !det.is_finite() || det.abs() < 1e-12 {
        return None;
    }
    let c = |r0: usize, c0: usize, r1: usize, c1: usize| m[r0][c0] * m[r1][c1] - m[r0][c1] * m[r1][c0];
    Some([
        [c(1, 1, 2, 2) / det, -c(0, 1, 2, 2) / det, c(0, 1, 1, 2) / det],
        [-c(1, 0, 2, 2) / det, c(0, 0, 2, 2) / det, -c(0, 0, 1, 2) / det],
        [c(1, 0, 2, 1) / det, -c(0, 0, 2, 1) / det, c(0, 0, 1, 1) / det],
    ])
}

fn mix(m: &[[f32; 3]; 3], c: [f32; 3]) -> [f32; 3] {
    [0, 1, 2].map(|r| m[r][0] * c[0] + m[r][1] * c[1] + m[r][2] * c[2])
}

fn is_identity(m: &[[f32; 3]; 3]) -> bool {
    (0..3).all(|r| (0..3).all(|c| (m[r][c] - if r == c { 1.0 } else { 0.0 }).abs() < 1e-4))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// How fast a grey's tint changes with brightness: the worst change of R-G or B-G between two greys 24 levels apart
    /// (8-bit levels). This is what turns smooth shading on a white bird into colour blotches.
    fn worst_tint_swing(look: &CameraLook) -> f32 {
        let tint = |v: u32| { let o = look.map([v as f32 / 255.0; 3]); [o[0] - o[1], o[2] - o[1]] };
        (0..=231u32).map(|v| {
            let (p, q) = (tint(v), tint(v + 24));
            ((p[0] - q[0]).abs().max((p[1] - q[1]).abs())) * 255.0
        }).fold(0.0, f32::max)
    }

    #[test]
    fn scene_colours_at_one_brightness_are_not_learned_as_a_hue_shift_of_greys() {
        // Our develop and the camera's JPEG agree exactly on greys, but the frame is mostly green grass at mid levels
        // and blue sky at bright levels, which the camera renders a little more saturated. Binned per channel, those
        // colours used to bend the three curves apart, so greys came out green-tinted in the mid-tones and blue up high.
        let mut samples = Vec::new();
        for i in 0..4000 {
            let v = (i % 200) as f32 / 200.0;
            let (ours, theirs) = match i % 5 {
                0 => ([v; 3], [v; 3]), // a little grey everywhere
                _ if v > 0.3 && v < 0.55 => ([v * 0.8, v, v * 0.7], [v * 0.72, v, v * 0.6]), // grass, more saturated
                _ if v > 0.65 && v < 0.9 => ([v * 0.85, v * 0.95, v], [v * 0.78, v * 0.93, v]), // sky, more saturated
                _ => ([v; 3], [v; 3]),
            };
            samples.push(Sample { ours, theirs, weight: 1.0 });
        }
        let raw_curves = [0, 1, 2].map(|c| fit_curve(&samples, c));
        let unsteady = CameraLook { curves: raw_curves, matrix: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]], before: 0.0, after: 0.0 };
        let steady = CameraLook { curves: steady_white_balance(unsteady.curves.clone()), ..unsteady.clone() };
        let (before, after) = (worst_tint_swing(&unsteady), worst_tint_swing(&steady));
        assert!(before > 6.0, "the per-channel fit alone swings a grey's tint by {before:.1} levels over 24 levels");
        assert!(after < 3.5 && after < 0.3 * before, "a grey's tint now changes by at most {after:.1} levels over 24 levels (was {before:.1})");
    }

    #[test]
    fn a_camera_that_renders_warmer_keeps_its_steady_tint() {
        // A real white-balance rendering: the camera's JPEG is warmer than our develop at every brightness.
        let samples: Vec<Sample> = (0..3000).map(|i| {
            let v = (i % 250) as f32 / 255.0;
            Sample { ours: [v; 3], theirs: [(v * 1.06).min(1.0), v, v * 0.94], weight: 1.0 }
        }).collect();
        let curves = steady_white_balance([0, 1, 2].map(|c| fit_curve(&samples, c)));
        let look = CameraLook { curves, matrix: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]], before: 0.0, after: 0.0 };
        let mid = look.map([0.5; 3]);
        assert!(mid[0] - mid[1] > 0.015 && mid[1] - mid[2] > 0.015, "still warmer in the mid-tones: {mid:?}");
        for v in [0.0f32, 1.0] {
            let end = look.map([v; 3]);
            assert!((end[0] - v).abs() < 0.02 && (end[2] - v).abs() < 0.02, "black stays black and white stays white: {end:?}");
        }
    }

    /// A textured synthetic "develop": smooth gradients and colour patches, 16-bit.
    fn developed(w: u32, h: u32) -> ImageBuffer<Rgb<u16>, Vec<u16>> {
        ImageBuffer::from_fn(w, h, |x, y| {
            let (fx, fy) = (x as f32 / w as f32, y as f32 / h as f32);
            let patch = ((x / 24) * 7 + (y / 24) * 3) % 11;
            let tint = [(patch % 3) as f32 * 0.12, ((patch + 1) % 4) as f32 * 0.08, ((patch + 2) % 5) as f32 * 0.06];
            let base = 0.08 + 0.78 * (0.6 * fx + 0.4 * fy);
            Rgb([0, 1, 2].map(|c| ((base * (0.8 + tint[c])).clamp(0.0, 1.0) * 65535.0) as u16))
        })
    }

    /// A made-up camera style: lifted contrast, warmer, more saturated; clipped to 8 bits like a JPEG.
    fn camera_style(p: [f32; 3]) -> [f32; 3] {
        let s = |v: f32| (v + 0.35 * (v * v * (3.0 - 2.0 * v) - v)).clamp(0.0, 1.0);
        let curved = [s(p[0]).powf(0.92), s(p[1]), s(p[2]).powf(1.08)];
        let y = (curved[0] + curved[1] + curved[2]) / 3.0;
        curved.map(|v| (y + (v - y) * 1.25).clamp(0.0, 1.0))
    }

    fn as_jpeg(img: &ImageBuffer<Rgb<u16>, Vec<u16>>, scale: u32, style: impl Fn([f32; 3]) -> [f32; 3]) -> RgbImage {
        let (w, h) = (img.width() / scale, img.height() / scale);
        RgbImage::from_fn(w, h, |x, y| {
            let p = img.get_pixel(x * scale, y * scale).0.map(|v| v as f32 / 65535.0);
            Rgb(style(p).map(|v| (v * 255.0).round() as u8))
        })
    }

    #[test]
    fn learns_a_camera_style_and_comes_close_to_the_camera_jpeg() {
        let ours = developed(960, 640);
        let camera = as_jpeg(&ours, 3, camera_style);
        let look = fit(&ours, &camera).expect("same picture: a look is learned");
        assert!(look.before > 5.0, "the style is a real difference: {}", look.before);
        assert!(look.after < 2.5, "fitted within a couple of levels: {} (was {})", look.after, look.before);
        // Every pixel, not only the grid: apply and compare at full size.
        let mut applied = ours.clone();
        look.apply(&mut applied);
        let mut total = 0f64;
        let mut n = 0f64;
        for (x, y, p) in camera.enumerate_pixels() {
            let q = applied.get_pixel(x * 3, y * 3).0;
            for c in 0..3 {
                if p[c] > 2 && p[c] < 253 {
                    total += (q[c] as f64 / 257.0 - p[c] as f64).abs();
                    n += 1.0;
                }
            }
        }
        assert!(total / n < 3.0, "mean full-size gap {} levels", total / n);
    }

    #[test]
    fn a_jpeg_stored_on_its_side_is_matched_the_right_way_round() {
        let ours = developed(600, 400);
        let upright = as_jpeg(&ours, 2, camera_style);
        let turned = image::imageops::rotate90(&upright);
        let look = fit(&ours, &turned).expect("a quarter turn is still the same picture");
        assert!(look.after < 3.0, "{}", look.after);
    }

    #[test]
    fn a_different_picture_or_shape_is_not_used() {
        let ours = developed(600, 400);
        // Same shape, different content: a flipped, inverted image.
        let other = RgbImage::from_fn(300, 200, |x, y| {
            let v = (((x * 13 + y * 7) % 97) as f32 / 97.0 * 255.0) as u8;
            Rgb([v, 255 - v, (x % 255) as u8])
        });
        assert!(fit(&ours, &other).is_none(), "noise is not the camera's rendering of this photo");
        let square = as_jpeg(&developed(400, 400), 2, camera_style);
        assert!(fit(&ours, &square).is_none(), "a different crop shape is refused");
    }

    #[test]
    fn curves_always_rise_and_never_clip_highlights_the_raw_kept() {
        let ours = developed(960, 640);
        // A camera that blows everything above 80% of our scale to white.
        let camera = as_jpeg(&ours, 3, |p| p.map(|v| (v * 1.25).min(1.0)));
        let look = fit(&ours, &camera).unwrap();
        for c in 0..3 {
            let curve = &look.curves[c];
            assert!(curve.windows(2).all(|w| w[1] >= w[0]), "channel {c} rises");
            // Above our 0.8, the curve still separates values instead of a flat white wall.
            let (a, b) = (curve[(0.85 * 65535.0) as usize], curve[(0.98 * 65535.0) as usize]);
            assert!(b - a > 0.004, "channel {c}: highlight detail kept ({a} to {b})");
        }
    }

    #[test]
    fn a_camera_jpeg_matching_already_changes_almost_nothing() {
        let ours = developed(600, 400);
        let camera = as_jpeg(&ours, 2, |p| p);
        let look = fit(&ours, &camera).unwrap();
        let mut applied = ours.clone();
        look.apply(&mut applied);
        let worst = applied.as_raw().iter().zip(ours.as_raw()).map(|(a, b)| (*a as i32 - *b as i32).abs()).max().unwrap();
        assert!(worst < 3 * 257, "at most a few levels: {}", worst / 257);
    }

    #[test]
    fn neutrals_stay_neutral_through_the_colour_mix() {
        let ours = developed(960, 640);
        let camera = as_jpeg(&ours, 3, camera_style);
        let look = fit(&ours, &camera).unwrap();
        for r in 0..3 {
            let sum: f32 = look.matrix[r].iter().sum();
            assert!((sum - 1.0).abs() < 1e-4, "row {r} sums to {sum}");
        }
    }

    #[test]
    fn files_without_a_camera_jpeg_are_left_alone() {
        assert!(embedded_preview(&[0u8; 4096]).is_none());
        let mut picture = developed(64, 48);
        let before = picture.clone();
        assert!(match_camera(&[0u8; 4096], &mut picture).is_none());
        assert_eq!(picture, before);
    }

    /// End to end: a synthetic Bayer DNG with a rendered preview inside it, through the editor's develop.
    #[cfg(feature = "nikon-he")]
    #[test]
    fn the_editor_develop_starts_from_the_files_own_jpeg() {
        let (width, height) = (1200usize, 800usize);
        // Smooth tones in large patches (no camera data), so the preview and the develop can be compared fairly.
        let pixels = (0..width * height).map(|i| {
            let (x, y) = (i % width, i / width);
            let patch = ((x / 100) * 5 + (y / 100) * 3) % 7;
            let base = 1100.0 + 4000.0 * (x as f32 / width as f32 * 0.7 + y as f32 / height as f32 * 0.3);
            let site = (x % 2) + 2 * (y % 2); // RGGB
            let gain = [0.7 + 0.08 * patch as f32, 1.0, 1.0, 0.9 - 0.05 * patch as f32][site];
            (base * gain).min(15000.0) as u16
        }).collect();
        let decoded = ticoraw::DecodedRaw {
            make: "NIKON CORPORATION".into(), model: "NIKON Z 8".into(),
            image: ticoraw::CfaImage { width, height, pixels },
            color: ticoraw::ColorInfo { cfa_pattern: [0, 1, 1, 2], black_level: [1008; 4], white_level: 15520,
                color_matrix: Some([(9000, 10000), (-2000, 10000), (-500, 10000), (-4000, 10000), (12000, 10000), (1500, 10000), (-800, 10000), (2200, 10000), (6000, 10000)]),
                as_shot_neutral: Some([(1, 2), (1, 1), (2, 3)]) },
            orientation: 1, crop: None, baseline_exposure: None,
        };
        let bare = ticoraw::dng::encode_uncompressed_dng(&decoded).unwrap();
        assert!(embedded_preview(&bare).is_none(), "this DNG has no preview yet");
        // rawler's converter renders a preview into the DNG, as a camera or converter would.
        let mut with_preview = std::io::Cursor::new(Vec::new());
        let params = rawler::dng::convert::ConvertParams { embedded: false, ..Default::default() };
        rawler::dng::convert::convert_raw_source(&RawSource::new_from_slice(&bare), &mut with_preview, "synthetic.dng", &params).unwrap();
        let bytes = with_preview.into_inner();
        let preview = embedded_preview(&bytes).expect("the converted DNG carries a preview");

        let jpeg = crate::develop_jpeg(&bytes).unwrap();
        let head = String::from_utf8_lossy(&jpeg[..400]).to_string();
        assert!(head.contains(AS_SHOT_LOOK_PREFIX), "the develop says it used the camera's look");
        let developed = image::load_from_memory(&jpeg).unwrap().to_rgb8();
        // Kestrel's own look, without the match, for comparison.
        let (raw, _) = crate::nikon_he::decode_sensor(&bytes).unwrap();
        let own = crate::scene_develop::develop_display_rgb16(&raw, &crate::scene_develop::Look::default()).unwrap().unwrap();
        let gap = |px: &dyn Fn(u32, u32) -> [f32; 3]| {
            let (pw, ph) = (preview.width(), preview.height());
            let (mut sum, mut n) = (0f64, 0f64);
            for y in (ph / 8..ph * 7 / 8).step_by(7) { for x in (pw / 8..pw * 7 / 8).step_by(7) {
                let p = preview.get_pixel(x, y).0;
                let q = px(x * developed.width() / pw, y * developed.height() / ph);
                for c in 0..3 { if p[c] > 2 && p[c] < 253 { sum += (q[c] - p[c] as f32).abs() as f64; n += 1.0; } }
            }}
            sum / n
        };
        let matched = gap(&|x, y| developed.get_pixel(x, y).0.map(|v| v as f32));
        let unmatched = gap(&|x, y| own.get_pixel(x, y).0.map(|v| v as f32 / 257.0));
        eprintln!("gap to the file's JPEG: Kestrel's own look {unmatched:.1} levels, As shot look {matched:.1} levels");
        assert!(matched < unmatched * 0.5 && matched < 6.0, "As shot look {matched:.1} vs own look {unmatched:.1}");
    }
}
