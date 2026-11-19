//! Kestrel's own RAW development, shared by the editor's picture (`raw.rs`) and the 16-bit master (`raw_precision.rs`),
//! so the screen and the export start from the same pixels.
//!
//! rawler's default develop clips every value above 1.0 straight after the camera matrix and then applies plain sRGB
//! gamma to linear data with no tone curve. That blows white plumage and skies, leaves magenta casts where the sensor
//! saturated, and looks flat. Here instead, in scene-linear floating point:
//!
//! 1. rawler only rescales, demosaics and crops (no white balance, matrix or gamma).
//! 2. White balance, then **highlight reconstruction**: where the sensor saturated, the clipped channels are rebuilt
//!    from the unclipped ones instead of leaving a magenta or cyan cast.
//! 3. The camera matrix to linear sRGB, **without clipping** (values above 1.0 are kept as real scene light).
//! 4. A baseline exposure and a **hue-preserving filmic shoulder**: bright values roll smoothly towards white instead
//!    of hitting a wall, and very bright colours desaturate gradually, as film and camera renderings do.
//! 5. sRGB encoding.
//!
//! Pure Rust with no platform code, so it can compile to WebAssembly for web and mobile later.

use image::{DynamicImage, ImageBuffer, Rgb, RgbImage};
use rawler::imgop::develop::{Intermediate, ProcessingStep, RawDevelop};
use rawler::imgop::raw::correct_blacklevel_cfa;
use rawler::imgop::sensor::bayer::ppg::PPGDemosaic;
use rawler::imgop::sensor::Demosaic;
use rawler::imgop::{Dim2, Point, Rect};
use rawler::pixarray::PixF32;
use rawler::rawimage::{RawImageData, RawPhotometricInterpretation};
use rawler::cfa::CFA;
use rawler::imgop::matrix::{multiply, normalize, pseudo_inverse};
use rawler::imgop::xyz::{Illuminant, SRGB_TO_XYZ_D65};
use rawler::RawImage;
use rayon::prelude::*;

/// Look parameters. Kept in one place so the screen and the export can never drift apart.
#[derive(Clone, Copy, Debug)]
pub struct Look {
    /// Exposure lift in stops applied before the shoulder. Camera renderings place mid-grey higher than plain linear.
    pub baseline_ev: f32,
    /// Display value (0..1) where the shoulder starts. Below it the response is linear in scene light.
    pub shoulder_start: f32,
    /// How strongly the brightest colours move towards white (0 = never, 1 = fully at the top).
    pub path_to_white: f32,
    /// Gentle midtone contrast applied in display space (0 = none).
    pub contrast: f32,
    /// Colourfulness around luminance in scene-linear light (1 = unchanged). Camera renderings add some.
    pub saturation: f32,
    /// Colour noise reduction strength (0 = off). Luminance is never blurred.
    pub chroma_denoise: f32,
    /// Capture sharpening amount on luminance (0 = off), gated so noise is not sharpened.
    pub sharpen: f32,
}

impl Default for Look {
    fn default() -> Self {
        Self { baseline_ev: 1.3, shoulder_start: 0.62, path_to_white: 0.3, contrast: 0.25, saturation: 1.15, chroma_denoise: 1.0, sharpen: 0.6 }
    }
}

/// Bump when the look changes, so cached developments can be told apart from new ones.
pub const LOOK_VERSION: u32 = 1;

fn wb_normalised(raw: &RawImage) -> [f32; 3] {
    let wb = raw.wb_coeffs;
    if wb[0].is_nan() || !(wb[1] > 0.0) {
        return [1.0, 1.0, 1.0];
    }
    [wb[0] / wb[1], 1.0, wb[2] / wb[1]]
}

fn camera_to_srgb(raw: &RawImage) -> [[f32; 3]; 3] {
    let found = raw.color_matrix_find_first([
        Illuminant::D65, Illuminant::D55, Illuminant::D50, Illuminant::Daylight, Illuminant::D75,
        Illuminant::A, Illuminant::B, Illuminant::C, Illuminant::Flash,
    ]);
    let Some((_, matrix)) = found.filter(|(_, m)| m.len() >= 9) else {
        return [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
    };
    let mut xyz2cam = [[0.0f32; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            xyz2cam[i][j] = matrix[i * 3 + j];
        }
    }
    let rgb2cam = normalize(multiply(&xyz2cam, &SRGB_TO_XYZ_D65));
    pseudo_inverse(rgb2cam)
}

/// Rebuild channels the sensor clipped. `c` is white-balanced camera RGB where each channel saturates at `clip[i]`.
/// Fully saturated pixels become neutral at the brightest plausible level; partly clipped ones keep the colour
/// ratios of their unclipped channels. Blends smoothly so there's no visible edge around a blown area.
fn reconstruct_highlights(c: [f32; 3], clip: [f32; 3]) -> [f32; 3] {
    let ratio = [c[0] / clip[0], c[1] / clip[1], c[2] / clip[2]];
    let hottest = ratio[0].max(ratio[1]).max(ratio[2]);
    const START: f32 = 0.92;
    if hottest <= START {
        return c;
    }
    let t = ((hottest - START) / (1.0 - START)).clamp(0.0, 1.0);
    let t = t * t * (3.0 - 2.0 * t);
    // Clipped channels can only be at least as bright as recorded; push them up to the brightest channel.
    let peak = c[0].max(c[1]).max(c[2]);
    let rebuilt = c.map(|v| v + (peak - v) * t);
    rebuilt
}

/// Hue-preserving filmic shoulder on scene-linear sRGB. Works on the largest channel so ratios (hue) are kept.
fn tone(rgb: [f32; 3], look: &Look) -> [f32; 3] {
    let rgb = rgb.map(|v| v.max(0.0));
    let peak = rgb[0].max(rgb[1]).max(rgb[2]);
    if peak <= 0.0 {
        return [0.0; 3];
    }
    // Work on the display-encoded peak so the shoulder sits where the eye expects it.
    let k = look.shoulder_start;
    let x = linear_to_srgb(peak);
    let mapped = if x <= k { x } else { k + (1.0 - k) * (1.0 - (-(x - k) / (1.0 - k)).exp()) };
    let new_peak = srgb_to_linear(mapped);
    let scale = new_peak / peak;
    let mut out = rgb.map(|v| v * scale);
    // Path to white: inside the shoulder, move saturated colours towards neutral at the same brightness.
    if x > k && look.path_to_white > 0.0 {
        let s = (((mapped - k) / (1.0 - k)).clamp(0.0, 1.0)).powi(2) * look.path_to_white;
        out = out.map(|v| v + (new_peak - v) * s);
    }
    out
}

fn srgb_to_linear(v: f32) -> f32 {
    if v <= 0.04045 { v / 12.92 } else { ((v + 0.055) / 1.055).powf(2.4) }
}

fn linear_to_srgb(v: f32) -> f32 {
    let v = v.max(0.0);
    if v <= 0.003_130_8 { v * 12.92 } else { 1.055 * v.powf(1.0 / 2.4) - 0.055 }
}

/// Gentle display-space S-curve around mid-grey that leaves 0 and 1 where they are.
fn contrast(v: f32, amount: f32) -> f32 {
    if amount <= 0.0 {
        return v;
    }
    let s = v * v * (3.0 - 2.0 * v);
    v + (s - v) * amount
}

/// Develop a decoded RAW into display-ready sRGB, 16 bits per channel, before orientation.
/// Returns `None` for sensors this path doesn't handle yet (monochrome, four-colour CFA); callers fall back.
pub fn develop_display_rgb16(raw: &RawImage, look: &Look) -> Result<Option<ImageBuffer<Rgb<u16>, Vec<u16>>>, String> {
    match strip_plan(raw) {
        Some(plan) => Ok(Some(develop_in_strips(raw, look, &plan))),
        None => develop_display_rgb16_whole(raw, look),
    }
}

/// The whole frame at once, through rawler's develop. Used for sensors the strip path doesn't cover (X-Trans, Fuji
/// rotation, four-colour, monochrome) and, in tests, as the reference the strip path must match exactly.
pub fn develop_display_rgb16_whole(raw: &RawImage, look: &Look) -> Result<Option<ImageBuffer<Rgb<u16>, Vec<u16>>>, String> {
    let steps = [
        ProcessingStep::Rescale, ProcessingStep::Demosaic, ProcessingStep::FujiRotate,
        ProcessingStep::CropActiveArea, ProcessingStep::CropDefault,
    ];
    let intermediate = RawDevelop::new_with(&steps).develop_intermediate(raw)
        .map_err(|error| format!("This RAW file could not be developed: {error}"))?;
    let Intermediate::ThreeColor(pixels) = intermediate else { return Ok(None) };
    let dim = pixels.dim();
    let (width, height) = (dim.w as u32, dim.h as u32);
    let transform = PixelTransform::new(raw, look);
    let mut out: Vec<u16> = vec![0; pixels.data.len() * 3];
    // Rows in parallel: every pixel is independent, so the result is identical to a serial pass.
    out.par_chunks_mut(dim.w * 3).zip(pixels.data.par_chunks(dim.w)).for_each(|(row_out, row_in)| transform.row(row_in, row_out));
    refine(&mut out, dim.w, dim.h, look);
    Ok(ImageBuffer::from_raw(width, height, out))
}

/// White balance, highlight rebuild, camera matrix, exposure, saturation, tone and the display curve, one pixel at a time.
struct PixelTransform { wb: [f32; 3], cam2rgb: [[f32; 3]; 3], gain: f32, look: Look }

impl PixelTransform {
    fn new(raw: &RawImage, look: &Look) -> Self {
        Self { wb: wb_normalised(raw), cam2rgb: camera_to_srgb(raw), gain: 2f32.powf(look.baseline_ev), look: *look }
    }

    fn row(&self, row_in: &[[f32; 3]], row_out: &mut [u16]) {
        let (wb, cam2rgb, gain, look) = (self.wb, self.cam2rgb, self.gain, &self.look);
        // After Rescale each raw channel saturates at 1.0, so after white balance it saturates at wb[i].
        let clip = wb;
        for (pix, dst) in row_in.iter().zip(row_out.chunks_exact_mut(3)) {
            let balanced = [pix[0] * wb[0], pix[1] * wb[1], pix[2] * wb[2]];
            let c = reconstruct_highlights(balanced, clip);
            let lin = [
                cam2rgb[0][0] * c[0] + cam2rgb[0][1] * c[1] + cam2rgb[0][2] * c[2],
                cam2rgb[1][0] * c[0] + cam2rgb[1][1] * c[1] + cam2rgb[1][2] * c[2],
                cam2rgb[2][0] * c[0] + cam2rgb[2][1] * c[1] + cam2rgb[2][2] * c[2],
            ].map(|v| v * gain);
            let y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
            let lin = lin.map(|v| y + (v - y) * look.saturation);
            let toned = tone(lin, look);
            for (slot, v) in dst.iter_mut().zip(toned) {
                let display = contrast(linear_to_srgb(v).clamp(0.0, 1.0), look.contrast);
                *slot = (display * 65535.0 + 0.5) as u16;
            }
        }
    }
}

// ---- Developing in strips -------------------------------------------------------------------------------------
//
// rawler's develop holds the whole frame several times over in 32-bit floats (scaled mosaic, demosaiced RGB, its
// cropped copy): about 1.9 GB for a 45-megapixel Z 8 frame in WebAssembly, too much for a phone. The strip path scales
// and demosaics a band of rows at a time, with overlap, using rawler's own scaling and PPG demosaic, and writes the
// finished rows straight into the output. It gives exactly the same numbers as the whole-frame path: PPG treats only
// the 3 pixels nearest its region's edge differently, and the overlap is far wider; strips start on even rows so the
// 2 x 2 colour pattern and black levels line up.

/// Output rows developed per strip.
const STRIP_ROWS: usize = 256;
/// Extra rows above and below each strip, discarded afterwards. Must be even and well over PPG's 3-pixel border.
const STRIP_OVERLAP: usize = 16;

struct StripPlan {
    /// The sensor's active area, in raw coordinates.
    active: Rect,
    /// The final picture, relative to the active area.
    crop: Rect,
    cfa: CFA,
}

/// When the strip path applies, and the exact active area and crop rawler's develop would use. None: use the whole frame.
fn strip_plan(raw: &RawImage) -> Option<StripPlan> {
    let RawPhotometricInterpretation::Cfa(config) = &raw.photometric else { return None };
    if raw.cpp != 1 || !config.cfa.is_rgb() || config.sensor != rawler::imgop::sensor::SensorType::Bayer || raw.fuji_rotation_width.is_some() {
        return None;
    }
    if !matches!(raw.data, RawImageData::Integer(_)) || raw.width < 16 || raw.height < 16 {
        return None;
    }
    let full = Rect::new(Point::new(0, 0), Dim2::new(raw.width, raw.height));
    let active = raw.active_area.unwrap_or(full);
    // As rawler's CropDefault: the default crop (or the active area), made relative to the active area, applied only when
    // its size differs from the active area's.
    let mut crop = raw.crop_area.or(raw.active_area).unwrap_or(full);
    if raw.active_area.is_some() {
        crop = crop.adapt(&active);
    }
    if crop.d == active.d || raw.crop_area.or(raw.active_area).is_none() {
        crop = Rect::new(Point::new(0, 0), active.d);
    }
    Some(StripPlan { active, crop, cfa: config.cfa.clone() })
}

fn develop_in_strips(raw: &RawImage, look: &Look, plan: &StripPlan) -> ImageBuffer<Rgb<u16>, Vec<u16>> {
    let RawImageData::Integer(samples) = &raw.data else { unreachable!("checked in strip_plan") };
    let (width, height) = (plan.crop.d.w, plan.crop.d.h);
    let transform = PixelTransform::new(raw, look);
    let black = raw.blacklevel.as_bayer_array();
    let white = raw.whitelevel.as_bayer_array();
    let ppg = PPGDemosaic::new();
    let colours = match &raw.photometric { RawPhotometricInterpretation::Cfa(config) => config.colors.clone(), _ => unreachable!() };
    let active_top = plan.active.p.y;
    let active_bottom = plan.active.p.y + plan.active.d.h;
    let mut out: Vec<u16> = vec![0; width * height * 3];
    // Each strip is independent, so strips can run in parallel where there are threads; the result is identical.
    out.par_chunks_mut(STRIP_ROWS * width * 3).enumerate().for_each(|(index, band)| {
        let first = index * STRIP_ROWS; // first output row of this strip
        let rows = band.len() / (width * 3);
        // The same rows in raw coordinates, then widened by the overlap, kept inside the active area, starting on an even
        // row and covering an even number of rows (rawler scales two rows at a time).
        let wanted_top = active_top + plan.crop.p.y + first;
        let wanted_bottom = wanted_top + rows;
        let top = wanted_top.saturating_sub(STRIP_OVERLAP).max(active_top) & !1;
        let mut bottom = (wanted_bottom + STRIP_OVERLAP).min(active_bottom);
        if (bottom - top) % 2 == 1 && bottom < raw.height { bottom += 1; }
        let strip_rows = bottom - top;
        let mut scaled: Vec<f32> = samples[top * raw.width..bottom * raw.width].iter().map(|&v| v as f32).collect();
        correct_blacklevel_cfa(&mut scaled, raw.width, strip_rows, &black, &white);
        let pixels = PixF32::new_with(scaled, raw.width, strip_rows);
        // The demosaic region: the active area's columns, and the rows of this strip that lie inside the active area.
        let roi_top = top.max(active_top);
        let roi_bottom = bottom.min(active_bottom);
        let roi = Rect::new(Point::new(plan.active.p.x, roi_top - top), Dim2::new(plan.active.d.w, roi_bottom - roi_top));
        let rgb = ppg.demosaic(&pixels, &plan.cfa, &colours, roi);
        for row in 0..rows {
            let in_roi = wanted_top + row - roi_top;
            let line = &rgb.pixels()[in_roi * plan.active.d.w + plan.crop.p.x..][..width];
            transform.row(line, &mut band[row * width * 3..(row + 1) * width * 3]);
        }
    });
    refine(&mut out, width, height, look);
    ImageBuffer::from_raw(width as u32, height as u32, out).expect("buffer sized to the picture")
}

// ---- Chroma noise reduction and capture sharpening ------------------------------------------------------------
//
// Colour noise (red/green/blue speckle in shadows and skies) is removed with a *fast guided filter*: chroma is
// smoothed at half resolution, but only where the luminance is flat, so colour edges that follow real detail
// (an orange breast against grey feathers) stay put. Luminance is never blurred. Then a small, thresholded unsharp
// mask on luminance restores the crispness a camera adds in its own JPEG, without sharpening noise.

const R709: f32 = 0.2126;
const G709: f32 = 0.7152;
const B709: f32 = 0.0722;

/// Mean over a (2r+1)^2 window, edges clamped. Separable running sums, rows in parallel then columns.
fn box_mean(src: &[f32], w: usize, h: usize, r: usize) -> Vec<f32> {
    let mut tmp = vec![0f32; src.len()];
    tmp.par_chunks_mut(w).zip(src.par_chunks(w)).for_each(|(dst, row)| {
        for x in 0..w {
            let (a, b) = (x.saturating_sub(r), (x + r).min(w - 1));
            // Small radius: a direct sum is simple and fast enough at half resolution.
            dst[x] = row[a..=b].iter().sum::<f32>() / (b - a + 1) as f32;
        }
    });
    let mut out = vec![0f32; src.len()];
    out.par_chunks_mut(w).enumerate().for_each(|(y, dst)| {
        let (a, b) = (y.saturating_sub(r), (y + r).min(h - 1));
        let n = (b - a + 1) as f32;
        for x in 0..w {
            let mut s = 0f32;
            for yy in a..=b { s += tmp[yy * w + x]; }
            dst[x] = s / n;
        }
    });
    out
}

/// Guided filter coefficients (a, b) so that `a * guide + b` is `p` smoothed wherever `guide` is flat.
fn guided_coefficients(guide: &[f32], p: &[f32], w: usize, h: usize, r: usize, eps: f32) -> (Vec<f32>, Vec<f32>) {
    let mean_i = box_mean(guide, w, h, r);
    let mean_p = box_mean(p, w, h, r);
    let ii: Vec<f32> = guide.par_iter().map(|v| v * v).collect();
    let ip: Vec<f32> = guide.par_iter().zip(p.par_iter()).map(|(a, b)| a * b).collect();
    let corr_ii = box_mean(&ii, w, h, r);
    let corr_ip = box_mean(&ip, w, h, r);
    let (mut a, mut b) = (vec![0f32; p.len()], vec![0f32; p.len()]);
    a.par_iter_mut().zip(b.par_iter_mut()).enumerate().for_each(|(i, (ai, bi))| {
        let var = corr_ii[i] - mean_i[i] * mean_i[i];
        let cov = corr_ip[i] - mean_i[i] * mean_p[i];
        *ai = cov / (var + eps);
        *bi = mean_p[i] - *ai * mean_i[i];
    });
    (box_mean(&a, w, h, r), box_mean(&b, w, h, r))
}

/// Denoise chroma and sharpen luminance in place on 16-bit display RGB.
fn refine(rgb: &mut [u16], w: usize, h: usize, look: &Look) {
    if w < 8 || h < 8 || (look.chroma_denoise <= 0.0 && look.sharpen <= 0.0) {
        return;
    }
    let px = |i: usize| [rgb[i * 3] as f32 / 65535.0, rgb[i * 3 + 1] as f32 / 65535.0, rgb[i * 3 + 2] as f32 / 65535.0];
    let luma: Vec<f32> = (0..w * h).into_par_iter().map(|i| { let p = px(i); R709 * p[0] + G709 * p[1] + B709 * p[2] }).collect();

    // Half-resolution planes for the guided filter.
    let (hw, hh) = (w / 2, h / 2);
    let mut yh = vec![0f32; hw * hh];
    let mut cbh = vec![0f32; hw * hh];
    let mut crh = vec![0f32; hw * hh];
    yh.par_chunks_mut(hw).zip(cbh.par_chunks_mut(hw)).zip(crh.par_chunks_mut(hw)).enumerate().for_each(|(y, ((yr, cbr), crr))| {
        for x in 0..hw {
            let (mut sy, mut sb, mut sr) = (0f32, 0f32, 0f32);
            for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                let i = (2 * y + dy) * w + 2 * x + dx;
                let p = px(i);
                let l = luma[i];
                sy += l; sb += p[2] - l; sr += p[0] - l;
            }
            yr[x] = sy / 4.0; cbr[x] = sb / 4.0; crr[x] = sr / 4.0;
        }
    });
    let denoise = look.chroma_denoise > 0.0;
    let eps = (0.02 * look.chroma_denoise).powi(2);
    let coeffs = denoise.then(|| (guided_coefficients(&yh, &cbh, hw, hh, 4, eps), guided_coefficients(&yh, &crh, hw, hh, 4, eps)));

    let at = |plane: &[f32], x: usize, y: usize| plane[(y / 2).min(hh - 1) * hw + (x / 2).min(hw - 1)];
    // Sharpen only what stands clearly above this photo's own luminance noise (robust MAD estimate on a sample).
    let threshold = {
        let mut d: Vec<f32> = (1..h - 1).step_by(7).flat_map(|y| (1..w - 1).step_by(7).map(move |x| (x, y)))
            .map(|(x, y)| {
                let c = luma[y * w + x];
                let n = (luma[y * w + x - 1] + luma[y * w + x + 1] + luma[(y - 1) * w + x] + luma[(y + 1) * w + x]) / 4.0;
                (c - n).abs()
            }).collect();
        d.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let sigma = d.get(d.len() / 2).copied().unwrap_or(0.0) / 0.6745;
        (3.0 * sigma).max(0.003)
    };
    rgb.par_chunks_mut(w * 3).enumerate().for_each(|(y, row)| {
        for x in 0..w {
            let i = y * w + x;
            let l = luma[i];
            let o = x * 3;
            let mut p = [row[o] as f32 / 65535.0, row[o + 1] as f32 / 65535.0, row[o + 2] as f32 / 65535.0];
            if let Some(((ab, bb), (ar, br))) = &coeffs {
                let cb = at(ab, x, y) * l + at(bb, x, y);
                let cr = at(ar, x, y) * l + at(br, x, y);
                let r = l + cr;
                let b = l + cb;
                let g = (l - R709 * r - B709 * b) / G709;
                p = [r, g, b];
            }
            if look.sharpen > 0.0 {
                // 3x3 binomial blur of luminance, clamped at the edges.
                let mut blur = 0f32;
                for (dy, wy) in [(-1i32, 1f32), (0, 2.0), (1, 1.0)] {
                    for (dx, wx) in [(-1i32, 1f32), (0, 2.0), (1, 1.0)] {
                        let yy = (y as i32 + dy).clamp(0, h as i32 - 1) as usize;
                        let xx = (x as i32 + dx).clamp(0, w as i32 - 1) as usize;
                        blur += luma[yy * w + xx] * wx * wy;
                    }
                }
                let detail = l - blur / 16.0;
                // Below the threshold (noise) nothing is added; above it, the full amount.
                let gate = ((detail.abs() - threshold) / threshold).clamp(0.0, 1.0);
                let delta = detail * look.sharpen * gate;
                p = p.map(|v| v + delta);
            }
            for c in 0..3 {
                row[o + c] = (p[c].clamp(0.0, 1.0) * 65535.0 + 0.5) as u16;
            }
        }
    });
}

/// Quantise 16-bit display pixels to 8 bits with a small, fixed (deterministic) dither, so smooth skies don't band.
pub fn to_rgb8_dithered(image: &ImageBuffer<Rgb<u16>, Vec<u16>>) -> RgbImage {
    let (w, h) = image.dimensions();
    let mut out = vec![0u8; (w * h * 3) as usize];
    out.par_chunks_mut(w as usize * 3).zip(image.as_raw().par_chunks(w as usize * 3)).enumerate().for_each(|(y, (dst, src))| {
        for x in 0..w as usize {
            // Interleaved gradient noise: cheap, well spread, the same every run.
            let n = (52.982_918 * ((0.067_110_56 * x as f32 + 0.005_837_15 * y as f32).fract())).fract() - 0.5;
            for c in 0..3 {
                dst[x * 3 + c] = ((src[x * 3 + c] as f32 / 257.0) + n).round().clamp(0.0, 255.0) as u8;
            }
        }
    });
    RgbImage::from_raw(w, h, out).expect("buffer matches its dimensions")
}

/// Convenience for callers that want a `DynamicImage`.
pub fn develop_display(raw: &RawImage) -> Result<Option<DynamicImage>, String> {
    Ok(develop_display_rgb16(raw, &Look::default())?.map(DynamicImage::ImageRgb16))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A synthetic Bayer frame with texture, a default crop at odd offsets and a portrait orientation, as rawler reads
    /// it from a DNG. Sizes are deliberately not multiples of the strip height.
    #[cfg(feature = "nikon-he")]
    fn synthetic_raw(width: usize, height: usize) -> RawImage {
        let mut seed = 0x2545_f491_u32;
        let pixels = (0..width * height).map(|i| {
            seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5;
            let (x, y) = (i % width, i / width);
            (1008 + ((x * 37 + y * 11) % 9000) + (seed % 400) as usize) as u16
        }).collect();
        let decoded = ticoraw::DecodedRaw {
            make: "NIKON CORPORATION".into(), model: "NIKON Z 8".into(),
            image: ticoraw::CfaImage { width, height, pixels },
            color: ticoraw::ColorInfo { cfa_pattern: [0, 1, 1, 2], black_level: [1008, 1010, 1009, 1007], white_level: 15520,
                color_matrix: Some([(9000, 10000), (-2000, 10000), (-500, 10000), (-4000, 10000), (12000, 10000), (1500, 10000), (-800, 10000), (2200, 10000), (6000, 10000)]),
                as_shot_neutral: Some([(1, 2), (1, 1), (2, 3)]) },
            orientation: 6,
            crop: Some(ticoraw::Crop { x: 6, y: 5, width: width - 13, height: height - 11 }),
            baseline_exposure: None,
        };
        let dng = ticoraw::dng::encode_uncompressed_dng(&decoded).unwrap();
        crate::nikon_he::decode_sensor(&dng).unwrap().0
    }

    #[cfg(feature = "nikon-he")]
    #[test]
    fn strips_give_exactly_the_whole_frame_result() {
        for (w, h) in [(96, 64), (640, 531), (1000, 2 * STRIP_ROWS + 37)] {
            let raw = synthetic_raw(w, h);
            assert!(strip_plan(&raw).is_some(), "{w}x{h}: a Bayer frame takes the strip path");
            let whole = develop_display_rgb16_whole(&raw, &Look::default()).unwrap().unwrap();
            let strips = develop_display_rgb16(&raw, &Look::default()).unwrap().unwrap();
            assert_eq!(strips.dimensions(), whole.dimensions(), "{w}x{h}: size");
            let differing = strips.as_raw().iter().zip(whole.as_raw()).filter(|(a, b)| a != b).count();
            assert_eq!(differing, 0, "{w}x{h}: {differing} samples differ");
        }
    }

    /// Optional, real files: KESTREL_RAW_SAMPLES=<folder>. Every RAW that decodes must develop identically in strips.
    #[test]
    fn real_files_develop_identically_in_strips() {
        let Some(folder) = std::env::var_os("KESTREL_RAW_SAMPLES") else { return };
        let mut checked = 0;
        for entry in std::fs::read_dir(folder).expect("samples folder").flatten() {
            let Ok(bytes) = std::fs::read(entry.path()) else { continue };
            let Ok((raw, _)) = crate::nikon_he::decode_sensor(&bytes) else { continue };
            if strip_plan(&raw).is_none() { continue }
            let whole = develop_display_rgb16_whole(&raw, &Look::default()).unwrap().unwrap();
            let strips = develop_display_rgb16(&raw, &Look::default()).unwrap().unwrap();
            assert_eq!(strips.dimensions(), whole.dimensions(), "{}", entry.path().display());
            assert!(strips.as_raw() == whole.as_raw(), "{}: strip develop differs", entry.path().display());
            checked += 1;
        }
        eprintln!("RAW files developed identically in strips: {checked}");
    }

    #[test]
    fn shoulder_is_continuous_monotonic_and_never_reaches_a_wall() {
        let look = Look::default();
        let mut last = 0.0;
        for i in 1..=4000 {
            let v = i as f32 / 500.0; // scene light up to 8x diffuse white
            let out = tone([v, v, v], &look)[0];
            assert!(out >= last - 1e-6, "monotonic at {v}");
            assert!(out < 1.0, "a bright value is compressed, not clipped, at {v}");
            last = out;
        }
        // Midtones are untouched by the shoulder.
        let mid = tone([0.18, 0.18, 0.18], &look)[0];
        assert!((mid - 0.18).abs() < 1e-4);
    }

    #[test]
    fn tone_keeps_hue_below_the_shoulder_and_moves_bright_colour_towards_white() {
        let look = Look::default();
        let orange = [0.30, 0.12, 0.03];
        let out = tone(orange, &look);
        assert!((out[1] / out[0] - orange[1] / orange[0]).abs() < 1e-4, "ratios kept below the shoulder");
        let hot = tone([3.0, 1.2, 0.3], &look);
        assert!(hot[2] / hot[0] > 0.1, "a very bright orange gains some white instead of a flat channel clip");
        assert!(hot[0] < 1.0);
    }

    #[test]
    fn clipped_sensor_channels_are_rebuilt_not_left_magenta() {
        // Green clipped at 1.0 while red and blue (with WB gains 2.0 and 1.5) read higher: classic magenta highlight.
        let clip = [2.0, 1.0, 1.5];
        let blown = [2.0, 1.0, 1.5];
        let rebuilt = reconstruct_highlights(blown, clip);
        assert!((rebuilt[0] - rebuilt[1]).abs() < 1e-5 && (rebuilt[1] - rebuilt[2]).abs() < 1e-5, "neutral, not magenta");
        let safe = [0.5, 0.4, 0.3];
        assert_eq!(reconstruct_highlights(safe, clip), safe, "unclipped pixels are untouched");
    }

    fn noisy_patch(w: usize, h: usize, edge: bool) -> Vec<u16> {
        // Deterministic speckle in chroma only, around a mid grey (optionally with a sharp vertical luminance edge).
        let mut v = vec![0u16; w * h * 3];
        for y in 0..h { for x in 0..w {
            let base = if edge && x >= w / 2 { 0.75 } else { 0.35 };
            let n = (((x * 7919 + y * 104729) % 97) as f32 / 97.0 - 0.5) * 0.08;
            let p = [base + n, base - n * 0.5, base - n];
            for c in 0..3 { v[(y * w + x) * 3 + c] = (p[c].clamp(0.0, 1.0) * 65535.0) as u16; }
        }}
        v
    }

    fn chroma_spread(v: &[u16]) -> f32 {
        let mut s = 0f32;
        for p in v.chunks_exact(3) { s += ((p[0] as f32 - p[2] as f32) / 65535.0).abs(); }
        s / (v.len() / 3) as f32
    }

    #[test]
    fn colour_speckle_is_reduced_and_a_luminance_edge_survives() {
        let (w, h) = (64, 48);
        let look = Look { sharpen: 0.0, ..Look::default() };
        let mut v = noisy_patch(w, h, true);
        let before = chroma_spread(&v);
        refine(&mut v, w, h, &look);
        assert!(chroma_spread(&v) < before * 0.5, "colour noise at least halved");
        let left = v[(20 * w + 10) * 3 + 1] as f32 / 65535.0;
        let right = v[(20 * w + 54) * 3 + 1] as f32 / 65535.0;
        assert!(right - left > 0.35, "the edge between dark and light stays sharp: {left} vs {right}");
    }

    #[test]
    fn sharpening_never_amplifies_noise_on_a_flat_patch() {
        let (w, h) = (64, 48);
        let look = Look { chroma_denoise: 0.0, ..Look::default() };
        let mut v = noisy_patch(w, h, false);
        let before: Vec<u16> = v.clone();
        refine(&mut v, w, h, &look);
        let luma = |p: &[u16]| 0.2126 * p[0] as f32 + 0.7152 * p[1] as f32 + 0.0722 * p[2] as f32;
        let spread = |x: &[u16]| { let l: Vec<f32> = x.chunks_exact(3).map(luma).collect(); let m = l.iter().sum::<f32>() / l.len() as f32; l.iter().map(|v| (v - m).abs()).sum::<f32>() / l.len() as f32 };
        assert!(spread(&v) <= spread(&before) * 1.05, "noise is not sharpened");
    }

    #[test]
    fn dithered_quantisation_stays_within_one_level() {
        let mut img: ImageBuffer<Rgb<u16>, Vec<u16>> = ImageBuffer::new(64, 64);
        for (x, _, p) in img.enumerate_pixels_mut() { let v = (x * 1000) as u16; *p = Rgb([v, v, v]); }
        let out = to_rgb8_dithered(&img);
        for (x, y, p) in out.enumerate_pixels() {
            let exact = img.get_pixel(x, y).0[0] as f32 / 257.0;
            assert!((p.0[0] as f32 - exact).abs() <= 1.0);
        }
    }
}

/// Before/after on real files. Never runs by default and never writes into the repository.
/// `KESTREL_COMPARE_DIR=<folder of RAWs> KESTREL_COMPARE_OUT=<scratch folder> cargo test --release compare_on_real_files -- --ignored --nocapture`
#[cfg(test)]
mod compare {
    use super::*;
    use image::imageops::FilterType;
    use rawler::decoders::RawDecodeParams;
    use rawler::rawsource::RawSource;

    struct Stats { median: f32, clipped: f32, mean_sat_bright: f32 }

    fn stats(img: &RgbImage) -> Stats {
        let mut lum: Vec<f32> = Vec::with_capacity((img.width() * img.height()) as usize);
        let (mut clipped, mut bright, mut sat) = (0usize, 0usize, 0f32);
        for p in img.pixels() {
            let [r, g, b] = p.0.map(|v| v as f32 / 255.0);
            let l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            lum.push(l);
            if p.0.iter().any(|&v| v >= 254) { clipped += 1; }
            if l > 0.75 { bright += 1; let mx = r.max(g).max(b); let mn = r.min(g).min(b); sat += if mx > 0.0 { (mx - mn) / mx } else { 0.0 }; }
        }
        lum.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let n = lum.len().max(1) as f32;
        Stats { median: lum[lum.len() / 2], clipped: clipped as f32 / n * 100.0, mean_sat_bright: if bright > 0 { sat / bright as f32 } else { 0.0 } }
    }

    /// Nikon's own rendering: the largest JPEG embedded in the file. The reference look to learn from.
    fn embedded_jpeg(bytes: &[u8]) -> Option<DynamicImage> {
        let mut best: Option<(usize, usize)> = None;
        let mut i = 0;
        while i + 3 < bytes.len() {
            if bytes[i] == 0xff && bytes[i + 1] == 0xd8 && bytes[i + 2] == 0xff {
                if let Some(end) = bytes[i..].windows(2).position(|w| w == [0xff, 0xd9]).map(|p| i + p + 2) {
                    // Keep scanning past nested thumbnails: take the biggest that decodes.
                    let len = end - i;
                    if best.map(|(_, l)| len > l).unwrap_or(true) && len > 200_000 { best = Some((i, len)); }
                }
            }
            i += 1;
        }
        let mut candidates = vec![];
        if let Some((start, _)) = best { candidates.push(start); }
        for start in candidates {
            // The end marker search above stops at the first EOI; decode greedily to the last EOI instead.
            if let Some(last) = bytes[start..].windows(2).rposition(|w| w == [0xff, 0xd9]) {
                if let Ok(img) = image::load_from_memory_with_format(&bytes[start..start + last + 2], image::ImageFormat::Jpeg) {
                    if img.width() > 2000 { return Some(img); }
                }
            }
        }
        None
    }

    fn look_from_env() -> Look {
        let mut look = Look::default();
        if let Ok(v) = std::env::var("KESTREL_LOOK") {
            let p: Vec<f32> = v.split(',').filter_map(|s| s.trim().parse().ok()).collect();
            if p.len() == 7 { look = Look { baseline_ev: p[0], shoulder_start: p[1], path_to_white: p[2], contrast: p[3], saturation: p[4], chroma_denoise: p[5], sharpen: p[6] }; }
        }
        look
    }

    fn small(img: DynamicImage) -> RgbImage { img.resize(1600, 1600, FilterType::Triangle).to_rgb8() }

    #[test]
    #[ignore]
    fn compare_on_real_files() {
        let (Ok(dir), Ok(out)) = (std::env::var("KESTREL_COMPARE_DIR"), std::env::var("KESTREL_COMPARE_OUT")) else { return };
        let limit: usize = std::env::var("KESTREL_COMPARE_LIMIT").ok().and_then(|v| v.parse().ok()).unwrap_or(8);
        let mut files: Vec<_> = std::fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).map(|e| e.path())
            .filter(|p| p.extension().map(|e| e.eq_ignore_ascii_case("nef")).unwrap_or(false)).collect();
        files.sort();
        let step = (files.len() / limit).max(1);
        println!("file | camera | old median/clip%/brightSat | new median/clip%/brightSat | camera JPEG median/clip%/brightSat");
        for path in files.iter().step_by(step).take(limit) {
            let bytes = std::fs::read(path).unwrap();
            let source = RawSource::new_from_slice(&bytes);
            let name = path.file_stem().unwrap().to_string_lossy().to_string();
            let raw = match rawler::decode(&source, &RawDecodeParams { image_index: 0 }) {
                Ok(raw) => raw,
                Err(e) => { println!("{name} | not decodable by rawler: {e}"); continue; }
            };
            let camera = format!("{} {}", raw.camera.make, raw.camera.model);
            let old = RawDevelop::default().develop_intermediate(&raw).unwrap().to_dynamic_image().unwrap();
            let new = DynamicImage::ImageRgb8(to_rgb8_dithered(&develop_display_rgb16(&raw, &look_from_env()).unwrap().unwrap()));
            let new_full = new.clone();
            let reference = embedded_jpeg(&bytes);
            let (o, n) = (small(old.clone()), small(new));
            let (so, sn) = (stats(&o), stats(&n));
            let refs = reference.map(|r| { let r = small(r); let s = stats(&r); r.save(format!("{out}/{name}-camera.jpg")).ok(); s });
            o.save(format!("{out}/{name}-old.jpg")).unwrap();
            n.save(format!("{out}/{name}-new.jpg")).unwrap();
            let crop = |img: &DynamicImage| { let (w, h) = (img.width(), img.height()); img.crop_imm(w / 2 - 400, h / 2 - 300, 800, 600).to_rgb8() };
            let tag = std::env::var("KESTREL_TAG").unwrap_or_default();
            crop(&old).save(format!("{out}/{name}-old-100.jpg")).ok();
            crop(&new_full).save(format!("{out}/{name}-new{tag}-100.jpg")).ok();
            let f = |s: &Stats| format!("{:.3}/{:.2}/{:.3}", s.median, s.clipped, s.mean_sat_bright);
            println!("{name} | {camera} | {} | {} | {}", f(&so), f(&sn), refs.as_ref().map(f).unwrap_or("none".into()));
        }
    }
}

#[cfg(test)]
mod timing {
    /// `KESTREL_RAW_SAMPLES=<folder> cargo test --release develop_speed -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn develop_speed_on_real_files() {
        let Some(dir) = std::env::var_os("KESTREL_RAW_SAMPLES") else { return };
        for entry in std::fs::read_dir(dir).unwrap().filter_map(|e| e.ok()) {
            let bytes = std::fs::read(entry.path()).unwrap();
            let t = std::time::Instant::now();
            let jpeg = crate::develop_jpeg(&bytes);
            let ms = t.elapsed().as_millis();
            let size = jpeg.as_ref().ok().and_then(|j| image::load_from_memory(j).ok()).map(|i| (i.width(), i.height()));
            println!("{:?} | {ms} ms | {:?}", entry.file_name(), size);
        }
    }
}
