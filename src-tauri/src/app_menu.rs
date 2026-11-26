//! The desktop app's native menu bar, and the command the page uses to grey out items that cannot act right now.
//!
//! Every custom id here is read by `src/v2/ui/commands/menuMap.ts` (what a choice does) and
//! `src/v2/ui/commands/menuState.ts` (when it is available). The page sends only the ids whose state changed, so a
//! render that changes nothing costs nothing here.
//!
//! Items are greyed out, never hidden, so the menus keep the same shape on every screen (calm and predictable, and the
//! macOS convention). The standard Undo, Redo, Cut, Copy and Paste items act on text fields and are left to the system.

use tauri::menu::{AboutMetadata, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Runtime};

/// The public website, from the same file the web app reads (config/public-site.json).
pub fn site_origin() -> String {
    let parsed: serde_json::Value = serde_json::from_str(include_str!("../../config/public-site.json")).unwrap_or_default();
    parsed.get("origin").and_then(|v| v.as_str()).unwrap_or("https://inflight.studio").trim_end_matches('/').to_string()
}

/// The commit this app was built from, when the build knew it (see build.rs). Never made up.
pub fn build_revision() -> Option<&'static str> {
    option_env!("KESTREL_MENU_REVISION").filter(|v| !v.is_empty())
}

/// The words in the About box: what the app is, which build, and where the licence and notices are.
pub fn about_comments(revision: Option<&str>) -> String {
    let build = match revision {
        Some(rev) => format!("Build {rev}"),
        None => "Build information unavailable".to_string(),
    };
    format!(
        "Offline-first photo culling and editing. Your originals are never changed.\n{build}\nLicence and third-party notices: Help → Terms and licence, and Settings → Privacy → Build information."
    )
}

fn about<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<PredefinedMenuItem<R>> {
    let site = site_origin();
    let version = app.package_info().version.to_string();
    let metadata = AboutMetadata {
        name: Some("InFlight".into()),
        version: Some(version.clone()),
        short_version: Some(version),
        copyright: Some("© 2026 Leitch Technology. All rights reserved.".into()),
        comments: Some(about_comments(build_revision())),
        website: Some(site.clone()),
        website_label: Some(site.trim_start_matches("https://").to_string()),
        credits: Some(about_comments(build_revision())),
        ..Default::default()
    };
    PredefinedMenuItem::about(app, Some("About InFlight"), Some(metadata))
}

fn item<R: Runtime>(app: &AppHandle<R>, id: &str, label: &str, accelerator: Option<&str>) -> tauri::Result<MenuItem<R>> {
    MenuItem::with_id(app, id, label, true, accelerator)
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let mac = cfg!(target_os = "macos");
    let sep = || PredefinedMenuItem::separator(app);

    let file = Submenu::with_items(app, "File", true, &[
        &item(app, "add", "Add photos…", Some("CmdOrCtrl+O"))?,
        &sep()?,
        &item(app, "export", "Export…", Some("CmdOrCtrl+E"))?,
        &item(app, "export-again", "Export again with last settings", None)?,
        &item(app, "open-export", "Export everything in open formats…", None)?,
        &sep()?,
        &item(app, "xmp-save", "Save ratings to XMP…", None)?,
        &item(app, "xmp-read", "Read ratings from XMP…", None)?,
        &item(app, "lightroom-read", "Bring in a Lightroom catalogue…", None)?,
        &sep()?,
        &item(app, "backup-now", "Back up now", None)?,
        &item(app, "backup-file", "Save backup file…", None)?,
        &sep()?,
        &item(app, "removed-photos", "Removed photos…", None)?,
        &item(app, "back-to-projects", "Back to projects", None)?,
        &sep()?,
        &PredefinedMenuItem::close_window(app, None)?,
    ])?;
    if !mac {
        file.append(&sep()?)?;
        file.append(&PredefinedMenuItem::quit(app, Some("Exit"))?)?;
    }

    let edit = Submenu::with_items(app, "Edit", true, &[
        &PredefinedMenuItem::undo(app, None)?,
        &PredefinedMenuItem::redo(app, None)?,
        &sep()?,
        &PredefinedMenuItem::cut(app, None)?,
        &PredefinedMenuItem::copy(app, None)?,
        &PredefinedMenuItem::paste(app, None)?,
        &sep()?,
        &item(app, "photos-select-all", "Select All Photos", Some("CmdOrCtrl+A"))?,
        &item(app, "photos-deselect-all", "Deselect Photos", Some("CmdOrCtrl+Shift+A"))?,
        &sep()?,
        &item(app, "edit-copy-adjustments", "Copy edits", None)?,
        &item(app, "edit-paste-adjustments", "Paste edits", None)?,
        &item(app, "reset-photo", "Reset photo edits", None)?,
    ])?;

    let rate = Submenu::with_id_and_items(app, "photo-rate", "Rate", true, &[
        &item(app, "photo-rate-0", "No rating", None)?,
        &item(app, "photo-rate-1", "1 star", None)?,
        &item(app, "photo-rate-2", "2 stars", None)?,
        &item(app, "photo-rate-3", "3 stars", None)?,
        &item(app, "photo-rate-4", "4 stars", None)?,
        &item(app, "photo-rate-5", "5 stars", None)?,
    ])?;
    let photo = Submenu::with_items(app, "Photo", true, &[
        &item(app, "photo-keep", "Keep", None)?,
        &item(app, "photo-reject", "Set aside", None)?,
        &item(app, "photo-unreview", "Back to review", None)?,
        &sep()?,
        &rate,
        &sep()?,
        &item(app, "photo-compare", "Compare original and edit", None)?,
        &sep()?,
        &item(app, "photo-undo", "Undo last photo change", None)?,
        &item(app, "photo-redo", "Redo photo change", None)?,
    ])?;

    let view = Submenu::with_items(app, "View", true, &[
        &item(app, "view-grid", "All photos (grid)", None)?,
        &item(app, "view-loupe", "Single photo", None)?,
        &sep()?,
        &item(app, "filmstrip", "Show or hide filmstrip", None)?,
    ])?;
    view.append(&sep()?)?;
    if mac {
        view.append(&PredefinedMenuItem::fullscreen(app, None)?)?;
    } else {
        // The system full-screen item does nothing on Windows and Linux; F11 is handled by the page.
        view.append(&item(app, "view-fullscreen", "Full screen (F11)", None)?)?;
    }

    let settings = Submenu::with_items(app, "Settings", true, &[
        &item(app, "appearance", "Appearance and layout…", None)?,
        &item(app, "settings-ai", "Bring your own AI…", None)?,
        &item(app, "settings-storage", "Bring your own Storage…", None)?,
        // Cmd+M is Minimize on macOS (Window menu), so the Mac gets no accelerator here; Cmd+, opens Settings.
        &item(app, "macro-pad", "Macro pad and shortcuts…", if mac { None } else { Some("Ctrl+M") })?,
    ])?;

    let window = Submenu::with_items(app, "Window", true, &[&PredefinedMenuItem::minimize(app, None)?])?;
    if mac {
        window.append(&PredefinedMenuItem::maximize(app, Some("Zoom"))?)?;
    }

    let help = Submenu::with_items(app, "Help", true, &[
        &item(app, "help-shortcuts", "Keyboard shortcuts", None)?,
        &sep()?,
        &item(app, "help-website", "InFlight website", None)?,
        &item(app, "help-privacy", "Privacy", None)?,
        &item(app, "help-terms", "Terms and licence", None)?,
        &item(app, "help-build", "Build information…", None)?,
    ])?;
    if !mac {
        help.append(&sep()?)?;
        help.append(&about(app)?)?;
    }

    if mac {
        let app_menu = Submenu::with_items(app, "InFlight", true, &[
            &about(app)?,
            &sep()?,
            &item(app, "settings-open", "Settings…", Some("Cmd+Comma"))?,
            &sep()?,
            &PredefinedMenuItem::services(app, None)?,
            &sep()?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &sep()?,
            &PredefinedMenuItem::quit(app, None)?,
        ])?;
        Menu::with_items(app, &[&app_menu, &file, &edit, &photo, &view, &settings, &window, &help])
    } else {
        Menu::with_items(app, &[&file, &edit, &photo, &view, &settings, &window, &help])
    }
}

/// Finds a custom item or submenu anywhere in the menu bar and sets whether it can be chosen.
fn set_enabled_in<R: Runtime>(items: &[MenuItemKind<R>], id: &str, enabled: bool) -> bool {
    for entry in items {
        match entry {
            MenuItemKind::MenuItem(found) if found.id().0 == id => {
                let _ = found.set_enabled(enabled);
                return true;
            }
            MenuItemKind::Submenu(sub) => {
                if sub.id().0 == id {
                    let _ = sub.set_enabled(enabled);
                    return true;
                }
                if let Ok(children) = sub.items() {
                    if set_enabled_in(&children, id, enabled) {
                        return true;
                    }
                }
            }
            _ => {}
        }
    }
    false
}

/// The page tells the menu which items can act now, sending only those that changed. Unknown ids are ignored.
#[tauri::command]
pub fn menu_set_enabled<R: Runtime>(app: AppHandle<R>, items: Vec<(String, bool)>) {
    let Some(menu) = app.menu() else { return };
    let Ok(top) = menu.items() else { return };
    for (id, enabled) in items {
        set_enabled_in(&top, &id, enabled);
    }
}

/// Help menu links open in the system browser, not inside the app window.
pub fn site_link_for(id: &str) -> Option<String> {
    let path = match id {
        "help-website" => "/",
        "help-privacy" => "/privacy.html",
        "help-terms" => "/terms.html",
        _ => return None,
    };
    Some(format!("{}{}", site_origin(), path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_site_comes_from_the_shared_config_as_a_bare_https_origin() {
        let site = site_origin();
        assert!(site.starts_with("https://"), "{site}");
        assert!(!site.ends_with('/'), "{site}");
    }

    #[test]
    fn help_links_go_to_the_public_site_and_nothing_else_is_a_link() {
        let site = site_origin();
        assert_eq!(site_link_for("help-website"), Some(format!("{site}/")));
        assert_eq!(site_link_for("help-privacy"), Some(format!("{site}/privacy.html")));
        assert_eq!(site_link_for("help-terms"), Some(format!("{site}/terms.html")));
        assert_eq!(site_link_for("export"), None);
    }

    #[test]
    fn the_about_box_names_the_build_or_says_it_is_unknown() {
        assert!(about_comments(Some("abc123def456")).contains("Build abc123def456"));
        let unknown = about_comments(None);
        assert!(unknown.contains("Build information unavailable"));
        assert!(unknown.contains("Licence and third-party notices"));
    }
}
