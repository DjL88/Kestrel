//! Lens profiles from the lensfun database, for photos whose files carry no lens corrections of their own.
//!
//! lensfun (https://github.com/lensfun/lensfun) is the open collection of lens measurements darktable, RawTherapee and
//! digiKam use. Its data is CC BY-SA 3.0; Kestrel keeps a compact copy in `data/lensfun/lensfun.txt` (see the README
//! there). Its models and coordinate conventions, from lensfun's documentation:
//!
//! - Distortion (`ptlens`, `poly3`, `poly5`) and lateral colour (`linear`, `poly3`) are polynomials in the radius,
//!   with r = 1 at half the short side of the frame the lens was measured on (Hugin's convention). Each maps a
//!   corrected position to where it lies in the photo.
//! - Vignetting (`pa`) is the brightness falloff 1 + k1 r^2 + k2 r^4 + k3 r^6, with r = 1 at the measured frame's
//!   corner. It is divided out.
//!
//! Distances are worked in millimetres on the sensor, so a lens measured on one sensor size applies correctly to
//! another. A lens is used only when the photo's own lens name matches one in the database exactly (after ignoring
//! spaces, punctuation and letter case) and its camera's sensor size is known; otherwise nothing is applied. A lens
//! measured on a smaller sensor than the photo's is not used, since its measurements don't reach the photo's corners.

use std::sync::OnceLock;

use rawler::decoders::RawDecodeParams;
use rawler::rawsource::RawSource;

const DATABASE: &str = include_str!("../data/lensfun/lensfun.txt");
/// The diagonal of a 36 x 24 mm frame, in millimetres.
const FULL_FRAME_DIAGONAL: f64 = 43.266_615_305_567_87;

#[derive(Clone, Debug, PartialEq)]
enum Distortion {
    PtLens([f64; 3]),
    Poly3(f64),
    Poly5([f64; 2]),
}

#[derive(Clone, Debug, PartialEq)]
enum Tca {
    Linear([f64; 2]),
    /// vr, vb, cr, cb, br, bb
    Poly3([f64; 6]),
}

#[derive(Debug, Default)]
struct Lens {
    maker: String,
    names: Vec<String>,
    crop: f64,
    aspect: f64,
    distortion: Vec<(f64, Distortion)>,
    tca: Vec<(f64, Tca)>,
    /// (focal, aperture, k1, k2, k3)
    vignetting: Vec<(f64, f64, [f64; 3])>,
}

struct Database {
    cameras: Vec<(String, Vec<String>, f64)>,
    lenses: Vec<Lens>,
}

fn database() -> &'static Database {
    static DB: OnceLock<Database> = OnceLock::new();
    DB.get_or_init(|| parse(DATABASE))
}

fn parse(text: &str) -> Database {
    let mut db = Database { cameras: Vec::new(), lenses: Vec::new() };
    let f = |s: &str| s.parse::<f64>().ok().filter(|v| v.is_finite());
    for line in text.lines().filter(|l| !l.starts_with('#')) {
        let p: Vec<&str> = line.split('|').collect();
        match (p[0], p.len()) {
            ("C", 4) => {
                if let Some(crop) = f(p[3]) {
                    db.cameras.push((normalise(p[1]), p[2].split('~').map(normalise).collect(), crop));
                }
            }
            ("L", 5) => {
                let (Some(crop), Some(aspect)) = (f(p[3]), f(p[4])) else { continue };
                let maker = normalise(p[1]);
                let names = p[2].split('~').map(|n| strip_maker(&normalise(n), &maker)).collect();
                db.lenses.push(Lens { maker, names, crop, aspect, ..Lens::default() });
            }
            ("D", _) | ("T", _) | ("V", _) => {
                let Some(lens) = db.lenses.last_mut() else { continue };
                let nums: Vec<f64> = p[1..].iter().filter_map(|s| f(s)).collect();
                match (p[0], p.get(2).copied(), nums.len()) {
                    ("D", Some("ptlens"), 4) => lens.distortion.push((nums[0], Distortion::PtLens([nums[1], nums[2], nums[3]]))),
                    ("D", Some("poly3"), 2) => lens.distortion.push((nums[0], Distortion::Poly3(nums[1]))),
                    ("D", Some("poly5"), 3) => lens.distortion.push((nums[0], Distortion::Poly5([nums[1], nums[2]]))),
                    ("T", Some("linear"), 3) => lens.tca.push((nums[0], Tca::Linear([nums[1], nums[2]]))),
                    ("T", Some("poly3"), 7) => lens.tca.push((nums[0], Tca::Poly3([nums[1], nums[2], nums[3], nums[4], nums[5], nums[6]]))),
                    ("V", _, 5) => lens.vignetting.push((nums[0], nums[1], [nums[2], nums[3], nums[4]])),
                    _ => {}
                }
            }
            _ => {}
        }
    }
    for lens in &mut db.lenses {
        lens.distortion.sort_by(|a, b| a.0.total_cmp(&b.0));
        lens.tca.sort_by(|a, b| a.0.total_cmp(&b.0));
    }
    db
}

/// Lower case letters, digits and dots only; "f/4.0" and "F4" both become "f4".
fn normalise(name: &str) -> String {
    let chars: Vec<char> = name.to_lowercase().chars().collect();
    let mut out = String::with_capacity(chars.len());
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        // Drop a ".0" that ends a number ("f/4.0-5.6" is "f/4-5.6").
        if c == '.' && i > 0 && chars[i - 1].is_ascii_digit() && chars.get(i + 1) == Some(&'0') && !chars.get(i + 2).is_some_and(|c| c.is_ascii_digit()) {
            i += 2;
            continue;
        }
        if c.is_alphanumeric() || c == '.' {
            out.push(c);
        }
        i += 1;
    }
    out
}

fn strip_maker(name: &str, maker: &str) -> String {
    let first = maker.split(|c: char| !c.is_alphanumeric()).next().unwrap_or("");
    for prefix in [maker, first] {
        if !prefix.is_empty() && name.len() > prefix.len() && name.starts_with(prefix) {
            return name[prefix.len()..].to_string();
        }
    }
    name.to_string()
}

/// The camera's crop factor (full-frame diagonal / sensor diagonal), from the database.
fn camera_crop(make: &str, model: &str) -> Option<f64> {
    let (make, model) = (normalise(make), normalise(model));
    let first = |s: &str| s.chars().take(4).collect::<String>();
    database().cameras.iter()
        .find(|(m, models, _)| first(m) == first(&make) && models.iter().any(|n| *n == model || strip_maker(n, m) == strip_maker(&model, m)))
        .map(|c| c.2)
}

/// A lens profile at one focal length and aperture, ready to apply.
#[derive(Clone, Debug, PartialEq)]
pub struct LensfunCorrection {
    /// The lens, as named in the database.
    pub lens: String,
    camera_crop: f64,
    lens_crop: f64,
    lens_aspect: f64,
    distortion: Option<Distortion>,
    tca: Option<Tca>,
    vignetting: Option<[f64; 3]>,
    /// Zoom so the corrected picture fills the frame (set by `fit_frame`).
    fill: f64,
}

/// Interpolate per-focal entries linearly; None outside the measured range (more than 3% beyond it).
fn by_focal<T: Clone>(entries: &[(f64, T)], focal: f64, mix: impl Fn(&T, &T, f64) -> Option<T>) -> Option<T> {
    let (first, last) = (entries.first()?, entries.last()?);
    if focal < first.0 * 0.97 || focal > last.0 * 1.03 {
        return None;
    }
    if focal <= first.0 { return Some(first.1.clone()); }
    if focal >= last.0 { return Some(last.1.clone()); }
    let i = entries.partition_point(|e| e.0 <= focal) - 1;
    let (a, b) = (&entries[i], &entries[i + 1]);
    if (b.0 - a.0).abs() < 1e-9 { return Some(a.1.clone()); }
    mix(&a.1, &b.1, (focal - a.0) / (b.0 - a.0))
}

fn lerp(a: f64, b: f64, t: f64) -> f64 { a + (b - a) * t }

impl Lens {
    fn at(&self, focal: f64, aperture: Option<f64>, camera_crop: f64) -> LensfunCorrection {
        let distortion = by_focal(&self.distortion, focal, |a, b, t| match (a, b) {
            (Distortion::PtLens(x), Distortion::PtLens(y)) => Some(Distortion::PtLens([0, 1, 2].map(|i| lerp(x[i], y[i], t)))),
            (Distortion::Poly3(x), Distortion::Poly3(y)) => Some(Distortion::Poly3(lerp(*x, *y, t))),
            (Distortion::Poly5(x), Distortion::Poly5(y)) => Some(Distortion::Poly5([0, 1].map(|i| lerp(x[i], y[i], t)))),
            _ => None,
        });
        let tca = by_focal(&self.tca, focal, |a, b, t| match (a, b) {
            (Tca::Linear(x), Tca::Linear(y)) => Some(Tca::Linear([0, 1].map(|i| lerp(x[i], y[i], t)))),
            (Tca::Poly3(x), Tca::Poly3(y)) => Some(Tca::Poly3([0, 1, 2, 3, 4, 5].map(|i| lerp(x[i], y[i], t)))),
            _ => None,
        });
        let vignetting = aperture.and_then(|n| self.vignetting_at(focal, n));
        LensfunCorrection {
            lens: self.names.first().cloned().unwrap_or_default(),
            camera_crop,
            lens_crop: self.crop,
            lens_aspect: self.aspect,
            distortion,
            tca,
            vignetting,
            fill: 1.0,
        }
    }

    /// Vignetting at a focal length and f-number: interpolated in stops between the measured apertures (held at the
    /// ends), then linearly between the measured focal lengths.
    fn vignetting_at(&self, focal: f64, f_number: f64) -> Option<[f64; 3]> {
        let mut focals: Vec<f64> = self.vignetting.iter().map(|v| v.0).collect();
        focals.sort_by(f64::total_cmp);
        focals.dedup();
        let at_focal = |f: f64| -> Option<[f64; 3]> {
            let mut rows: Vec<(f64, [f64; 3])> = self.vignetting.iter().filter(|v| v.0 == f).map(|v| (v.1.log2(), v.2)).collect();
            rows.sort_by(|a, b| a.0.total_cmp(&b.0));
            by_stops(&rows, f_number.log2())
        };
        let entries: Vec<(f64, [f64; 3])> = focals.into_iter().filter_map(|f| Some((f, at_focal(f)?))).collect();
        by_focal(&entries, focal, |a, b, t| Some([0, 1, 2].map(|i| lerp(a[i], b[i], t))))
    }
}

fn by_stops(rows: &[(f64, [f64; 3])], stops: f64) -> Option<[f64; 3]> {
    let (first, last) = (rows.first()?, rows.last()?);
    if stops <= first.0 { return Some(first.1); }
    if stops >= last.0 { return Some(last.1); }
    let i = rows.partition_point(|r| r.0 <= stops) - 1;
    let t = (stops - rows[i].0) / (rows[i + 1].0 - rows[i].0).max(1e-9);
    Some([0, 1, 2].map(|k| lerp(rows[i].1[k], rows[i + 1].1[k], t)))
}

impl LensfunCorrection {
    pub fn is_empty(&self) -> bool {
        self.distortion.is_none() && self.tca.is_none() && self.vignetting.is_none()
    }

    pub fn has_geometry(&self) -> bool {
        self.distortion.is_some() || self.tca.is_some()
    }

    pub fn has_vignetting(&self) -> bool {
        self.vignetting.is_some()
    }

    /// Millimetres on the sensor per pixel, for a picture w x h pixels covering the whole sensor.
    fn mm_per_pixel(&self, w: f64, h: f64) -> f64 {
        FULL_FRAME_DIAGONAL / self.camera_crop / (w * w + h * h).sqrt()
    }

    /// Half the short side of the frame the lens was measured on, in millimetres (Hugin's unit radius).
    fn hugin_unit(&self) -> f64 {
        FULL_FRAME_DIAGONAL / self.lens_crop / (self.lens_aspect * self.lens_aspect + 1.0).sqrt() / 2.0
    }

    /// Brightness gain for a point `mm` millimetres from the centre.
    pub fn vignetting_gain(&self, mm: f64) -> f64 {
        let Some(k) = self.vignetting else { return 1.0 };
        let r2 = (mm / (FULL_FRAME_DIAGONAL / self.lens_crop / 2.0)).powi(2);
        let c = 1.0 + r2 * (k[0] + r2 * (k[1] + r2 * k[2]));
        1.0 / c.max(0.05)
    }

    /// Where a corrected point at `r` (Hugin units) lies, as a multiple of its distance, for each plane (R, G, B).
    fn radial(&self, r: f64) -> [f64; 3] {
        let d = match self.distortion {
            Some(Distortion::PtLens([a, b, c])) => a * r.powi(3) + b * r * r + c * r + (1.0 - a - b - c),
            Some(Distortion::Poly3(k1)) => 1.0 - k1 + k1 * r * r,
            Some(Distortion::Poly5([k1, k2])) => 1.0 + k1 * r * r + k2 * r.powi(4),
            None => 1.0,
        };
        let rd = r * d; // the distorted radius, where lateral colour is measured
        let (red, blue) = match self.tca {
            Some(Tca::Linear([kr, kb])) => (kr, kb),
            Some(Tca::Poly3([vr, vb, cr, cb, br, bb])) => (vr + cr * rd + br * rd * rd, vb + cb * rd + bb * rd * rd),
            None => (1.0, 1.0),
        };
        [d * red, d, d * blue]
    }

    /// Where the corrected pixel at offset (dx, dy) pixels from the centre comes from, per plane, as a multiple of the
    /// offset. `mm_per_px` from `mm_per_pixel` for this picture.
    pub fn scale(&self, plane: usize, dx: f64, dy: f64, mm_per_px: f64) -> f64 {
        let r = (dx * dx + dy * dy).sqrt() * mm_per_px / self.fill / self.hugin_unit();
        self.radial(r)[plane] / self.fill
    }

    /// Set the zoom that keeps every corrected pixel inside the photo (as darktable's automatic scale does), for a
    /// picture of w x h pixels. Refuses (false) a correction that would need an implausible zoom.
    pub fn fit_frame(&mut self, w: f64, h: f64) -> bool {
        let mm = self.mm_per_pixel(w, h);
        let half_diagonal = (w * w + h * h).sqrt() / 2.0;
        let short = w.min(h) / 2.0;
        let mut zoom = 0f64;
        for i in 0..200 {
            let px = short + (half_diagonal - short) * i as f64 / 199.0;
            let r = px * mm / self.hugin_unit();
            for s in self.radial(r) { zoom = zoom.max(s); }
        }
        self.fill = zoom;
        (0.8..=1.25).contains(&zoom)
    }

    pub fn mm_per_px(&self, w: f64, h: f64) -> f64 {
        self.mm_per_pixel(w, h)
    }
}

/// The lensfun correction for this photo, if its lens and camera are in the database.
/// `picture`: the developed picture's size in pixels (the whole sensor's image).
pub fn lookup(bytes: &[u8], camera_make: &str, camera_model: &str, picture: (f64, f64)) -> Option<LensfunCorrection> {
    let (lens_name, lens_make, focal, f_number) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let source = RawSource::new_from_slice(bytes);
        let meta = rawler::get_decoder(&source).ok()?.raw_metadata(&source, &RawDecodeParams { image_index: 0 }).ok()?;
        let name = meta.exif.lens_model.clone().filter(|s| !s.trim().is_empty())
            .or_else(|| meta.lens.as_ref().map(|l| format!("{} {}", l.lens_make, l.lens_model)))?;
        let focal = meta.exif.focal_length.map(|r| r.n as f64 / r.d as f64).filter(|f| f.is_finite() && *f > 0.0)?;
        let f_number = meta.exif.fnumber.map(|r| r.n as f64 / r.d as f64).filter(|f| f.is_finite() && *f > 0.0);
        Some((name, meta.exif.lens_make.clone().unwrap_or_default(), focal, f_number))
    })).ok().flatten()?;
    let camera_crop = camera_crop(camera_make, camera_model)?;
    let correction = find(&lens_name, &lens_make, focal, f_number, camera_crop)?;
    let mut correction = correction;
    if correction.has_geometry() && !correction.fit_frame(picture.0, picture.1) {
        correction.distortion = None;
        correction.tca = None;
        correction.fill = 1.0;
    }
    (!correction.is_empty()).then_some(correction)
}

/// Find the lens by name and build its correction at this focal length and aperture.
fn find(lens_name: &str, lens_make: &str, focal: f64, f_number: Option<f64>, camera_crop: f64) -> Option<LensfunCorrection> {
    let wanted = normalise(lens_name);
    let make = normalise(lens_make);
    let matches: Vec<&Lens> = database().lenses.iter()
        .filter(|lens| {
            let name = strip_maker(&wanted, &lens.maker);
            let name = if make.is_empty() { name } else { strip_maker(&name, &make) };
            lens.names.iter().any(|n| *n == name)
        })
        // Measured on a sensor at least as large as this camera's (5% leeway), so the corners are covered.
        .filter(|lens| lens.crop <= camera_crop * 1.05)
        .collect();
    // Prefer the measurement made on the most similar sensor.
    let lens = matches.into_iter().min_by(|a, b| (camera_crop - a.crop).abs().total_cmp(&(camera_crop - b.crop).abs()))?;
    Some(lens.at(focal, f_number, camera_crop))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_bundled_database_loads_with_cameras_and_lenses() {
        let db = database();
        assert!(db.cameras.len() > 500, "{}", db.cameras.len());
        assert!(db.lenses.len() > 1000, "{}", db.lenses.len());
        assert!(db.lenses.iter().filter(|l| !l.distortion.is_empty()).count() > 800);
    }

    #[test]
    fn lens_names_match_across_spelling_differences_only() {
        assert_eq!(normalise("FE 24-70mm F2.8 GM"), normalise("FE 24-70mm f/2.8 GM"));
        assert_eq!(normalise("Zuiko 40-150mm f/4.0-5.6"), normalise("Zuiko 40-150mm F4-5.6"));
        assert_ne!(normalise("FE 24-70mm F2.8 GM"), normalise("FE 24-70mm F2.8 GM II"));
        assert_eq!(strip_maker(&normalise("Canon EF 50mm f/1.8 STM"), "canon"), normalise("EF50mm f/1.8 STM"));
    }

    #[test]
    fn a_real_lens_and_camera_are_found_and_a_lookalike_is_not() {
        // A lens in the database, as cameras write it to EXIF (no maker, no spaces where Canon leaves them out).
        let canon = find("EF50mm f/1.8 STM", "", 50.0, Some(2.8), 1.0).expect("Canon EF 50mm f/1.8 STM is in lensfun");
        assert!(canon.distortion.is_some() || canon.vignetting.is_some());
        assert!(find("EF50mm f/1.8 STM Mark IX", "", 50.0, Some(2.8), 1.0).is_none(), "no guessing");
        assert!(find("EF50mm f/1.8 STM", "", 400.0, Some(2.8), 1.0).map_or(true, |c| c.distortion.is_none()), "no extrapolation beyond the measured focal lengths");
        assert!(camera_crop("Canon", "Canon EOS 5D Mark II").is_some_and(|c| (c - 1.0).abs() < 0.05));
        assert!(camera_crop("Canon", "Canon EOS 99Z").is_none());
    }

    #[test]
    fn a_crop_sensor_lens_is_not_used_on_full_frame() {
        let lens = database().lenses.iter().find(|l| l.crop > 1.4 && !l.distortion.is_empty()).unwrap();
        assert!(find(&lens.names[0], "", lens.distortion[0].0, None, 1.0).is_none() || database().lenses.iter().any(|o| o.names == lens.names && o.crop <= 1.05));
    }

    #[test]
    fn vignetting_follows_the_aperture_and_is_held_at_the_ends() {
        let lens = Lens {
            vignetting: vec![(50.0, 1.8, [-0.6, 0.1, 0.0]), (50.0, 4.0, [-0.2, 0.0, 0.0])],
            ..Lens::default()
        };
        let wide = lens.vignetting_at(50.0, 1.8).unwrap();
        let mid = lens.vignetting_at(50.0, 2.68).unwrap(); // about one stop down from f/1.8, half way in stops
        let narrow = lens.vignetting_at(50.0, 11.0).unwrap();
        assert!((wide[0] + 0.6).abs() < 1e-9 && (narrow[0] + 0.2).abs() < 1e-9);
        assert!(mid[0] > -0.6 && mid[0] < -0.2);
    }

    #[test]
    fn corrections_scale_with_the_sensor_not_the_pixel_count() {
        let mut c = LensfunCorrection {
            lens: "test".into(), camera_crop: 1.0, lens_crop: 1.0, lens_aspect: 1.5,
            distortion: Some(Distortion::Poly3(-0.02)), tca: None, vignetting: Some([-0.5, 0.0, 0.0]), fill: 1.0,
        };
        assert!(c.fit_frame(6000.0, 4000.0));
        let big = c.scale(1, 3000.0, 2000.0, c.mm_per_px(6000.0, 4000.0));
        let small = c.scale(1, 1500.0, 1000.0, c.mm_per_px(3000.0, 2000.0));
        assert!((big - small).abs() < 1e-9, "the corner is the corner at any size");
        // Vignetting: r = 1 at the measured frame's corner (21.6 mm on full frame): gain 1 / (1 - 0.5) = 2.
        assert!((c.vignetting_gain(FULL_FRAME_DIAGONAL / 2.0) - 2.0).abs() < 1e-9);
        assert!((c.vignetting_gain(0.0) - 1.0).abs() < 1e-12);
    }
}
