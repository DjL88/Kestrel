//! The pinned model pack: what files it must contain, how to check them, and one safe way to run them.
//! Every file is checked for size and SHA-256 against the pinned manifest before anything is loaded; a missing, resized or
//! altered file stops the load with a plain message. Nothing here downloads anything or touches the network.
use crate::VisionModel;
use image::RgbImage;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const REVISION: &str = "4cde9d208e19";
pub const REVISION_FULL: &str = "4cde9d208e19519c36917aa170fffc7e381aa0ad";
/// File, size and SHA-256, pinned from `scripts/models/manifest.json` (the tokenizer's from the verified download).
pub const PACK: [(&str, u64, &str); 4] = [
    ("onnx/vision_encoder_int8.onnx", 98_966_476, "d931eb204e21ab4d905d62976aeaefe20360076f52760ba55b84a5b35088284f"),
    ("onnx/embed_tokens_int8.onnx", 47_309_344, "0e6d275190cd1cdf3339225b98b42116871ddc4e0c3210801f02bf2a1d2e164a"),
    ("onnx/decoder_model_merged_int8.onnx", 365_039_224, "7d0a356562c7e474012c5e383de58d44d487a517c04190d26e5891db86cb2b1f"),
    ("tokenizer.json", 3_548_256, "5ece781dc8d2b2f3e2f289ca0ae50b17cfc27dd27bfe7971bb8241e0b964331a"),
];
pub const MAX_PHOTO_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_QUESTION: usize = 400;
pub const DEFAULT_QUESTION: &str = "In two short plain sentences: what is the main subject, and is the light and colour natural?";

/// The loaded model, kept between calls so only the first check pays the load.
#[derive(Default)]
pub struct Engine {
    loaded: Mutex<Option<(PathBuf, VisionModel)>>,
    measured: Mutex<Measured>,
}

/// What this process has actually measured, for Settings (#703). Nothing here is typed in: every number comes from a clock
/// or the operating system during a real load or run, and stays `None` until it has been measured.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Measured {
    /// True once every file passed the full SHA-256 check in this session (it runs before the first load).
    pub digests_verified: bool,
    pub load_ms: Option<u128>,
    /// Resident memory the process gained while the model loaded, from the operating system.
    pub load_ram_bytes: Option<u64>,
    /// Resident memory of the whole app after the latest run.
    pub process_ram_bytes: Option<u64>,
    pub vision_ms: Option<u128>,
    pub generate_ms: Option<u128>,
    pub new_tokens: Option<usize>,
    pub runs: u32,
}

/// Resident memory of this process, or `None` where the operating system does not say.
pub fn process_ram_bytes() -> Option<u64> {
    memory_stats::memory_stats().map(|stats| stats.physical_mem as u64)
}

/// A plain synthetic test card (no photo of anyone's): a smooth colour ramp with a darker disc as a subject, 512 x 384.
pub fn test_card() -> RgbImage {
    RgbImage::from_fn(512, 384, |x, y| {
        let (dx, dy) = (x as f32 - 256.0, y as f32 - 192.0);
        let inside = dx * dx + dy * dy < 90.0 * 90.0;
        let (r, g, b) = ((x * 255 / 511) as u8, (y * 255 / 383) as u8, 160u8);
        if inside { image::Rgb([r / 3, g / 3, 60]) } else { image::Rgb([r, g, b]) }
    })
}

fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 { break; }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect())
}

/// Every file present, the right size and the right digest. Returns the first problem in plain words.
pub fn verify(dir: &Path) -> Result<(), String> {
    for (name, bytes, digest) in PACK {
        let path = dir.join(name);
        let meta = std::fs::metadata(&path).map_err(|_| format!("The vision model is not installed ({name} is missing)."))?;
        if meta.len() != bytes { return Err(format!("The vision model file {name} is the wrong size, so it was not used.")); }
        if sha256_file(&path).map_err(|_| format!("The vision model file {name} could not be read."))? != digest {
            return Err(format!("The vision model file {name} does not match its checksum, so it was not used."));
        }
    }
    Ok(())
}

/// Cheap check for the status line: every file is there and the right size. The full digest check happens before the first load.
pub fn verify_installed(dir: &Path) -> bool {
    PACK.iter().all(|(name, bytes, _)| std::fs::metadata(dir.join(name)).map(|m| m.len() == *bytes).unwrap_or(false))
}

impl Engine {
    pub fn is_loaded(&self) -> bool { self.loaded.lock().map(|guard| guard.is_some()).unwrap_or(false) }

    /// The whole job: check the pack, load the model once, look at one photo.
    pub fn run(&self, dir: &Path, bytes: &[u8], question: &str) -> Result<serde_json::Value, String> {
        let photo = image::load_from_memory(bytes).map_err(|_| "This photo could not be read.".to_string())?.to_rgb8();
        self.run_image(dir, &photo, question)
    }

    /// Settings' "Measure on this device": the same load and run as a real check, on the synthetic test card.
    pub fn measure(&self, dir: &Path) -> Result<serde_json::Value, String> {
        self.run_image(dir, &test_card(), DEFAULT_QUESTION)
    }

    /// The latest measurements, as JSON for the window. Unmeasured values are `null`, never zero.
    pub fn metrics(&self) -> serde_json::Value {
        let m = self.measured.lock().map(|guard| guard.clone()).unwrap_or_default();
        let files: Vec<_> = PACK.iter().map(|(name, bytes, digest)| serde_json::json!({ "name": name, "bytes": bytes, "sha256": digest })).collect();
        serde_json::json!({
            "revision": REVISION_FULL, "files": files, "loaded": self.is_loaded(), "digestsVerified": m.digests_verified,
            "loadMs": m.load_ms, "loadRamBytes": m.load_ram_bytes, "processRamBytes": m.process_ram_bytes,
            "visionMs": m.vision_ms, "generateMs": m.generate_ms, "newTokens": m.new_tokens, "runs": m.runs,
        })
    }

    fn run_image(&self, dir: &Path, photo: &RgbImage, question: &str) -> Result<serde_json::Value, String> {
        let mut guard = self.loaded.lock().map_err(|_| "The vision model is busy.".to_string())?;
        if guard.as_ref().map(|(held, _)| held != dir).unwrap_or(true) {
            *guard = None;
            verify(dir)?;
            let before = process_ram_bytes();
            let threads = std::thread::available_parallelism().map(|n| n.get().min(4)).unwrap_or(2);
            let model = VisionModel::load(dir, threads).map_err(|_| "The vision model could not be loaded.".to_string())?;
            let after = process_ram_bytes();
            if let Ok(mut m) = self.measured.lock() {
                *m = Measured {
                    digests_verified: true, load_ms: Some(model.load_ms),
                    load_ram_bytes: before.zip(after).map(|(b, a)| a.saturating_sub(b)), ..Measured::default()
                };
            }
            *guard = Some((dir.to_path_buf(), model));
        }
        let model = &mut guard.as_mut().unwrap().1;
        let described = model.describe(photo, question, 60).map_err(|_| "The vision model could not check this photo.".to_string())?;
        if let Ok(mut m) = self.measured.lock() {
            m.vision_ms = Some(described.vision_ms);
            m.generate_ms = Some(described.generate_ms);
            m.new_tokens = Some(described.new_tokens);
            m.process_ram_bytes = process_ram_bytes();
            m.runs += 1;
        }
        Ok(serde_json::json!({
            "text": described.text, "promptTokens": described.prompt_tokens, "newTokens": described.new_tokens,
            "loadMs": model.load_ms, "visionMs": described.vision_ms, "generateMs": described.generate_ms, "revision": REVISION_FULL,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kite44-vision-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("onnx")).unwrap();
        dir
    }

    #[test]
    fn a_missing_pack_is_reported_as_not_installed_and_never_loaded() {
        let dir = temp("missing");
        assert!(verify(&dir).unwrap_err().contains("not installed"));
        let engine = Engine::default();
        assert!(engine.run(&dir, b"x", "q").unwrap_err().contains("not installed"));
        assert!(!engine.is_loaded(), "nothing is loaded from a pack that failed its check");
        let metrics = engine.metrics();
        assert_eq!(metrics["digestsVerified"], false);
        assert!(metrics["loadMs"].is_null() && metrics["visionMs"].is_null() && metrics["loadRamBytes"].is_null(), "nothing unmeasured is shown as a number");
        assert_eq!(metrics["runs"], 0);
        assert_eq!(metrics["files"].as_array().unwrap().len(), PACK.len());
        assert_eq!(metrics["files"][2]["sha256"], PACK[2].2);
    }

    #[test]
    fn the_test_card_is_synthetic_and_the_process_reports_its_memory() {
        let card = test_card();
        assert_eq!(card.dimensions(), (512, 384));
        assert_ne!(card.get_pixel(0, 0), card.get_pixel(256, 192), "the card has a visible subject");
        assert!(process_ram_bytes().map(|bytes| bytes > 0).unwrap_or(true));
    }

    #[test]
    fn a_file_of_the_wrong_size_is_refused() {
        let dir = temp("tampered");
        for (name, _, _) in PACK { std::fs::write(dir.join(name), b"not the model").unwrap(); }
        assert!(verify(&dir).unwrap_err().contains("wrong size"));
        assert!(!verify_installed(&dir));
    }

    /// Needs the real pack and a photo: `KESTREL_MODELS_DIR=... KESTREL_TEST_PHOTO=/path/photo.jpg cargo test --release real_pack -- --ignored --nocapture`.
    /// Run it with the network denied to prove the on-device path works offline.
    #[test]
    #[ignore]
    fn real_pack_reads_a_real_photo() {
        let photo = std::fs::read(std::env::var("KESTREL_TEST_PHOTO").expect("KESTREL_TEST_PHOTO")).unwrap();
        let base = std::env::var("KESTREL_MODELS_DIR").expect("KESTREL_MODELS_DIR");
        let dir = Path::new(&base).join("smolvlm2-500m").join(REVISION);
        let engine = Engine::default();
        let started = std::time::Instant::now();
        let first = engine.run(&dir, &photo, DEFAULT_QUESTION).expect("first check");
        let first_ms = started.elapsed().as_millis();
        let second_started = std::time::Instant::now();
        let second = engine.run(&dir, &photo, DEFAULT_QUESTION).expect("second check");
        let metrics = engine.metrics();
        assert_eq!(metrics["digestsVerified"], true);
        assert!(metrics["loadMs"].as_u64().is_some() && metrics["visionMs"].as_u64().is_some());
        assert_eq!(metrics["runs"], 2);
        println!("METRICS {metrics}");
        println!("OFFLINE_PROOF first_ms={first_ms} (verify+load+answer) second_ms={} (model already loaded)\nfirst={first}\nsecond={second}", second_started.elapsed().as_millis());
        assert_eq!(first["text"], second["text"], "greedy decoding gives the same answer for the same photo");
        assert!(!first["text"].as_str().unwrap().is_empty());
    }
}
