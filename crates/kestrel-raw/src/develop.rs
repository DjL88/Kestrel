//! Full RAW development to a picture the editor can use: decode the sensor data (rawler, or `nikon_he` for Nikon High
//! Efficiency), develop it with Kestrel's own `scene_develop`, turn it the way the camera was held and encode a
//! high-quality JPEG at the file's full resolution. Pure: no files, no clock, no platform calls, so the desktop app and the
//! WebAssembly build run exactly the same code. The original is only read.

use image::codecs::jpeg::JpegEncoder;
use image::{imageops, RgbImage};
use rawler::imgop::develop::RawDevelop;

/// Turn the picture the way the camera was held, from the file's EXIF orientation (1 to 8). The sensor data is always stored
/// sideways-on, so without this a portrait photograph comes out lying on its side.
pub fn apply_orientation(image: RgbImage, exif_orientation: u16) -> RgbImage {
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

/// A plain-English reason for a decoder error, so the person sees what is going on rather than a library message.
/// Shared by every adapter (desktop develop, the 16-bit master, WebAssembly) so each gives the same plain wording.
pub fn explain(error: &str) -> String {
    if error.contains("HighEfficen") || error.contains("HighEfficien") {
        "This build of Kestrel can’t develop Nikon High Efficiency (HE/HE*) RAW files from their sensor data.".to_string()
    } else {
        format!("This RAW file could not be read: {error}")
    }
}

pub fn develop_jpeg(bytes: &[u8]) -> Result<Vec<u8>, String> {
    // Nikon High Efficiency NEFs are decoded from their sensor data by `nikon_he`; everything else by rawler.
    let (raw, _decoder) = crate::nikon_he::decode_sensor(bytes)?;
    // Kestrel's own develop (highlight reconstruction, no clipping, filmic shoulder), shared with the 16-bit master.
    // Sensors it doesn't handle yet (monochrome, four-colour) keep rawler's default develop.
    let rgb8 = match crate::scene_develop::develop_display_rgb16(&raw, &crate::scene_develop::Look::default())? {
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
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::develop_jpeg as develop;

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
