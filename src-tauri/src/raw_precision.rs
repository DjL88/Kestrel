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
use rawler::decoders::RawDecodeParams;
use rawler::imgop::develop::RawDevelop;
use rawler::rawsource::RawSource;

type Rgb16 = ImageBuffer<Rgb<u16>, Vec<u16>>;

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
    let source = RawSource::new_from_slice(bytes);
    let raw = rawler::decode(&source, &RawDecodeParams { image_index: 0 })
        .map_err(|error| crate::raw::explain(&error.to_string()))?;
    let intermediate = RawDevelop::default().develop_intermediate(&raw)
        .map_err(|error| format!("RAW development failed: {error}"))?
        .to_dynamic_image()
        .ok_or_else(|| "RAW development produced no picture.".to_string())?;
    let rgb = require_rgb16(intermediate)?;
    // A rotated frame retains its pixel count; the earlier check protects this copy too.
    let oriented = orient_rgb16(rgb, raw.orientation.to_u16());
    encode_rgb16_tiff(&oriented)
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn invalid_orientation_defaults_to_unchanged_pixels() {
        let original = ImageBuffer::from_fn(2, 3, |x, y| {
            Rgb([(x + 2 * y) as u16, 32769, 65535])
        });
        assert_eq!(orient_rgb16(original.clone(), 0), original);
        assert_eq!(orient_rgb16(original.clone(), 9), original);
        assert_eq!(orient_rgb16(original.clone(), u16::MAX), original);
    }

}
