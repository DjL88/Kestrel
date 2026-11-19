//! Experimental TrueDetail RGB16 TIFF path.
//!
//! Wired to one explicit, clearly-labelled "16-bit TIFF (experimental)" download
//! action in Edit options — not the editor's main image source, and not a Pro
//! feature gate. It refuses 8-bit developments instead of expanding 8-bit values
//! into misleading 16-bit output, and has no Nikon HE/HE* or ICC promises yet.
//! The default JPEG-based editor path in raw.rs is unchanged and still what
//! every edit, crop and export actually uses.

use image::codecs::tiff::TiffEncoder;
use image::{imageops, DynamicImage, ImageBuffer, ImageEncoder, Rgb};
use rawler::imgop::develop::RawDevelop;

type Rgb16 = ImageBuffer<Rgb<u16>, Vec<u16>>;


/// The first high-bit-depth edited-master proof of concept. All fields are native
/// parametric values; no image generation, file writes, masks or fake 16-bit
/// conversion. The current screen preview may differ because it uses 8-bit JPEG.
#[derive(Debug, Clone, Copy, Default, serde::Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct NativeMasterEdit {
    pub exposure: f64,
    pub warmth: f64,
    pub colour: f64,
    pub brightness: f64,
    pub contrast: f64,
    pub highlights: f64,
    pub shadows: f64,
    pub whites: f64,
    pub blacks: f64,
    pub vibrance: f64,
}

impl NativeMasterEdit {
    fn validate(self) -> Result<Self, String> {
        for (name, value, lower, upper) in [
            ("exposure", self.exposure, -12.5, 12.5),
            ("warmth", self.warmth, -2.0, 2.0),
            ("colour", self.colour, -2.0, 2.0),
            ("brightness", self.brightness, -2.0, 2.0),
            ("contrast", self.contrast, -2.0, 2.0),
            ("highlights", self.highlights, -2.0, 2.0),
            ("shadows", self.shadows, -2.0, 2.0),
            ("whites", self.whites, -2.0, 2.0),
            ("blacks", self.blacks, -2.0, 2.0),
            ("vibrance", self.vibrance, -2.0, 2.0),
        ] {
            if !value.is_finite() || value < lower || value > upper {
                return Err(format!("Invalid high-bit-depth master {name} adjustment."));
            }
        }
        Ok(self)
    }

    fn is_neutral(self) -> bool {
        [
            self.exposure, self.warmth, self.colour, self.brightness,
            self.contrast, self.highlights, self.shadows, self.whites,
            self.blacks, self.vibrance,
        ].iter().all(|value| *value == 0.0)
    }
}

/// Post-EXIF manual crop and 90-degree turns. Matches the saved editor's
/// cropRectangle rounding (maximal centred rectangle, then normalized crop
/// anchor). Continuous straighten requires a resampling path and is blocked.
#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct NativeMasterFraming {
    pub ratio: Option<f64>,
    pub turns: u8,
    pub straighten: f64,
    pub x: f64,
    pub y: f64,
    pub size: f64,
}

impl Default for NativeMasterFraming {
    fn default() -> Self {
        Self { ratio: None, turns: 0, straighten: 0.0, x: 0.5, y: 0.5, size: 1.0 }
    }
}

impl NativeMasterFraming {
    fn validate(self) -> Result<Self, String> {
        if self.turns > 3 || !self.straighten.is_finite() || self.straighten != 0.0 {
            return Err("Only quarter-turn rotation is supported by this RAW master prototype.".into());
        }
        if self.ratio.is_some_and(|ratio| !ratio.is_finite() || !(0.01..=100.0).contains(&ratio)) {
            return Err("Invalid native RAW master crop ratio.".into());
        }
        if !self.x.is_finite() || !(0.0..=1.0).contains(&self.x) ||
            !self.y.is_finite() || !(0.0..=1.0).contains(&self.y) ||
            !self.size.is_finite() || !(0.08..=1.0).contains(&self.size) {
            return Err("Invalid native RAW master crop position or size.".into());
        }
        Ok(self)
    }
}

pub fn parse_master_framing(json: &str) -> Result<NativeMasterFraming, String> {
    serde_json::from_str::<NativeMasterFraming>(json)
        .map_err(|_| "This crop/rotation recipe is not supported by the 16-bit RAW prototype.".to_string())?
        .validate()
}

/// Do not accept arbitrary native parameters, NaN, or unknown recipe keys.
pub fn parse_master_edit(json: &str) -> Result<NativeMasterEdit, String> {
    serde_json::from_str::<NativeMasterEdit>(json)
        .map_err(|_| "This edit recipe is not supported by the 16-bit RAW prototype.".to_string())?
        .validate()
}

// Conservative prototype ceiling: a Z8 frame fits, while oversized frames
// cannot multiply into multi-gigabyte RGB16/orientation/encoder allocations.
const MAX_PIXELS: u64 = 50_000_000;

fn checked_rgb16_bytes(width: u32, height: u32) -> Result<usize, String> {
    let pixels = u64::from(width) * u64::from(height);
    if pixels == 0 || pixels > MAX_PIXELS {
        return Err("Invalid or excessive RAW image dimensions.".into());
    }
    let bytes = pixels.checked_mul(6)
        .ok_or_else(|| "RAW image dimensions overflow.".to_string())?;
    usize::try_from(bytes).map_err(|_| "RAW image too large for this computer.".to_string())
}


/// Only accept an intermediate that really stores 16-bit channel values.
/// This guard is essential: `to_rgb16()` also accepts 8-bit inputs, but
/// upsampling their codes cannot recover lost RAW information.
fn require_rgb16(image: DynamicImage) -> Result<Rgb16, String> {
    // Reject excessive frames before RGBA/greyscale conversion allocates an RGB16 copy.
    checked_rgb16_bytes(image.width(), image.height())?;
    match image {
        DynamicImage::ImageRgb16(rgb) => Ok(rgb),
        DynamicImage::ImageRgba16(rgba) => Ok(DynamicImage::ImageRgba16(rgba).to_rgb16()),
        DynamicImage::ImageLuma16(gray) => Ok(DynamicImage::ImageLuma16(gray).to_rgb16()),
        DynamicImage::ImageLumaA16(gray) => Ok(DynamicImage::ImageLumaA16(gray).to_rgb16()),
        _ => Err("The RAW decoder did not supply a high-bit-depth image; TrueDetail 16-bit output is unavailable for this file.".into()),
    }
}

fn orient_rgb16(image: Rgb16, exif_orientation: u16) -> Rgb16 {
    match exif_orientation {
        2 => imageops::flip_horizontal(&image),
        3 => imageops::rotate180(&image),
        4 => imageops::flip_vertical(&image),
        5 => imageops::flip_horizontal(&imageops::rotate90(&image)),
        6 => imageops::rotate90(&image),
        7 => imageops::flip_horizontal(&imageops::rotate270(&image)),
        8 => imageops::rotate270(&image),
        _ => image,
    }
}


/// This prototype performs tonal arithmetic at 16-bit precision. It does not
/// establish camera-profile or scene-linear colour accuracy: rawler determines
/// the colour transform upstream. Preserve neutral samples byte-for-byte.
fn srgb_to_linear(code: f64) -> f64 {
    let v = code.clamp(0.0, 1.0);
    if v <= 0.04045 { v / 12.92 } else { ((v + 0.055) / 1.055).powf(2.4) }
}

fn linear_to_srgb(linear: f64) -> f64 {
    let v = linear.clamp(0.0, 1.0);
    if v <= 0.0031308 { v * 12.92 } else { 1.055 * v.powf(1.0 / 2.4) - 0.055 }
}

fn smoothstep(low: f64, high: f64, value: f64) -> f64 {
    let t = ((value - low) / (high - low)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn edit_rgb16(image: &mut Rgb16, edit: NativeMasterEdit) {
    if edit.is_neutral() { return; }
    // The coefficients mirror the existing parametric editor, with every
    // intermediate evaluated at f64 rather than quantised through JPEG.
    let gain = 2.0f64.powf(edit.exposure * 0.4);
    let warmth = edit.warmth * 0.08;
    let colour = if edit.colour == -2.0 { -1.0 } else { edit.colour * 0.2 };
    let contrast = 1.0 + edit.contrast * 0.35;
    let highlights = edit.highlights * 0.3;
    let shadows = edit.shadows * 0.3;
    let black_point = -edit.blacks * 0.02;
    let white_point = 1.0 - edit.whites * 0.08;
    let brightness = edit.brightness * 0.11;
    let vibrance = edit.vibrance * 0.3;
    let tonal = highlights != 0.0 || shadows != 0.0 || black_point != 0.0 || white_point != 1.0;

    for pixel in image.pixels_mut() {
        let mut red = srgb_to_linear(f64::from(pixel[0]) / 65535.0) * gain * (1.0 + warmth);
        let mut green = srgb_to_linear(f64::from(pixel[1]) / 65535.0) * gain;
        let mut blue = srgb_to_linear(f64::from(pixel[2]) / 65535.0) * gain * (1.0 - warmth);
        if tonal {
            let range = white_point - black_point;
            red = (red - black_point) / range;
            green = (green - black_point) / range;
            blue = (blue - black_point) / range;
            let perceived = (0.2126 * red + 0.7152 * green + 0.0722 * blue).clamp(0.0, 1.0);
            let factor = (1.0 + shadows * (1.0 - smoothstep(0.0, 0.6, perceived))
                + highlights * smoothstep(0.4, 1.0, perceived)).max(0.0);
            red *= factor;
            green *= factor;
            blue *= factor;
        }
        let mut luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
        if brightness != 0.0 && luminance > 0.0 && luminance < 1.0 {
            let display = linear_to_srgb(luminance);
            let lifted = display + 4.0 * brightness * display * (1.0 - display);
            let requested = srgb_to_linear(lifted) / luminance;
            let peak = red.max(green).max(blue);
            let factor = if requested > 1.0 && peak > 0.0 {
                requested.min((0.992 / peak).max(1.0))
            } else { requested };
            red *= factor;
            green *= factor;
            blue *= factor;
            luminance *= factor;
        }
        let monochrome = colour == -1.0;
        let mut saturation = if monochrome { 0.0 } else { 1.0 + colour };
        if !monochrome && vibrance != 0.0 {
            let high = red.max(green).max(blue);
            let chroma = if high > 0.0 { (high - red.min(green).min(blue)) / high } else { 0.0 };
            saturation += vibrance * (1.0 - chroma.min(1.0));
        }
        let mut channels = [
            luminance + (red - luminance) * saturation,
            luminance + (green - luminance) * saturation,
            luminance + (blue - luminance) * saturation,
        ];
        for (channel, output) in channels.iter_mut().zip(pixel.0.iter_mut()) {
            // Work in a display-referred space for contrast, then encode
            // once. The previous branch incorrectly treated linear light as
            // encoded sRGB whenever contrast was non-neutral, shifting tones
            // substantially even for an otherwise small contrast adjustment.
            let encoded = linear_to_srgb(*channel);
            let adjusted = if contrast != 1.0 {
                0.5 + (encoded - 0.5) * contrast
            } else { encoded };
            *output = (adjusted.clamp(0.0, 1.0) * 65535.0).round() as u16;
        }
    }
}

/// Preserve full 16-bit samples during 90° transforms and rectangular crop.
/// The raster is already EXIF-oriented; the editor's manual turns happen next.
fn frame_rgb16(mut image: Rgb16, framing: NativeMasterFraming) -> Result<Rgb16, String> {
    let framing = framing.validate()?;
    image = match framing.turns {
        1 => imageops::rotate90(&image),
        2 => imageops::rotate180(&image),
        3 => imageops::rotate270(&image),
        _ => image,
    };
    let (width, height) = image.dimensions();
    checked_rgb16_bytes(width, height)?;
    let ratio = framing.ratio.unwrap_or(f64::from(width) / f64::from(height));
    let crop_width = ((f64::from(width)).min(f64::from(height) * ratio) * framing.size)
        .round().max(1.0) as u32;
    let crop_height = ((f64::from(height)).min(f64::from(width) / ratio) * framing.size)
        .round().max(1.0) as u32;
    let crop_width = crop_width.min(width);
    let crop_height = crop_height.min(height);
    let max_x = width - crop_width;
    let max_y = height - crop_height;
    let left = (framing.x * f64::from(width) - f64::from(crop_width) / 2.0)
        .round().clamp(0.0, f64::from(max_x)) as u32;
    let top = (framing.y * f64::from(height) - f64::from(crop_height) / 2.0)
        .round().clamp(0.0, f64::from(max_y)) as u32;
    if left == 0 && top == 0 && crop_width == width && crop_height == height {
        return Ok(image);
    }
    Ok(imageops::crop_imm(&image, left, top, crop_width, crop_height).to_image())
}

/// Encode 16-bit RGB without converting through an 8-bit RGB/JPEG canvas.
/// ICC profile metadata is not yet embedded: this output is NOT eligible for
/// the matched-profile Nikon reference QA comparison or commercial export.
fn encode_rgb16_tiff(rgb: &Rgb16) -> Result<Vec<u8>, String> {
    let (width, height) = rgb.dimensions();
    let expected_bytes = checked_rgb16_bytes(width, height)?;
    let mut data = Vec::new();
    data.try_reserve_exact(expected_bytes)
        .map_err(|_| "Insufficient memory for the high-bit-depth TIFF.".to_string())?;
    for pixel in rgb.as_raw() {
        data.extend_from_slice(&pixel.to_ne_bytes());
    }
    let mut output = std::io::Cursor::new(Vec::new());
    TiffEncoder::new(&mut output)
        .write_image(&data, width, height, image::ExtendedColorType::Rgb16)
        .map_err(|error| format!("Could not encode the high-bit-depth TIFF: {error}"))?;
    Ok(output.into_inner())
}

/// Native entrypoint for the experimental 16-bit TIFF download (wired to the `develop_raw_precision` Tauri command in
/// `lib.rs`), offered alongside the normal 8-bit JPEG editing path, not in place of it.
/// Decoder intermediates lacking genuine 16-bit channels fail closed.
pub fn develop_raw_rgb16_tiff(bytes: &[u8]) -> Result<Vec<u8>, String> {
    develop_raw_rgb16_tiff_with_edit(bytes, NativeMasterEdit::default())
}

/// Decode sensor RAW once and produce a complete 16-bit edited TIFF with no JPEG
/// intermediary. Refuse unsupported camera compression instead of exporting an
/// 8-bit embedded preview. The caller must preflight crop/masks/detail controls.
pub fn develop_raw_rgb16_tiff_with_edit(bytes: &[u8], edit: NativeMasterEdit) -> Result<Vec<u8>, String> {
    develop_raw_rgb16_tiff_with_edit_and_framing(bytes, edit, NativeMasterFraming::default())
}

/// Produce the saved master geometry from the decoded, high-precision pixels.
pub fn develop_raw_rgb16_tiff_with_edit_and_framing(
    bytes: &[u8], edit: NativeMasterEdit, framing: NativeMasterFraming,
) -> Result<Vec<u8>, String> {
    let edit = edit.validate()?;
    let framing = framing.validate()?;
    let (raw, _decoder) = crate::nikon_he::decode_sensor(bytes)?;
    // The same develop the editor's picture uses, so the 16-bit master starts from the pixels the person saw.
    let intermediate = match crate::scene_develop::develop_display(&raw)? {
        Some(display) => display,
        None => RawDevelop::default().develop_intermediate(&raw)
            .map_err(|error| format!("RAW development failed: {error}"))?
            .to_dynamic_image()
            .ok_or_else(|| "RAW development produced no picture.".to_string())?,
    };
    let mut rgb = require_rgb16(intermediate)?;
    edit_rgb16(&mut rgb, edit);
    let oriented = orient_rgb16(rgb, raw.orientation.to_u16());
    let framed = frame_rgb16(oriented, framing)?;
    encode_rgb16_tiff(&framed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contrast_adjustment_preserves_midtones_without_linear_to_gamma_jump() {
        let mut midgrey = ImageBuffer::from_pixel(1, 1, Rgb([32768u16, 32768, 32768]));
        let unchanged = midgrey.get_pixel(0, 0)[0];
        let mut edit = NativeMasterEdit::default();
        edit.contrast = 0.1;
        edit_rgb16(&mut midgrey, edit);
        let adjusted = midgrey.get_pixel(0, 0)[0];
        // sRGB code ~0.5 is midgrey. Tiny contrast edits cannot turn it
        // into ~0.21 or another unencoded linear-light value.
        assert!((i32::from(adjusted) - i32::from(unchanged)).abs() < 2500, "unexpected tone jump: {adjusted}");
    }

    #[test]
    fn rgb16_crop_and_quarter_turn_match_expected_raster_coordinates() {
        let original = ImageBuffer::from_fn(4, 3, |x, y| Rgb([(1 + x + y * 4) as u16, 32769, 65535]));
        // 4x3 -> 3x4 clockwise -> width 2, height 2 crop anchored at upper left.
        let frame = NativeMasterFraming {
            ratio: Some(1.0), turns: 1, straighten: 0.0,
            x: 0.0, y: 0.0, size: 0.5,
        };
        let cropped = frame_rgb16(original.clone(), frame).unwrap();
        assert_eq!(cropped.dimensions(), (2, 2));
        let expected = imageops::rotate90(&original);
        assert_eq!(cropped.get_pixel(0, 0), expected.get_pixel(0, 0));
        assert_eq!(cropped.get_pixel(1, 1), expected.get_pixel(1, 1));
        assert_eq!(cropped.get_pixel(1, 1)[1], 32769);
        let restored = image::load_from_memory_with_format(
            &encode_rgb16_tiff(&cropped).unwrap(), image::ImageFormat::Tiff,
        ).unwrap();
        assert_eq!(restored.as_rgb16().unwrap(), &cropped);
    }

    #[test]
    fn default_geometry_is_pixel_identical_and_invalid_geometry_is_rejected() {
        let original = ImageBuffer::from_fn(5, 3, |x, y| Rgb([(1001 + x + 5 * y) as u16, 32769, 65535]));
        let framed = frame_rgb16(original.clone(), NativeMasterFraming::default()).unwrap();
        assert_eq!(framed, original);
        for json in [
            r#"{"turns":4}"#, r#"{"straighten":1}"#, r#"{"size":0}"#,
            r#"{"ratio":0}"#, r#"{"x":-0.1}"#, r#"{"y":1.1}"#, r#"{"size":1.1}"#,
            r#"{"unknown":2}"#,
        ] {
            assert!(parse_master_framing(json).is_err(), "invalid framing: {json}");
        }
    }

    #[test]
    fn neutral_master_edit_preserves_all_sixteen_bit_codes() {
        let mut image = ImageBuffer::from_fn(2, 1, |x, _| {
            if x == 0 { Rgb([32768u16, 32769, 65535]) } else { Rgb([1u16, 2, 3]) }
        });
        let original = image.clone();
        edit_rgb16(&mut image, NativeMasterEdit::default());
        assert_eq!(image, original, "no neutral round-trip quantisation");
        let roundtrip = image::load_from_memory_with_format(
            &encode_rgb16_tiff(&image).unwrap(), image::ImageFormat::Tiff,
        ).unwrap();
        assert_eq!(roundtrip.as_rgb16().unwrap(), &original);
    }

    #[test]
    fn edited_master_produces_true_sixteen_bit_values_without_touching_source() {
        let image = ImageBuffer::from_fn(4, 1, |x, _| Rgb([10001 + x as u16, 32769, 49011]));
        let source = image.clone();
        let mut output = image;
        let edit = parse_master_edit(r#"{"exposure":0.6,"shadows":0.5,"warmth":0.25}"#).unwrap();
        edit_rgb16(&mut output, edit);
        assert_eq!(source.get_pixel(0, 0)[0], 10001);
        assert_ne!(output, source);
        assert!(output.pixels().any(|pixel| pixel[0] % 257 != 0), "16-bit output must not be 8-bit codes shifted up");
        let decoded = image::load_from_memory_with_format(
            &encode_rgb16_tiff(&output).unwrap(), image::ImageFormat::Tiff,
        ).unwrap();
        assert_eq!(decoded.as_rgb16().unwrap(), &output);
    }

    #[test]
    fn edited_master_rejects_invalid_or_unknown_parameters() {
        for recipe in [
            r#"{"exposure":13}"#, r#"{"warmth":-3}"#, r#"{"shadows":"bright"}"#,
            r#"{"mask":{}}"#, r#"{"exposure":1e100}"#, "not-json",
        ] {
            assert!(parse_master_edit(recipe).is_err(), "invalid recipe {recipe}");
        }
    }

    #[test]
    fn rejects_8_bit_rgb_instead_of_fake_sixteen_bit() {
        let image = DynamicImage::ImageRgb8(image::RgbImage::new(4, 3));
        assert!(require_rgb16(image).unwrap_err().contains("did not supply"));
    }

    #[test]
    fn preserves_real_sixteen_bit_pixel_values_in_tiff() {
        let image = ImageBuffer::from_fn(3, 2, |x, y| {
            Rgb([(x * 1000 + y + 47) as u16, 32769, 65535])
        });
        let result = encode_rgb16_tiff(&image).expect("encode");
        let decoded = image::load_from_memory_with_format(&result, image::ImageFormat::Tiff)
            .expect("decode");
        assert_eq!(decoded.as_rgb16().expect("16-bit"), &image);
        assert_eq!(decoded.width(), 3);
        assert_eq!(decoded.height(), 2);
    }

    #[test]
    fn rotates_without_reducing_precision() {
        let image = ImageBuffer::from_fn(3, 2, |x, y| Rgb([(x + 3 * y + 1000) as u16, 32769, 65535]));
        let portrait = orient_rgb16(image, 6);
        assert_eq!(portrait.dimensions(), (2, 3));
        assert_eq!(portrait.get_pixel(0, 0)[0], 1003);
        assert_eq!(portrait.get_pixel(1, 2)[0], 1002);
        assert_eq!(portrait.get_pixel(0, 0)[1], 32769);
    }

    #[test]
    fn z8_dimensions_fit_but_oversized_frames_fail_before_allocation() {
        assert_eq!(checked_rgb16_bytes(8256, 5504).unwrap(), 272646144);
        assert!(checked_rgb16_bytes(10_000, 10_000).is_err());
        assert!(checked_rgb16_bytes(u32::MAX, u32::MAX).is_err());
        assert!(checked_rgb16_bytes(0, 1).is_err());
    }

    #[test]
    fn rejects_oversized_rgba16_before_rgb_conversion() {
        // ImageBuffer construction would allocate hundreds of MB here, so verify
        // the dimension guard directly; require_rgb16 calls it before conversion.
        assert!(checked_rgb16_bytes(10_000, 10_000).is_err());
        let rgba = DynamicImage::ImageRgba16(ImageBuffer::from_pixel(2, 2, image::Rgba([1, 2, 3, 4])));
        assert_eq!(require_rgb16(rgba).unwrap().dimensions(), (2, 2));
    }

    #[test]
    fn refuses_empty_image() {
        let empty = Rgb16::new(0, 0);
        assert!(encode_rgb16_tiff(&empty).is_err());
    }

    #[test]
    fn bad_raw_input_fails_instead_of_fabricating_output() {
        assert!(develop_raw_rgb16_tiff(&[]).is_err());
        assert!(develop_raw_rgb16_tiff(&[0u8; 256]).is_err());
    }

    /// Guards against the raw `rawler` message ("RAW decode failed: Failed to decode image, possibly
    /// corrupt image: NEF compression Some(HighEfficencyStar) is not supported") leaking to the person
    /// again — this path used to build its own `format!("RAW decode failed: {error}")` instead of
    /// going through `raw::explain`, so a Nikon HE*/HE file hit the library's own wording verbatim.
    #[test]
    fn nikon_high_efficiency_is_explained_in_plain_words_here_too() {
        let message = crate::raw::explain("Failed to decode image, possibly corrupt image: NEF compression Some(HighEfficencyStar) is not supported");
        assert!(message.contains("High Efficiency") && !message.contains("Some("), "{message}");
    }

    #[test]
    fn exif_orientations_match_independent_coordinate_reference() {
        // The existing sample-multiset test cannot detect an incorrect rotation
        // direction or a mirror applied on the wrong axis. These matrices are
        // the expected EXIF 1..8 raster orders for an asymmetric 3x2 fixture.
        let original = ImageBuffer::from_fn(3, 2, |x, y| {
            Rgb([(1 + x + y * 3) as u16, 32769, 65535])
        });
        let cases: &[(u16, u32, u32, &[u16])] = &[
            (1, 3, 2, &[1, 2, 3, 4, 5, 6]),
            (2, 3, 2, &[3, 2, 1, 6, 5, 4]),
            (3, 3, 2, &[6, 5, 4, 3, 2, 1]),
            (4, 3, 2, &[4, 5, 6, 1, 2, 3]),
            (5, 2, 3, &[1, 4, 2, 5, 3, 6]),
            (6, 2, 3, &[4, 1, 5, 2, 6, 3]),
            (7, 2, 3, &[6, 3, 5, 2, 4, 1]),
            (8, 2, 3, &[3, 6, 2, 5, 1, 4]),
        ];
        for &(orientation, width, height, expected) in cases {
            let result = orient_rgb16(original.clone(), orientation);
            assert_eq!(result.dimensions(), (width, height), "EXIF {orientation}");
            let actual: Vec<u16> = result.pixels().map(|pixel| pixel[0]).collect();
            assert_eq!(actual, expected, "EXIF {orientation} coordinate mapping");
            assert!(result.pixels().all(|pixel| pixel[1] == 32769 && pixel[2] == 65535));
        }
    }

    #[test]
    fn all_exif_orientations_preserve_rgb16_samples_and_dimensions() {
        // Asymmetric fixture catches swapped axes, mirrored coordinates and
        // accidental 8-bit quantisation without relying on camera files.
        let original = ImageBuffer::from_fn(3, 2, |x, y| {
            Rgb([1001 + (y * 3 + x) as u16, 32769, 65535])
        });
        for orientation in 1..=8 {
            let oriented = orient_rgb16(original.clone(), orientation);
            let expected_dimensions = if (5..=8).contains(&orientation) {
                (2, 3)
            } else {
                (3, 2)
            };
            assert_eq!(oriented.dimensions(), expected_dimensions, "orientation {orientation}");
            let mut actual: Vec<_> = oriented.pixels().map(|p| p.0).collect();
            let mut expected: Vec<_> = original.pixels().map(|p| p.0).collect();
            actual.sort_unstable();
            expected.sort_unstable();
            assert_eq!(actual, expected, "orientation {orientation} altered sample values");
            let encoded = encode_rgb16_tiff(&oriented).expect("TIFF encode");
            let decoded = image::load_from_memory_with_format(&encoded, image::ImageFormat::Tiff)
                .expect("TIFF decode");
            assert_eq!(decoded.as_rgb16().expect("RGB16"), &oriented, "orientation {orientation}");
        }
    }


    #[test]
    fn rgb16_budget_boundary_is_inclusive_and_rejects_one_pixel_over() {
        // Pure arithmetic: never allocate a 300 MB test image on CI or a laptop.
        assert_eq!(checked_rgb16_bytes(10_000, 5_000).unwrap(), 300_000_000);
        assert!(checked_rgb16_bytes(10_000, 5_001).is_err());
        assert!(checked_rgb16_bytes(1, 0).is_err());
    }

    #[test]
    fn sixteen_bit_grayscale_conversion_preserves_exact_sample_codes() {
        let gray = ImageBuffer::from_fn(2, 2, |x, y| {
            image::Luma([([0u16, 1, 32769, 65535][(y * 2 + x) as usize])])
        });
        let rgb = require_rgb16(DynamicImage::ImageLuma16(gray)).expect("16-bit grayscale");
        let samples = [0u16, 1, 32769, 65535];
        for (index, pixel) in rgb.pixels().enumerate() {
            assert_eq!(pixel.0, [samples[index]; 3]);
        }
        let encoded = encode_rgb16_tiff(&rgb).expect("TIFF encode");
        let decoded = image::load_from_memory_with_format(&encoded, image::ImageFormat::Tiff)
            .expect("TIFF decode");
        assert_eq!(decoded.as_rgb16().expect("RGB16"), &rgb);
    }

    #[test]
    fn rgba16_conversion_drops_alpha_without_quantising_rgb() {
        let rgba = ImageBuffer::from_fn(2, 1, |x, _| {
            if x == 0 {
                image::Rgba([1u16, 32769, 65535, 0])
            } else {
                image::Rgba([65535u16, 2, 32768, 65535])
            }
        });
        let rgb = require_rgb16(DynamicImage::ImageRgba16(rgba))
            .expect("16-bit RGBA should retain RGB sample codes");
        assert_eq!(rgb.get_pixel(0, 0).0, [1, 32769, 65535]);
        assert_eq!(rgb.get_pixel(1, 0).0, [65535, 2, 32768]);
        let encoded = encode_rgb16_tiff(&rgb).expect("TIFF encode");
        let decoded = image::load_from_memory_with_format(&encoded, image::ImageFormat::Tiff)
            .expect("TIFF decode");
        assert_eq!(decoded.as_rgb16().expect("RGB16"), &rgb);
    }

    #[test]
    fn invalid_orientation_defaults_to_unchanged_pixels() {
        let original = ImageBuffer::from_fn(2, 3, |x, y| {
            Rgb([(x + 2 * y) as u16, 32769, 65535])
        });
        assert_eq!(orient_rgb16(original.clone(), 0), original);
        assert_eq!(orient_rgb16(original.clone(), 9), original);
        assert_eq!(orient_rgb16(original.clone(), u16::MAX), original);
    }

}
