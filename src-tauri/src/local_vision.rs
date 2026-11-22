//! #703: the on-device vision model for the desktop app. The pinned pack, its checksums and the run logic live in the
//! `kestrel-vision` crate (`pack.rs`), where they are tested; this file is only the window-facing commands.
//! No network is used, nothing is downloaded here, and the answer is only an observation for the page to validate.
use kestrel_vision::pack::{verify_installed, Engine, DEFAULT_QUESTION, MAX_PHOTO_BYTES, MAX_QUESTION, REVISION, REVISION_FULL};
use std::path::PathBuf;
use std::sync::Arc;

#[derive(Default)]
pub struct VisionState {
    engine: Arc<Engine>,
}

/// Where the model folder is: `KESTREL_MODELS_DIR` if set, otherwise `~/kestrel-models`.
fn pack_dir() -> Option<PathBuf> {
    let base = std::env::var_os("KESTREL_MODELS_DIR").map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(|home| PathBuf::from(home).join("kestrel-models")))?;
    Some(base.join("smolvlm2-500m").join(REVISION))
}

#[tauri::command]
pub fn local_vision_status() -> serde_json::Value {
    let installed = pack_dir().map(|dir| verify_installed(&dir)).unwrap_or(false);
    serde_json::json!({ "installed": installed, "revision": REVISION_FULL, "runtime": "onnxruntime (CPU)", "model": "SmolVLM2-500M-Video-Instruct int8", "licence": "Apache-2.0" })
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
    let engine = Arc::clone(&state.engine);
    // A damaged photo or model must become a message, not a crash; and nothing else blocks the window while it thinks.
    tauri::async_runtime::spawn_blocking(move || engine.run(&dir, &bytes, &question))
        .await.map_err(|_| "The vision model stopped unexpectedly.".to_string())?
}
