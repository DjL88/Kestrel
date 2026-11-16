#[cfg(desktop)]
mod raw;
#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
#[cfg(desktop)]
use tauri::Emitter;

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

    // Menus, restart and the updater exist on desktop only.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![develop_raw])
        .menu(|app| {
            let app_menu = Submenu::with_items(app, "Kestrel", true, &[
                &PredefinedMenuItem::about(app, None, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::quit(app, None)?,
            ])?;
            let file = Submenu::with_items(app, "File", true, &[
                &MenuItem::with_id(app, "export", "Export…", true, Some("CmdOrCtrl+E"))?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::close_window(app, None)?,
            ])?;
            let edit = Submenu::with_items(app, "Edit", true, &[
                &PredefinedMenuItem::undo(app, None)?,
                &PredefinedMenuItem::redo(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::cut(app, None)?,
                &PredefinedMenuItem::copy(app, None)?,
                &PredefinedMenuItem::paste(app, None)?,
                &PredefinedMenuItem::select_all(app, None)?,
            ])?;
            let view = Submenu::with_items(app, "View", true, &[
                &MenuItem::with_id(app, "filmstrip", "Show or hide filmstrip", true, None::<&str>)?,
                &MenuItem::with_id(app, "appearance", "Appearance && layout…", true, None::<&str>)?,
                &PredefinedMenuItem::fullscreen(app, None)?,
            ])?;
            let window = Submenu::with_items(app, "Window", true, &[
                &MenuItem::with_id(app, "macro-pad", "Macro pad…", true, Some("CmdOrCtrl+M"))?,
                &PredefinedMenuItem::minimize(app, None)?,
            ])?;
            Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window])
        })
        .on_menu_event(|app, event| {
            let _ = app.emit("menu", event.id().0.clone());
        });

    builder
        .run(tauri::generate_context!())
        .expect("error while running Kestrel");
}
