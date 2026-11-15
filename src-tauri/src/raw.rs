//! Full RAW development: decode the camera's sensor data, demosaic, white balance and convert to sRGB at the file's full
//! resolution, then hand back a high-quality JPEG for the editor to work on. The original file is never changed.
//!
//! Covers whatever the `rawler` decoder supports for the camera (Nikon NEF/NRW, Sony ARW, Canon CR2/CR3, Fujifilm RAF, DNG
//! and others). A camera or compression mode it cannot read returns a plain error, and the app falls back to the preview
//! inside the file. Newer lossy modes (for example Nikon High Efficiency) must be checked with real files before being claimed.

use image::codecs::jpeg::JpegEncoder;
use rawler::decoders::RawDecodeParams;
use rawler::imgop::develop::RawDevelop;
use rawler::rawsource::RawSource;

pub fn develop(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let source = RawSource::new_from_slice(bytes);
    let raw = rawler::decode(&source, &RawDecodeParams { image_index: 0 })
        .map_err(|error| format!("This RAW file could not be read: {error}"))?;
    let developed = RawDevelop::default()
        .develop_intermediate(&raw)
        .map_err(|error| format!("This RAW file could not be developed: {error}"))?
        .to_dynamic_image()
        .ok_or_else(|| "This RAW file produced no picture.".to_string())?;
    let rgb = developed.to_rgb8();
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
        let expected = [("nikon-d7200.nef", 6000, 4000), ("canon-5d2-sraw.cr2", 3861, 2574), ("sony-a7rv.arw", 6240, 4160)];
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
    fn junk_is_refused_with_a_plain_message() {
        let error = develop(&[0u8; 4096]).unwrap_err();
        assert!(error.contains("RAW file"), "{error}");
        assert!(develop(&[]).is_err());
    }
}
