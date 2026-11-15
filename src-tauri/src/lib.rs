#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
#[cfg(desktop)]
use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init());

    // Menus, restart and the updater exist on desktop only.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
