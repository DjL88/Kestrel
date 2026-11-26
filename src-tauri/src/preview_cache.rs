//! Desktop preview cache on disk (x-std-disk-previews), the way Lightroom keeps its previews and Smart Previews.
//!
//! The page names a photo by its path; this module reads the original (read-only), develops it here, and writes three
//! JPEGs into the app's own data folder: a 400 px thumbnail, a 2,200 px review copy and a 2,560 px smart preview that
//! the editor can work on while the drive is unplugged. No RAW bytes cross the IPC bridge, and the original is never
//! opened for writing, moved or replaced. Every entry is derived data: deleting the folder only means previews are
//! made again.
//!
//! Layout: `<root>/<sha256(key)[..32]>/{thumb,review,smart}.jpg` plus `meta.json`. The cache key comes from the page
//! (the same identity the IndexedDB cache uses: stable key, file name, size, modified time, versions), so a replaced
//! file never inherits another photo's previews. The key is hashed for the folder name, so it can never form a path.
//! `meta.json`'s modified time is the entry's last use; the size limit removes the least recently used entries first.

use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, DynamicImage, ImageFormat, ImageReader};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// Raise when every stored preview must be made again (a change to how they are developed or sized).
pub const CACHE_VERSION: u32 = 1;

/// The three sizes, by the long edge, and their JPEG quality.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Level { Thumb, Review, Smart }

impl Level {
    pub const ALL: [Level; 3] = [Level::Smart, Level::Review, Level::Thumb];
    pub fn long_edge(self) -> u32 { match self { Level::Thumb => 400, Level::Review => 2200, Level::Smart => 2560 } }
    fn quality(self) -> u8 { match self { Level::Thumb => 82, Level::Review => 82, Level::Smart => 88 } }
    fn file(self) -> &'static str { match self { Level::Thumb => "thumb.jpg", Level::Review => "review.jpg", Level::Smart => "smart.jpg" } }
}

/// Photo types this cache may read. Anything else is refused before a byte is read.
const RAW_EXTENSIONS: &[&str] = &["nef", "nrw", "cr2", "cr3", "arw", "raf", "dng", "orf", "rw2", "pef", "srw", "3fr"];
const PICTURE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "tif", "tiff"];
/// A camera file bigger than this is not a photo this app reads.
const MAX_SOURCE_BYTES: u64 = 1024 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildRequest {
    /// The page's cache key for this original (see `previewCacheKey` in src/providers/offlinePreviewCache.ts).
    pub key: String,
    /// Where the original is. Only read.
    pub path: String,
    /// The size recorded when the photo was added. A different size means a different file: nothing is made.
    pub size: Option<u64>,
    /// The SHA-256 of the bytes added (lower-case hex). When given, a file at this path with other bytes makes nothing:
    /// equal name and size are not identity.
    pub sha256: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BuildResult {
    pub key: String,
    /// "built", "cached" (already there), or "failed".
    pub status: &'static str,
    /// What the pictures were made from: "raw" (developed from the sensor data) or "picture" (a JPEG, PNG or TIFF).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub made_from: Option<&'static str>,
    /// For a NEF: "nikon-he", "nikon-he-star" or "other", read from the file's own headers. Absent when not checked.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codec: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Usage { pub bytes: u64, pub entries: u64 }

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Meta { version: u32, key: String, made_from: String, width: u32, height: u32 }

pub fn entry_dir(root: &Path, key: &str) -> PathBuf {
    let digest = Sha256::digest(key.as_bytes());
    let mut name = String::with_capacity(32);
    for byte in &digest[..16] { name.push_str(&format!("{byte:02x}")); }
    root.join(name)
}

fn extension_of(path: &Path) -> Option<String> {
    path.extension().and_then(|value| value.to_str()).map(|value| value.to_ascii_lowercase())
}

/// An entry is usable when all three pictures and its record are there, for this key and this cache version.
pub fn is_complete(root: &Path, key: &str) -> bool {
    let dir = entry_dir(root, key);
    let Ok(text) = fs::read_to_string(dir.join("meta.json")) else { return false };
    let Ok(meta) = serde_json::from_str::<Meta>(&text) else { return false };
    meta.version == CACHE_VERSION && meta.key == key && Level::ALL.iter().all(|level| dir.join(level.file()).is_file())
}

/// Read the original without ever opening it for writing. Refuses anything that is not a regular photo file, and a file
/// whose size no longer matches the one recorded when it was added.
fn read_original(path: &Path, expected: Option<u64>) -> Result<(Vec<u8>, String), String> {
    let extension = extension_of(path).ok_or("This file has no photo extension.")?;
    if !RAW_EXTENSIONS.contains(&extension.as_str()) && !PICTURE_EXTENSIONS.contains(&extension.as_str()) {
        return Err("This file type has no disk preview.".into());
    }
    let info = fs::metadata(path).map_err(|_| "The original is not reachable. Is its drive connected?".to_string())?;
    if !info.is_file() { return Err("This is not a photo file.".into()); }
    if info.len() == 0 || info.len() > MAX_SOURCE_BYTES { return Err("This file is not a readable photo.".into()); }
    if let Some(size) = expected {
        if size != info.len() { return Err("The file at this path has changed since it was added, so no preview was made.".into()); }
    }
    let mut bytes = Vec::with_capacity(info.len() as usize);
    fs::File::open(path).and_then(|mut file| file.read_to_end(&mut bytes))
        .map_err(|_| "The original could not be read.".to_string())?;
    if let Some(size) = expected {
        if size != bytes.len() as u64 { return Err("The original changed while it was read.".into()); }
    }
    Ok((bytes, extension))
}

/// The decoder's own comment (as-shot white, `InFlight-AsShotWhite/1`), so the pictures made from it still carry it.
pub fn jpeg_comment(jpeg: &[u8]) -> Option<Vec<u8>> {
    if jpeg.len() < 4 || jpeg[0] != 0xff || jpeg[1] != 0xd8 { return None; }
    let mut at = 2;
    for _ in 0..32 {
        if at + 4 > jpeg.len() || jpeg[at] != 0xff { return None; }
        let marker = jpeg[at + 1];
        if marker == 0xda || marker == 0xd9 { return None; }
        let length = u16::from_be_bytes([jpeg[at + 2], jpeg[at + 3]]) as usize;
        if length < 2 || at + 2 + length > jpeg.len() { return None; }
        if marker == 0xfe { return Some(jpeg[at + 4..at + 2 + length].to_vec()); }
        at += 2 + length;
    }
    None
}

/// Put a comment segment straight after the start marker, where `src/core/asShotWhite.ts` looks first.
fn with_comment(jpeg: Vec<u8>, comment: Option<&[u8]>) -> Vec<u8> {
    let Some(comment) = comment.filter(|text| text.len() + 2 <= u16::MAX as usize) else { return jpeg };
    if jpeg.len() < 2 { return jpeg; }
    let mut out = Vec::with_capacity(jpeg.len() + comment.len() + 4);
    out.extend_from_slice(&jpeg[..2]);
    out.extend_from_slice(&[0xff, 0xfe]);
    out.extend_from_slice(&((comment.len() + 2) as u16).to_be_bytes());
    out.extend_from_slice(comment);
    out.extend_from_slice(&jpeg[2..]);
    out
}

/// Never larger than the picture itself: a small original is kept at its own size, not blown up.
pub fn fit(width: u32, height: u32, long_edge: u32) -> (u32, u32) {
    let long = width.max(height).max(1);
    if long <= long_edge { return (width.max(1), height.max(1)); }
    let scale = long_edge as f64 / long as f64;
    (((width as f64 * scale).round() as u32).max(1), ((height as f64 * scale).round() as u32).max(1))
}

fn encode(picture: &DynamicImage, level: Level, comment: Option<&[u8]>) -> Result<Vec<u8>, String> {
    let (width, height) = fit(picture.width(), picture.height(), level.long_edge());
    let sized = if (width, height) == (picture.width(), picture.height()) { picture.clone() } else { picture.resize_exact(width, height, FilterType::CatmullRom) };
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, level.quality()).encode_image(&sized.to_rgb8())
        .map_err(|_| "A preview could not be encoded.".to_string())?;
    Ok(with_comment(jpeg, comment))
}

/// Write the pictures beside the entry, then swap the folder in whole, so a reader never sees half an entry.
fn store(root: &Path, key: &str, picture: &DynamicImage, made_from: &str, comment: Option<&[u8]>) -> Result<(), String> {
    let dir = entry_dir(root, key);
    let staging = dir.with_extension(format!("tmp-{}-{:?}", std::process::id(), std::thread::current().id()).replace(['(', ')'], ""));
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging).map_err(|_| "The preview folder could not be written.".to_string())?;
    let result = (|| {
        for level in Level::ALL {
            fs::write(staging.join(level.file()), encode(picture, level, comment)?).map_err(|_| "A preview could not be saved.".to_string())?;
        }
        let meta = Meta { version: CACHE_VERSION, key: key.to_string(), made_from: made_from.to_string(), width: picture.width(), height: picture.height() };
        fs::write(staging.join("meta.json"), serde_json::to_vec(&meta).map_err(|error| error.to_string())?)
            .map_err(|_| "A preview could not be saved.".to_string())?;
        let _ = fs::remove_dir_all(&dir);
        fs::rename(&staging, &dir).map_err(|_| "The preview folder could not be written.".to_string())
    })();
    if result.is_err() { let _ = fs::remove_dir_all(&staging); }
    result
}

fn codec_of(bytes: &[u8], extension: &str) -> Option<&'static str> {
    if extension != "nef" { return None; }
    let verdict = std::panic::catch_unwind(|| kestrel_raw::nikon_he::prefix_verdict(bytes, bytes.len()))
        .unwrap_or(kestrel_raw::nikon_he::PrefixVerdict::NotHighEfficiency);
    Some(match verdict {
        kestrel_raw::nikon_he::PrefixVerdict::HighEfficiency(mode) => mode.label(),
        _ => "other",
    })
}

/// Make one photo's previews. `develop` turns RAW bytes into a JPEG (the screen-size develop in the app; a stand-in
/// in tests, which have no camera files).
pub fn build_one(root: &Path, request: &BuildRequest, develop: &(dyn Fn(&[u8], &str) -> Result<Vec<u8>, String> + Sync)) -> BuildResult {
    let failed = |error: String| BuildResult { key: request.key.clone(), status: "failed", made_from: None, codec: None, error: Some(error) };
    if request.key.is_empty() || request.key.len() > 4096 { return failed("No cache key was given.".into()); }
    if is_complete(root, &request.key) {
        touch(root, &request.key);
        return BuildResult { key: request.key.clone(), status: "cached", made_from: None, codec: None, error: None };
    }
    let path = Path::new(&request.path);
    let (bytes, extension) = match read_original(path, request.size) { Ok(read) => read, Err(error) => return failed(error) };
    if let Some(expected) = request.sha256.as_deref() {
        let digest = Sha256::digest(&bytes);
        let actual: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
        if !actual.eq_ignore_ascii_case(expected.trim()) {
            return failed("The file at this path is not the photo that was added, so no preview was made.".into());
        }
    }
    let raw = RAW_EXTENSIONS.contains(&extension.as_str());
    let codec = if raw { codec_of(&bytes, &extension) } else { None };
    // A decoder can panic on a damaged file; that becomes this photo's error, never the app's.
    let made = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> Result<(DynamicImage, Option<Vec<u8>>), String> {
        if raw {
            let jpeg = develop(&bytes, &extension)?;
            let comment = jpeg_comment(&jpeg);
            let picture = image::load_from_memory_with_format(&jpeg, ImageFormat::Jpeg).map_err(|_| "The developed picture could not be read.".to_string())?;
            Ok((picture, comment))
        } else {
            let picture = ImageReader::new(Cursor::new(&bytes)).with_guessed_format().map_err(|_| "This picture could not be read.".to_string())?
                .decode().map_err(|_| "This picture could not be read.".to_string())?;
            Ok((picture, None))
        }
    })).unwrap_or_else(|_| Err("This file could not be read.".into()));
    let (picture, comment) = match made { Ok(made) => made, Err(error) => return BuildResult { codec, ..failed(error) } };
    drop(bytes);
    let made_from = if raw { "raw" } else { "picture" };
    match store(root, &request.key, &picture, made_from, comment.as_deref()) {
        Ok(()) => BuildResult { key: request.key.clone(), status: "built", made_from: Some(made_from), codec, error: None },
        Err(error) => BuildResult { codec, ..failed(error) },
    }
}

/// Build many at once on `threads` threads (from the page's memory budget). Results come back in the order asked.
pub fn build_many(root: &Path, requests: &[BuildRequest], threads: usize, develop: &(dyn Fn(&[u8], &str) -> Result<Vec<u8>, String> + Sync)) -> Vec<BuildResult> {
    use rayon::prelude::*;
    let pool = rayon::ThreadPoolBuilder::new().num_threads(threads.clamp(1, 8)).build();
    match pool {
        Ok(pool) => pool.install(|| requests.par_iter().map(|request| build_one(root, request, develop)).collect()),
        Err(_) => requests.iter().map(|request| build_one(root, request, develop)).collect(),
    }
}

fn touch(root: &Path, key: &str) {
    let meta = entry_dir(root, key).join("meta.json");
    if let Ok(file) = fs::OpenOptions::new().append(true).open(&meta) { let _ = file.set_modified(SystemTime::now()); }
}

/// One stored picture, or None. Reading counts as use for the size limit.
pub fn read(root: &Path, key: &str, level: Level) -> Option<Vec<u8>> {
    if !is_complete(root, key) { return None; }
    let bytes = fs::read(entry_dir(root, key).join(level.file())).ok()?;
    touch(root, key);
    Some(bytes)
}

/// Turn every stored picture of an entry by a quarter, half or three-quarter turn (clockwise), to match the camera's own
/// preview where a camera's rotation flag says "normal" for an upright portrait. Keeps the decoder's comment.
pub fn rotate(root: &Path, key: &str, degrees: u32) -> Result<(), String> {
    if degrees % 360 == 0 { return Ok(()); }
    if !is_complete(root, key) { return Err("There is no stored preview to turn.".into()); }
    let dir = entry_dir(root, key);
    for level in Level::ALL {
        let file = dir.join(level.file());
        let jpeg = fs::read(&file).map_err(|_| "A preview could not be read.".to_string())?;
        let comment = jpeg_comment(&jpeg);
        let picture = image::load_from_memory_with_format(&jpeg, ImageFormat::Jpeg).map_err(|_| "A preview could not be read.".to_string())?;
        let turned = match degrees % 360 { 90 => picture.rotate90(), 180 => picture.rotate180(), 270 => picture.rotate270(), _ => return Err("Only quarter turns are allowed.".into()) };
        let out = encode(&turned, level, comment.as_deref())?;
        let staged = file.with_extension("jpg.tmp");
        fs::write(&staged, out).and_then(|_| fs::rename(&staged, &file)).map_err(|_| "A preview could not be saved.".to_string())?;
    }
    Ok(())
}

struct Entry { dir: PathBuf, bytes: u64, used: SystemTime }

fn entries(root: &Path) -> Vec<Entry> {
    let Ok(list) = fs::read_dir(root) else { return Vec::new() };
    list.filter_map(Result::ok).filter(|item| item.file_type().map(|kind| kind.is_dir()).unwrap_or(false)).map(|item| {
        let dir = item.path();
        let bytes = fs::read_dir(&dir).map(|files| files.filter_map(Result::ok).filter_map(|file| file.metadata().ok()).map(|info| info.len()).sum()).unwrap_or(0);
        let used = fs::metadata(dir.join("meta.json")).and_then(|info| info.modified()).unwrap_or(SystemTime::UNIX_EPOCH);
        Entry { dir, bytes, used }
    }).collect()
}

pub fn usage(root: &Path) -> Usage {
    let list = entries(root);
    Usage { bytes: list.iter().map(|entry| entry.bytes).sum(), entries: list.len() as u64 }
}

/// Remove the least recently used entries until the cache fits `limit` bytes. Only ever deletes inside `root`.
pub fn trim(root: &Path, limit: u64) -> Usage {
    let mut list = entries(root);
    list.sort_by_key(|entry| entry.used);
    let mut total: u64 = list.iter().map(|entry| entry.bytes).sum();
    let mut kept = list.len() as u64;
    for entry in &list {
        if total <= limit { break; }
        if entry.dir.parent() != Some(root) { continue; }
        if fs::remove_dir_all(&entry.dir).is_ok() { total = total.saturating_sub(entry.bytes); kept -= 1; }
    }
    Usage { bytes: total, entries: kept }
}

/// Remove every stored preview. Originals, projects and edits are untouched: this is only the app's own folder.
pub fn clear(root: &Path) -> Usage {
    for entry in entries(root) {
        if entry.dir.parent() == Some(root) { let _ = fs::remove_dir_all(&entry.dir); }
    }
    usage(root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, RgbImage};

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kestrel-preview-cache-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn synthetic_jpeg(width: u32, height: u32) -> Vec<u8> {
        let picture = RgbImage::from_fn(width, height, |x, y| Rgb([(x % 256) as u8, (y % 256) as u8, 128]));
        let mut out = Vec::new();
        JpegEncoder::new_with_quality(&mut out, 90).encode_image(&picture).unwrap();
        out
    }

    fn no_raw(_: &[u8], _: &str) -> Result<Vec<u8>, String> { Err("no RAW decoder in this test".into()) }

    fn dims(jpeg: &[u8]) -> (u32, u32) {
        let picture = image::load_from_memory_with_format(jpeg, ImageFormat::Jpeg).unwrap();
        (picture.width(), picture.height())
    }

    #[test]
    fn builds_three_sizes_from_a_path_and_never_changes_the_original() {
        let dir = scratch("sizes");
        let root = dir.join("previews");
        let original = dir.join("photo.jpg");
        let bytes = synthetic_jpeg(4000, 3000);
        fs::write(&original, &bytes).unwrap();
        let modified = fs::metadata(&original).unwrap().modified().unwrap();
        let request = BuildRequest { key: "k1".into(), path: original.to_string_lossy().into(), size: Some(bytes.len() as u64), sha256: Some(Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect()) };
        let result = build_one(&root, &request, &no_raw);
        assert_eq!(result.status, "built", "{result:?}");
        assert_eq!(dims(&read(&root, "k1", Level::Thumb).unwrap()), (400, 300));
        assert_eq!(dims(&read(&root, "k1", Level::Review).unwrap()), (2200, 1650));
        assert_eq!(dims(&read(&root, "k1", Level::Smart).unwrap()), (2560, 1920));
        assert_eq!(fs::read(&original).unwrap(), bytes, "the original's bytes changed");
        assert_eq!(fs::metadata(&original).unwrap().modified().unwrap(), modified, "the original was touched");
        assert_eq!(build_one(&root, &request, &no_raw).status, "cached");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_small_picture_is_never_enlarged() {
        assert_eq!(fit(1200, 800, 2560), (1200, 800));
        assert_eq!(fit(800, 1200, 400), (267, 400));
        assert_eq!(fit(0, 0, 400), (1, 1));
    }

    #[test]
    fn refuses_a_changed_file_and_unknown_types_before_making_anything() {
        let dir = scratch("refuse");
        let root = dir.join("previews");
        let original = dir.join("photo.jpg");
        fs::write(&original, synthetic_jpeg(64, 48)).unwrap();
        let changed = BuildRequest { key: "k".into(), path: original.to_string_lossy().into(), size: Some(1), sha256: None };
        assert_eq!(build_one(&root, &changed, &no_raw).status, "failed");
        let other_bytes = BuildRequest { key: "h".into(), path: original.to_string_lossy().into(), size: None, sha256: Some("00".repeat(32)) };
        assert!(build_one(&root, &other_bytes, &no_raw).error.unwrap().contains("not the photo"));
        assert_eq!(build_one(&root, &changed, &no_raw).status, "failed");
        let text = dir.join("notes.txt");
        fs::write(&text, b"hello").unwrap();
        let other = BuildRequest { key: "t".into(), path: text.to_string_lossy().into(), size: None, sha256: None };
        assert_eq!(build_one(&root, &other, &no_raw).status, "failed");
        let missing = BuildRequest { key: "m".into(), path: dir.join("gone.nef").to_string_lossy().into(), size: None, sha256: None };
        assert_eq!(build_one(&root, &missing, &no_raw).status, "failed");
        assert_eq!(usage(&root).entries, 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn raw_files_are_developed_here_and_keep_the_decoders_comment() {
        let dir = scratch("raw");
        let root = dir.join("previews");
        let original = dir.join("photo.dng");
        fs::write(&original, b"synthetic sensor data").unwrap();
        let comment = b"InFlight-AsShotWhite/1 {\"kelvin\":5200,\"duv\":0.001}".to_vec();
        let expected = comment.clone();
        let develop = move |bytes: &[u8], extension: &str| -> Result<Vec<u8>, String> {
            assert_eq!(bytes, b"synthetic sensor data");
            assert_eq!(extension, "dng");
            Ok(with_comment(synthetic_jpeg(3000, 2000), Some(&comment)))
        };
        let request = BuildRequest { key: "raw".into(), path: original.to_string_lossy().into(), size: None, sha256: None };
        let result = build_one(&root, &request, &develop);
        assert_eq!((result.status, result.made_from), ("built", Some("raw")));
        for level in Level::ALL { assert_eq!(jpeg_comment(&read(&root, "raw", level).unwrap()).unwrap(), expected); }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_decoder_panic_is_one_photos_error() {
        let dir = scratch("panic");
        let root = dir.join("previews");
        let original = dir.join("photo.nef");
        fs::write(&original, b"damaged").unwrap();
        let develop = |_: &[u8], _: &str| -> Result<Vec<u8>, String> { panic!("damaged file") };
        let request = BuildRequest { key: "p".into(), path: original.to_string_lossy().into(), size: None, sha256: None };
        let result = build_one(&root, &request, &develop);
        assert_eq!(result.status, "failed");
        assert_eq!(result.codec, Some("other"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn builds_in_parallel_in_the_order_asked() {
        let dir = scratch("parallel");
        let root = dir.join("previews");
        let requests: Vec<_> = (0..6).map(|index| {
            let path = dir.join(format!("p{index}.png"));
            image::DynamicImage::ImageRgb8(RgbImage::new(300 + index, 200)).save(&path).unwrap();
            BuildRequest { key: format!("k{index}"), path: path.to_string_lossy().into(), size: None, sha256: None }
        }).collect();
        let results = build_many(&root, &requests, 3, &no_raw);
        assert_eq!(results.iter().map(|result| result.key.as_str()).collect::<Vec<_>>(), ["k0", "k1", "k2", "k3", "k4", "k5"]);
        assert!(results.iter().all(|result| result.status == "built"));
        assert_eq!(usage(&root).entries, 6);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_size_limit_removes_the_least_recently_used_first() {
        let dir = scratch("trim");
        let root = dir.join("previews");
        for index in 0..3 {
            let path = dir.join(format!("p{index}.jpg"));
            fs::write(&path, synthetic_jpeg(800, 600)).unwrap();
            build_one(&root, &BuildRequest { key: format!("k{index}"), path: path.to_string_lossy().into(), size: None, sha256: None }, &no_raw);
            let meta = entry_dir(&root, &format!("k{index}")).join("meta.json");
            let when = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_000_000 + index as u64 * 100);
            fs::OpenOptions::new().append(true).open(meta).unwrap().set_modified(when).unwrap();
        }
        // k0 is used again, so k1 is now the oldest.
        assert!(read(&root, "k0", Level::Thumb).is_some());
        let one = usage(&root).bytes / 3;
        let left = trim(&root, one * 2 + one / 2);
        assert_eq!(left.entries, 2);
        assert!(is_complete(&root, "k0") && !is_complete(&root, "k1") && is_complete(&root, "k2"));
        assert_eq!(clear(&root).entries, 0);
        assert!(dir.join("p0.jpg").exists(), "clearing previews removed an original");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn turning_keeps_sizes_and_comment() {
        let dir = scratch("turn");
        let root = dir.join("previews");
        let original = dir.join("photo.nef");
        fs::write(&original, b"sensor").unwrap();
        let develop = |_: &[u8], _: &str| -> Result<Vec<u8>, String> { Ok(with_comment(synthetic_jpeg(3000, 2000), Some(b"note"))) };
        build_one(&root, &BuildRequest { key: "r".into(), path: original.to_string_lossy().into(), size: None, sha256: None }, &develop);
        rotate(&root, "r", 90).unwrap();
        assert_eq!(dims(&read(&root, "r", Level::Smart).unwrap()), (1707, 2560));
        assert_eq!(dims(&read(&root, "r", Level::Thumb).unwrap()), (267, 400));
        assert_eq!(jpeg_comment(&read(&root, "r", Level::Review).unwrap()).unwrap(), b"note");
        assert!(rotate(&root, "r", 45).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn keys_never_form_paths() {
        let root = Path::new("/cache");
        for key in ["../../etc", "a/b", "C:\\x", ""] {
            let dir = entry_dir(root, key);
            assert_eq!(dir.parent(), Some(root));
            assert_eq!(dir.file_name().unwrap().len(), 32);
        }
    }
}
