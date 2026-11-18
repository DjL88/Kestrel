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
}

impl Default for Look {
    fn default() -> Self {
        Self { baseline_ev: 1.3, shoulder_start: 0.62, path_to_white: 0.3, contrast: 0.25, saturation: 1.15 }
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
    let steps = [
        ProcessingStep::Rescale, ProcessingStep::Demosaic, ProcessingStep::FujiRotate,
        ProcessingStep::CropActiveArea, ProcessingStep::CropDefault,
    ];
    let intermediate = RawDevelop::new_with(&steps).develop_intermediate(raw)
        .map_err(|error| format!("This RAW file could not be developed: {error}"))?;
    let Intermediate::ThreeColor(pixels) = intermediate else { return Ok(None) };
    let dim = pixels.dim();
    let (width, height) = (dim.w as u32, dim.h as u32);
    let wb = wb_normalised(raw);
    let cam2rgb = camera_to_srgb(raw);
    // After Rescale each raw channel saturates at 1.0, so after white balance it saturates at wb[i].
    let clip = wb;
    let gain = 2f32.powf(look.baseline_ev);
    let mut out: Vec<u16> = vec![0; pixels.data.len() * 3];
    // Rows in parallel: every pixel is independent, so the result is identical to a serial pass.
    out.par_chunks_mut(dim.w * 3).zip(pixels.data.par_chunks(dim.w)).for_each(|(row_out, row_in)| {
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
    });
    Ok(ImageBuffer::from_raw(width, height, out))
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
            if p.len() == 5 { look = Look { baseline_ev: p[0], shoulder_start: p[1], path_to_white: p[2], contrast: p[3], saturation: p[4] }; }
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
            let reference = embedded_jpeg(&bytes);
            let (o, n) = (small(old.clone()), small(new));
            let (so, sn) = (stats(&o), stats(&n));
            let refs = reference.map(|r| { let r = small(r); let s = stats(&r); r.save(format!("{out}/{name}-camera.jpg")).ok(); s });
            o.save(format!("{out}/{name}-old.jpg")).unwrap();
            n.save(format!("{out}/{name}-new.jpg")).unwrap();
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
            let jpeg = crate::raw::develop(&bytes);
            let ms = t.elapsed().as_millis();
            let size = jpeg.as_ref().ok().and_then(|j| image::load_from_memory(j).ok()).map(|i| (i.width(), i.height()));
            println!("{:?} | {ms} ms | {:?}", entry.file_name(), size);
        }
    }
}
