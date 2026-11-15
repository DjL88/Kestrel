//! Full RAW development: decode the camera's sensor data, demosaic, white balance and convert to sRGB at the file's full
//! resolution, then hand back a high-quality JPEG for the editor to work on. The original file is never changed.
//!
//! Covers whatever the `rawler` decoder supports for the camera (Nikon NEF/NRW, Sony ARW, Canon CR2/CR3, Fujifilm RAF, DNG
//! and others). A camera or compression mode it cannot read returns a plain error, and the app falls back to the preview
//! inside the file. Newer lossy modes (for example Nikon High Efficiency) must be checked with real files before being claimed.

use image::codecs::jpeg::JpegEncoder;
use image::{imageops, RgbImage};
use rawler::decoders::RawDecodeParams;
use rawler::imgop::develop::RawDevelop;
use rawler::rawsource::RawSource;

/// Turn the picture the way the camera was held, from the file's EXIF orientation (1 to 8). The sensor data is always stored
/// sideways-on, so without this a portrait photograph comes out lying on its side.
fn apply_orientation(image: RgbImage, exif_orientation: u16) -> RgbImage {
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
fn explain(error: &str) -> String {
    if error.contains("HighEfficen") {
        "This is a Nikon High Efficiency (HE) RAW file, a compressed mode Kestrel cannot decode on this computer (a Mac can).".to_string()
    } else {
        format!("This RAW file could not be read: {error}")
    }
}

/// macOS can read RAW formats the built-in decoder cannot, including Nikon High Efficiency (HE and HE*) files, because the
/// system's own RAW engine includes licensed decoders. `sips` is part of macOS and uses that engine. The result is Apple's
/// neutral rendering at the file's full size, already turned the right way up. Used only when the built-in decoder fails.
#[cfg(target_os = "macos")]
fn develop_with_system(bytes: &[u8], extension: &str) -> Result<Vec<u8>, String> {
    use std::process::Command;
    let folder = std::env::temp_dir().join(format!("kestrel-raw-{}-{}", std::process::id(), bytes.len()));
    std::fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
    let input = folder.join(format!("in.{extension}"));
    let output = folder.join("out.jpg");
    let result = (|| {
        std::fs::write(&input, bytes).map_err(|error| error.to_string())?;
        let status = Command::new("/usr/bin/sips")
            .args(["-s", "format", "jpeg", "-s", "formatOptions", "95"])
            .arg(&input).arg("--out").arg(&output)
            .output()
            .map_err(|error| error.to_string())?;
        if !status.status.success() { return Err("macOS could not read this RAW file either.".to_string()); }
        std::fs::read(&output).map_err(|_| "macOS could not read this RAW file either.".to_string())
    })();
    let _ = std::fs::remove_dir_all(&folder);
    result
}

#[cfg(not(target_os = "macos"))]
fn develop_with_system(_bytes: &[u8], _extension: &str) -> Result<Vec<u8>, String> {
    Err("No system RAW decoder is available on this computer.".to_string())
}

/// Develop a RAW file: the built-in decoder first, then (on a Mac) the system's, for modes such as Nikon HE and HE*.
pub fn develop_any(bytes: &[u8], extension: &str) -> Result<Vec<u8>, String> {
    match develop(bytes) {
        Ok(jpeg) => Ok(jpeg),
        Err(error) => develop_with_system(bytes, extension).map_err(|_| error),
    }
}

pub fn develop(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let source = RawSource::new_from_slice(bytes);
    let raw = rawler::decode(&source, &RawDecodeParams { image_index: 0 })
        .map_err(|error| explain(&error.to_string()))?;
    let developed = RawDevelop::default()
        .develop_intermediate(&raw)
        .map_err(|error| format!("This RAW file could not be developed: {error}"))?
        .to_dynamic_image()
        .ok_or_else(|| "This RAW file produced no picture.".to_string())?;
    let rgb = apply_orientation(developed.to_rgb8(), raw.orientation.to_u16());
    let mut out = Vec::with_capacity((rgb.width() * rgb.height()) as usize / 4);
    JpegEncoder::new_with_quality(&mut out, 95)
        .encode_image(&rgb)
        .map_err(|error| format!("The developed picture could not be saved: {error}"))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::develop;

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

    /// Only a Mac can do this, and the file is the owner's own Z8 HE* picture, not kept in the repository.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_mac_develops_nikon_high_efficiency_files_through_the_system() {
        let Some(dir) = samples() else { eprintln!("skipped: KESTREL_RAW_SAMPLES not set"); return };
        let path = dir.join("z8-he.nef");
        if !path.exists() { eprintln!("skipped: z8-he.nef not found"); return; }
        let bytes = std::fs::read(&path).unwrap();
        assert!(super::develop(&bytes).is_err(), "the built-in decoder should not read HE* (if it can now, this fallback is no longer needed for it)");
        let jpeg = super::develop_any(&bytes, "nef").expect("the system decoder reads HE*");
        let image = image::load_from_memory_with_format(&jpeg, image::ImageFormat::Jpeg).unwrap().to_rgb8();
        assert_eq!((image.width(), image.height()), (8256, 5504));
    }

    #[test]
    fn nikon_high_efficiency_is_explained_in_plain_words() {
        let message = super::explain("Failed to decode image, possibly corrupt image: NEF compression Some(HighEfficencyStar) is not supported");
        assert!(message.contains("High Efficiency") && !message.contains("Some("), "{message}");
        assert!(super::explain("something else").contains("could not be read"));
    }

    #[test]
    fn junk_is_refused_with_a_plain_message() {
        let error = develop(&[0u8; 4096]).unwrap_err();
        assert!(error.contains("RAW file"), "{error}");
        assert!(develop(&[]).is_err());
    }
}
