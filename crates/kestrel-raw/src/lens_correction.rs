//! Lens corrections carried by the file itself: the DNG opcode lists written by phones, Adobe's converter, Leica,
//! Pentax, Ricoh and others.
//!
//! - **GainMap** (lens shading, in OpcodeList2 or OpcodeList3): a smooth grid of gains per colour plane. Phone DNGs
//!   depend on it; without it their corners are dark and tinted.
//! - **FixVignetteRadial** (OpcodeList3): a radial brightness falloff polynomial.
//! - **WarpRectilinear** (OpcodeList3): radial and tangential distortion, per colour plane (so lateral chromatic
//!   aberration too).
//!
//! These are the maker's own measurements for this lens and shot, so they come before any generic lens profile. They
//! follow Adobe's DNG specification 1.6, section 6 (Opcode lists). Brightness corrections are applied to the sensor
//! data (they are gains, so they commute with demosaicing); distortion is applied to the developed picture.
//!
//! Opcodes Kestrel doesn't apply are reported, never silently treated as done. Pure: no files, no clock.

use image::{ImageBuffer, Rgb};
use rawler::decoders::WellKnownIFD;
use rawler::formats::tiff::Value;
use rawler::rawimage::RawImageData;
use rawler::rawsource::RawSource;
use rawler::tags::DngTag;
use rawler::RawImage;
use rayon::prelude::*;

/// What the file says to correct, read from its opcode lists.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct LensCorrection {
    /// Gain maps on the sensor data (OpcodeList2), in full-sensor coordinates.
    pub sensor_gain_maps: Vec<GainMap>,
    /// Gain maps after demosaicing (OpcodeList3), in active-area coordinates.
    pub image_gain_maps: Vec<GainMap>,
    /// Radial vignetting (OpcodeList3).
    pub vignette: Option<Vignette>,
    /// Distortion (OpcodeList3).
    pub warp: Option<Warp>,
    /// A camera maker's radial lens profile stored in the file (Sony ARW today).
    pub profile: Option<RadialProfile>,
    /// Opcode ids present in the file that Kestrel does not apply (for plain reporting).
    pub skipped: Vec<u32>,
}

impl LensCorrection {
    pub fn is_empty(&self) -> bool {
        self.sensor_gain_maps.is_empty() && self.image_gain_maps.is_empty() && self.vignette.is_none() && self.warp.is_none() && self.profile.is_none()
    }

    /// A short description for the developed picture's comment: which corrections were applied.
    pub fn summary(&self) -> String {
        let mut parts = Vec::new();
        if !self.sensor_gain_maps.is_empty() || !self.image_gain_maps.is_empty() { parts.push("shading"); }
        if self.vignette.is_some() { parts.push("vignetting"); }
        if let Some(warp) = &self.warp {
            parts.push(if warp.planes.len() == 3 { "distortion+ca" } else { "distortion" });
        }
        if self.profile.is_some() { parts.push("camera-profile"); }
        let mut text = format!("{LENS_PREFIX}source=file applied={}", if parts.is_empty() { "none".to_string() } else { parts.join(",") });
        if !self.skipped.is_empty() {
            text.push_str(&format!(" skipped={}", self.skipped.iter().map(u32::to_string).collect::<Vec<_>>().join(",")));
        }
        text
    }
}

/// The text the app can look for in the developed JPEG. Versioned so it can change safely.
pub const LENS_PREFIX: &str = "InFlight-LensCorrection/1 ";

/// DNG GainMap (opcode 9).
#[derive(Clone, Debug, PartialEq)]
pub struct GainMap {
    pub top: u32,
    pub left: u32,
    pub bottom: u32,
    pub right: u32,
    pub plane: u32,
    pub planes: u32,
    pub row_pitch: u32,
    pub col_pitch: u32,
    pub points_v: u32,
    pub points_h: u32,
    pub spacing_v: f64,
    pub spacing_h: f64,
    pub origin_v: f64,
    pub origin_h: f64,
    pub map_planes: u32,
    /// [v][h][map plane]
    pub gains: Vec<f32>,
}

impl GainMap {
    /// The gain at a position relative to the image (0..1 down and across), for one map plane: bilinear between the
    /// grid points, held at the nearest point outside the grid (as the DNG SDK does).
    pub fn gain(&self, v: f64, h: f64, map_plane: usize) -> f32 {
        let map_plane = map_plane.min(self.map_planes as usize - 1);
        let fy = if self.points_v > 1 { ((v - self.origin_v) / self.spacing_v).clamp(0.0, (self.points_v - 1) as f64) } else { 0.0 };
        let fx = if self.points_h > 1 { ((h - self.origin_h) / self.spacing_h).clamp(0.0, (self.points_h - 1) as f64) } else { 0.0 };
        let (y0, x0) = (fy.floor() as usize, fx.floor() as usize);
        let (y1, x1) = ((y0 + 1).min(self.points_v as usize - 1), (x0 + 1).min(self.points_h as usize - 1));
        let (ty, tx) = ((fy - y0 as f64) as f32, (fx - x0 as f64) as f32);
        let at = |y: usize, x: usize| self.gains[(y * self.points_h as usize + x) * self.map_planes as usize + map_plane];
        let top = at(y0, x0) + (at(y0, x1) - at(y0, x0)) * tx;
        let bottom = at(y1, x0) + (at(y1, x1) - at(y1, x0)) * tx;
        top + (bottom - top) * ty
    }
}

/// DNG FixVignetteRadial (opcode 3): gain = 1 + k0 r^2 + k1 r^4 + k2 r^6 + k3 r^8 + k4 r^10.
#[derive(Clone, Debug, PartialEq)]
pub struct Vignette {
    pub k: [f64; 5],
    /// Optical centre, relative to the image (0..1).
    pub cx: f64,
    pub cy: f64,
}

/// DNG WarpRectilinear (opcode 1), one set of coefficients per plane (1 for all planes, or 3).
#[derive(Clone, Debug, PartialEq)]
pub struct Warp {
    /// kr0..kr3 (radial), kt0, kt1 (tangential).
    pub planes: Vec<[f64; 6]>,
    pub cx: f64,
    pub cy: f64,
}

/// Distance from the optical centre to the farthest corner of a w x h image: DNG's unit radius.
fn unit_radius(w: f64, h: f64, cx: f64, cy: f64) -> f64 {
    let dx = cx.max(w - cx);
    let dy = cy.max(h - cy);
    (dx * dx + dy * dy).sqrt().max(1.0)
}

impl Vignette {
    fn gain(&self, r2: f64) -> f64 {
        let k = self.k;
        1.0 + r2 * (k[0] + r2 * (k[1] + r2 * (k[2] + r2 * (k[3] + r2 * k[4]))))
    }
}

impl Warp {
    /// Where the corrected pixel at (x, y) comes from, in the same pixel coordinates, for one plane.
    /// `w`, `h`: the size of the image the opcode describes (the active area).
    pub fn source(&self, plane: usize, x: f64, y: f64, w: f64, h: f64) -> (f64, f64) {
        let c = self.planes[plane.min(self.planes.len() - 1)];
        let (cx, cy) = (self.cx * w, self.cy * h);
        let m = unit_radius(w, h, cx, cy);
        let (dx, dy) = ((x - cx) / m, (y - cy) / m);
        let r2 = dx * dx + dy * dy;
        let f = c[0] + r2 * (c[1] + r2 * (c[2] + r2 * c[3]));
        let sx = dx * f + 2.0 * c[4] * dx * dy + c[5] * (r2 + 2.0 * dx * dx);
        let sy = dy * f + c[4] * (r2 + 2.0 * dy * dy) + 2.0 * c[5] * dx * dy;
        (cx + m * sx, cy + m * sy)
    }
}

/// A radial lens profile from the camera: correction factors at a few radii from the picture's centre (radius 1 = half
/// the diagonal), joined linearly. Distortion and lateral colour as a scale on the distance from the centre per plane;
/// vignetting as the brightness falloff to divide out.
#[derive(Clone, Debug, PartialEq)]
pub struct RadialProfile {
    pub knots: Vec<f64>,
    /// Per plane (red, green, blue): where a corrected point at radius r is found, as a multiple of r.
    pub distortion: [Vec<f64>; 3],
    /// Relative brightness the lens gives at each knot (1 = none lost).
    pub falloff: Vec<f64>,
    /// Zoom so the corrected picture still fills the frame with no empty corners, as the camera's own JPEG does.
    pub fill: f64,
}

/// Linear interpolation through (knots, values), held at the ends.
fn spline(knots: &[f64], values: &[f64], x: f64) -> f64 {
    if x <= knots[0] { return values[0]; }
    let last = knots.len() - 1;
    if x >= knots[last] { return values[last]; }
    let i = knots.partition_point(|&k| k <= x) - 1;
    let t = (x - knots[i]) / (knots[i + 1] - knots[i]);
    values[i] + (values[i + 1] - values[i]) * t
}

impl RadialProfile {
    /// Sony's lens correction tags (DistortionCorrParams 0x7037, ChromaticAberrationCorrParams 0x7035,
    /// VignettingCorrParams 0x7032), each starting with its number of values. The encoding, as documented by ExifTool
    /// and used by darktable and RawTherapee: knot i sits at radius (i + 0.5) / (n - 1); distortion is
    /// 1 + d / 2^14; lateral colour scales red and blue by 1 + c / 2^21; brightness is (2^(0.5 - 2^(v / 2^13 - 1)))^2.
    pub fn from_sony(distortion: &[i32], ca: &[i32], vignetting: &[i32], picture: (f64, f64)) -> Option<RadialProfile> {
        let n = *distortion.first()? as usize;
        if !(2..=16).contains(&n) || ca.first().copied()? as usize != 2 * n || vignetting.first().copied()? as usize != n {
            return None;
        }
        if distortion.len() < n + 1 || ca.len() < 2 * n + 1 || vignetting.len() < n + 1 {
            return None;
        }
        let knots: Vec<f64> = (0..n).map(|i| (i as f64 + 0.5) / (n - 1) as f64).collect();
        let green: Vec<f64> = (0..n).map(|i| 1.0 + distortion[i + 1] as f64 / 16384.0).collect();
        let red: Vec<f64> = (0..n).map(|i| green[i] * (1.0 + ca[i + 1] as f64 / 2_097_152.0)).collect();
        let blue: Vec<f64> = (0..n).map(|i| green[i] * (1.0 + ca[n + i + 1] as f64 / 2_097_152.0)).collect();
        let falloff: Vec<f64> = (0..n).map(|i| 2f64.powf(0.5 - 2f64.powf(vignetting[i + 1] as f64 / 8192.0 - 1.0)).powi(2)).collect();
        let mut profile = RadialProfile { knots, distortion: [red, green, blue], falloff, fill: 1.0 };
        profile.fill = profile.fill_zoom(picture);
        profile.plausible().then_some(profile)
    }

    /// The largest scale any plane needs between the short edge and the corner: zooming by it keeps every corrected
    /// pixel inside the recorded picture.
    fn fill_zoom(&self, (w, h): (f64, f64)) -> f64 {
        let half_diagonal = (w * w + h * h).sqrt() / 2.0;
        let short = (w.min(h) / 2.0) / half_diagonal;
        let mut zoom = 0f64;
        for i in 0..200 {
            let r = short + (1.0 - short) * i as f64 / 199.0;
            for plane in &self.distortion {
                zoom = zoom.max(spline(&self.knots, plane, r));
            }
        }
        zoom
    }

    /// A real lens profile moves the edges by a few percent and loses at most a few stops in the corners.
    fn plausible(&self) -> bool {
        self.distortion.iter().flatten().all(|v| v.is_finite() && (0.8..=1.25).contains(v))
            && self.falloff.iter().all(|v| v.is_finite() && (0.1..=1.5).contains(v))
            && (0.8..=1.25).contains(&self.fill)
    }

    /// Brightness gain at a radius (1 = half the diagonal).
    pub fn gain(&self, r: f64) -> f64 {
        1.0 / spline(&self.knots, &self.falloff, r).max(1e-3)
    }

    /// Where a corrected point at radius r (1 = half the diagonal) is found, as a multiple of its distance, per plane.
    pub fn scale(&self, plane: usize, r: f64) -> f64 {
        spline(&self.knots, &self.distortion[plane], r / self.fill) / self.fill
    }
}

/// Sony's lens tags, from the raw IFD (SubIFD) or, after a DNG round trip, IFD 0.
fn sony_profile(bytes: &[u8], picture: (f64, f64)) -> Option<RadialProfile> {
    use rawler::formats::tiff::reader::TiffReader;
    let tiff = rawler::formats::tiff::GenericTiffReader::new_with_buffer(bytes, 0, 0, None).ok()?;
    let root = tiff.root_ifd();
    let mut candidates = vec![root];
    if let Some(subs) = root.get_sub_ifd_all(rawler::tags::TiffCommonTag::SubIFDs) {
        candidates.extend(subs.iter());
    }
    let values = |ifd: &rawler::formats::tiff::IFD, tag: u16| -> Option<Vec<i32>> {
        let value = &ifd.get_entry(tag)?.value;
        Some((0..value.count()).map(|i| value.force_i32(i)).collect())
    };
    candidates.into_iter().find_map(|ifd| {
        RadialProfile::from_sony(&values(ifd, 0x7037)?, &values(ifd, 0x7035)?, &values(ifd, 0x7032)?, picture)
    })
}

// ---- Reading the opcode lists ------------------------------------------------------------------------------------

/// Read the corrections a file carries. Files with none (every non-DNG today) give an empty result.
pub fn from_file(bytes: &[u8]) -> LensCorrection {
    from_file_for(bytes, None)
}

/// As `from_file`, also reading a camera maker's lens profile, which needs the developed picture's size.
pub fn from_file_for(bytes: &[u8], picture: Option<(f64, f64)>) -> LensCorrection {
    let lists = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let source = RawSource::new_from_slice(bytes);
        let decoder = rawler::get_decoder(&source).ok()?;
        let ifd = decoder.ifd(WellKnownIFD::Raw).ok().flatten()?;
        let read = |tag: DngTag| match ifd.get_entry(tag).map(|entry| &entry.value) {
            Some(Value::Undefined(data)) | Some(Value::Byte(data)) => Some(data.clone()),
            _ => None,
        };
        Some((read(DngTag::OpcodeList2), read(DngTag::OpcodeList3)))
    }))
    .ok()
    .flatten();
    let mut out = LensCorrection::default();
    let Some((list2, list3)) = lists else {
        out.profile = picture.and_then(|picture| std::panic::catch_unwind(|| sony_profile(bytes, picture)).ok().flatten());
        return out;
    };
    if let Some(data) = list2 {
        for op in parse_list(&data, &mut out.skipped) {
            match op {
                Opcode::GainMap(map) => out.sensor_gain_maps.push(map),
                // Vignette and warp belong after demosaicing; in list 2 they are not expected and are not applied.
                Opcode::Vignette(_) => out.skipped.push(OP_FIX_VIGNETTE_RADIAL),
                Opcode::Warp(_) => out.skipped.push(OP_WARP_RECTILINEAR),
            }
        }
    }
    if let Some(data) = list3 {
        for op in parse_list(&data, &mut out.skipped) {
            match op {
                Opcode::GainMap(map) => out.image_gain_maps.push(map),
                Opcode::Vignette(v) => out.vignette = Some(v),
                Opcode::Warp(w) => out.warp = Some(w),
            }
        }
    }
    // A DNG's own opcodes describe this shot; a camera profile is used only when there are none.
    if out.is_empty() {
        out.profile = picture.and_then(|picture| std::panic::catch_unwind(|| sony_profile(bytes, picture)).ok().flatten());
    }
    out
}

const OP_WARP_RECTILINEAR: u32 = 1;
const OP_FIX_VIGNETTE_RADIAL: u32 = 3;
const OP_GAIN_MAP: u32 = 9;

enum Opcode {
    GainMap(GainMap),
    Vignette(Vignette),
    Warp(Warp),
}

/// Parse a DNG opcode list (always big-endian). Opcodes that are unknown or malformed are recorded in `skipped`.
fn parse_list(data: &[u8], skipped: &mut Vec<u32>) -> Vec<Opcode> {
    let mut r = Reader { data, at: 0 };
    let mut out = Vec::new();
    let Some(count) = r.u32() else { return out };
    for _ in 0..count.min(256) {
        let (Some(id), Some(_version), Some(_flags), Some(size)) = (r.u32(), r.u32(), r.u32(), r.u32()) else { break };
        let Some(body) = r.take(size as usize) else { break };
        let parsed = match id {
            OP_GAIN_MAP => parse_gain_map(body).map(Opcode::GainMap),
            OP_FIX_VIGNETTE_RADIAL => parse_vignette(body).map(Opcode::Vignette),
            OP_WARP_RECTILINEAR => parse_warp(body).map(Opcode::Warp),
            _ => None,
        };
        match parsed {
            Some(op) => out.push(op),
            None => skipped.push(id),
        }
    }
    out
}

struct Reader<'a> {
    data: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let end = self.at.checked_add(n)?;
        let slice = self.data.get(self.at..end)?;
        self.at = end;
        Some(slice)
    }
    fn u32(&mut self) -> Option<u32> {
        self.take(4).map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
    }
    fn f32(&mut self) -> Option<f32> {
        self.take(4).map(|b| f32::from_be_bytes([b[0], b[1], b[2], b[3]]))
    }
    fn f64(&mut self) -> Option<f64> {
        self.take(8).map(|b| f64::from_be_bytes(b.try_into().unwrap()))
    }
}

fn finite(v: f64) -> Option<f64> {
    v.is_finite().then_some(v)
}

fn parse_gain_map(body: &[u8]) -> Option<GainMap> {
    let mut r = Reader { data: body, at: 0 };
    let (top, left, bottom, right) = (r.u32()?, r.u32()?, r.u32()?, r.u32()?);
    let (plane, planes, row_pitch, col_pitch) = (r.u32()?, r.u32()?, r.u32()?, r.u32()?);
    let (points_v, points_h) = (r.u32()?, r.u32()?);
    let (spacing_v, spacing_h) = (finite(r.f64()?)?, finite(r.f64()?)?);
    let (origin_v, origin_h) = (finite(r.f64()?)?, finite(r.f64()?)?);
    let map_planes = r.u32()?;
    if points_v == 0 || points_h == 0 || map_planes == 0 || planes == 0 || row_pitch == 0 || col_pitch == 0 || bottom <= top || right <= left {
        return None;
    }
    if (points_v > 1 && spacing_v <= 0.0) || (points_h > 1 && spacing_h <= 0.0) {
        return None;
    }
    let n = (points_v as usize).checked_mul(points_h as usize)?.checked_mul(map_planes as usize)?;
    if n > 4_000_000 {
        return None;
    }
    let mut gains = Vec::with_capacity(n);
    for _ in 0..n {
        let g = r.f32()?;
        // A gain map brightens or darkens gently; anything else is a malformed file.
        if !(g.is_finite() && (0.0..=64.0).contains(&g)) {
            return None;
        }
        gains.push(g);
    }
    Some(GainMap { top, left, bottom, right, plane, planes, row_pitch, col_pitch, points_v, points_h, spacing_v, spacing_h, origin_v, origin_h, map_planes, gains })
}

fn parse_vignette(body: &[u8]) -> Option<Vignette> {
    let mut r = Reader { data: body, at: 0 };
    let mut k = [0f64; 5];
    for slot in &mut k {
        *slot = finite(r.f64()?)?;
    }
    let (cx, cy) = (finite(r.f64()?)?, finite(r.f64()?)?);
    let v = Vignette { k, cx, cy };
    // The gain must stay positive and sensible across the frame (r^2 up to 1).
    let plausible = (0..=20).all(|i| { let g = v.gain(i as f64 / 20.0); g > 0.05 && g < 32.0 });
    plausible.then_some(v)
}

fn parse_warp(body: &[u8]) -> Option<Warp> {
    let mut r = Reader { data: body, at: 0 };
    let n = r.u32()?;
    if n != 1 && n != 3 {
        return None;
    }
    let mut planes = Vec::with_capacity(n as usize);
    for _ in 0..n {
        let mut c = [0f64; 6];
        for slot in &mut c {
            *slot = finite(r.f64()?)?;
        }
        planes.push(c);
    }
    let (cx, cy) = (finite(r.f64()?)?, finite(r.f64()?)?);
    let warp = Warp { planes, cx, cy };
    // A real lens moves the frame's corners by a few percent at most; reject anything that folds the picture.
    let plausible = (0..warp.planes.len()).all(|p| {
        (0..=10).all(|i| {
            let x = i as f64 / 10.0 * 1000.0;
            let (sx, sy) = warp.source(p, x, x * 0.66, 1000.0, 660.0);
            sx.is_finite() && sy.is_finite() && (sx - x).abs() < 250.0 && (sy - x * 0.66).abs() < 250.0
        })
    });
    plausible.then_some(warp)
}

// ---- Applying them -------------------------------------------------------------------------------------------------

/// Apply the brightness corrections (gain maps and vignetting) to the sensor data in place.
/// Returns true when anything was applied.
pub fn apply_to_sensor(correction: &LensCorrection, raw: &mut RawImage) -> bool {
    if correction.sensor_gain_maps.is_empty() && correction.image_gain_maps.is_empty() && correction.vignette.is_none() && correction.profile.is_none() {
        return false;
    }
    // The developed picture's place on the sensor, for the camera profile (centred on the picture).
    let ((px, py), _, (pw, ph)) = crate::scene_develop::picture_frame(raw);
    let (width, height, cpp) = (raw.width, raw.height, raw.cpp.max(1));
    let (ax, ay, aw, ah) = match raw.active_area {
        Some(rect) => (rect.p.x, rect.p.y, rect.d.w, rect.d.h),
        None => (0, 0, width, height),
    };
    let black = raw.blacklevel.as_vec();
    let black_at = |x: usize, y: usize, plane: usize| -> f32 {
        if cpp == 1 { black[(((y & 1) << 1) | (x & 1)).min(black.len() - 1)] } else { black[plane.min(black.len() - 1)] }
    };
    // Gain for one sample, combining every map and the vignette that covers it.
    let gain_at = |x: usize, y: usize, plane: usize| -> f32 {
        let mut g = 1.0f32;
        for map in &correction.sensor_gain_maps {
            g *= map_gain(map, x, y, plane, width, height);
        }
        let (sx, sy) = (x as isize - ax as isize, y as isize - ay as isize);
        if sx >= 0 && sy >= 0 && (sx as usize) < aw && (sy as usize) < ah {
            for map in &correction.image_gain_maps {
                g *= map_gain(map, sx as usize, sy as usize, plane, aw, ah);
            }
            if let Some(v) = &correction.vignette {
                let (cx, cy) = (v.cx * aw as f64, v.cy * ah as f64);
                let m = unit_radius(aw as f64, ah as f64, cx, cy);
                let (dx, dy) = ((sx as f64 + 0.5 - cx) / m, (sy as f64 + 0.5 - cy) / m);
                g *= v.gain(dx * dx + dy * dy) as f32;
            }
            if let Some(profile) = &correction.profile {
                let half_diagonal = ((pw * pw + ph * ph) as f64).sqrt() / 2.0;
                let dx = sx as f64 + 0.5 - (px as f64 + pw as f64 / 2.0);
                let dy = sy as f64 + 0.5 - (py as f64 + ph as f64 / 2.0);
                g *= profile.gain((dx * dx + dy * dy).sqrt() / half_diagonal) as f32;
            }
        }
        g
    };
    match &mut raw.data {
        RawImageData::Integer(samples) => samples.par_chunks_mut(width * cpp).enumerate().for_each(|(y, row)| {
            for x in 0..width {
                for plane in 0..cpp {
                    let g = gain_at(x, y, plane);
                    if g == 1.0 { continue }
                    let slot = &mut row[x * cpp + plane];
                    let b = black_at(x, y, plane);
                    let v = *slot as f32;
                    if v > b {
                        *slot = (b + (v - b) * g).round().clamp(0.0, u16::MAX as f32) as u16;
                    }
                }
            }
        }),
        RawImageData::Float(samples) => samples.par_chunks_mut(width * cpp).enumerate().for_each(|(y, row)| {
            for x in 0..width {
                for plane in 0..cpp {
                    let b = black_at(x, y, plane);
                    let slot = &mut row[x * cpp + plane];
                    if *slot > b { *slot = b + (*slot - b) * gain_at(x, y, plane); }
                }
            }
        }),
    }
    true
}

/// A gain map's gain for one sample at (x, y) of a w x h image, or 1 where the map does not apply.
fn map_gain(map: &GainMap, x: usize, y: usize, plane: usize, w: usize, h: usize) -> f32 {
    let (x32, y32) = (x as u32, y as u32);
    if y32 < map.top || y32 >= map.bottom || x32 < map.left || x32 >= map.right {
        return 1.0;
    }
    if (y32 - map.top) % map.row_pitch != 0 || (x32 - map.left) % map.col_pitch != 0 {
        return 1.0;
    }
    let plane = plane as u32;
    if plane < map.plane || plane >= map.plane + map.planes {
        return 1.0;
    }
    let v = (y as f64 + 0.5) / h as f64;
    let u = (x as f64 + 0.5) / w as f64;
    map.gain(v, u, (plane - map.plane) as usize)
}

/// Correct distortion (and lateral colour, when the file gives each plane its own coefficients) on the developed
/// picture. `origin`: where the picture's top-left sits in the active area; `scale`: active-area pixels per picture
/// pixel (2 for the half-size screen develop). `active`: the active area's size. Bilinear resampling; samples that fall
/// outside the picture take its nearest edge.
pub fn apply_warp(warp: &Warp, image: &mut ImageBuffer<Rgb<u16>, Vec<u16>>, origin: (f64, f64), scale: f64, active: (f64, f64)) {
    let (w, h) = (image.width() as usize, image.height() as usize);
    if w < 2 || h < 2 {
        return;
    }
    let src = image.as_raw().clone();
    let sample = |plane: usize, fx: f64, fy: f64| -> u16 {
        let fx = fx.clamp(0.0, (w - 1) as f64);
        let fy = fy.clamp(0.0, (h - 1) as f64);
        let (x0, y0) = (fx.floor() as usize, fy.floor() as usize);
        let (x1, y1) = ((x0 + 1).min(w - 1), (y0 + 1).min(h - 1));
        let (tx, ty) = ((fx - x0 as f64) as f32, (fy - y0 as f64) as f32);
        let at = |x: usize, y: usize| src[(y * w + x) * 3 + plane] as f32;
        let top = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * tx;
        let bottom = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * tx;
        (top + (bottom - top) * ty + 0.5) as u16
    };
    let per_plane = warp.planes.len() == 3;
    image.as_mut().par_chunks_mut(w * 3).enumerate().for_each(|(y, row)| {
        for x in 0..w {
            // Pixel centre in active-area coordinates.
            let ax = origin.0 + (x as f64 + 0.5) * scale;
            let ay = origin.1 + (y as f64 + 0.5) * scale;
            let mut shared = None;
            for plane in 0..3 {
                let (sx, sy) = if per_plane {
                    warp.source(plane, ax, ay, active.0, active.1)
                } else {
                    *shared.get_or_insert_with(|| warp.source(0, ax, ay, active.0, active.1))
                };
                let px = (sx - origin.0) / scale - 0.5;
                let py = (sy - origin.1) / scale - 0.5;
                row[x * 3 + plane] = sample(plane, px, py);
            }
        }
    });
}

/// Correct distortion and lateral colour from a camera profile on the developed picture (before orientation), at any
/// size: the profile works in radii relative to the picture's half diagonal.
pub fn apply_profile(profile: &RadialProfile, image: &mut ImageBuffer<Rgb<u16>, Vec<u16>>) {
    let (w, h) = (image.width() as usize, image.height() as usize);
    if w < 2 || h < 2 {
        return;
    }
    let (cx, cy) = (w as f64 / 2.0, h as f64 / 2.0);
    let half_diagonal = (cx * cx + cy * cy).sqrt();
    let src = image.as_raw().clone();
    image.as_mut().par_chunks_mut(w * 3).enumerate().for_each(|(y, row)| {
        for x in 0..w {
            let (dx, dy) = (x as f64 + 0.5 - cx, y as f64 + 0.5 - cy);
            let r = (dx * dx + dy * dy).sqrt() / half_diagonal;
            for plane in 0..3 {
                let s = profile.scale(plane, r);
                row[x * 3 + plane] = bilinear(&src, w, h, plane, cx + s * dx - 0.5, cy + s * dy - 0.5);
            }
        }
    });
}

/// One plane of a 16-bit RGB picture at a fractional position, edges held.
fn bilinear(src: &[u16], w: usize, h: usize, plane: usize, fx: f64, fy: f64) -> u16 {
    let fx = fx.clamp(0.0, (w - 1) as f64);
    let fy = fy.clamp(0.0, (h - 1) as f64);
    let (x0, y0) = (fx.floor() as usize, fy.floor() as usize);
    let (x1, y1) = ((x0 + 1).min(w - 1), (y0 + 1).min(h - 1));
    let (tx, ty) = ((fx - x0 as f64) as f32, (fy - y0 as f64) as f32);
    let at = |x: usize, y: usize| src[(y * w + x) * 3 + plane] as f32;
    let top = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * tx;
    let bottom = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * tx;
    (top + (bottom - top) * ty + 0.5) as u16
}

#[cfg(test)]
mod tests {
    use super::*;

    fn be32(v: u32) -> [u8; 4] { v.to_be_bytes() }

    pub(crate) fn opcode(id: u32, body: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend(be32(id));
        out.extend(be32(0x0103_0000));
        out.extend(be32(0));
        out.extend(be32(body.len() as u32));
        out.extend(body);
        out
    }

    pub(crate) fn list(ops: &[Vec<u8>]) -> Vec<u8> {
        let mut out = be32(ops.len() as u32).to_vec();
        for op in ops { out.extend(op); }
        out
    }

    pub(crate) fn gain_map_body(top: u32, left: u32, pitch: u32, points: (u32, u32), gains: &[f32]) -> Vec<u8> {
        let mut b = Vec::new();
        for v in [top, left, 100_000, 100_000, 0, 1, pitch, pitch, points.0, points.1] { b.extend(be32(v)); }
        let spacing_v = if points.0 > 1 { 1.0 / (points.0 - 1) as f64 } else { 1.0 };
        let spacing_h = if points.1 > 1 { 1.0 / (points.1 - 1) as f64 } else { 1.0 };
        for v in [spacing_v, spacing_h, 0.0, 0.0] { b.extend(v.to_be_bytes()); }
        b.extend(be32(1));
        for g in gains { b.extend(g.to_be_bytes()); }
        b
    }

    pub(crate) fn vignette_body(k: [f64; 5]) -> Vec<u8> {
        let mut b = Vec::new();
        for v in k.iter().chain([0.5, 0.5].iter()) { b.extend(v.to_be_bytes()); }
        b
    }

    pub(crate) fn warp_body(planes: &[[f64; 6]]) -> Vec<u8> {
        let mut b = be32(planes.len() as u32).to_vec();
        for p in planes { for v in p { b.extend(v.to_be_bytes()); } }
        for v in [0.5f64, 0.5] { b.extend(v.to_be_bytes()); }
        b
    }

    #[test]
    fn opcode_lists_are_read_and_unknown_or_broken_opcodes_are_reported() {
        let data = list(&[
            opcode(9, &gain_map_body(0, 0, 1, (2, 2), &[1.0, 2.0, 3.0, 4.0])),
            opcode(3, &vignette_body([0.5, 0.0, 0.0, 0.0, 0.0])),
            opcode(1, &warp_body(&[[1.0, 0.02, 0.0, 0.0, 0.0, 0.0]])),
            opcode(4, &[0; 12]),                                   // FixBadPixelsConstant: not applied
            opcode(3, &vignette_body([f64::NAN, 0.0, 0.0, 0.0, 0.0])), // malformed
        ]);
        let mut skipped = Vec::new();
        let ops = parse_list(&data, &mut skipped);
        assert_eq!(ops.len(), 3);
        assert_eq!(skipped, vec![4, 3]);
        let Opcode::GainMap(map) = &ops[0] else { panic!() };
        assert!((map.gain(0.0, 0.0, 0) - 1.0).abs() < 1e-6);
        assert!((map.gain(1.0, 1.0, 0) - 4.0).abs() < 1e-6);
        assert!((map.gain(0.5, 0.5, 0) - 2.5).abs() < 1e-6, "bilinear in the middle");
        assert!((map.gain(-1.0, 2.0, 0) - 2.0).abs() < 1e-6, "held at the edge outside the grid");
        // Truncated lists stop cleanly.
        assert!(parse_list(&data[..30], &mut Vec::new()).is_empty());
        assert!(parse_list(&[], &mut Vec::new()).is_empty());
    }

    #[test]
    fn a_warp_that_folds_the_picture_is_refused() {
        assert!(parse_warp(&warp_body(&[[1.0, 0.02, 0.0, 0.0, 0.0, 0.0]])).is_some());
        assert!(parse_warp(&warp_body(&[[1.0, 40.0, 0.0, 0.0, 0.0, 0.0]])).is_none());
        assert!(parse_vignette(&vignette_body([-2.0, 0.0, 0.0, 0.0, 0.0])).is_none(), "a gain that goes negative");
    }

    #[test]
    fn identity_warp_leaves_the_picture_exactly_alone() {
        let mut img = ImageBuffer::from_fn(64, 40, |x, y| Rgb([(x * 900) as u16, (y * 1500) as u16, ((x + y) * 600) as u16]));
        let before = img.clone();
        let warp = Warp { planes: vec![[1.0, 0.0, 0.0, 0.0, 0.0, 0.0]], cx: 0.5, cy: 0.5 };
        apply_warp(&warp, &mut img, (0.0, 0.0), 1.0, (64.0, 40.0));
        assert_eq!(img, before);
    }

    #[test]
    fn barrel_distortion_is_straightened() {
        // A straight vertical line near the right edge, bowed outwards by barrel distortion (k1 < 0 in the forward
        // model). The DNG warp maps each corrected pixel to where it lies in the distorted picture.
        let (w, h) = (400u32, 300u32);
        let warp = Warp { planes: vec![[1.0, -0.08, 0.0, 0.0, 0.0, 0.0]], cx: 0.5, cy: 0.5 };
        let line_x = 340.0;
        // Draw the distorted picture: a pixel is on the line if its corrected position is.
        // Invert by sampling: for each distorted pixel find the corrected one with a few fixed-point steps.
        let distorted = ImageBuffer::from_fn(w, h, |x, y| {
            let (dx, dy) = (x as f64 + 0.5, y as f64 + 0.5);
            let (mut ux, mut uy) = (dx, dy);
            for _ in 0..20 {
                let (sx, sy) = warp.source(0, ux, uy, w as f64, h as f64);
                ux += dx - sx;
                uy += dy - sy;
            }
            let v = if (ux - line_x).abs() < 1.5 { 60000 } else { 2000 };
            Rgb([v, v, v])
        });
        let column_of = |img: &ImageBuffer<Rgb<u16>, Vec<u16>>, y: u32| {
            let (mut sum, mut weight) = (0f64, 0f64);
            for x in 0..w { let v = img.get_pixel(x, y)[1] as f64 - 2000.0; if v > 0.0 { sum += v * x as f64; weight += v; } }
            sum / weight
        };
        let bow = |img: &ImageBuffer<Rgb<u16>, Vec<u16>>| (column_of(img, 10) - column_of(img, h / 2)).abs();
        assert!(bow(&distorted) > 2.0, "the line is bent before: {}", bow(&distorted));
        let mut corrected = distorted.clone();
        apply_warp(&warp, &mut corrected, (0.0, 0.0), 1.0, (w as f64, h as f64));
        assert!(bow(&corrected) < 0.5, "straight after: {}", bow(&corrected));
        assert!((column_of(&corrected, h / 2) - (line_x - 0.5)).abs() < 1.0);
        // The half-size picture of the same frame is corrected the same way.
        let half = image::imageops::resize(&distorted, w / 2, h / 2, image::imageops::FilterType::Triangle);
        let mut half_corrected = half.clone();
        apply_warp(&warp, &mut half_corrected, (0.0, 0.0), 2.0, (w as f64, h as f64));
        let half_bow = (column_of_half(&half_corrected, 5) - column_of_half(&half_corrected, h / 4)).abs();
        assert!(half_bow < 0.5, "half size straight too: {half_bow}");
        fn column_of_half(img: &ImageBuffer<Rgb<u16>, Vec<u16>>, y: u32) -> f64 {
            let (mut sum, mut weight) = (0f64, 0f64);
            for x in 0..img.width() { let v = img.get_pixel(x, y)[1] as f64 - 2000.0; if v > 0.0 { sum += v * x as f64; weight += v; } }
            sum / weight
        }
    }

    #[test]
    fn per_plane_warp_moves_colours_back_into_register() {
        // Lateral CA: red is 1% larger than green, blue 1% smaller. A white dot near the corner splits into colours.
        let (w, h) = (300u32, 200u32);
        let warp = Warp { planes: vec![[1.01, 0.0, 0.0, 0.0, 0.0, 0.0], [1.0, 0.0, 0.0, 0.0, 0.0, 0.0], [0.99, 0.0, 0.0, 0.0, 0.0, 0.0]], cx: 0.5, cy: 0.5 };
        let dot = (270.0, 180.0);
        let img = ImageBuffer::from_fn(w, h, |x, y| {
            let p = (x as f64 + 0.5, y as f64 + 0.5);
            Rgb([0, 1, 2].map(|plane| {
                // A plane shows the dot where its scale puts it: the source position of the dot's corrected position.
                let (sx, sy) = warp.source(plane, dot.0, dot.1, w as f64, h as f64);
                if (p.0 - sx).powi(2) + (p.1 - sy).powi(2) < 4.0 { 60000 } else { 0 }
            }))
        });
        let centroid = |img: &ImageBuffer<Rgb<u16>, Vec<u16>>, plane: usize| {
            let (mut sx, mut sy, mut n) = (0f64, 0f64, 0f64);
            for (x, y, p) in img.enumerate_pixels() { let v = p[plane] as f64; sx += v * x as f64; sy += v * y as f64; n += v; }
            (sx / n, sy / n)
        };
        let split = |img: &ImageBuffer<Rgb<u16>, Vec<u16>>| { let (r, b) = (centroid(img, 0), centroid(img, 2)); ((r.0 - b.0).powi(2) + (r.1 - b.1).powi(2)).sqrt() };
        assert!(split(&img) > 2.0);
        let mut corrected = img.clone();
        apply_warp(&warp, &mut corrected, (0.0, 0.0), 1.0, (w as f64, h as f64));
        assert!(split(&corrected) < 0.3, "colours back in register: {}", split(&corrected));
    }

    /// Add tags (sorted, as TIFF wants) to IFD 0 of a little-endian DNG: data appended at the end, IFD rewritten.
    #[cfg(feature = "nikon-he")]
    fn with_tags(dng: &[u8], extra: &[(u16, Vec<u8>)]) -> Vec<u8> {
        with_typed_tags(dng, &extra.iter().map(|(t, d)| (*t, 7u16, d.len() as u32, d.clone())).collect::<Vec<_>>())
    }

    /// As `with_tags`, with each tag's TIFF type and count.
    #[cfg(feature = "nikon-he")]
    fn with_typed_tags(dng: &[u8], extra: &[(u16, u16, u32, Vec<u8>)]) -> Vec<u8> {
        assert_eq!(&dng[..4], b"II*\0");
        let rd16 = |b: &[u8], o: usize| u16::from_le_bytes([b[o], b[o + 1]]);
        let rd32 = |b: &[u8], o: usize| u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]]);
        let ifd = rd32(dng, 4) as usize;
        let n = rd16(dng, ifd) as usize;
        let mut entries: Vec<[u8; 12]> = (0..n).map(|i| dng[ifd + 2 + 12 * i..ifd + 14 + 12 * i].try_into().unwrap()).collect();
        let mut out = dng.to_vec();
        for (tag, kind, count, data) in extra {
            let mut e = [0u8; 12];
            e[0..2].copy_from_slice(&tag.to_le_bytes());
            e[2..4].copy_from_slice(&kind.to_le_bytes());
            e[4..8].copy_from_slice(&count.to_le_bytes());
            if data.len() <= 4 {
                e[8..8 + data.len()].copy_from_slice(data);
            } else {
                while out.len() % 2 == 1 { out.push(0); }
                let at = out.len() as u32;
                out.extend(data);
                e[8..12].copy_from_slice(&at.to_le_bytes());
            }
            entries.push(e);
        }
        entries.sort_by_key(|e| u16::from_le_bytes([e[0], e[1]]));
        while out.len() % 2 == 1 { out.push(0); }
        let new_ifd = out.len() as u32;
        out.extend((entries.len() as u16).to_le_bytes());
        for e in &entries { out.extend(e); }
        out.extend(0u32.to_le_bytes());
        out[4..8].copy_from_slice(&new_ifd.to_le_bytes());
        out
    }

    /// A flat grey scene seen through a lens that darkens the corners (cos^4-like falloff), as a synthetic Bayer DNG.
    #[cfg(feature = "nikon-he")]
    fn vignetted_dng(width: usize, height: usize, falloff: impl Fn(f64, f64) -> f64) -> Vec<u8> {
        let pixels = (0..width * height).map(|i| {
            let (x, y) = (i % width, i / width);
            let g = falloff((x as f64 + 0.5) / width as f64, (y as f64 + 0.5) / height as f64);
            (1008.0 + 3000.0 * g) as u16
        }).collect();
        let decoded = ticoraw::DecodedRaw {
            make: "NIKON CORPORATION".into(), model: "NIKON Z 8".into(),
            image: ticoraw::CfaImage { width, height, pixels },
            color: ticoraw::ColorInfo { cfa_pattern: [0, 1, 1, 2], black_level: [1008; 4], white_level: 15520,
                color_matrix: Some([(10000, 10000), (0, 10000), (0, 10000), (0, 10000), (10000, 10000), (0, 10000), (0, 10000), (0, 10000), (10000, 10000)]),
                as_shot_neutral: Some([(1, 1), (1, 1), (1, 1)]) },
            orientation: 1, crop: None, baseline_exposure: None,
        };
        ticoraw::dng::encode_uncompressed_dng(&decoded).unwrap()
    }

    #[cfg(feature = "nikon-he")]
    fn corner_to_centre(jpeg: &[u8]) -> f64 {
        let img = image::load_from_memory(jpeg).unwrap().to_luma8();
        let (w, h) = (img.width(), img.height());
        let mean = |x0: u32, y0: u32| { let mut s = 0f64; for y in y0..y0 + 8 { for x in x0..x0 + 8 { s += img.get_pixel(x, y)[0] as f64; } } s / 64.0 };
        mean(4, 4) / mean(w / 2 - 4, h / 2 - 4)
    }

    #[cfg(feature = "nikon-he")]
    #[test]
    fn a_dng_gain_map_takes_the_dark_corners_out() {
        let (w, h) = (320usize, 240usize);
        let falloff = |u: f64, v: f64| { let r2 = ((u - 0.5).powi(2) + (v - 0.5).powi(2)) / 0.5; 1.0 - 0.45 * r2 };
        let bare = vignetted_dng(w, h, falloff);
        // The maker's measured shading: one map per Bayer site, as phones write them (pitch 2), 9 x 9 points.
        let points = 9u32;
        let mut ops = Vec::new();
        for (top, left) in [(0, 0), (0, 1), (1, 0), (1, 1)] {
            let gains: Vec<f32> = (0..points * points).map(|i| {
                let (gx, gy) = ((i % points) as f64 / (points - 1) as f64, (i / points) as f64 / (points - 1) as f64);
                (1.0 / falloff(gx, gy)) as f32
            }).collect();
            ops.push(opcode(9, &gain_map_body(top, left, 2, (points, points), &gains)));
        }
        let dng = with_tags(&bare, &[(0xC741, list(&ops))]);
        let lens = from_file(&dng);
        assert_eq!(lens.sensor_gain_maps.len(), 4, "{lens:?}");
        assert!(from_file(&bare).is_empty());
        let before = corner_to_centre(&crate::develop_jpeg(&bare).unwrap());
        let jpeg = crate::develop_jpeg(&dng).unwrap();
        let after = corner_to_centre(&jpeg);
        assert!(before < 0.85, "corners start dark: {before:.3}");
        assert!((after - 1.0).abs() < 0.03, "corners match the centre after: {after:.3}");
        assert!(String::from_utf8_lossy(&jpeg[..300]).contains("InFlight-LensCorrection/1 source=file applied=shading"));
    }

    #[cfg(feature = "nikon-he")]
    #[test]
    fn a_dng_radial_vignette_and_warp_are_read_and_applied() {
        let (w, h) = (320usize, 240usize);
        let k0 = 0.6;
        // FixVignetteRadial: gain = 1 + k0 r^2 with r = 1 at the farthest corner; the scene is its inverse.
        let falloff = move |u: f64, v: f64| {
            let (dx, dy) = ((u - 0.5) * w as f64, (v - 0.5) * h as f64);
            let r2 = (dx * dx + dy * dy) / ((w as f64 / 2.0).powi(2) + (h as f64 / 2.0).powi(2));
            1.0 / (1.0 + k0 * r2)
        };
        let bare = vignetted_dng(w, h, falloff);
        let list3 = list(&[opcode(3, &vignette_body([k0, 0.0, 0.0, 0.0, 0.0])), opcode(1, &warp_body(&[[1.0, 0.0, 0.0, 0.0, 0.0, 0.0]]))]);
        let dng = with_tags(&bare, &[(0xC74E, list3)]);
        let lens = from_file(&dng);
        assert!(lens.vignette.is_some() && lens.warp.is_some(), "{lens:?}");
        let before = corner_to_centre(&crate::develop_jpeg(&bare).unwrap());
        let jpeg = crate::develop_jpeg(&dng).unwrap();
        let after = corner_to_centre(&jpeg);
        assert!(before < 0.85 && (after - 1.0).abs() < 0.03, "{before:.3} -> {after:.3}");
        assert!(String::from_utf8_lossy(&jpeg[..300]).contains("applied=vignetting,distortion"));
        // The screen-size develop and the 16-bit develop get the same correction.
        let screen = corner_to_centre(&crate::develop_jpeg_screen(&dng).unwrap());
        assert!((screen - 1.0).abs() < 0.04, "screen copy {screen:.3}");
    }

    #[test]
    fn a_zero_sony_profile_changes_nothing_and_a_bulging_one_zooms_to_fill() {
        let n = 16;
        let zeros = |count: usize| { let mut v = vec![count as i32]; v.extend(std::iter::repeat(0).take(count)); v };
        let flat = RadialProfile::from_sony(&zeros(n), &zeros(2 * n), &zeros(n), (6000.0, 4000.0)).unwrap();
        assert!((flat.fill - 1.0).abs() < 1e-9);
        for r in [0.0, 0.3, 0.7, 1.0] {
            assert!((flat.gain(r) - 1.0).abs() < 1e-9 && (0..3).all(|p| (flat.scale(p, r) - 1.0).abs() < 1e-9));
        }
        // Barrel correction: corners must be pulled in from further out, up to 4% (d = 0.04 * 2^14 at the edge).
        let mut d = vec![n as i32];
        d.extend((0..n).map(|i| ((i as f64 / (n - 1) as f64).powi(2) * 0.04 * 16384.0) as i32));
        let barrel = RadialProfile::from_sony(&d, &zeros(2 * n), &zeros(n), (6000.0, 4000.0)).unwrap();
        assert!(barrel.fill > 1.01, "zoomed so no corner is empty: {}", barrel.fill);
        // With the zoom, the corner's source is still inside the picture: radius scale * 1 <= the farthest knot's reach.
        assert!(barrel.scale(1, 1.0) <= 1.0 + 1e-9, "{}", barrel.scale(1, 1.0));
        // Counts that don't agree, or wild values, are refused.
        assert!(RadialProfile::from_sony(&zeros(n), &zeros(n), &zeros(n), (6000.0, 4000.0)).is_none());
        let mut wild = vec![n as i32]; wild.extend(std::iter::repeat(16000).take(n));
        assert!(RadialProfile::from_sony(&wild, &zeros(2 * n), &zeros(n), (6000.0, 4000.0)).is_none());
    }

    #[test]
    fn sony_lateral_colour_brings_red_and_blue_back_into_register() {
        let n = 16;
        let zeros = |count: usize| { let mut v = vec![count as i32]; v.extend(std::iter::repeat(0).take(count)); v };
        // Red imaged 0.5% larger, blue 0.5% smaller: the correction looks 0.5% further out / in for them.
        let mut ca = vec![(2 * n) as i32];
        ca.extend(std::iter::repeat((0.005 * 2_097_152.0) as i32).take(n));
        ca.extend(std::iter::repeat((-0.005 * 2_097_152.0) as i32).take(n));
        let profile = RadialProfile::from_sony(&zeros(n), &ca, &zeros(n), (300.0, 200.0)).unwrap();
        let (w, h) = (300u32, 200u32);
        let (cx, cy) = (150.0f64, 100.0f64);
        let dot = (280.0f64, 185.0f64);
        let img = ImageBuffer::from_fn(w, h, |x, y| {
            let p = (x as f64 + 0.5, y as f64 + 0.5);
            Rgb([0, 1, 2].map(|plane| {
                let r = (((dot.0 - cx) as f64).powi(2) + ((dot.1 - cy) as f64).powi(2)).sqrt() / (cx * cx + cy * cy).sqrt();
                let s = profile.scale(plane, r);
                let (sx, sy) = (cx + s * (dot.0 - cx), cy + s * (dot.1 - cy));
                if (p.0 - sx).powi(2) + (p.1 - sy).powi(2) < 4.0 { 60000 } else { 0 }
            }))
        });
        let centroid = |img: &ImageBuffer<Rgb<u16>, Vec<u16>>, plane: usize| {
            let (mut sx, mut sy, mut n) = (0f64, 0f64, 0f64);
            for (x, y, p) in img.enumerate_pixels() { let v = p[plane] as f64; sx += v * x as f64; sy += v * y as f64; n += v; }
            (sx / n, sy / n)
        };
        let split = |img: &ImageBuffer<Rgb<u16>, Vec<u16>>| { let (r, b) = (centroid(img, 0), centroid(img, 2)); ((r.0 - b.0).powi(2) + (r.1 - b.1).powi(2)).sqrt() };
        assert!(split(&img) > 1.2, "{}", split(&img));
        let mut corrected = img.clone();
        apply_profile(&profile, &mut corrected);
        assert!(split(&corrected) < 0.3, "colours back in register: {}", split(&corrected));
    }

    #[cfg(feature = "nikon-he")]
    #[test]
    fn sony_lens_tags_in_the_file_take_the_dark_corners_out() {
        let n = 16usize;
        let knots: Vec<f64> = (0..n).map(|i| (i as f64 + 0.5) / (n - 1) as f64).collect();
        // Sony's vignetting values for a falloff to about 0.7 in the corners.
        let v: Vec<i32> = knots.iter().map(|k| (4905.0 * k * k) as i32).collect();
        let falloff: Vec<f64> = v.iter().map(|&v| 2f64.powf(0.5 - 2f64.powf(v as f64 / 8192.0 - 1.0)).powi(2)).collect();
        let (w, h) = (320usize, 240usize);
        let hd = ((w * w + h * h) as f64).sqrt() / 2.0;
        let bare = vignetted_dng(w, h, |u, t| {
            let r = (((u - 0.5) * w as f64).powi(2) + ((t - 0.5) * h as f64).powi(2)).sqrt() / hd;
            spline(&knots, &falloff, r)
        });
        let sshorts = |values: Vec<i32>| -> (u32, Vec<u8>) { (values.len() as u32, values.iter().flat_map(|&v| (v as i16).to_le_bytes()).collect()) };
        let zeros = |count: usize| { let mut z = vec![count as i32]; z.extend(std::iter::repeat(0).take(count)); z };
        let mut vig = vec![n as i32]; vig.extend(&v);
        let tags: Vec<(u16, u16, u32, Vec<u8>)> = [(0x7032u16, vig), (0x7035, zeros(2 * n)), (0x7037, zeros(n))]
            .into_iter().map(|(tag, values)| { let (count, data) = sshorts(values); (tag, 8u16, count, data) }).collect();
        let dng = with_typed_tags(&bare, &tags);
        let lens = from_file_for(&dng, Some((w as f64, h as f64)));
        assert!(lens.profile.is_some(), "{lens:?}");
        assert!(from_file_for(&bare, Some((w as f64, h as f64))).profile.is_none());
        let before = corner_to_centre(&crate::develop_jpeg(&bare).unwrap());
        let jpeg = crate::develop_jpeg(&dng).unwrap();
        let after = corner_to_centre(&jpeg);
        assert!(before < 0.92 && (after - 1.0).abs() < 0.03, "{before:.3} -> {after:.3}");
        assert!(String::from_utf8_lossy(&jpeg[..300]).contains("applied=camera-profile"));
    }
}
