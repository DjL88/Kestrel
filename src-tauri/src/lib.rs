#[cfg(target_os = "ios")]
mod ios_orientation;
#[cfg(desktop)]
use kestrel_raw::nikon_he;
#[cfg(desktop)]
mod raw;
#[cfg(desktop)]
mod oauth_loopback;
#[cfg(desktop)]
mod local_vision;
#[cfg(desktop)]
pub use kestrel_raw::scene_develop;
#[cfg(desktop)]
pub mod raw_precision;
#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
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
    const KNOWN: [&str; 19] = ["jpg", "jpeg", "png", "webp", "heic", "heif", "hif", "nef", "nrw", "arw", "srf", "sr2", "cr2", "cr3", "raf", "rw2", "orf", "pef", "dng"];
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

/// The photos waiting to be opened, handed over once.
#[cfg(desktop)]
#[tauri::command]
fn take_opened_files(state: tauri::State<'_, OpenedFiles>) -> Vec<String> {
    state.0.lock().map(|mut pending| std::mem::take(&mut *pending)).unwrap_or_default()
}

/// Develop a RAW file the page sends as raw bytes, and return the full-size picture as JPEG bytes.
#[cfg(desktop)]
#[tauri::command]
async fn develop_raw(request: tauri::ipc::Request<'_>) -> Result<tauri::ipc::Response, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("No file was sent.".into()) };
    let bytes = bytes.to_vec();
    // The file's extension, so the system decoder on a Mac knows what it is given.
    let extension = request.headers().get("x-file-extension").and_then(|value| value.to_str().ok())
        .filter(|value| value.chars().all(|c| c.is_ascii_alphanumeric()) && !value.is_empty() && value.len() <= 5).unwrap_or("nef").to_string();
    // A decoder can panic on a damaged file; run it apart so that becomes an error message, not a crash.
    let jpeg = tauri::async_runtime::spawn_blocking(move || raw::develop_any(&bytes, &extension))
        .await
        .map_err(|_| "This RAW file could not be read.".to_string())??;
    Ok(tauri::ipc::Response::new(jpeg))
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
        .manage(local_vision::VisionState::default())
        .invoke_handler(tauri::generate_handler![develop_raw, develop_raw_rgb16, develop_raw_precision, develop_raw_precision_edited, raw_dng_copy, raw_sensor_mode, take_opened_files, oauth_listen_start, oauth_listen_wait, oauth_listen_stop, local_vision::local_vision_status, local_vision::local_vision_describe])
        .menu(|app| {
            let app_menu = Submenu::with_items(app, "InFlight", true, &[
                &PredefinedMenuItem::about(app, None, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::quit(app, None)?,
            ])?;
            let file = Submenu::with_items(app, "File", true, &[
                &MenuItem::with_id(app, "add", "Add photos…", true, Some("CmdOrCtrl+O"))?,
                &MenuItem::with_id(app, "export", "Export…", true, Some("CmdOrCtrl+E"))?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::close_window(app, None)?,
            ])?;
            let edit = Submenu::with_items(app, "Edit", true, &[
                &MenuItem::with_id(app, "edit-photo", "Edit photo", true, None::<&str>)?,
                &MenuItem::with_id(app, "edit-auto", "Auto-adjust…", true, None::<&str>)?,
                &MenuItem::with_id(app, "edit-look", "Apply look…", true, None::<&str>)?,
                &MenuItem::with_id(app, "edit-copy-adjustments", "Copy edits", true, None::<&str>)?,
                &MenuItem::with_id(app, "edit-paste-adjustments", "Paste edits", true, None::<&str>)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::undo(app, None)?,
                &PredefinedMenuItem::redo(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::cut(app, None)?,
                &PredefinedMenuItem::copy(app, None)?,
                &PredefinedMenuItem::paste(app, None)?,
                // A photo library must select photo records, not the webview page text.
                &MenuItem::with_id(app, "photos-select-all", "Select All Photos", true, Some("CmdOrCtrl+A"))?,
                &MenuItem::with_id(app, "photos-deselect-all", "Deselect Photos", true, Some("CmdOrCtrl+Shift+A"))?,
            ])?;
            // Plain-letter shortcuts (P, X, 0-5) are not accelerators here: a native one would fire while typing in a field.
            let rate = Submenu::with_items(app, "Rate", true, &[
                &MenuItem::with_id(app, "photo-rate-0", "No rating", true, None::<&str>)?,
                &MenuItem::with_id(app, "photo-rate-1", "1 star", true, None::<&str>)?,
                &MenuItem::with_id(app, "photo-rate-2", "2 stars", true, None::<&str>)?,
                &MenuItem::with_id(app, "photo-rate-3", "3 stars", true, None::<&str>)?,
                &MenuItem::with_id(app, "photo-rate-4", "4 stars", true, None::<&str>)?,
                &MenuItem::with_id(app, "photo-rate-5", "5 stars", true, None::<&str>)?,
            ])?;
            let photo = Submenu::with_items(app, "Photo", true, &[
                &MenuItem::with_id(app, "photo-keep", "Keep", true, None::<&str>)?,
                &MenuItem::with_id(app, "photo-reject", "Move to Trash", true, None::<&str>)?,
                &MenuItem::with_id(app, "photo-unreview", "Back to review", true, None::<&str>)?,
                &PredefinedMenuItem::separator(app)?,
                &rate,
                &PredefinedMenuItem::separator(app)?,
                &MenuItem::with_id(app, "photo-compare", "Compare photos", true, None::<&str>)?,
                &PredefinedMenuItem::separator(app)?,
                &MenuItem::with_id(app, "photo-undo", "Undo last decision", true, None::<&str>)?,
                &MenuItem::with_id(app, "photo-redo", "Redo decision", true, None::<&str>)?,
            ])?;
            let view = Submenu::with_items(app, "View", true, &[
                &MenuItem::with_id(app, "view-grid", "Grid", true, None::<&str>)?,
                &MenuItem::with_id(app, "view-loupe", "Single photo", true, None::<&str>)?,
                &MenuItem::with_id(app, "view-compare", "Compare", true, None::<&str>)?,
                &MenuItem::with_id(app, "view-photo-only", "Photo only", true, None::<&str>)?,
                &PredefinedMenuItem::separator(app)?,
                &MenuItem::with_id(app, "filmstrip", "Show or hide filmstrip", true, None::<&str>)?,
                &MenuItem::with_id(app, "view-info", "Show or hide Photo info", true, None::<&str>)?,
                &MenuItem::with_id(app, "view-bursts", "Group or ungroup bursts", true, None::<&str>)?,
                &MenuItem::with_id(app, "view-tools", "Show or hide editing tools", true, None::<&str>)?,
                &MenuItem::with_id(app, "view-tab-auto", "Show or hide Auto tab", true, None::<&str>)?,
                &MenuItem::with_id(app, "view-tab-crop", "Show or hide Crop tab", true, None::<&str>)?,
                &MenuItem::with_id(app, "view-tab-edit", "Show or hide Edit tab", true, None::<&str>)?,
                &MenuItem::with_id(app, "view-tab-masks", "Show or hide Masks tab", true, None::<&str>)?,
                &MenuItem::with_id(app, "view-tab-history", "Show or hide History tab", true, None::<&str>)?,
                &MenuItem::with_id(app, "view-tab-float", "Dock or undock active editor tab", true, None::<&str>)?,
                &MenuItem::with_id(app, "view-all-tabs", "Show and dock all editor tabs", true, None::<&str>)?,
                &PredefinedMenuItem::separator(app)?,
                &MenuItem::with_id(app, "view-left", "Panels on the left", true, None::<&str>)?,
                &MenuItem::with_id(app, "view-right", "Panels on the right", true, None::<&str>)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::fullscreen(app, None)?,
            ])?;
            let settings = Submenu::with_items(app, "Settings", true, &[
                &MenuItem::with_id(app, "appearance", "Appearance and layout…", true, None::<&str>)?,
                &MenuItem::with_id(app, "settings-ai", "Bring your own AI…", true, None::<&str>)?,
                &MenuItem::with_id(app, "settings-storage", "Bring your own Storage…", true, None::<&str>)?,
                &MenuItem::with_id(app, "macro-pad", "Macro pad and shortcuts…", true, Some("CmdOrCtrl+M"))?,
            ])?;
            let window = Submenu::with_items(app, "Window", true, &[
                &PredefinedMenuItem::minimize(app, None)?,
            ])?;
            Menu::with_items(app, &[&app_menu, &file, &edit, &photo, &view, &settings, &window])
        })
        .on_menu_event(|app, event| {
            let _ = app.emit("menu", event.id().0.clone());
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
