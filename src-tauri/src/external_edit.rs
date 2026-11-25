//! "Open in another editor and come back" (desktop only).
//!
//! The page renders the current edit as a 16-bit PNG and sends it here. This module writes it as a 16-bit TIFF into
//! InFlight's own working folder (never beside the original), opens it in the app the person chose, reports the file's
//! size and modified time so the page can tell when a save has settled (`src/core/externalEdit.ts`), and reads the saved
//! TIFF back as a 16-bit PNG that the page imports as a new photo. The original photo is never read or written here.

use image::codecs::png::PngEncoder;
use image::codecs::tiff::TiffEncoder;
use image::{DynamicImage, ImageDecoder, ImageEncoder, ImageFormat};
use std::ffi::OsString;
use std::io::Write;
use std::path::{Path, PathBuf};

/// The folder under the app's data folder that holds every file sent to, and brought back from, another editor.
pub const WORKING_FOLDER: &str = "External edits";

/// The largest TIFF read back. A 100-megapixel 16-bit RGB picture with layers is well under this.
const MAX_RETURNED_BYTES: u64 = 4 * 1024 * 1024 * 1024;

/// The same sRGB ICC profile as the page's exports (`src/core/iccEmbed.ts`; a unit test there checks the bytes match).
/// InFlight's renderer hands over display-encoded sRGB, so this is a truthful tag for the working TIFF.
pub const SRGB_ICC: &[u8] = include_bytes!("srgb.icc");

/// Profiles larger than this are not passed back to the page (printer profiles can be megabytes); the file keeps them.
const MAX_REPORTED_PROFILE: usize = 1 << 20;

/// How big a saved file is, and when it last changed, so the page can see a save start and settle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStamp {
    pub size: u64,
    pub modified_ms: u64,
}

/// A safe file name: only the last part, no folder separators, no control characters, no leading dots.
pub fn safe_file_name(name: &str, extension: &str) -> Result<String, String> {
    let cleaned: String = name.chars()
        .map(|c| if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '_' } else { c })
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.').trim();
    if cleaned.is_empty() { return Err("The file needs a name.".into()); }
    let lower = cleaned.to_ascii_lowercase();
    let wanted = format!(".{extension}");
    let named = if lower.ends_with(&wanted) { cleaned.to_string() } else { format!("{cleaned}{wanted}") };
    // Windows and macOS both limit one name to 255 bytes; keep well inside it.
    if named.len() > 200 { return Err("The file name is too long.".into()); }
    Ok(named)
}

/// Header values must be ASCII, so the page percent-encodes names and app paths (`encodeURIComponent`). Undo that here.
/// Malformed input is refused rather than half-decoded.
pub fn percent_decode(value: &str) -> Result<String, String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = value.get(i + 1..i + 3).ok_or_else(|| "A name was not sent correctly.".to_string())?;
            out.push(u8::from_str_radix(hex, 16).map_err(|_| "A name was not sent correctly.".to_string())?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| "A name was not sent correctly.".into())
}

/// True only when `path` is a file directly inside `folder` (after resolving links), so the page can never point these
/// commands at an original or anywhere else on the disk.
pub fn is_inside(folder: &Path, path: &Path) -> bool {
    let (Ok(folder), Ok(path)) = (folder.canonicalize(), path.canonicalize()) else { return false };
    path.parent() == Some(folder.as_path()) && path.is_file()
}

/// The app the person chose must look like an app on this system: a `.app` bundle on a Mac, an `.exe` on Windows, an
/// executable file elsewhere. Anything else is refused rather than run.
pub fn check_app(os: &str, app: &Path) -> Result<(), String> {
    let extension = app.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default();
    let ok = match os {
        "macos" => extension == "app" && app.is_dir(),
        "windows" => extension == "exe" && app.is_file(),
        _ => app.is_file(),
    };
    if ok { Ok(()) } else { Err("That does not look like an app InFlight can open a photo in. Choose the app itself.".into()) }
}

/// The program and arguments that open `file` in `app`. A Mac uses `open -a`, so an app that is already running gets the
/// file rather than a second copy of itself. The person's default app for TIFF is opened by the opener plugin instead.
pub fn launch_plan(os: &str, app: &Path, file: &Path) -> (OsString, Vec<OsString>) {
    if os == "macos" {
        ("open".into(), vec!["-a".into(), app.as_os_str().to_owned(), file.as_os_str().to_owned()])
    } else {
        (app.as_os_str().to_owned(), vec![file.as_os_str().to_owned()])
    }
}

pub fn stamp(path: &Path) -> Option<FileStamp> {
    let metadata = std::fs::metadata(path).ok()?;
    let modified_ms = metadata.modified().ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_millis() as u64).unwrap_or(0);
    Some(FileStamp { size: metadata.len(), modified_ms })
}

/// Decode a PNG or TIFF and the ICC profile it carries, if any.
fn decode_with_profile(bytes: &[u8], format: ImageFormat) -> Result<(DynamicImage, Option<Vec<u8>>), String> {
    // The profile is read BEFORE the limits are set: in image 0.25.10 setting limits on the TIFF decoder loses its
    // profile (this module's test caught it). No size limit beyond the file cap in `read_returned`, so a 100-megapixel
    // 16-bit picture is not refused.
    fn read(mut decoder: impl ImageDecoder) -> Result<(DynamicImage, Option<Vec<u8>>), String> {
        let profile = decoder.icc_profile().ok().flatten().filter(|profile| !profile.is_empty());
        decoder.set_limits(image::Limits::no_limits()).map_err(|_| String::new())?;
        let picture = DynamicImage::from_decoder(decoder).map_err(|_| String::new())?;
        Ok((picture, profile))
    }
    let cursor = std::io::Cursor::new(bytes);
    match format {
        ImageFormat::Png => read(image::codecs::png::PngDecoder::with_limits(cursor, image::Limits::no_limits()).map_err(|_| String::new())?),
        ImageFormat::Tiff => read(image::codecs::tiff::TiffDecoder::new(cursor).map_err(|_| String::new())?),
        _ => Err(String::new()),
    }
}

fn rgb16_bytes(picture: &DynamicImage) -> Result<(Vec<u8>, u32, u32), String> {
    let rgb = picture.to_rgb16();
    let (width, height) = rgb.dimensions();
    if width == 0 || height == 0 { return Err("The picture is empty.".into()); }
    Ok((rgb.as_raw().iter().flat_map(|sample| sample.to_ne_bytes()).collect(), width, height))
}

/// A 16-bit RGB TIFF of the PNG the page sent, tagged with its colour profile: the PNG's own ICC profile when it has
/// one, otherwise sRGB, which is what InFlight's renderer writes. Refuses anything that is not a PNG rather than guessing.
pub fn png_to_tiff16(png: &[u8]) -> Result<Vec<u8>, String> {
    let (picture, profile) = decode_with_profile(png, ImageFormat::Png).map_err(|_| "The edited picture could not be read.".to_string())?;
    let (bytes, width, height) = rgb16_bytes(&picture).map_err(|_| "The edited picture is empty.".to_string())?;
    let mut output = std::io::Cursor::new(Vec::new());
    let mut encoder = TiffEncoder::new(&mut output);
    encoder.set_icc_profile(profile.unwrap_or_else(|| SRGB_ICC.to_vec()))
        .map_err(|_| "The colour profile could not be added to the TIFF.".to_string())?;
    encoder.write_image(&bytes, width, height, image::ExtendedColorType::Rgb16)
        .map_err(|error| format!("Could not write the 16-bit TIFF: {error}"))?;
    Ok(output.into_inner())
}

/// What came back from the other editor.
pub struct Returned {
    /// A 16-bit PNG InFlight can read, carrying the same ICC profile the editor saved (none when it saved none).
    pub png: Vec<u8>,
    /// Bits per channel the editor actually saved (8, 16 or 32), so the page never calls an 8-bit save 16-bit.
    pub bits: u8,
    /// The editor's ICC profile, for the page to name it. None when there is none, or it is too large to pass on.
    pub profile: Option<Vec<u8>>,
}

pub fn tiff_to_png16(tiff: &[u8]) -> Result<Returned, String> {
    let (picture, profile) = decode_with_profile(tiff, ImageFormat::Tiff)
        .map_err(|_| "InFlight could not read the TIFF the other app saved. Save it as a flattened TIFF (8 or 16 bits) and try again.".to_string())?;
    let bits = match &picture {
        DynamicImage::ImageLuma8(_) | DynamicImage::ImageLumaA8(_) | DynamicImage::ImageRgb8(_) | DynamicImage::ImageRgba8(_) => 8,
        DynamicImage::ImageRgb32F(_) | DynamicImage::ImageRgba32F(_) => 32,
        _ => 16,
    };
    let (bytes, width, height) = rgb16_bytes(&picture).map_err(|_| "The saved TIFF is empty.".to_string())?;
    let mut output = std::io::Cursor::new(Vec::new());
    let mut encoder = PngEncoder::new(&mut output);
    if let Some(profile) = &profile {
        encoder.set_icc_profile(profile.clone()).map_err(|_| "The saved colour profile could not be kept.".to_string())?;
    }
    encoder.write_image(&bytes, width, height, image::ExtendedColorType::Rgb16)
        .map_err(|error| format!("Could not write the returned picture: {error}"))?;
    Ok(Returned { png: output.into_inner(), bits, profile: profile.filter(|profile| profile.len() <= MAX_REPORTED_PROFILE) })
}

/// Write `bytes` to a new file in `folder`. Never replaces an existing file: a name already in use gets " (2)", " (3)"...
pub fn write_new(folder: &Path, name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    std::fs::create_dir_all(folder).map_err(|_| "InFlight could not make its working folder for other editors.".to_string())?;
    let path = Path::new(name);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("photo").to_string();
    let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("tif").to_string();
    for attempt in 1..1000 {
        let candidate = if attempt == 1 { folder.join(name) } else { folder.join(format!("{stem} ({attempt}).{extension}")) };
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&candidate) {
            Ok(mut file) => {
                if file.write_all(bytes).and_then(|_| file.sync_all()).is_err() {
                    let _ = std::fs::remove_file(&candidate);
                    return Err("InFlight could not finish writing the file. Check there is space on the disk.".into());
                }
                return Ok(candidate);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("InFlight could not write in its working folder for other editors.".into()),
        }
    }
    Err("There are too many files with this name in the working folder.".into())
}

/// Read a returned TIFF from the working folder, refusing anything outside it or absurdly large.
pub fn read_returned(folder: &Path, path: &Path) -> Result<Vec<u8>, String> {
    if !is_inside(folder, path) { return Err("That file is not one InFlight sent to another app.".into()); }
    let size = std::fs::metadata(path).map(|m| m.len()).map_err(|_| "The saved file has gone.".to_string())?;
    if size == 0 { return Err("The saved file is empty. Save it again in the other app.".into()); }
    if size > MAX_RETURNED_BYTES { return Err("The saved file is too large to bring back.".into()); }
    std::fs::read(path).map_err(|_| "The saved file could not be read. Close it in the other app and try again.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb};

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("inflight-extedit-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn png16(width: u32, height: u32) -> (Vec<u8>, Vec<u16>) {
        let picture: ImageBuffer<Rgb<u16>, Vec<u16>> = ImageBuffer::from_fn(width, height, |x, y| Rgb([(x * 4099 + 1) as u16, (y * 3001 + 7) as u16, 65_535 - x as u16 * 13]));
        let samples = picture.as_raw().clone();
        let bytes: Vec<u8> = samples.iter().flat_map(|s| s.to_ne_bytes()).collect();
        let mut output = std::io::Cursor::new(Vec::new());
        PngEncoder::new(&mut output).write_image(&bytes, width, height, image::ExtendedColorType::Rgb16).unwrap();
        (output.into_inner(), samples)
    }

    #[test]
    fn sent_tiff_keeps_every_sixteen_bit_value_and_comes_back_unchanged() {
        let (png, samples) = png16(13, 7);
        let tiff = png_to_tiff16(&png).unwrap();
        let read = image::load_from_memory_with_format(&tiff, ImageFormat::Tiff).unwrap();
        assert!(matches!(read, DynamicImage::ImageRgb16(_)), "the working file must be 16-bit RGB");
        assert_eq!(read.to_rgb16().as_raw(), &samples);
        let back = tiff_to_png16(&tiff).unwrap();
        assert_eq!(back.bits, 16);
        let back = image::load_from_memory_with_format(&back.png, ImageFormat::Png).unwrap();
        assert_eq!(back.to_rgb16().as_raw(), &samples, "bringing it back must not round to 8 bits");
    }

    #[test]
    fn an_eight_bit_save_is_reported_as_eight_bits() {
        let picture: ImageBuffer<Rgb<u8>, Vec<u8>> = ImageBuffer::from_pixel(4, 3, Rgb([10, 200, 30]));
        let mut tiff = std::io::Cursor::new(Vec::new());
        TiffEncoder::new(&mut tiff).write_image(picture.as_raw(), 4, 3, image::ExtendedColorType::Rgb8).unwrap();
        let back = tiff_to_png16(&tiff.into_inner()).unwrap();
        assert_eq!(back.bits, 8);
        assert!(back.profile.is_none(), "a TIFF saved without a profile is not given one");
        let back = image::load_from_memory_with_format(&back.png, ImageFormat::Png).unwrap().to_rgb16();
        assert_eq!(back.get_pixel(0, 0).0, [10 * 257, 200 * 257, 30 * 257]);
    }

    fn profile_of(bytes: &[u8], format: ImageFormat) -> Option<Vec<u8>> {
        decode_with_profile(bytes, format).unwrap().1
    }

    #[test]
    fn the_working_tiff_is_tagged_srgb_and_the_editors_profile_comes_back() {
        let (png, _) = png16(5, 4);
        let tiff = png_to_tiff16(&png).unwrap();
        assert_eq!(profile_of(&tiff, ImageFormat::Tiff).as_deref(), Some(SRGB_ICC), "an untagged render is sRGB");
        assert_eq!(&SRGB_ICC[36..40], b"acsp");

        // The editor saved in another space: its profile is kept on the returned PNG and passed to the page.
        let mut other = SRGB_ICC.to_vec();
        other[100] ^= 0x55; // a different profile, byte for byte
        let picture: ImageBuffer<Rgb<u16>, Vec<u16>> = ImageBuffer::from_pixel(3, 2, Rgb([1000, 30000, 60000]));
        let raw: Vec<u8> = picture.as_raw().iter().flat_map(|s| s.to_ne_bytes()).collect();
        let mut saved = std::io::Cursor::new(Vec::new());
        let mut encoder = TiffEncoder::new(&mut saved);
        encoder.set_icc_profile(other.clone()).unwrap();
        encoder.write_image(&raw, 3, 2, image::ExtendedColorType::Rgb16).unwrap();
        let back = tiff_to_png16(&saved.into_inner()).unwrap();
        assert_eq!(back.profile.as_deref(), Some(other.as_slice()));
        assert_eq!(profile_of(&back.png, ImageFormat::Png).as_deref(), Some(other.as_slice()));

        // A PNG that already carries a profile keeps it in the TIFF rather than being called sRGB.
        let mut tagged = std::io::Cursor::new(Vec::new());
        let mut encoder = PngEncoder::new(&mut tagged);
        encoder.set_icc_profile(other.clone()).unwrap();
        encoder.write_image(&raw, 3, 2, image::ExtendedColorType::Rgb16).unwrap();
        let tiff = png_to_tiff16(&tagged.into_inner()).unwrap();
        assert_eq!(profile_of(&tiff, ImageFormat::Tiff).as_deref(), Some(other.as_slice()));
    }

    #[test]
    fn unreadable_files_are_refused_in_plain_words() {
        assert!(png_to_tiff16(b"not a png").is_err());
        let error = tiff_to_png16(b"II*\0broken").err().unwrap();
        assert!(error.contains("flattened TIFF"));
    }

    #[test]
    fn file_names_cannot_leave_the_working_folder() {
        assert_eq!(safe_file_name("DSC_0001 InFlight edit", "tif").unwrap(), "DSC_0001 InFlight edit.tif");
        assert_eq!(safe_file_name("../../etc/passwd", "tif").unwrap(), "_.._etc_passwd.tif");
        assert_eq!(safe_file_name("C:\\Photos\\a.TIF", "tif").unwrap(), "C__Photos_a.TIF");
        assert!(safe_file_name("  ...  ", "tif").is_err());
        assert!(safe_file_name(&"a".repeat(300), "tif").is_err());
    }

    #[test]
    fn names_sent_from_the_page_are_decoded_exactly() {
        assert_eq!(percent_decode("Mo%C3%B6r%20hen%20(1)").unwrap(), "Moör hen (1)");
        assert_eq!(percent_decode("C%3A%5CProgram%20Files%5CPhotoshop.exe").unwrap(), "C:\\Program Files\\Photoshop.exe");
        assert!(percent_decode("bad%2").is_err());
        assert!(percent_decode("bad%zz").is_err());
        assert!(percent_decode("%FF").is_err());
    }

    #[test]
    fn writing_never_replaces_an_existing_file() {
        let dir = scratch("write");
        let first = write_new(&dir, "a.tif", b"one").unwrap();
        let second = write_new(&dir, "a.tif", b"two").unwrap();
        assert_ne!(first, second);
        assert_eq!(second.file_name().unwrap(), "a (2).tif");
        assert_eq!(std::fs::read(&first).unwrap(), b"one");
        assert_eq!(std::fs::read(&second).unwrap(), b"two");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_files_inside_the_working_folder_are_read_or_stamped() {
        let dir = scratch("inside");
        let outside = scratch("outside");
        let mine = write_new(&dir, "edit.tif", b"saved").unwrap();
        let theirs = write_new(&outside, "original.nef", b"raw").unwrap();
        assert!(is_inside(&dir, &mine));
        assert!(!is_inside(&dir, &theirs));
        assert!(!is_inside(&dir, &dir.join("..").join(outside.file_name().unwrap()).join("original.nef")));
        assert!(!is_inside(&dir, &dir.join("missing.tif")));
        assert!(read_returned(&dir, &theirs).is_err());
        assert_eq!(read_returned(&dir, &mine).unwrap(), b"saved");
        let empty = write_new(&dir, "empty.tif", b"").unwrap();
        assert!(read_returned(&dir, &empty).unwrap_err().contains("empty"));
        let first = stamp(&mine).unwrap();
        assert_eq!(first.size, 5);
        assert!(stamp(&dir.join("missing.tif")).is_none());
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn apps_are_opened_the_way_each_system_expects() {
        let file = Path::new("/w/a.tif");
        let (program, args) = launch_plan("macos", Path::new("/Applications/Affinity Photo 2.app"), file);
        assert_eq!(program, OsString::from("open"));
        assert_eq!(args, vec![OsString::from("-a"), OsString::from("/Applications/Affinity Photo 2.app"), OsString::from("/w/a.tif")]);
        let (program, args) = launch_plan("windows", Path::new("C:\\Program Files\\Adobe\\Photoshop.exe"), file);
        assert_eq!(program, OsString::from("C:\\Program Files\\Adobe\\Photoshop.exe"));
        assert_eq!(args, vec![OsString::from("/w/a.tif")]);
    }

    #[test]
    fn only_real_apps_are_accepted() {
        let dir = scratch("apps");
        let bundle = dir.join("Editor.app");
        std::fs::create_dir_all(&bundle).unwrap();
        let exe = write_new(&dir, "editor.exe", b"MZ").unwrap();
        let text = write_new(&dir, "notes.txt", b"hi").unwrap();
        assert!(check_app("macos", &bundle).is_ok());
        assert!(check_app("macos", &text).is_err());
        assert!(check_app("windows", &exe).is_ok());
        assert!(check_app("windows", &text).is_err());
        assert!(check_app("windows", &dir.join("missing.exe")).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
