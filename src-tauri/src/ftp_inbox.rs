//! FTP inbox for a live shoot: cameras that send frames over Wi-Fi (Canon, Nikon, Sony, Fujifilm and others call it
//! "FTP transfer") push each shot here, and the app's hot-folder watch imports it as soon as it has landed.
//!
//! Deliberately small and receive-only. It accepts uploads (STOR) into one folder and nothing else: no downloads, no
//! deletes, no renames, no way to leave the folder. Every connection must give the user name and password InFlight
//! made for this shoot. A frame is written as `name.part` and renamed when complete, so a half-sent frame is never
//! imported, and an existing file is never overwritten (a clash gets ` (2)`, ` (3)`… before the extension).
//! Standard library only, so it is tested without the rest of the Tauri build.
//!
//! Plain FTP is not encrypted: the password and frames cross the local network in the clear, as with every camera's
//! FTP mode. The app says so beside the switch; it listens only while the person has it on.

use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{IpAddr, Ipv4Addr, Shutdown, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

/// Largest single frame accepted (a 100 MP RAW is about 200 MB; video is not what this is for).
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_CONNECTIONS: u64 = 16;

#[derive(Clone)]
pub struct InboxConfig {
    pub folder: PathBuf,
    pub user: String,
    pub password: String,
}

#[derive(Default)]
pub struct InboxCounters {
    pub received: AtomicU64,
    pub connections: AtomicU64,
    pub last_name: Mutex<Option<String>>,
}

pub struct InboxHandle {
    pub port: u16,
    stop: Arc<AtomicBool>,
    pub counters: Arc<InboxCounters>,
}

impl InboxHandle {
    pub fn stop(&self) { self.stop.store(true, Ordering::SeqCst); }
}

impl Drop for InboxHandle {
    fn drop(&mut self) { self.stop(); }
}

/// Start listening on every network interface (the camera is another device on the same Wi-Fi). Port 0 picks one.
pub fn start(config: InboxConfig, port: u16) -> std::io::Result<InboxHandle> {
    if config.user.is_empty() || config.password.len() < 6 {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "a user name and a password of 6 or more characters are needed"));
    }
    fs::create_dir_all(&config.folder)?;
    let listener = TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), port))?;
    listener.set_nonblocking(true)?;
    let port = listener.local_addr()?.port();
    let stop = Arc::new(AtomicBool::new(false));
    let counters = Arc::new(InboxCounters::default());
    let (stop_loop, counters_loop) = (stop.clone(), counters.clone());
    thread::spawn(move || {
        while !stop_loop.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((stream, _)) => {
                    if counters_loop.connections.load(Ordering::SeqCst) >= MAX_CONNECTIONS {
                        let _ = (&stream).write_all(b"421 Too many connections.\r\n");
                        continue;
                    }
                    let (config, stop, counters) = (config.clone(), stop_loop.clone(), counters_loop.clone());
                    counters.connections.fetch_add(1, Ordering::SeqCst);
                    thread::spawn(move || {
                        let _ = serve(stream, &config, &stop, &counters);
                        counters.connections.fetch_sub(1, Ordering::SeqCst);
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(100)),
                Err(_) => thread::sleep(Duration::from_millis(250)),
            }
        }
    });
    Ok(InboxHandle { port, stop, counters })
}

/// This computer's addresses on the local network, to type into the camera. Sends nothing: a UDP "connect" only asks
/// the system which interface it would use for each kind of address.
pub fn local_addresses() -> Vec<String> {
    let mut found: Vec<String> = Vec::new();
    for probe in ["192.168.255.255:9", "10.255.255.255:9", "172.31.255.255:9", "8.8.8.8:9"] {
        let Ok(socket) = UdpSocket::bind("0.0.0.0:0") else { continue };
        if socket.connect(probe).is_err() { continue; }
        if let Ok(SocketAddr::V4(local)) = socket.local_addr() {
            let ip = *local.ip();
            if ip.is_private() && !found.contains(&ip.to_string()) { found.push(ip.to_string()); }
        }
    }
    found
}

/// The file name to write: the last part of what the camera sent, with nothing that could leave the folder.
pub fn safe_name(requested: &str) -> Option<String> {
    let last = requested.rsplit(['/', '\\']).next()?.trim();
    let cleaned: String = last.chars().filter(|c| !c.is_control() && !matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|')).collect();
    let cleaned = cleaned.trim_start_matches('.').trim().to_string();
    if cleaned.is_empty() || cleaned.len() > 200 { None } else { Some(cleaned) }
}

/// A path in `folder` for `name` that does not exist yet (never overwrite a frame already received).
pub fn free_path(folder: &Path, name: &str) -> PathBuf {
    let candidate = folder.join(name);
    if !candidate.exists() && !folder.join(format!("{name}.part")).exists() { return candidate; }
    let (stem, extension) = match name.rsplit_once('.') { Some((stem, ext)) if !stem.is_empty() => (stem, format!(".{ext}")), _ => (name, String::new()) };
    for index in 2..10_000 {
        let next = format!("{stem} ({index}){extension}");
        if !folder.join(&next).exists() && !folder.join(format!("{next}.part")).exists() { return folder.join(next); }
    }
    folder.join(format!("{stem} ({}){extension}", std::process::id()))
}

enum Data { None, Passive(TcpListener), Active(SocketAddr) }

fn reply(stream: &mut TcpStream, line: &str) -> std::io::Result<()> {
    stream.write_all(line.as_bytes())?;
    stream.write_all(b"\r\n")
}

fn open_data(data: &mut Data, peer: IpAddr) -> Option<TcpStream> {
    let stream = match std::mem::replace(data, Data::None) {
        Data::Passive(listener) => {
            listener.set_nonblocking(false).ok()?;
            // Only the camera that asked may connect to the data port.
            let (stream, from) = listener.accept().ok()?;
            if from.ip() != peer { return None; }
            stream
        }
        // Active mode connects back to the camera that asked, never to another address it names.
        Data::Active(address) if address.ip() == peer => TcpStream::connect_timeout(&address, Duration::from_secs(10)).ok()?,
        _ => return None,
    };
    stream.set_read_timeout(Some(Duration::from_secs(60))).ok()?;
    Some(stream)
}

fn receive(mut data: TcpStream, path: &Path) -> std::io::Result<u64> {
    let partial = PathBuf::from(format!("{}.part", path.display()));
    let mut file: File = OpenOptions::new().write(true).create_new(true).open(&partial)?;
    let mut buffer = vec![0u8; 256 * 1024];
    let mut total = 0u64;
    let result = loop {
        match data.read(&mut buffer) {
            Ok(0) => break Ok(total),
            Ok(read) => {
                total += read as u64;
                if total > MAX_FILE_BYTES { break Err(std::io::Error::other("too large")); }
                if let Err(error) = file.write_all(&buffer[..read]) { break Err(error); }
            }
            Err(error) => break Err(error),
        }
    };
    drop(file);
    match result {
        Ok(total) if total > 0 => { fs::rename(&partial, path)?; Ok(total) }
        Ok(_) => { let _ = fs::remove_file(&partial); Err(std::io::Error::other("empty")) }
        Err(error) => { let _ = fs::remove_file(&partial); Err(error) }
    }
}

fn serve(mut stream: TcpStream, config: &InboxConfig, stop: &AtomicBool, counters: &InboxCounters) -> std::io::Result<()> {
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(Duration::from_secs(300)))?;
    let peer = stream.peer_addr()?.ip();
    let local = stream.local_addr()?.ip();
    let mut reader = BufReader::new(stream.try_clone()?);
    reply(&mut stream, "220 InFlight live shoot inbox")?;
    let (mut user_ok, mut logged_in, mut failures) = (false, false, 0u32);
    let mut cwd = String::from("/");
    let mut data = Data::None;
    let mut line = String::new();
    while !stop.load(Ordering::SeqCst) {
        line.clear();
        if reader.by_ref().take(4096).read_line(&mut line)? == 0 { break; }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        let (command, argument) = trimmed.split_once(' ').unwrap_or((trimmed, ""));
        let command = command.to_ascii_uppercase();
        if !logged_in && !matches!(command.as_str(), "USER" | "PASS" | "QUIT" | "FEAT" | "SYST" | "AUTH" | "OPTS" | "NOOP") {
            reply(&mut stream, "530 Please log in.")?;
            continue;
        }
        match command.as_str() {
            "USER" => { user_ok = argument == config.user; logged_in = false; reply(&mut stream, "331 Password, please.")?; }
            "PASS" => {
                if user_ok && argument == config.password { logged_in = true; reply(&mut stream, "230 Ready for photos.")?; }
                else {
                    failures += 1;
                    thread::sleep(Duration::from_secs(1)); // slow down guessing
                    reply(&mut stream, "530 Wrong user name or password.")?;
                    if failures >= 3 { break; }
                }
            }
            "AUTH" => reply(&mut stream, "502 Encrypted FTP is not available. Use plain FTP.")?,
            "SYST" => reply(&mut stream, "215 UNIX Type: L8")?,
            "FEAT" => { reply(&mut stream, "211-Features:")?; reply(&mut stream, " EPSV")?; reply(&mut stream, " PASV")?; reply(&mut stream, " UTF8")?; reply(&mut stream, "211 End")?; }
            "OPTS" => reply(&mut stream, "200 OK.")?,
            "NOOP" => reply(&mut stream, "200 OK.")?,
            "PWD" | "XPWD" => reply(&mut stream, &format!("257 \"{cwd}\""))?,
            // Folders are accepted so a camera's own folder settings work, but every frame lands in the one inbox folder.
            "CWD" | "XCWD" => {
                cwd = if argument.starts_with('/') { argument.to_string() } else { format!("{}/{}", cwd.trim_end_matches('/'), argument) };
                if cwd.is_empty() { cwd = "/".into(); }
                reply(&mut stream, "250 OK.")?;
            }
            "CDUP" | "XCUP" => { cwd = "/".into(); reply(&mut stream, "250 OK.")?; }
            "MKD" | "XMKD" => reply(&mut stream, &format!("257 \"{argument}\" created."))?,
            "TYPE" | "MODE" | "STRU" => reply(&mut stream, "200 OK.")?,
            "ALLO" => reply(&mut stream, "202 No storage allocation necessary.")?,
            "PASV" => {
                let IpAddr::V4(ip) = local else { reply(&mut stream, "522 Use EPSV.")?; continue; };
                let listener = TcpListener::bind(SocketAddr::new(local, 0))?;
                let port = listener.local_addr()?.port();
                let [a, b, c, d] = ip.octets();
                data = Data::Passive(listener);
                reply(&mut stream, &format!("227 Entering Passive Mode ({a},{b},{c},{d},{},{})", port >> 8, port & 0xff))?;
            }
            "EPSV" => {
                let listener = TcpListener::bind(SocketAddr::new(local, 0))?;
                let port = listener.local_addr()?.port();
                data = Data::Passive(listener);
                reply(&mut stream, &format!("229 Entering Extended Passive Mode (|||{port}|)"))?;
            }
            "PORT" => {
                let parts: Vec<u16> = argument.split(',').filter_map(|part| part.trim().parse().ok()).collect();
                if parts.len() == 6 && parts.iter().all(|&p| p <= 255) {
                    let ip = Ipv4Addr::new(parts[0] as u8, parts[1] as u8, parts[2] as u8, parts[3] as u8);
                    data = Data::Active(SocketAddr::new(IpAddr::V4(ip), parts[4] * 256 + parts[5]));
                    reply(&mut stream, "200 OK.")?;
                } else { reply(&mut stream, "501 Bad address.")?; }
            }
            "STOR" => {
                let Some(name) = safe_name(argument) else { reply(&mut stream, "553 That file name cannot be used.")?; continue; };
                let path = free_path(&config.folder, &name);
                reply(&mut stream, "150 Sending.")?;
                match open_data(&mut data, peer).map(|socket| receive(socket, &path)) {
                    Some(Ok(_)) => {
                        counters.received.fetch_add(1, Ordering::SeqCst);
                        if let Ok(mut last) = counters.last_name.lock() { *last = path.file_name().map(|n| n.to_string_lossy().into_owned()); }
                        reply(&mut stream, "226 Received.")?;
                    }
                    Some(Err(_)) => reply(&mut stream, "451 The photo did not arrive completely. Send it again.")?,
                    None => reply(&mut stream, "425 Could not open the data connection.")?,
                }
            }
            "LIST" | "NLST" | "MLSD" => {
                // Nothing is listed: the inbox only receives. An empty listing keeps cameras that check first happy.
                reply(&mut stream, "150 Listing.")?;
                if let Some(socket) = open_data(&mut data, peer) { let _ = socket.shutdown(Shutdown::Both); }
                reply(&mut stream, "226 Done.")?;
            }
            "SIZE" | "MDTM" | "RETR" | "DELE" | "RNFR" | "RNTO" | "RMD" | "REST" | "APPE" | "SITE" => reply(&mut stream, "550 Not available: this inbox only receives photos.")?,
            "QUIT" => { reply(&mut stream, "221 Goodbye.")?; break; }
            _ => reply(&mut stream, "502 Not available.")?,
        }
    }
    let _ = stream.shutdown(Shutdown::Both);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_folder(name: &str) -> PathBuf {
        let folder = std::env::temp_dir().join(format!("inflight-ftp-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&folder);
        fs::create_dir_all(&folder).unwrap();
        folder
    }

    struct Client { control: TcpStream, reader: BufReader<TcpStream> }
    impl Client {
        fn connect(port: u16) -> Client {
            let control = TcpStream::connect(("127.0.0.1", port)).unwrap();
            control.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut client = Client { reader: BufReader::new(control.try_clone().unwrap()), control };
            assert!(client.line().starts_with("220"));
            client
        }
        fn line(&mut self) -> String { let mut line = String::new(); self.reader.read_line(&mut line).unwrap(); line }
        fn send(&mut self, command: &str) -> String { write!(self.control, "{command}\r\n").unwrap(); self.line() }
        fn login(&mut self, password: &str) -> String { assert!(self.send("USER camera").starts_with("331")); self.send(&format!("PASS {password}")) }
        fn upload(&mut self, name: &str, bytes: &[u8]) -> String {
            let reply = self.send("EPSV");
            let port: u16 = reply.split("|||").nth(1).unwrap().trim_end_matches(|c: char| !c.is_ascii_digit()).parse().unwrap();
            let mut data = TcpStream::connect(("127.0.0.1", port)).unwrap();
            write!(self.control, "STOR {name}\r\n").unwrap();
            assert!(self.line().starts_with("150"));
            data.write_all(bytes).unwrap();
            drop(data);
            self.line()
        }
    }

    fn inbox(name: &str) -> (PathBuf, InboxHandle) {
        let folder = temp_folder(name);
        let handle = start(InboxConfig { folder: folder.clone(), user: "camera".into(), password: "s3cret-pass".into() }, 0).unwrap();
        (folder, handle)
    }

    #[test]
    fn receives_a_frame_into_the_folder_whole() {
        let (folder, handle) = inbox("receive");
        let mut client = Client::connect(handle.port);
        assert!(client.login("s3cret-pass").starts_with("230"));
        assert!(client.send("CWD /DCIM/100CANON").starts_with("250"));
        assert!(client.upload("IMG_0001.CR3", b"raw bytes").starts_with("226"));
        assert_eq!(fs::read(folder.join("IMG_0001.CR3")).unwrap(), b"raw bytes");
        assert!(!folder.join("IMG_0001.CR3.part").exists());
        assert_eq!(handle.counters.received.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn never_overwrites_a_frame_already_received() {
        let (folder, handle) = inbox("clash");
        let mut client = Client::connect(handle.port);
        client.login("s3cret-pass");
        client.upload("DSC_0001.NEF", b"first");
        client.upload("DSC_0001.NEF", b"second");
        assert_eq!(fs::read(folder.join("DSC_0001.NEF")).unwrap(), b"first");
        assert_eq!(fs::read(folder.join("DSC_0001 (2).NEF")).unwrap(), b"second");
    }

    #[test]
    fn refuses_wrong_password_and_anything_before_login() {
        let (_folder, handle) = inbox("login");
        let mut client = Client::connect(handle.port);
        assert!(client.send("EPSV").starts_with("530"));
        assert!(client.login("guess").starts_with("530"));
        assert!(client.send("STOR x.jpg").starts_with("530"));
    }

    #[test]
    fn cannot_read_delete_or_leave_the_folder() {
        let (folder, handle) = inbox("escape");
        let mut client = Client::connect(handle.port);
        client.login("s3cret-pass");
        assert!(client.send("RETR IMG_0001.CR3").starts_with("550"));
        assert!(client.send("DELE IMG_0001.CR3").starts_with("550"));
        assert!(client.upload("../../escape.jpg", b"x").starts_with("226"));
        assert!(folder.join("escape.jpg").exists());
        assert!(!folder.parent().unwrap().join("escape.jpg").exists());
    }

    #[test]
    fn names_are_cleaned_to_one_safe_file_name() {
        assert_eq!(safe_name("/DCIM/100CANON/IMG_1.CR3").as_deref(), Some("IMG_1.CR3"));
        assert_eq!(safe_name("..\\..\\x.jpg").as_deref(), Some("x.jpg"));
        assert_eq!(safe_name(".hidden").as_deref(), Some("hidden"));
        assert_eq!(safe_name("..").as_deref(), None);
        assert_eq!(safe_name("a:b?.jpg").as_deref(), Some("ab.jpg"));
    }

    #[test]
    fn refuses_a_weak_password() {
        assert!(start(InboxConfig { folder: temp_folder("weak"), user: "camera".into(), password: "123".into() }, 0).is_err());
    }
}
