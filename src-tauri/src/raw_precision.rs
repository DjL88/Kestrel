//! Experimental TrueDetail RGB16 TIFF path.
//!
//! Deliberately NOT connected to the editor or the paid-feature UI. This
//! prototype refuses 8-bit developments instead of expanding 8-bit values
//! into misleading 16-bit output. It has no Nikon HE/HE* or ICC promises.
//! The current JPEG-based editor path in raw.rs is unchanged.

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

/// Native-only, offline research entrypoint. Never invoked by production UI.
/// Decoder intermediates lacking genuine 16-bit channels fail closed.
#[allow(dead_code)]
pub fn develop_raw_rgb16_tiff(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let source = RawSource::new_from_slice(bytes);
    let raw = rawler::decode(&source, &RawDecodeParams { image_index: 0 })
        .map_err(|error| format!("RAW decode failed: {error}"))?;
    let intermediate = RawDevelop::default().develop_intermediate(&raw)
        .map_err(|error| format!("RAW development failed: {error}"))?
        .to_dynamic_image()
        .ok_or_else(|| "RAW development produced no picture.".to_string())?;
    let rgb = require_rgb16(intermediate)?;
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
    fn refuses_empty_image() {
        let empty = Rgb16::new(0, 0);
        assert!(encode_rgb16_tiff(&empty).is_err());
    }

    #[test]
    fn bad_raw_input_fails_instead_of_fabricating_output() {
        assert!(develop_raw_rgb16_tiff(&[]).is_err());
        assert!(develop_raw_rgb16_tiff(&[0u8; 256]).is_err());
    }
}
