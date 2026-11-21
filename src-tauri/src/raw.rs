//! Desktop adapter for RAW development. The development itself (sensor decode, Kite44's develop, orientation, JPEG) is
//! `kestrel_raw::develop_jpeg`, the same code the WebAssembly build runs. This file adds only what is platform-specific:
//! on a Mac, the system's own decoder as a last fallback. The original file is never changed.


/// Give each decode its own private workspace. Two photos of equal byte length may be
/// developed concurrently; a shared path would overwrite one input or delete the
/// other's output. create_dir is atomic, so a stale directory is never reused.
#[cfg(target_os = "macos")]
fn unique_system_decode_folder() -> Result<std::path::PathBuf, String> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    for _ in 0..64 {
        let serial = NEXT.fetch_add(1, Ordering::Relaxed);
        let folder = std::env::temp_dir().join(format!("kestrel-raw-{}-{serial}", std::process::id()));
        match std::fs::create_dir(&folder) {
            Ok(()) => return Ok(folder),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Could not prepare a temporary RAW workspace: {error}")),
        }
    }
    Err("Could not allocate a private RAW workspace.".to_string())
}

/// Owns a private decoder directory until the operation leaves scope, including
/// early errors and unwinding. Never delete a caller-provided path.
#[cfg(target_os = "macos")]
struct SystemDecodeWorkspace(std::path::PathBuf);

#[cfg(target_os = "macos")]
impl SystemDecodeWorkspace {
    fn new() -> Result<Self, String> {
        unique_system_decode_folder().map(Self)
    }

    fn path(&self) -> &std::path::Path {
        &self.0
    }
}

#[cfg(target_os = "macos")]
impl Drop for SystemDecodeWorkspace {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Only camera RAW extensions may become part of a temporary filename. Reject path
/// separators and arbitrary suffixes before writing any caller-provided bytes.
#[cfg(target_os = "macos")]
fn safe_raw_extension(extension: &str) -> Result<&'static str, String> {
    match extension.to_ascii_lowercase().as_str() {
        "nef" => Ok("nef"), "nrw" => Ok("nrw"), "arw" => Ok("arw"),
        "cr2" => Ok("cr2"), "cr3" => Ok("cr3"), "raf" => Ok("raf"),
        "dng" => Ok("dng"), "orf" => Ok("orf"), "rw2" => Ok("rw2"),
        "pef" => Ok("pef"), "srw" => Ok("srw"), "3fr" => Ok("3fr"),
        _ => Err("Unsupported RAW file extension.".to_string()),
    }
}

#[cfg(target_os = "macos")]
fn validate_system_jpeg(jpeg: &[u8]) -> Result<(), String> {
    use image::ImageReader;
    use std::io::Cursor;
    let invalid = || "macOS returned an invalid RAW development.".to_string();
    if !jpeg.starts_with(&[0xff, 0xd8]) || !jpeg.ends_with(&[0xff, 0xd9]) {
        return Err(invalid());
    }
    let (width, height) = ImageReader::with_format(Cursor::new(jpeg), image::ImageFormat::Jpeg)
        .into_dimensions().map_err(|_| invalid())?;
    if width == 0 || height == 0 || (width as u64) * (height as u64) > 200_000_000 {
        return Err(invalid());
    }
    // JPEG headers and end markers do not prove that the compressed scan data is
    // decodable. Fail closed before returning a system-rendered export source.
    let decoded = ImageReader::with_format(Cursor::new(jpeg), image::ImageFormat::Jpeg)
        .decode().map_err(|_| invalid())?;
    if decoded.width() != width || decoded.height() != height {
        return Err(invalid());
    }
    Ok(())
}

/// On some macOS versions the system RAW engine may read formats the built-in decoder cannot.
/// `sips` is part of macOS; successful HE/HE* decoding and colour fidelity depend on the installed
/// system and camera support and require lawful real-file verification. The output is a system-rendered
/// JPEG, not an official Nikon colour match. Used only when the built-in decoder fails.
#[cfg(target_os = "macos")]
fn develop_with_system(bytes: &[u8], extension: &str) -> Result<Vec<u8>, String> {
    use std::process::Command;
    let extension = safe_raw_extension(extension)?;
    let folder = SystemDecodeWorkspace::new()?;
    let input = folder.path().join(format!("in.{extension}"));
    let output = folder.path().join("out.jpg");
    let result = (|| {
        std::fs::write(&input, bytes).map_err(|error| error.to_string())?;
        let status = Command::new("/usr/bin/sips")
            .args(["-s", "format", "jpeg", "-s", "formatOptions", "95"])
            .arg(&input).arg("--out").arg(&output)
            .output()
            .map_err(|error| error.to_string())?;
        if !status.status.success() { return Err("macOS could not read this RAW file either.".to_string()); }
        let jpeg = std::fs::read(&output).map_err(|_| "macOS could not read this RAW file either.".to_string())?;
        // A successful sips exit alone does not establish a usable preview. Validate
        // the container and dimensions without decoding a second full-size bitmap.
        validate_system_jpeg(&jpeg)?;
        Ok(jpeg)
    })();
    result
}

#[cfg(not(target_os = "macos"))]
fn develop_with_system(_bytes: &[u8], _extension: &str) -> Result<Vec<u8>, String> {
    Err("No system RAW decoder is available on this computer.".to_string())
}

/// Develop a RAW file: Kite44's own decoders first (rawler, and ticoraw for Nikon HE/HE*), then on a Mac the system's.
pub fn develop_any(bytes: &[u8], extension: &str) -> Result<Vec<u8>, String> {
    match develop(bytes) {
        Ok(jpeg) => Ok(jpeg),
        Err(error) => develop_with_system(bytes, extension).map_err(|_| error),
    }
}

pub fn develop(bytes: &[u8]) -> Result<Vec<u8>, String> {
    kestrel_raw::develop_jpeg(bytes)
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "macos")]
    #[test]
    fn system_jpeg_requires_decodable_scan_not_just_valid_markers() {
        use image::{codecs::jpeg::JpegEncoder, Rgb, RgbImage};
        let image = RgbImage::from_pixel(8, 8, Rgb([42, 80, 123]));
        let mut valid = Vec::new();
        JpegEncoder::new_with_quality(&mut valid, 90).encode_image(&image).unwrap();
        assert!(super::validate_system_jpeg(&valid).is_ok());
        // Preserve the SOI/EOI and the dimension-bearing header, but truncate
        // the entropy-coded scan. A header-only validator would accept this.
        let scan = valid.windows(2).position(|w| w == [0xff, 0xda]).unwrap();
        let scan_header_len = u16::from_be_bytes([valid[scan + 2], valid[scan + 3]]) as usize;
        let mut truncated = valid[..scan + 2 + scan_header_len].to_vec();
        truncated.extend_from_slice(&[0xff, 0xd9]);
        assert!(super::validate_system_jpeg(&truncated).is_err());
    }

    /// Optional, owner-provided HE/HE* fixture. macOS support is not universal,
    /// and a future built-in decoder may gain support before the system decoder.
    /// A missing or unsupported fixture is not evidence of a passing decode.
    #[cfg(target_os = "macos")]
    #[test]
    fn macos_nikon_he_fixture_reports_support_without_promising_it() {
        let Some(dir) = samples() else { eprintln!("NOT RUN: KESTREL_RAW_SAMPLES not set"); return };
        let path = dir.join("z8-he.nef");
        if !path.exists() { eprintln!("NOT RUN: z8-he.nef not found"); return; }
        let bytes = std::fs::read(&path).expect("read owner-provided fixture");
        match super::develop_any(&bytes, "nef") {
            Ok(jpeg) => {
                let image = image::load_from_memory_with_format(&jpeg, image::ImageFormat::Jpeg)
                    .expect("successful decode must produce valid JPEG");
                assert_eq!((image.width(), image.height()), (8256, 5504));
                eprintln!("SUPPORTED ON THIS SYSTEM: Z8 HE fixture decoded; colour fidelity NOT VERIFIED");
            }
            Err(error) => {
                assert!(!error.contains("a Mac can"), "{error}");
                eprintln!("UNSUPPORTED ON THIS SYSTEM: Z8 HE fixture did not decode; {error}");
            }
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn system_decoder_rejects_untrusted_extension_paths() {
        for bad in ["../escape", "nef/../../escape", "", ".nef", "nef\\\\out", "jpg", "nef\\n"] {
            assert!(super::safe_raw_extension(bad).is_err(), "accepted {bad:?}");
        }
        assert_eq!(super::safe_raw_extension("NEF").unwrap(), "nef");
        assert_eq!(super::safe_raw_extension("nrw").unwrap(), "nrw");
        assert_eq!(super::safe_raw_extension("CR3").unwrap(), "cr3");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn system_raw_output_must_be_a_bounded_jpeg() {
        assert!(super::validate_system_jpeg(&[]).is_err());
        assert!(super::validate_system_jpeg(&[0xff, 0xd8, 0xff, 0xd9]).is_err());
        let mut valid = Vec::new();
        let tiny = image::RgbImage::new(2, 2);
        image::codecs::jpeg::JpegEncoder::new(&mut valid).encode_image(&tiny).unwrap();
        assert!(super::validate_system_jpeg(&valid).is_ok());
        let mut truncated = valid.clone();
        truncated.pop();
        assert!(super::validate_system_jpeg(&truncated).is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn system_workspace_cleans_up_on_error_and_unwind() {
        // No real camera files or system decoder required. An early error must
        // remove both the directory and any partially written input.
        let mut path = None;
        let failure: Result<(), &str> = (|| {
            let workspace = super::SystemDecodeWorkspace::new().unwrap();
            let folder = workspace.path().to_path_buf();
            std::fs::write(folder.join("in.nef"), b"synthetic").unwrap();
            path = Some(folder);
            Err("simulated decoder failure")
        })();
        assert!(failure.is_err());
        assert!(!path.unwrap().exists(), "failed decode left input behind");

        let mut panic_path = None;
        let unwind = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let workspace = super::SystemDecodeWorkspace::new().unwrap();
            let folder = workspace.path().to_path_buf();
            std::fs::write(folder.join("out.jpg"), b"partial").unwrap();
            panic_path = Some(folder);
            panic!("simulated decoder panic");
        }));
        assert!(unwind.is_err());
        assert!(!panic_path.unwrap().exists(), "unwinding left output behind");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn simultaneous_system_decodes_never_share_a_workspace() {
        let folders: Vec<_> = (0..32).map(|_| super::unique_system_decode_folder().unwrap()).collect();
        let unique: std::collections::HashSet<_> = folders.iter().collect();
        assert_eq!(unique.len(), folders.len());
        for folder in folders { std::fs::remove_dir(folder).unwrap(); }
    }
}
