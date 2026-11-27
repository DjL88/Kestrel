//! Import reads done here rather than through the page, one call for many small things.
//!
//! Importing a folder of 2,000 RAWs used to make tens of thousands of calls across the bridge: one `stat` per photo
//! while the folder was looked through (8 at a time), then a seek and a read per MiB to fingerprint each original. On
//! the owner's Windows laptop that ran at about 4 photos a minute with the CPU nearly idle: the time went on round trips,
//! not work. Here the same facts come back in one call: the size and modified time of a whole batch of photos, and a
//! photo's SHA-256, read once at the drive's own speed. No bytes of the photo cross the bridge, and nothing is written.
//!
//! Only paths the person has already granted (the folder or files they chose, which the dialog adds to the file-system
//! scope) are read, the same boundary as the page's own file reads.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::Path;
use std::time::UNIX_EPOCH;

/// Size and modified time (ms since 1970, 0 when the file system records none) of one photo.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PhotoStat { pub size: u64, pub modified_ms: f64 }

/// A photo's fingerprint and the size and time it had while it was read.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Fingerprint { pub sha256: String, pub size: u64, pub modified_ms: f64 }

/// The most paths one `photo_stats` call answers (a 2,000-photo folder is one call).
pub const MAX_STAT_PATHS: usize = 20_000;

fn modified_ms(info: &fs::Metadata) -> f64 {
    info.modified().ok().and_then(|time| time.duration_since(UNIX_EPOCH).ok()).map_or(0.0, |since| since.as_millis() as f64)
}

/// The size and modified time of each path that is a readable file, in the order given; None for anything else.
pub fn stats(paths: &[String], allowed: &dyn Fn(&Path) -> bool) -> Vec<Option<PhotoStat>> {
    paths.iter().map(|path| {
        let path = Path::new(path);
        if !allowed(path) { return None; }
        let info = fs::metadata(path).ok()?;
        info.is_file().then(|| PhotoStat { size: info.len(), modified_ms: modified_ms(&info) })
    }).collect()
}

/// SHA-256 of the exact bytes, read in 1 MiB pieces (never the whole file in memory). Refused when the file is not the
/// size the page expects, or changes size or time while it is read: a fingerprint must describe one, unchanged file.
pub fn fingerprint(path: &Path, expected_size: Option<u64>) -> Result<Fingerprint, String> {
    let before = fs::metadata(path).map_err(|_| "The original is not reachable. Is its drive connected?".to_string())?;
    if !before.is_file() { return Err("This is not a photo file.".into()); }
    if let Some(size) = expected_size {
        if size != before.len() { return Err("The file at this path is not the size it was when it was added.".into()); }
    }
    let mut file = fs::File::open(path).map_err(|_| "The original could not be read.".to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    let mut read_total: u64 = 0;
    loop {
        let count = file.read(&mut buffer).map_err(|_| "The original could not be read.".to_string())?;
        if count == 0 { break; }
        hasher.update(&buffer[..count]);
        read_total += count as u64;
    }
    let after = fs::metadata(path).map_err(|_| "The original is not reachable. Is its drive connected?".to_string())?;
    if read_total != before.len() || after.len() != before.len() || modified_ms(&after) != modified_ms(&before) {
        return Err("The original changed while it was read.".into());
    }
    let sha256 = hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect();
    Ok(Fingerprint { sha256, size: read_total, modified_ms: modified_ms(&after) })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("kestrel-import-io-{}-{name}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn fingerprint_is_the_sha256_of_the_exact_bytes() {
        // Bigger than one read piece, so the streaming is exercised.
        let bytes: Vec<u8> = (0..(3 * 1024 * 1024 + 17)).map(|i| (i * 31 % 251) as u8).collect();
        let path = temp_file("photo.nef", &bytes);
        let expected: String = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
        let found = fingerprint(&path, Some(bytes.len() as u64)).unwrap();
        assert_eq!(found.sha256, expected);
        assert_eq!(found.size, bytes.len() as u64);
        assert!(fingerprint(&path, Some(5)).is_err(), "a different size is a different file");
        assert!(fingerprint(&path.with_file_name("missing.nef"), None).is_err());
    }

    #[test]
    fn stats_answer_only_granted_files_in_order() {
        let a = temp_file("a.nef", b"12345");
        let b = temp_file("b.nef", b"1");
        let paths = vec![a.to_string_lossy().into_owned(), "Z:/not/here.nef".into(), b.to_string_lossy().into_owned(), a.parent().unwrap().to_string_lossy().into_owned()];
        let all = stats(&paths, &|_| true);
        assert_eq!(all[0].as_ref().map(|s| s.size), Some(5));
        assert_eq!(all[1], None, "a missing file");
        assert_eq!(all[2].as_ref().map(|s| s.size), Some(1));
        assert_eq!(all[3], None, "a folder is not a photo");
        assert!(all[0].as_ref().unwrap().modified_ms > 0.0);
        let only_b = stats(&paths, &|path| path.ends_with("b.nef"));
        assert_eq!(only_b.iter().filter(|s| s.is_some()).count(), 1, "paths outside the granted scope are not read");
    }
}
