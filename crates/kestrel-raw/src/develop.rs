//! Full RAW development to a picture the editor can use: decode the sensor data (rawler, or `nikon_he` for Nikon High
//! Efficiency), develop it with Kestrel's own `scene_develop`, turn it the way the camera was held and encode a
//! high-quality JPEG at the file's full resolution. Pure: no files, no clock, no platform calls, so the desktop app and the
//! WebAssembly build run exactly the same code. The original is only read.

use image::codecs::jpeg::JpegEncoder;
use image::{ImageBuffer, Pixel, Rgb};
use rayon::prelude::*;
use rawler::imgop::develop::RawDevelop;

/// Turn the picture the way the camera was held, from the file's EXIF orientation (1 to 8). The sensor data is always stored
/// sideways-on, so without this a portrait photograph comes out lying on its side.
///
/// The same pixels as `image::imageops`' rotate and flip, exactly, but in 64 x 64 tiles over all cores: a quarter turn of a
/// 45-megapixel frame reads its source column by column, which took the plain version about 2.4 s.
pub fn apply_orientation<P: Pixel + 'static>(image: ImageBuffer<P, Vec<P::Subpixel>>, exif_orientation: u16) -> ImageBuffer<P, Vec<P::Subpixel>>
where P::Subpixel: Send + Sync {
    if !(2..=8).contains(&exif_orientation) { return image; }
    let (w, h) = (image.width() as usize, image.height() as usize);
    let c = P::CHANNEL_COUNT as usize;
    let quarter = exif_orientation >= 5;
    let (ow, oh) = if quarter { (h, w) } else { (w, h) };
    // Where output pixel (x, y) comes from in the source.
    let source = move |x: usize, y: usize| -> (usize, usize) {
        match exif_orientation {
            2 => (w - 1 - x, y),
            3 => (w - 1 - x, h - 1 - y),
            4 => (x, h - 1 - y),
            5 => (y, x),
            6 => (y, h - 1 - x),
            7 => (w - 1 - y, h - 1 - x),
            _ => (w - 1 - y, x), // 8
        }
    };
    let src = image.as_raw();
    let mut out: Vec<P::Subpixel> = src.clone();
    const TILE: usize = 64;
    out.par_chunks_mut(TILE * ow * c).enumerate().for_each(|(band, rows)| {
        let top = band * TILE;
        let band_rows = rows.len() / (ow * c);
        for left in (0..ow).step_by(TILE) {
            for dy in 0..band_rows {
                let y = top + dy;
                for x in left..(left + TILE).min(ow) {
                    let (sx, sy) = source(x, y);
                    let from = (sy * w + sx) * c;
                    let to = (dy * ow + x) * c;
                    rows[to..to + c].copy_from_slice(&src[from..from + c]);
                }
            }
        }
    });
    ImageBuffer::from_raw(ow as u32, oh as u32, out).expect("same number of samples")
}

/// A plain-English reason for a decoder error, so the person sees what is going on rather than a library message.
/// Shared by every adapter (desktop develop, the 16-bit master, WebAssembly) so each gives the same plain wording.
pub fn explain(error: &str) -> String {
    if error.contains("HighEfficen") || error.contains("HighEfficien") {
        "This build of Kestrel can’t develop Nikon High Efficiency (HE/HE*) RAW files from their sensor data.".to_string()
    } else {
        format!("This RAW file could not be read: {error}")
    }
}

/// The developed picture at 16 bits per channel (display-encoded sRGB), turned the way the camera was held: exactly what
/// `develop_jpeg` encodes, before it is reduced to 8 bits. The editor's 16-bit export starts from this.
pub fn develop_rgb16(bytes: &[u8]) -> Result<ImageBuffer<Rgb<u16>, Vec<u16>>, String> {
    let (raw, _decoder) = crate::nikon_he::decode_sensor(bytes)?;
    let rgb16 = match crate::scene_develop::develop_display_rgb16(&raw, &crate::scene_develop::Look::default())? {
        Some(display) => display,
        None => RawDevelop::default()
            .develop_intermediate(&raw)
            .map_err(|error| format!("This RAW file could not be developed: {error}"))?
            .to_dynamic_image()
            .ok_or_else(|| "This RAW file produced no picture.".to_string())?
            .to_rgb16(),
    };
    let orientation = raw.orientation.to_u16();
    drop(raw);
    Ok(apply_orientation(rgb16, orientation))
}

/// A 16-bit picture as bytes for the page: width and height (u32, little-endian), then R, G, B samples (u16,
/// little-endian), row by row.
pub fn rgb16_bytes(image: &ImageBuffer<Rgb<u16>, Vec<u16>>) -> Vec<u8> {
    let samples = image.as_raw();
    let mut out = Vec::with_capacity(8 + samples.len() * 2);
    out.extend_from_slice(&image.width().to_le_bytes());
    out.extend_from_slice(&image.height().to_le_bytes());
    for sample in samples {
        out.extend_from_slice(&sample.to_le_bytes());
    }
    out
}

pub fn develop_jpeg(bytes: &[u8]) -> Result<Vec<u8>, String> {
    develop_jpeg_sized(bytes, false)
}

/// The same develop at half the sensor's width and height (see `scene_develop::develop_display_rgb16_half`): for the
/// screen-size copy the app keeps after import, about five times faster than the full size it would throw away.
pub fn develop_jpeg_screen(bytes: &[u8]) -> Result<Vec<u8>, String> {
    develop_jpeg_sized(bytes, true)
}

fn develop_jpeg_sized(bytes: &[u8], half: bool) -> Result<Vec<u8>, String> {
    // Nikon High Efficiency NEFs are decoded from their sensor data by `nikon_he`; everything else by rawler.
    let (raw, _decoder) = crate::nikon_he::decode_sensor(bytes)?;
    // Kestrel's own develop (highlight reconstruction, no clipping, filmic shoulder), shared with the 16-bit master.
    // Sensors it doesn't handle yet (monochrome, four-colour) keep rawler's default develop.
    let look = crate::scene_develop::Look::default();
    let display = if half { crate::scene_develop::develop_display_rgb16_half(&raw, &look)? } else { crate::scene_develop::develop_display_rgb16(&raw, &look)? };
    let rgb8 = match display {
        Some(display) => crate::scene_develop::to_rgb8_dithered(&display),
        None => RawDevelop::default()
            .develop_intermediate(&raw)
            .map_err(|error| format!("This RAW file could not be developed: {error}"))?
            .to_dynamic_image()
            .ok_or_else(|| "This RAW file produced no picture.".to_string())?
            .to_rgb8(),
    };
    let rgb = apply_orientation(rgb8, raw.orientation.to_u16());
    let mut out = Vec::with_capacity((rgb.width() * rgb.height()) as usize / 4);
    JpegEncoder::new_with_quality(&mut out, 95)
        .encode_image(&rgb)
        .map_err(|error| format!("The developed picture could not be saved: {error}"))?;
    Ok(match crate::scene_develop::as_shot_white(&raw) {
        Some((kelvin, duv)) => with_as_shot_comment(out, kelvin, duv),
        None => out,
    })
}

/// The text the app looks for (`src/core/asShotWhite.ts`). Kept short and versioned so it can change safely.
pub const AS_SHOT_PREFIX: &str = "InFlight-AsShotWhite/1 ";

/// Put the camera's as-shot white (an estimate, see `scene_develop::as_shot_white`) in a JPEG comment right after the
/// start-of-image marker, so the desktop app and the WebAssembly build hand it to the editor with no new interface.
/// Comments never change the pixels.
pub fn with_as_shot_comment(jpeg: Vec<u8>, kelvin: f32, duv: f32) -> Vec<u8> {
    if jpeg.len() < 2 || jpeg[0] != 0xFF || jpeg[1] != 0xD8 {
        return jpeg;
    }
    let text = format!("{AS_SHOT_PREFIX}K={:.0} Duv={:.4}", kelvin, duv);
    let length = (text.len() + 2) as u16;
    let mut out = Vec::with_capacity(jpeg.len() + text.len() + 4);
    out.extend_from_slice(&jpeg[..2]);
    out.extend_from_slice(&[0xFF, 0xFE]);
    out.extend_from_slice(&length.to_be_bytes());
    out.extend_from_slice(text.as_bytes());
    out.extend_from_slice(&jpeg[2..]);
    out
}

#[cfg(test)]
mod tests {
    use super::develop_jpeg as develop;

    #[test]
    fn a_white_far_from_any_real_light_gets_no_temperature() {
        // The synthetic Z 8 DNG's white-balance coefficients are made up: its white lies about 0.09 Duv off the
        // Planckian locus, where a colour temperature means nothing. It must develop with no as-shot comment.
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/synthetic-z8.dng");
        let jpeg = develop(&std::fs::read(path).unwrap()).unwrap();
        assert!(!String::from_utf8_lossy(&jpeg[..200]).contains("InFlight-AsShotWhite"));
        assert!(image::load_from_memory(&jpeg).is_ok());
    }

    #[test]
    fn as_shot_comment_is_added_after_start_of_image_and_leaves_the_picture_alone() {
        let picture = image::RgbImage::from_pixel(8, 8, image::Rgb([120, 90, 60]));
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 95).encode_image(&picture).unwrap();
        let tagged = super::with_as_shot_comment(jpeg.clone(), 5480.4, 0.00213);
        assert_eq!(&tagged[..4], &[0xFF, 0xD8, 0xFF, 0xFE]);
        let text = "InFlight-AsShotWhite/1 K=5480 Duv=0.0021";
        assert_eq!(u16::from_be_bytes([tagged[4], tagged[5]]) as usize, text.len() + 2);
        assert_eq!(&tagged[6..6 + text.len()], text.as_bytes());
        let a = image::load_from_memory(&jpeg).unwrap().to_rgb8();
        let b = image::load_from_memory(&tagged).unwrap().to_rgb8();
        assert_eq!(a.as_raw(), b.as_raw());
        assert_eq!(super::with_as_shot_comment(vec![1, 2, 3], 5000.0, 0.0), vec![1, 2, 3], "not a JPEG: untouched");
    }

    /// Real camera files are not kept in the repository. Point KESTREL_RAW_SAMPLES at a folder holding some to run these.
    fn samples() -> Option<std::path::PathBuf> {
        std::env::var_os("KESTREL_RAW_SAMPLES").map(Into::into).filter(|path: &std::path::PathBuf| path.is_dir())
    }

    #[test]
    fn real_files_develop_at_full_size_with_real_picture_content() {
        let Some(dir) = samples() else { eprintln!("skipped: KESTREL_RAW_SAMPLES not set"); return };
        let expected = [("nikon-d7200.nef", 6000, 4000), ("canon-5d2-sraw.cr2", 3861, 2574), ("sony-a7rv.arw", 6240, 4160), // This Nikon D3 portrait shot says "normal" orientation in its own flags, so the decoder returns it landscape (4256 x 2832).
            // The app turns it to match the camera's preview (see matchPreviewOrientation).
            ("portrait-d3.nef", 4256, 2832)];
        for (name, width, height) in expected {
            let path = dir.join(name);
            if !path.exists() { eprintln!("skipped {name}: not found"); continue; }
            let jpeg = develop(&std::fs::read(&path).unwrap()).unwrap_or_else(|error| panic!("{name}: {error}"));
            let image = image::load_from_memory_with_format(&jpeg, image::ImageFormat::Jpeg).unwrap().to_rgb8();
            assert_eq!((image.width(), image.height()), (width, height), "{name} size");
            let mean = image.pixels().step_by(997).map(|p| (p[0] as u32 + p[1] as u32 + p[2] as u32) / 3).sum::<u32>() as f64 / (image.pixels().len() as f64 / 997.0);
            assert!(mean > 10.0 && mean < 245.0, "{name}: picture is blank or blown out (mean {mean})");
            let spread = image.pixels().step_by(997).map(|p| p[1] as i32).max().unwrap() - image.pixels().step_by(997).map(|p| p[1] as i32).min().unwrap();
            assert!(spread > 60, "{name}: picture has no contrast (spread {spread})");
        }
    }

    #[test]
    fn the_16_bit_develop_is_the_jpeg_before_it_lost_precision() {
        // Synthetic 96 x 64 Bayer DNG, orientation 6: no camera data.
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/synthetic-z8.dng");
        let bytes = std::fs::read(path).unwrap();
        let rgb16 = super::develop_rgb16(&bytes).unwrap();
        assert_eq!((rgb16.width(), rgb16.height()), (64, 96), "turned the way the camera was held");
        let jpeg = image::load_from_memory_with_format(&develop(&bytes).unwrap(), image::ImageFormat::Jpeg).unwrap().to_rgb8();
        assert_eq!((jpeg.width(), jpeg.height()), (64, 96));
        let mean_gap = rgb16.pixels().zip(jpeg.pixels())
            .map(|(a, b)| (0..3).map(|c| (a[c] as f64 / 257.0 - b[c] as f64).abs()).sum::<f64>() / 3.0)
            .sum::<f64>() / (64.0 * 96.0);
        assert!(mean_gap < 3.0, "same picture, only finer: mean gap {mean_gap} levels");
        let bytes16 = super::rgb16_bytes(&rgb16);
        assert_eq!(bytes16.len(), 8 + 64 * 96 * 6);
        assert_eq!(&bytes16[..8], &[64, 0, 0, 0, 96, 0, 0, 0]);
        assert_eq!(u16::from_le_bytes([bytes16[8], bytes16[9]]), rgb16.as_raw()[0]);
    }

    #[test]
    fn every_exif_orientation_turns_the_picture_the_right_way() {
        // A 3 x 2 picture: top row 1 2 3, bottom row 4 5 6 (red channel carries the number).
        let picture = || image::RgbImage::from_fn(3, 2, |x, y| image::Rgb([(y * 3 + x + 1) as u8, 0, 0]));
        let layout = |image: &image::RgbImage| -> Vec<Vec<u8>> { (0..image.height()).map(|y| (0..image.width()).map(|x| image.get_pixel(x, y)[0]).collect()).collect() };
        let expect = [
            (1, vec![vec![1, 2, 3], vec![4, 5, 6]]),
            (2, vec![vec![3, 2, 1], vec![6, 5, 4]]),
            (3, vec![vec![6, 5, 4], vec![3, 2, 1]]),
            (4, vec![vec![4, 5, 6], vec![1, 2, 3]]),
            (5, vec![vec![1, 4], vec![2, 5], vec![3, 6]]),
            (6, vec![vec![4, 1], vec![5, 2], vec![6, 3]]),
            (7, vec![vec![6, 3], vec![5, 2], vec![4, 1]]),
            (8, vec![vec![3, 6], vec![2, 5], vec![1, 4]]),
        ];
        for (orientation, wanted) in expect {
            assert_eq!(layout(&super::apply_orientation(picture(), orientation)), wanted, "orientation {orientation}");
        }
        assert_eq!(layout(&super::apply_orientation(picture(), 0)), layout(&picture()), "unknown leaves it alone");
    }

    #[test]
    fn the_tiled_turn_gives_exactly_the_image_crates_pixels() {
        use image::{imageops, ImageBuffer, Rgb};
        // Odd sizes that are not multiples of the tile, in 8 and 16 bits.
        for (w, h) in [(1, 1), (7, 3), (130, 67), (200, 129)] {
            let eight = image::RgbImage::from_fn(w, h, |x, y| image::Rgb([(x * 7 + y) as u8, (y * 13) as u8, (x ^ y) as u8]));
            let sixteen = ImageBuffer::<Rgb<u16>, Vec<u16>>::from_fn(w, h, |x, y| Rgb([(x * 977 + y) as u16, (y * 131) as u16, (x * y) as u16]));
            let reference8 = |o: u16| match o { 2 => imageops::flip_horizontal(&eight), 3 => imageops::rotate180(&eight), 4 => imageops::flip_vertical(&eight),
                5 => imageops::flip_horizontal(&imageops::rotate90(&eight)), 6 => imageops::rotate90(&eight),
                7 => imageops::flip_horizontal(&imageops::rotate270(&eight)), _ => imageops::rotate270(&eight) };
            let reference16 = |o: u16| match o { 2 => imageops::flip_horizontal(&sixteen), 3 => imageops::rotate180(&sixteen), 4 => imageops::flip_vertical(&sixteen),
                5 => imageops::flip_horizontal(&imageops::rotate90(&sixteen)), 6 => imageops::rotate90(&sixteen),
                7 => imageops::flip_horizontal(&imageops::rotate270(&sixteen)), _ => imageops::rotate270(&sixteen) };
            for o in 2..=8u16 {
                assert_eq!(super::apply_orientation(eight.clone(), o), reference8(o), "8-bit {w}x{h} orientation {o}");
                assert_eq!(super::apply_orientation(sixteen.clone(), o), reference16(o), "16-bit {w}x{h} orientation {o}");
            }
        }
    }

    #[test]
    fn nikon_high_efficiency_is_explained_in_plain_words() {
        let message = super::explain("Failed to decode image, possibly corrupt image: NEF compression Some(HighEfficencyStar) is not supported");
        assert!(message.contains("High Efficiency") && !message.contains("Some("), "{message}");
        assert!(message.contains("can’t develop"), "{message}");
        assert!(!message.contains("a Mac can") && !message.contains("varies by computer"), "{message}");
        // Decoder versions may use the corrected English spelling instead of rawler’s historical typo.
        for variant in ["HighEfficiency", "HighEfficiencyStar", "HighEfficency", "HighEfficencyStar"] {
            let explained = super::explain(&format!("NEF compression Some({variant}) is not supported"));
            assert!(explained.contains("High Efficiency") && !explained.contains("Some("), "{variant}: {explained}");
        }
        assert!(super::explain("something else").contains("could not be read"));
    }

    #[test]
    fn junk_is_refused_with_a_plain_message() {
        let error = develop(&[0u8; 4096]).unwrap_err();
        assert!(error.contains("RAW file"), "{error}");
        assert!(develop(&[]).is_err());
    }
}
