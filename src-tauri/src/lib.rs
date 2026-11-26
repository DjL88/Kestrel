#[cfg(target_os = "ios")]
mod ios_orientation;
#[cfg(desktop)]
use kestrel_raw::nikon_he;
#[cfg(desktop)]
mod raw;
#[cfg(desktop)]
mod oauth_loopback;
#[cfg(desktop)]
mod ftp_inbox;
#[cfg(desktop)]
mod shoot_room;
#[cfg(desktop)]
mod local_vision;
#[cfg(desktop)]
mod external_edit;
#[cfg(desktop)]
mod preview_cache;
#[cfg(desktop)]
pub use kestrel_raw::scene_develop;
#[cfg(desktop)]
pub mod raw_precision;
#[cfg(desktop)]
mod app_menu;
#[cfg(desktop)]
use tauri::{Emitter, Manager};
#[cfg(desktop)]
use tauri_plugin_fs::FsExt;

/// Photos the system asked InFlight to open (Open With, double-click, or a path on the command line) that the page has not
/// taken yet. Kept here so a file that launches the app is not lost before the page is ready to listen.
#[cfg(desktop)]
#[derive(Default)]
struct OpenedFiles(std::sync::Mutex<Vec<String>>);

/// The listener that waits for a cloud sign-in to come back to this computer. One at a time; starting again replaces it.
#[cfg(desktop)]
#[derive(Default)]
struct OauthListener(std::sync::Mutex<Option<std::net::TcpListener>>);

/// The live-shoot FTP inbox, while the person has it switched on. One at a time; starting again replaces it.
#[cfg(desktop)]
#[derive(Default)]
struct FtpInboxState(std::sync::Mutex<Option<ftp_inbox::InboxHandle>>);

#[cfg(desktop)]
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FtpInboxInfo { port: u16, addresses: Vec<String>, received: u64, last_name: Option<String> }

#[cfg(desktop)]
fn ftp_inbox_info(handle: &ftp_inbox::InboxHandle) -> FtpInboxInfo {
    use std::sync::atomic::Ordering;
    FtpInboxInfo {
        port: handle.port,
        addresses: ftp_inbox::local_addresses(),
        received: handle.counters.received.load(Ordering::SeqCst),
        last_name: handle.counters.last_name.lock().ok().and_then(|last| last.clone()),
    }
}

/// Start receiving photos from a camera over Wi-Fi into `folder` (a folder the person chose). Tries `port` first, then
/// any free port, and says which one to type into the camera.
#[cfg(desktop)]
#[tauri::command]
fn ftp_inbox_start(state: tauri::State<'_, FtpInboxState>, folder: String, user: String, password: String, port: u16) -> Result<FtpInboxInfo, String> {
    let mut slot = state.0.lock().map_err(|_| "The camera inbox is busy. Try again.".to_string())?;
    if let Some(old) = slot.take() { old.stop(); }
    let config = ftp_inbox::InboxConfig { folder: std::path::PathBuf::from(folder), user, password };
    let handle = ftp_inbox::start(config.clone(), port)
        .or_else(|_| ftp_inbox::start(config, 0))
        .map_err(|error| format!("The camera inbox could not start: {error}"))?;
    let info = ftp_inbox_info(&handle);
    *slot = Some(handle);
    Ok(info)
}

#[cfg(desktop)]
#[tauri::command]
fn ftp_inbox_status(state: tauri::State<'_, FtpInboxState>) -> Option<FtpInboxInfo> {
    state.0.lock().ok().and_then(|slot| slot.as_ref().map(ftp_inbox_info))
}

/// The live shoot room, while the photographer has it on. One at a time; starting again replaces it.
#[cfg(desktop)]
#[derive(Default)]
struct ShootRoomState(std::sync::Mutex<Option<shoot_room::RoomHandle>>);

#[cfg(desktop)]
#[derive(serde::Serialize)]
struct ShootRoomInfo { port: u16, addresses: Vec<String> }

/// Open the room for other screens on this network. `key` is the random part of the link; tries `port`, then any.
#[cfg(desktop)]
#[tauri::command]
fn shoot_room_start(state: tauri::State<'_, ShootRoomState>, key: String, title: String, port: u16) -> Result<ShootRoomInfo, String> {
    let mut slot = state.0.lock().map_err(|_| "The shoot room is busy. Try again.".to_string())?;
    if let Some(old) = slot.take() { old.stop(); }
    let handle = shoot_room::start(key.clone(), title.clone(), port)
        .or_else(|_| shoot_room::start(key, title, 0))
        .map_err(|error| format!("The shoot room could not open: {error}"))?;
    let info = ShootRoomInfo { port: handle.port, addresses: ftp_inbox::local_addresses() };
    *slot = Some(handle);
    Ok(info)
}

/// Show one frame in the room: a screen-sized JPEG as the raw body (never the original). Headers carry what it is.
#[cfg(desktop)]
#[tauri::command]
fn shoot_room_put(state: tauri::State<'_, ShootRoomState>, request: tauri::ipc::Request<'_>) -> Result<bool, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("No picture was sent.".into()) };
    let header = |name: &str| request.headers().get(name).and_then(|value| value.to_str().ok()).map(str::to_string).unwrap_or_default();
    let name = preview_cache::percent_decode(&header("x-frame-name")).unwrap_or_default();
    let rating: u8 = header("x-frame-rating").parse().unwrap_or(0);
    let slot = state.0.lock().map_err(|_| "The shoot room is busy.".to_string())?;
    let Some(room) = slot.as_ref() else { return Ok(false) };
    let mut room = room.state.lock().map_err(|_| "The shoot room is busy.".to_string())?;
    Ok(room.put(&header("x-frame-id"), &name, rating, &header("x-frame-decision"), header("x-frame-camera") == "1", bytes.to_vec()))
}

#[cfg(desktop)]
#[tauri::command]
fn shoot_room_marks(state: tauri::State<'_, ShootRoomState>, id: String, rating: u8, decision: String, removed: bool) -> bool {
    let Ok(slot) = state.0.lock() else { return false };
    let Some(room) = slot.as_ref() else { return false };
    let Ok(mut room) = room.state.lock() else { return false };
    if removed { room.remove(&id); true } else { room.set_marks(&id, rating, &decision) }
}

/// Stars and picks sent from the room since the last call, as the page sent them; the app checks each one.
#[cfg(desktop)]
#[tauri::command]
fn shoot_room_take(state: tauri::State<'_, ShootRoomState>) -> Vec<String> {
    state.0.lock().ok().and_then(|slot| slot.as_ref().and_then(|room| room.state.lock().ok().map(|mut room| room.take_marks()))).unwrap_or_default()
}

#[cfg(desktop)]
#[tauri::command]
fn shoot_room_stop(state: tauri::State<'_, ShootRoomState>) {
    if let Ok(mut slot) = state.0.lock() { if let Some(handle) = slot.take() { handle.stop(); } }
}

#[cfg(desktop)]
#[tauri::command]
fn ftp_inbox_stop(state: tauri::State<'_, FtpInboxState>) {
    if let Ok(mut slot) = state.0.lock() { if let Some(handle) = slot.take() { handle.stop(); } }
}

/// Start listening for the sign-in redirect and return the redirect address to give the provider.
#[cfg(desktop)]
#[tauri::command]
fn oauth_listen_start(state: tauri::State<'_, OauthListener>) -> Result<String, String> {
    let listener = oauth_loopback::bind(oauth_loopback::PORT).map_err(|_| "Another sign-in is already open, or something else is using the sign-in port. Close it and try again.".to_string())?;
    *state.0.lock().map_err(|_| "Sign-in is busy. Try again.".to_string())? = Some(listener);
    Ok(format!("http://localhost:{}{}", oauth_loopback::PORT, oauth_loopback::CALLBACK_PATH))
}

/// Wait for the one redirect and return its query string (`code` and `state`, or `error`). The page checks `state`.
#[cfg(desktop)]
#[tauri::command]
async fn oauth_listen_wait(state: tauri::State<'_, OauthListener>, timeout_secs: u64) -> Result<String, String> {
    let listener = state.0.lock().map_err(|_| "Sign-in is busy. Try again.".to_string())?.take().ok_or_else(|| "No sign-in is waiting.".to_string())?;
    let timeout = std::time::Duration::from_secs(timeout_secs.clamp(10, 600));
    tauri::async_runtime::spawn_blocking(move || oauth_loopback::wait_for_callback(&listener, timeout))
        .await
        .map_err(|_| "Sign-in stopped unexpectedly.".to_string())?
}

/// Stop listening, for example when the person closes the browser tab and cancels.
#[cfg(desktop)]
#[tauri::command]
fn oauth_listen_stop(state: tauri::State<'_, OauthListener>) {
    if let Ok(mut held) = state.0.lock() { *held = None; }
}

/// Only picture files InFlight can read. Anything else handed to the app is ignored.
#[cfg(desktop)]
fn is_photo(path: &std::path::Path) -> bool {
    // Keep in step with PHOTO_EXTENSIONS in src/core/rawFormats.ts (a unit test there compares them).
    const KNOWN: [&str; 25] = ["jpg", "jpeg", "png", "webp", "heic", "heif", "hif", "nef", "nrw", "arw", "srf", "sr2", "cr2", "cr3", "raf", "rw2", "orf", "pef", "dng", "srw", "3fr", "fff", "iiq", "rwl", "mos"];
    path.is_file() && path.extension().and_then(|e| e.to_str()).map(|e| KNOWN.contains(&e.to_ascii_lowercase().as_str())).unwrap_or(false)
}

/// Let the page read exactly these files, remember them, and tell the page. The window can read only what the person opened.
#[cfg(desktop)]
fn queue_opened_files(app: &tauri::AppHandle, paths: Vec<std::path::PathBuf>) {
    let accepted: Vec<String> = paths.into_iter().filter(|path| is_photo(path))
        .filter(|path| app.fs_scope().allow_file(path).is_ok())
        .map(|path| path.to_string_lossy().into_owned()).collect();
    if accepted.is_empty() { return; }
    if let Ok(mut pending) = app.state::<OpenedFiles>().0.lock() { pending.extend(accepted); }
    let _ = app.emit("open-files", ());
}

/// The working folder for files sent to another editor: inside the app's data folder, never beside an original.
#[cfg(desktop)]
fn external_edit_folder(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map(|dir| dir.join(external_edit::WORKING_FOLDER))
        .map_err(|_| "InFlight could not find its own data folder.".to_string())
}

/// Write the edit the page sends (a 16-bit PNG) as a 16-bit TIFF, tagged with its colour profile, in the working folder and open it in the chosen app
/// (header `x-open-with`, a path to the app) or the system's default app for TIFF files. Returns the TIFF's path and stamp.
#[cfg(desktop)]
#[tauri::command]
async fn external_edit_send(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<serde_json::Value, String> {
    use tauri_plugin_opener::OpenerExt;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("No picture was sent.".into()) };
    let bytes = bytes.to_vec();
    let header = |name: &str| request.headers().get(name).and_then(|value| value.to_str().ok()).map(external_edit::percent_decode).transpose();
    let name = external_edit::safe_file_name(&header("x-file-name")?.unwrap_or_else(|| "InFlight edit".into()), "tif")?;
    let open_with = header("x-open-with")?.filter(|value| !value.is_empty()).map(std::path::PathBuf::from);
    if let Some(chosen) = &open_with { external_edit::check_app(std::env::consts::OS, chosen)?; }
    let folder = external_edit_folder(&app)?;
    let path = tauri::async_runtime::spawn_blocking(move || {
        let tiff = external_edit::png_to_tiff16(&bytes)?;
        external_edit::write_new(&folder, &name, &tiff)
    }).await.map_err(|_| "The TIFF could not be written.".to_string())??;
    match &open_with {
        Some(chosen) => {
            let (program, args) = external_edit::launch_plan(std::env::consts::OS, chosen, &path);
            std::process::Command::new(program).args(args).spawn()
                .map_err(|_| "The other app did not open. The TIFF is saved in InFlight's working folder.".to_string())?;
        }
        None => app.opener().open_path(path.to_string_lossy(), None::<&str>)
            .map_err(|_| "No app on this computer opened the TIFF. Choose an app instead.".to_string())?,
    }
    let stamp = external_edit::stamp(&path).ok_or_else(|| "The TIFF could not be checked after writing.".to_string())?;
    Ok(serde_json::json!({ "path": path.to_string_lossy(), "size": stamp.size, "modifiedMs": stamp.modified_ms }))
}

/// The size and modified time of a file InFlight sent to another app, or nothing when it has gone.
#[cfg(desktop)]
#[tauri::command]
fn external_edit_stamp(app: tauri::AppHandle, path: String) -> Result<Option<external_edit::FileStamp>, String> {
    let folder = external_edit_folder(&app)?;
    let path = std::path::PathBuf::from(path);
    if !path.exists() { return Ok(None); }
    if !external_edit::is_inside(&folder, &path) { return Err("That file is not one InFlight sent to another app.".into()); }
    Ok(external_edit::stamp(&path))
}

/// Read the TIFF the other app saved and write it as a new 16-bit PNG in the working folder, which the page may then
/// read and import, keeping the colour profile the other app saved. Returns the PNG's path, the bits per channel the
/// other app saved and its ICC profile (bytes) when it has one.
#[cfg(desktop)]
#[tauri::command]
async fn external_edit_bring_back(app: tauri::AppHandle, path: String, name: String) -> Result<serde_json::Value, String> {
    let folder = external_edit_folder(&app)?;
    let name = external_edit::safe_file_name(&name, "png")?;
    let source = std::path::PathBuf::from(path);
    let place = folder.clone();
    let (png_path, returned) = tauri::async_runtime::spawn_blocking(move || {
        let tiff = external_edit::read_returned(&place, &source)?;
        let returned = external_edit::tiff_to_png16(&tiff)?;
        external_edit::write_new(&place, &name, &returned.png).map(|written| (written, returned))
    }).await.map_err(|_| "The saved file could not be read.".to_string())??;
    app.fs_scope().allow_file(&png_path).map_err(|_| "InFlight could not open the returned picture.".to_string())?;
    Ok(serde_json::json!({ "path": png_path.to_string_lossy(), "bits": returned.bits, "profile": returned.profile }))
}

/// The photos waiting to be opened, handed over once.
#[cfg(desktop)]
#[tauri::command]
fn take_opened_files(state: tauri::State<'_, OpenedFiles>) -> Vec<String> {
    state.0.lock().map(|mut pending| std::mem::take(&mut *pending)).unwrap_or_default()
}

/// Develop a RAW file the page sends as raw bytes, and return the picture as JPEG bytes: full size, or half the sensor's
/// width and height when the page asks for the screen-size copy (header `x-develop-size: screen`).
#[cfg(desktop)]
#[tauri::command]
async fn develop_raw(request: tauri::ipc::Request<'_>) -> Result<tauri::ipc::Response, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("No file was sent.".into()) };
    let bytes = bytes.to_vec();
    // The file's extension, so the system decoder on a Mac knows what it is given.
    let extension = request.headers().get("x-file-extension").and_then(|value| value.to_str().ok())
        .filter(|value| value.chars().all(|c| c.is_ascii_alphanumeric()) && !value.is_empty() && value.len() <= 5).unwrap_or("nef").to_string();
    let screen = request.headers().get("x-develop-size").and_then(|value| value.to_str().ok()) == Some("screen");
    // A decoder can panic on a damaged file; run it apart so that becomes an error message, not a crash.
    let jpeg = tauri::async_runtime::spawn_blocking(move || raw::develop_any(&bytes, &extension, screen))
        .await
        .map_err(|_| "This RAW file could not be read.".to_string())??;
    Ok(tauri::ipc::Response::new(jpeg))
}

/// The app's own preview folder (x-std-disk-previews): derived pictures only, never an original.
#[cfg(desktop)]
fn preview_root(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map(|dir| dir.join("previews")).map_err(|_| "The app's data folder could not be found.".to_string())
}

/// Make the disk previews (400 px, 2,200 px, and the 2,560 px smart preview) for photos named by their paths, on
/// `threads` threads, then hold the folder to `limit_bytes`. The page sends paths, never the RAW bytes.
#[cfg(desktop)]
#[tauri::command]
async fn preview_cache_build(app: tauri::AppHandle, requests: Vec<preview_cache::BuildRequest>, threads: usize, limit_bytes: Option<u64>) -> Result<Vec<preview_cache::BuildResult>, String> {
    let root = preview_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let develop = |bytes: &[u8], extension: &str| raw::develop_any(bytes, extension, true);
        let results = preview_cache::build_many(&root, &requests, threads, &develop);
        if let Some(limit) = limit_bytes { preview_cache::trim(&root, limit); }
        results
    }).await.map_err(|_| "The previews could not be made.".to_string())
}

/// Store previews from a picture the page decoded itself (a HEIF photo): the body is a JPEG or PNG at most 2,560 px
/// across, never the original; header `x-preview-key` is the cache key, percent-encoded.
#[cfg(desktop)]
#[tauri::command]
async fn preview_cache_store(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<preview_cache::BuildResult, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("No picture was sent.".into()) };
    let key = request.headers().get("x-preview-key").and_then(|value| value.to_str().ok()).and_then(preview_cache::percent_decode)
        .ok_or_else(|| "No cache key was given.".to_string())?;
    let bytes = bytes.to_vec();
    let root = preview_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || preview_cache::store_picture(&root, &key, &bytes))
        .await.map_err(|_| "The previews could not be made.".to_string())
}

/// One stored preview as JPEG bytes, or an error when there is none.
#[cfg(desktop)]
#[tauri::command]
async fn preview_cache_read(app: tauri::AppHandle, key: String, level: preview_cache::Level) -> Result<tauri::ipc::Response, String> {
    let root = preview_root(&app)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || preview_cache::read(&root, &key, level))
        .await.map_err(|_| "The preview could not be read.".to_string())?;
    bytes.map(tauri::ipc::Response::new).ok_or_else(|| "missing".to_string())
}

#[cfg(desktop)]
#[tauri::command]
async fn preview_cache_rotate(app: tauri::AppHandle, key: String, degrees: u32) -> Result<(), String> {
    let root = preview_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || preview_cache::rotate(&root, &key, degrees))
        .await.map_err(|_| "The preview could not be turned.".to_string())?
}

/// How much the preview folder holds; with `limit_bytes`, first remove the least recently used beyond it.
#[cfg(desktop)]
#[tauri::command]
async fn preview_cache_usage(app: tauri::AppHandle, limit_bytes: Option<u64>) -> Result<preview_cache::Usage, String> {
    let root = preview_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || match limit_bytes { Some(limit) => preview_cache::trim(&root, limit), None => preview_cache::usage(&root) })
        .await.map_err(|_| "The preview folder could not be read.".to_string())
}

/// Remove every stored preview. Originals, projects and edits are not touched.
#[cfg(desktop)]
#[tauri::command]
async fn preview_cache_clear(app: tauri::AppHandle) -> Result<preview_cache::Usage, String> {
    let root = preview_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || preview_cache::clear(&root))
        .await.map_err(|_| "The preview folder could not be cleared.".to_string())
}

/// Develop a RAW file to its full-size 16-bit picture (width, height, then RGB16 samples; `kestrel_raw::rgb16_bytes`).
/// The page runs InFlight's shared edit maths on it for the 16-bit export, exactly as the web build does.
#[cfg(desktop)]
#[tauri::command]
async fn develop_raw_rgb16(request: tauri::ipc::Request<'_>) -> Result<tauri::ipc::Response, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("No file was sent.".into()) };
    let bytes = bytes.to_vec();
    let picture = tauri::async_runtime::spawn_blocking(move || kestrel_raw::develop_rgb16(&bytes).map(|image| kestrel_raw::rgb16_bytes(&image)))
        .await
        .map_err(|_| "This RAW file could not be read.".to_string())??;
    Ok(tauri::ipc::Response::new(picture))
}

/// Experimental: develop a RAW file straight to a 16-bit TIFF (see `raw_precision.rs`). Nikon HE/HE* goes through the
/// same sensor decode as the editor (`nikon_he.rs`). No colour profile yet; refuses rather than silently falling back to
/// 8-bit. Offered as an extra download, not the default editing path, until ICC handling is in place.
#[cfg(desktop)]
#[tauri::command]
async fn develop_raw_precision(request: tauri::ipc::Request<'_>) -> Result<tauri::ipc::Response, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("No file was sent.".into()) };
    let bytes = bytes.to_vec();
    let tiff = tauri::async_runtime::spawn_blocking(move || raw_precision::develop_raw_rgb16_tiff(&bytes))
        .await
        .map_err(|_| "This RAW file could not be read.".to_string())??;
    Ok(tauri::ipc::Response::new(tiff))
}

/// POC: apply supported parametric tone edits in the native 16-bit path.
/// Unsupported edits must be rejected in the UI; native validation independently
/// rejects malformed or out-of-range recipes. Original RAW bytes are read-only.
#[cfg(desktop)]
#[tauri::command]
async fn develop_raw_precision_edited(request: tauri::ipc::Request<'_>) -> Result<tauri::ipc::Response, String> {
    let recipe = request.headers().get("x-kestrel-master-edit")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "A validated 16-bit RAW edit recipe is required.".to_string())?;
    let edit = raw_precision::parse_master_edit(recipe)?;
    let framing_json = request.headers().get("x-kestrel-master-framing")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "A validated RAW master crop is required.".to_string())?;
    let framing = raw_precision::parse_master_framing(framing_json)?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("No original RAW file was sent.".into());
    };
    let bytes = bytes.to_vec();
    let tiff = tauri::async_runtime::spawn_blocking(move ||
        raw_precision::develop_raw_rgb16_tiff_with_edit_and_framing(&bytes, edit, framing))
        .await
        .map_err(|_| "The 16-bit RAW renderer could not finish.".to_string())??;
    Ok(tauri::ipc::Response::new(tiff))
}

/// A lossless DNG copy of a Nikon High Efficiency RAW's sensor data, for editors and tools that cannot read HE/HE*.
/// Returned to the page, which asks where to save it; the original is only read.
#[cfg(desktop)]
#[tauri::command]
async fn raw_dng_copy(request: tauri::ipc::Request<'_>) -> Result<tauri::ipc::Response, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("No file was sent.".into()) };
    let bytes = bytes.to_vec();
    let dng = tauri::async_runtime::spawn_blocking(move || nikon_he::dng_copy(&bytes))
        .await
        .map_err(|_| "This RAW file could not be read.".to_string())??;
    Ok(tauri::ipc::Response::new(dng))
}

/// Which sensor decoder a RAW needs, from the first few megabytes the page sends: "nikon-he", "nikon-he-star", or
/// "other". Lets the page say plainly how a picture was made, and offer a DNG copy only where one helps.
#[cfg(desktop)]
#[tauri::command]
fn raw_sensor_mode(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("No file was sent.".into()) };
    let file_len = request.headers().get("x-file-length").and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<usize>().ok()).filter(|&len| len >= bytes.len()).unwrap_or(bytes.len());
    // ticoraw bounds-checks every structure and never panics on hostile input; the guard is belt and braces.
    // ticoraw bounds-checks every structure; the guard is belt and braces. "need-more": send more of the file.
    let verdict = std::panic::catch_unwind(|| nikon_he::prefix_verdict(bytes, file_len)).unwrap_or(nikon_he::PrefixVerdict::NotHighEfficiency);
    Ok(match verdict {
        nikon_he::PrefixVerdict::HighEfficiency(mode) => mode.label(),
        nikon_he::PrefixVerdict::NeedMore => "need-more",
        nikon_he::PrefixVerdict::NotHighEfficiency => "other",
    }.to_string())
}

/// iPhone: upright, except while a photo is full screen (see `ios_orientation.rs`). iPad and every other platform: nothing
/// to do here, so the page may call this anywhere and it only ever acts on an iPhone.
#[cfg(mobile)]
#[tauri::command]
fn set_landscape_allowed(window: tauri::WebviewWindow, allowed: bool) {
    #[cfg(target_os = "ios")]
    let _ = window.with_webview(move |webview| {
        // SAFETY: `with_webview` runs this on the main thread with the window's live view controller.
        unsafe {
            ios_orientation::apply(webview.view_controller().cast(), allowed);
            ios_orientation::fill_window(webview.inner().cast());
        }
    });
    #[cfg(not(target_os = "ios"))]
    let _ = (window, allowed);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        // Lets the app talk to the person's own storage (S3-compatible, WebDAV) without a website's cross-origin limits.
        .plugin(tauri_plugin_http::init())
        // Remembers which folders the person allowed, so a chosen sync or backup folder still works after a restart.
        .plugin(tauri_plugin_persisted_scope::init());

    #[cfg(mobile)]
    let builder = builder.invoke_handler(tauri::generate_handler![set_landscape_allowed]);

    // Menus, restart and the updater exist on desktop only.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(OpenedFiles::default())
        .manage(OauthListener::default())
        .manage(FtpInboxState::default())
        .manage(ShootRoomState::default())
        .manage(local_vision::VisionState::default())
        .invoke_handler(tauri::generate_handler![develop_raw, develop_raw_rgb16, preview_cache_build, preview_cache_store, preview_cache_read, preview_cache_rotate, preview_cache_usage, preview_cache_clear, develop_raw_precision, develop_raw_precision_edited, raw_dng_copy, raw_sensor_mode, take_opened_files, external_edit_send, external_edit_stamp, external_edit_bring_back, oauth_listen_start, oauth_listen_wait, oauth_listen_stop, ftp_inbox_start, ftp_inbox_status, ftp_inbox_stop, shoot_room_start, shoot_room_put, shoot_room_marks, shoot_room_take, shoot_room_stop, local_vision::local_vision_status, local_vision::local_vision_describe, local_vision::local_vision_metrics, local_vision::local_vision_measure, app_menu::menu_set_enabled])
        .menu(|app| app_menu::build(app))
        .on_menu_event(|app, event| {
            let id = event.id().0.clone();
            // Help links open in the system browser; every other choice goes to the page (src/v2/ui/commands/menuMap.ts).
            if let Some(url) = app_menu::site_link_for(&id) {
                use tauri_plugin_opener::OpenerExt;
                let _ = app.opener().open_url(url, None::<&str>);
                return;
            }
            let _ = app.emit("menu", id);
        });

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building InFlight");
    // Windows and Linux pass the file to open as an argument when the app starts.
    #[cfg(desktop)]
    queue_opened_files(app.handle(), std::env::args_os().skip(1).map(std::path::PathBuf::from).collect());
    app.run(|_handle, _event| {
        // macOS delivers Open With and double-clicks as an event, both at launch and while the app is running.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = _event {
            queue_opened_files(_handle, urls.into_iter().filter_map(|url| url.to_file_path().ok()).collect());
        }
    });
}

#[cfg(all(test, desktop))]
mod open_with_tests {
    use super::is_photo;

    #[test]
    fn only_existing_picture_files_are_accepted() {
        let dir = std::env::temp_dir().join(format!("kestrel-open-with-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let nef = dir.join("DSC_0001.NEF");
        let heic = dir.join("IMG_0001.HEIC");
        let hif = dir.join("R5_0001.hif");
        let text = dir.join("notes.txt");
        let script = dir.join("run.sh");
        for path in [&nef, &heic, &hif, &text, &script] { std::fs::write(path, b"x").unwrap(); }
        assert!(is_photo(&nef), "a RAW file, whatever its letter case");
        assert!(is_photo(&heic) && is_photo(&hif), "HEIF photos from phones and cameras");
        assert!(!is_photo(&text) && !is_photo(&script), "other file types are ignored");
        assert!(!is_photo(&dir.join("missing.jpg")), "a path that does not exist is ignored");
        assert!(!is_photo(&dir), "a folder is ignored");
        std::fs::remove_dir_all(&dir).ok();
    }
}
