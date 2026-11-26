fn main() {
    // The commit for the About box. A release build passes KESTREL_BUILD_REVISION; otherwise ask git, and when neither
    // knows, the About box says the build information is unavailable rather than guessing.
    println!("cargo:rerun-if-env-changed=KESTREL_BUILD_REVISION");
    if std::path::Path::new("../.git/HEAD").exists() {
        println!("cargo:rerun-if-changed=../.git/HEAD");
    }
    let supplied = std::env::var("KESTREL_BUILD_REVISION").unwrap_or_default().trim().to_lowercase();
    let revision = if is_revision(&supplied) {
        Some(supplied)
    } else {
        std::process::Command::new("git")
            .args(["rev-parse", "HEAD"])
            .output()
            .ok()
            .filter(|out| out.status.success())
            .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_lowercase())
            .filter(|rev| is_revision(rev))
    };
    if let Some(rev) = revision {
        println!("cargo:rustc-env=KESTREL_MENU_REVISION={}", &rev[..rev.len().min(12)]);
    }
    tauri_build::build()
}

fn is_revision(value: &str) -> bool {
    (7..=40).contains(&value.len()) && value.chars().all(|c| c.is_ascii_hexdigit())
}
