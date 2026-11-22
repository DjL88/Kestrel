//! #703: a local vision-language model (SmolVLM2-500M, int8) that looks at one photo and answers in plain text.
//! It runs here, on this device, with no network. The model files are never downloaded by this code: they must already
//! be in the models folder (placed by `scripts/models/acquire.py` or the app's consented installer), and every file is
//! checked against the pinned SHA-256 before the model is loaded. The answer is only an observation; the page validates it
//! and it can never run, fetch or edit anything by itself.
use kestrel_vision::VisionModel;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub const REVISION: &str = "4cde9d208e19";
const REVISION_FULL: &str = "4cde9d208e19519c36917aa170fffc7e381aa0ad";
/// File, size and SHA-256, pinned from `scripts/models/manifest.json` (the tokenizer's from the verified download).
const PACK: [(&str, u64, &str); 4] = [
    ("onnx/vision_encoder_int8.onnx", 98_966_476, "d931eb204e21ab4d905d62976aeaefe20360076f52760ba55b84a5b35088284f"),
    ("onnx/embed_tokens_int8.onnx", 47_309_344, "0e6d275190cd1cdf3339225b98b42116871ddc4e0c3210801f02bf2a1d2e164a"),
    ("onnx/decoder_model_merged_int8.onnx", 365_039_224, "7d0a356562c7e474012c5e383de58d44d487a517c04190d26e5891db86cb2b1f"),
    ("tokenizer.json", 3_548_256, "5ece781dc8d2b2f3e2f289ca0ae50b17cfc27dd27bfe7971bb8241e0b964331a"),
];
const MAX_PHOTO_BYTES: usize = 64 * 1024 * 1024;
const MAX_QUESTION: usize = 400;
const DEFAULT_QUESTION: &str = "In two short plain sentences: what is the main subject, and is the light and colour natural?";

#[derive(Default)]
pub struct VisionState {
    loaded: Arc<Mutex<Option<(PathBuf, VisionModel)>>>,
}

/// Where the model folder is: `KESTREL_MODELS_DIR` if set, otherwise `~/kestrel-models`.
fn pack_dir() -> Option<PathBuf> {
    let base = std::env::var_os("KESTREL_MODELS_DIR").map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(|home| PathBuf::from(home).join("kestrel-models")))?;
    Some(base.join("smolvlm2-500m").join(REVISION))
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
fn verify(dir: &Path) -> Result<(), String> {
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

#[tauri::command]
pub fn local_vision_status() -> serde_json::Value {
    let dir = pack_dir();
    let present = dir.as_ref().map(|dir| PACK.iter().all(|(name, bytes, _)| std::fs::metadata(dir.join(name)).map(|m| m.len() == *bytes).unwrap_or(false))).unwrap_or(false);
    serde_json::json!({ "installed": present, "revision": REVISION_FULL, "runtime": "onnxruntime (CPU)", "model": "SmolVLM2-500M-Video-Instruct int8", "licence": "Apache-2.0" })
}

/// A photo as JPEG/PNG bytes in the body; optional `x-question` header (plain ASCII, short). Returns the observation and timings.
#[tauri::command]
pub async fn local_vision_describe(request: tauri::ipc::Request<'_>, state: tauri::State<'_, VisionState>) -> Result<serde_json::Value, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("No photo was sent.".into()) };
    if bytes.is_empty() || bytes.len() > MAX_PHOTO_BYTES { return Err("This photo is too large to check here.".into()); }
    let bytes = bytes.to_vec();
    let question = request.headers().get("x-question").and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty() && value.len() <= MAX_QUESTION && value.chars().all(|c| c.is_ascii() && !c.is_ascii_control()))
        .unwrap_or(DEFAULT_QUESTION).to_string();
    let dir = pack_dir().ok_or("The models folder could not be found.")?;
    let loaded = Arc::clone(&state.loaded);
    // A damaged photo or model must become a message, not a crash; and nothing else blocks the window while it thinks.
    let result = tauri::async_runtime::spawn_blocking({
        move || -> Result<serde_json::Value, String> {
            let mut guard = loaded.lock().map_err(|_| "The vision model is busy.".to_string())?;
            if guard.as_ref().map(|(held, _)| held != &dir).unwrap_or(true) {
                verify(&dir)?;
                let threads = std::thread::available_parallelism().map(|n| n.get().min(4)).unwrap_or(2);
                let model = VisionModel::load(&dir, threads).map_err(|_| "The vision model could not be loaded.".to_string())?;
                *guard = Some((dir.clone(), model));
            }
            let model = &mut guard.as_mut().unwrap().1;
            let photo = image::load_from_memory(&bytes).map_err(|_| "This photo could not be read.".to_string())?.to_rgb8();
            let described = model.describe(&photo, &question, 60).map_err(|_| "The vision model could not check this photo.".to_string())?;
            Ok(serde_json::json!({
                "text": described.text, "promptTokens": described.prompt_tokens, "newTokens": described.new_tokens,
                "loadMs": model.load_ms, "visionMs": described.vision_ms, "generateMs": described.generate_ms, "revision": REVISION_FULL,
            }))
        }
    }).await.map_err(|_| "The vision model stopped unexpectedly.".to_string())?;
    result
}
