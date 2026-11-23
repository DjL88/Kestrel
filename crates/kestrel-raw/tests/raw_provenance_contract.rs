//! Fail-closed provenance contract at the public RAW/develop boundary.
//! Synthetic fixture only: no owner's photographs and no embedded-preview substitution.
use kestrel_raw::{develop_rgb16, rgb16_bytes};
use image::{codecs::jpeg::JpegEncoder, Rgb, RgbImage};

#[test]
fn synthetic_sensor_dng_produces_a_real_rgb16_master() {
    let original = include_bytes!("../../../tests/fixtures/synthetic-z8.dng");
    let before = original.to_vec();
    let developed = develop_rgb16(original).expect("synthetic Bayer DNG must decode from sensor samples");
    assert_eq!((developed.width(), developed.height()), (64, 96));
    let packed = rgb16_bytes(&developed);
    assert_eq!(&packed[..8], &[64, 0, 0, 0, 96, 0, 0, 0]);
    assert_eq!(packed.len(), 8 + 64 * 96 * 3 * 2);
    for (bytes, sample) in packed[8..].chunks_exact(2).zip(developed.as_raw()) {
        assert_eq!(u16::from_le_bytes([bytes[0], bytes[1]]), *sample);
    }
    assert_eq!(original.as_slice(), before.as_slice(), "decode must never change original bytes");
}

#[test]
fn embedded_jpeg_cannot_be_promoted_to_sensor_raw_or_rgb16() {
    let picture = RgbImage::from_pixel(32, 24, Rgb([75, 125, 200]));
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, 90).encode_image(&picture).unwrap();
    let original = jpeg.clone();
    assert!(develop_rgb16(&jpeg).is_err(), "a JPEG preview is not decoded sensor data");
    assert_eq!(jpeg, original, "rejected input must remain unchanged");
}

#[test]
fn truncated_and_empty_sensor_input_fails_closed() {
    let original = include_bytes!("../../../tests/fixtures/synthetic-z8.dng");
    for bytes in [&original[..0], &original[..16], &original[..64]] {
        assert!(develop_rgb16(bytes).is_err(), "truncated header must not produce a master");
    }
}
