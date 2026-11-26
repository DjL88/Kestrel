//! Tauri commands for SFTP places ("Where your work lives"), on desktop only. The client is `crates/kestrel-sftp`:
//! one session per call, the host key pinned on first use, paths kept inside InFlight's folder.
//! A changed host key comes back as `host-key-changed:<fingerprint>` so the page can say so plainly.

use kestrel_sftp::{Auth, SftpError, Target};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpTarget {
    host: String,
    port: u16,
    user: String,
    password: Option<String>,
    private_key: Option<String>,
    passphrase: Option<String>,
    #[serde(default)]
    root: String,
    pinned: Option<String>,
}

impl SftpTarget {
    fn into_target(self) -> Target {
        let auth = match self.private_key.filter(|key| !key.trim().is_empty()) {
            Some(pem) => Auth::Key { pem, passphrase: self.passphrase.filter(|p| !p.is_empty()) },
            None => Auth::Password(self.password.unwrap_or_default()),
        };
        Target { host: self.host, port: self.port, user: self.user, auth, root: self.root, pinned: self.pinned.filter(|p| !p.is_empty()) }
    }
}

fn words(error: SftpError) -> String {
    match error {
        SftpError::HostKeyChanged(seen) => format!("host-key-changed:{seen}"),
        SftpError::Plain(text) => text,
    }
}

/// Connect, sign in and make InFlight's folder. Returns the server's fingerprint for the person to accept.
#[tauri::command]
pub async fn sftp_test(target: SftpTarget) -> Result<String, String> {
    kestrel_sftp::test(&target.into_target()).await.map_err(words)
}

/// The file's bytes are the raw body; header `x-sftp-target` is the target as JSON and `x-sftp-path` the path, both
/// percent-encoded.
#[tauri::command]
pub async fn sftp_put(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("Nothing was sent.".into()) };
    let header = |name: &str| request.headers().get(name).and_then(|value| value.to_str().ok()).and_then(crate::preview_cache::percent_decode);
    let target: SftpTarget = header("x-sftp-target").and_then(|json| serde_json::from_str(&json).ok()).ok_or_else(|| "The SFTP place was not given.".to_string())?;
    let path = header("x-sftp-path").ok_or_else(|| "No path was given.".to_string())?;
    let bytes = bytes.to_vec();
    kestrel_sftp::put(&target.into_target(), &path, &bytes).await.map_err(words)
}

/// The file's bytes, or an empty answer with `missing` as the error when there is no such file.
#[tauri::command]
pub async fn sftp_get(target: SftpTarget, path: String) -> Result<tauri::ipc::Response, String> {
    match kestrel_sftp::get(&target.into_target(), &path).await.map_err(words)? {
        Some(bytes) => Ok(tauri::ipc::Response::new(bytes)),
        None => Err("missing".into()),
    }
}

#[tauri::command]
pub async fn sftp_list(target: SftpTarget, prefix: String) -> Result<Vec<String>, String> {
    kestrel_sftp::list(&target.into_target(), &prefix).await.map_err(words)
}

#[tauri::command]
pub async fn sftp_remove(target: SftpTarget, path: String) -> Result<(), String> {
    kestrel_sftp::remove(&target.into_target(), &path).await.map_err(words)
}
