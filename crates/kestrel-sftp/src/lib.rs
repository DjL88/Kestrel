//! SFTP for InFlight's "Where your work lives" (desktop only: browsers cannot speak SSH).
//!
//! Every call opens one SSH session, does one thing and closes it, so nothing stays connected in the background.
//! The server's host key is pinned on first use: `test` reports its SHA-256 fingerprint for the person to accept, and
//! every later call refuses a server whose key differs (a changed key can mean someone is in between). Paths are always
//! relative to the folder the person chose and may only name InFlight's own files (`kestrel/v1/...`).

use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::keys::{decode_secret_key, HashAlg, PrivateKeyWithHashAlg};
use russh::{client, Disconnect};
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const TIMEOUT: Duration = Duration::from_secs(20);
/// Largest file read back in one call: project backups and previews, never whole originals.
pub const MAX_READ: u64 = 256 * 1024 * 1024;

#[derive(Clone, Debug)]
pub enum Auth {
    Password(String),
    /// An OpenSSH private key's text, and its passphrase when it has one.
    Key { pem: String, passphrase: Option<String> },
}

#[derive(Clone, Debug)]
pub struct Target {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth: Auth,
    /// The folder on the server InFlight works inside, such as `/volume1/photos` or `InFlight` (home-relative).
    pub root: String,
    /// The fingerprint the person accepted, `SHA256:...`. None only for `test`, which reports it.
    pub pinned: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum SftpError {
    /// Words for the person, already plain.
    Plain(String),
    /// The server's key is not the one the person accepted. Carries the new fingerprint.
    HostKeyChanged(String),
}

impl std::fmt::Display for SftpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SftpError::Plain(text) => f.write_str(text),
            SftpError::HostKeyChanged(_) => f.write_str("This server's identity has changed since you connected it. InFlight stopped, in case someone is in between. If you changed or reinstalled the server, remove this place and add it again."),
        }
    }
}

fn plain(text: &str) -> SftpError { SftpError::Plain(text.to_string()) }

fn plain_relative(path: &str) -> bool {
    !path.chars().any(|c| c == '\\' || c == ':' || c.is_control())
        && path.split('/').all(|part| !part.is_empty() && part != "." && part != "..")
}

/// Only InFlight's own files, as a plain relative path: no `..`, no absolute paths, no backslashes or control characters.
pub fn safe_relative(path: &str) -> Result<&str, SftpError> {
    let ok = (path == "kestrel/v1" || path.starts_with("kestrel/v1/")) && plain_relative(path);
    if ok { Ok(path) } else { Err(plain("That path is outside InFlight's folder.")) }
}

/// Exports may also go to an `export/` folder in the chosen place. Files there are written once and never read or removed.
pub fn is_export(path: &str) -> bool { path.starts_with("export/") && plain_relative(path) }

/// The server path for a relative one: the chosen folder, a slash, the path.
pub fn join(root: &str, path: &str) -> Result<String, SftpError> {
    let path = if is_export(path) { path } else { safe_relative(path)? };
    let root = root.trim_end_matches('/');
    if root.chars().any(|c| c.is_control()) { return Err(plain("The folder name is not valid.")); }
    Ok(if root.is_empty() { path.to_string() } else { format!("{root}/{path}") })
}

/// Checks the server's key against the pinned one, and records the key it saw for the caller.
struct Pin { pinned: Option<String>, seen: Arc<Mutex<Option<String>>> }

impl client::Handler for Pin {
    type Error = russh::Error;
    async fn check_server_key(&mut self, key: &russh::keys::PublicKeyOrCertificate) -> Result<bool, Self::Error> {
        let fingerprint = match key {
            russh::keys::PublicKeyOrCertificate::PublicKey { key, .. } => key.fingerprint(HashAlg::Sha256).to_string(),
            // A certificate is pinned by the key it certifies.
            russh::keys::PublicKeyOrCertificate::Certificate(cert) => cert.public_key().fingerprint(HashAlg::Sha256).to_string(),
        };
        let accept = self.pinned.as_deref().map_or(true, |pinned| pinned == fingerprint);
        if let Ok(mut seen) = self.seen.lock() { *seen = Some(fingerprint); }
        Ok(accept)
    }
}

struct Open { session: client::Handle<Pin>, sftp: SftpSession }

/// The SSH handshake alone, with the key check. Returns the session and the server's fingerprint.
async fn handshake(target: &Target) -> Result<(client::Handle<Pin>, String), SftpError> {
    if target.host.trim().is_empty() || target.user.trim().is_empty() { return Err(plain("Enter the server address and user name.")); }
    let config = Arc::new(client::Config { inactivity_timeout: Some(TIMEOUT), ..Default::default() });
    let seen = Arc::new(Mutex::new(None));
    let handler = Pin { pinned: target.pinned.clone(), seen: seen.clone() };
    let connecting = client::connect(config, (target.host.trim(), target.port), handler);
    let result = tokio::time::timeout(TIMEOUT, connecting).await;
    let fingerprint = seen.lock().ok().and_then(|seen| seen.clone());
    match result {
        Err(_) => Err(plain("The server did not answer. Check the address and port, and that you are online.")),
        Ok(Err(russh::Error::UnknownKey)) => Err(SftpError::HostKeyChanged(fingerprint.unwrap_or_default())),
        Ok(Err(error)) => Err(SftpError::Plain(connect_words(&error))),
        Ok(Ok(session)) => fingerprint.map(|f| (session, f)).ok_or_else(|| plain("The server did not identify itself.")),
    }
}

async fn open(target: &Target) -> Result<(Open, String), SftpError> {
    let (mut session, fingerprint) = handshake(target).await?;
    let auth = match &target.auth {
        Auth::Password(password) => session.authenticate_password(target.user.trim(), password).await,
        Auth::Key { pem, passphrase } => {
            let key = decode_secret_key(pem, passphrase.as_deref()).map_err(|_| plain("That private key could not be read. Check it is an OpenSSH key and the passphrase is right."))?;
            let hash = session.best_supported_rsa_hash().await.ok().flatten().flatten();
            session.authenticate_publickey(target.user.trim(), PrivateKeyWithHashAlg::new(Arc::new(key), hash)).await
        }
    };
    match auth {
        Ok(result) if result.success() => {}
        Ok(_) => return Err(plain("The server did not accept that user name and password or key.")),
        Err(error) => return Err(SftpError::Plain(connect_words(&error))),
    }
    let channel = session.channel_open_session().await.map_err(|e| SftpError::Plain(connect_words(&e)))?;
    channel.request_subsystem(true, "sftp").await.map_err(|_| plain("This server does not offer SFTP."))?;
    let sftp = SftpSession::new(channel.into_stream()).await.map_err(|_| plain("This server does not offer SFTP."))?;
    Ok((Open { session, sftp }, fingerprint))
}

fn connect_words(error: &russh::Error) -> String {
    match error {
        russh::Error::IO(_) | russh::Error::ConnectionTimeout | russh::Error::Disconnect => "Could not reach the server. Check the address and port, and that you are online.".into(),
        _ => "The SFTP connection failed. Check the address, port and sign-in.".into(),
    }
}

async fn close(open: Open) {
    let _ = open.sftp.close().await;
    let _ = open.session.disconnect(Disconnect::ByApplication, "", "en").await;
}

/// Connect, sign in and make sure InFlight's folder can be written. Returns the server's fingerprint to pin.
/// With a fingerprint already pinned, a different key is refused as `HostKeyChanged`.
pub async fn test(target: &Target) -> Result<String, SftpError> {
    let (open_, fingerprint) = open(target).await?;
    let made = match join(&target.root, "kestrel/v1") {
        Ok(path) => make_dirs(&open_.sftp, &path).await,
        Err(error) => Err(error),
    };
    close(open_).await;
    made?;
    Ok(fingerprint)
}

async fn make_dirs(sftp: &SftpSession, dir: &str) -> Result<(), SftpError> {
    let absolute = dir.starts_with('/');
    let mut so_far = String::new();
    for part in dir.split('/').filter(|p| !p.is_empty()) {
        so_far = if so_far.is_empty() { if absolute { format!("/{part}") } else { part.to_string() } } else { format!("{so_far}/{part}") };
        if sftp.try_exists(&so_far).await.unwrap_or(false) { continue; }
        sftp.create_dir(&so_far).await.map_err(|_| plain("InFlight cannot create its folder there. Check the folder and that this user may write to it."))?;
    }
    Ok(())
}

fn need_pin(target: &Target) -> Result<(), SftpError> {
    if target.pinned.as_deref().map_or(true, str::is_empty) { Err(plain("Check this place again before using it.")) } else { Ok(()) }
}

pub async fn put(target: &Target, path: &str, bytes: &[u8]) -> Result<(), SftpError> {
    need_pin(target)?;
    let full = join(&target.root, path)?;
    let export = is_export(path);
    let (o, _) = open(target).await?;
    let result = async {
        if let Some((parent, _)) = full.rsplit_once('/') { make_dirs(&o.sftp, parent).await?; }
        if export && o.sftp.try_exists(&full).await.unwrap_or(false) { return Err(plain("An export already exists at this destination. The file was not replaced.")); }
        // Write beside, then rename over, so a dropped connection never leaves half a backup under the real name.
        let partial = format!("{full}.partial");
        let mut file = o.sftp.open_with_flags(&partial, OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE).await.map_err(|_| plain("InFlight could not write to the server."))?;
        file.write_all(bytes).await.map_err(|_| plain("The upload did not finish. Your work is safe here; InFlight will try again."))?;
        file.shutdown().await.map_err(|_| plain("The upload did not finish. Your work is safe here; InFlight will try again."))?;
        if !export && o.sftp.try_exists(&full).await.unwrap_or(false) { let _ = o.sftp.remove_file(&full).await; }
        o.sftp.rename(&partial, &full).await.map_err(|_| plain("InFlight could not finish saving on the server."))
    }.await;
    close(o).await;
    result
}

pub async fn get(target: &Target, path: &str) -> Result<Option<Vec<u8>>, SftpError> {
    need_pin(target)?;
    let full = join(&target.root, safe_relative(path)?)?;
    let (o, _) = open(target).await?;
    let result = async {
        if !o.sftp.try_exists(&full).await.unwrap_or(false) { return Ok(None); }
        let size = o.sftp.metadata(&full).await.ok().and_then(|m| m.size).unwrap_or(0);
        if size > MAX_READ { return Err(plain("That file is too large to read back.")); }
        let mut file = o.sftp.open(&full).await.map_err(|_| plain("InFlight could not read from the server."))?;
        let mut bytes = Vec::with_capacity(size as usize);
        file.read_to_end(&mut bytes).await.map_err(|_| plain("InFlight could not read from the server."))?;
        Ok(Some(bytes))
    }.await;
    close(o).await;
    result
}

/// Most files one list returns, as the WebDAV connector does.
pub const MAX_LIST: usize = 5000;

/// Every file under one folder, as relative paths, sorted. A folder that is not there yet lists as empty.
pub async fn list(target: &Target, prefix: &str) -> Result<Vec<String>, SftpError> {
    need_pin(target)?;
    let base = prefix.trim_end_matches('/');
    safe_relative(base)?;
    let (o, _) = open(target).await?;
    let result = async {
        let mut out = Vec::new();
        let mut queue = vec![base.to_string()];
        while let Some(folder) = queue.pop() {
            if out.len() >= MAX_LIST { break; }
            let Ok(entries) = o.sftp.read_dir(join(&target.root, &folder)?).await else { continue };
            for entry in entries {
                let name = entry.file_name();
                if name == "." || name == ".." || name.contains('/') { continue; }
                let kind = entry.file_type();
                if kind.is_dir() { queue.push(format!("{folder}/{name}")); }
                else if kind.is_file() && !name.ends_with(".partial") { out.push(format!("{folder}/{name}")); }
            }
        }
        out.truncate(MAX_LIST);
        out.sort();
        Ok(out)
    }.await;
    close(o).await;
    result
}

pub async fn remove(target: &Target, path: &str) -> Result<(), SftpError> {
    need_pin(target)?;
    let full = join(&target.root, safe_relative(path)?)?;
    let (o, _) = open(target).await?;
    let _ = o.sftp.remove_file(&full).await;
    close(o).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_inflight_paths_are_allowed() {
        assert_eq!(join("/volume1/photos/", "kestrel/v1/a.json").unwrap(), "/volume1/photos/kestrel/v1/a.json");
        assert_eq!(join("", "kestrel/v1/a.json").unwrap(), "kestrel/v1/a.json");
        assert_eq!(join("r", "export/a.jpg").unwrap(), "r/export/a.jpg");
        assert!(safe_relative("export/a.jpg").is_err());
        for bad in ["export/../x", "../etc/passwd", "kestrel/v1/../../x", "/etc/passwd", "kestrel/v1/a\\b", "kestrel/v1//a", "other/x", "kestrel/v1/a:b"] {
            assert!(join("/r", bad).is_err(), "{bad}");
        }
    }

    /// Tauri runs async commands on a multi-threaded runtime, so every call's future must be Send.
    #[allow(dead_code)]
    fn futures_are_send(target: &Target) {
        fn send<T: Send>(_: T) {}
        send(test(target)); send(put(target, "", &[])); send(get(target, "")); send(list(target, "")); send(remove(target, ""));
    }

    #[test]
    fn calls_other_than_test_need_a_pinned_key() {
        let target = Target { host: "h".into(), port: 22, user: "u".into(), auth: Auth::Password("p".into()), root: String::new(), pinned: None };
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        assert!(matches!(rt.block_on(list(&target, "kestrel/v1")), Err(SftpError::Plain(_))));
    }
}
