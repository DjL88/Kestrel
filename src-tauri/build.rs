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
    // The universal Mac app links Microsoft's ONNX Runtime as a library in Contents/Frameworks (scripts/macos/
    // fetch-onnxruntime.sh, ORT_PREFER_DYNAMIC_LINK=1 in the release build): tell the app where to find it there.
    println!("cargo:rerun-if-env-changed=ORT_PREFER_DYNAMIC_LINK");
    let dynamic_ort = std::env::var("ORT_PREFER_DYNAMIC_LINK").map(|v| v == "1" || v.eq_ignore_ascii_case("true")).unwrap_or(false);
    if dynamic_ort && std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");
    }
    tauri_build::build()
}

fn is_revision(value: &str) -> bool {
    (7..=40).contains(&value.len()) && value.chars().all(|c| c.is_ascii_hexdigit())
}
