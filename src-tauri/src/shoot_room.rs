//! Live shoot room: while the photographer has it on, this computer shows the shoot to other screens on the same
//! network (a client's iPad, a studio TV, an assistant's phone) in any web browser, with no account, app or internet.
//! New frames appear within a couple of seconds; people in the room can star and pick, and the app merges those marks
//! with the photographer's own using the shared-project rules (src/core/sharedMarks.ts), so nothing is overwritten.
//!
//! Only screen-sized previews the app publishes are served, never originals. Every request must carry the room's
//! random key (from the link or QR code the app shows). Marks arrive as small text the app validates before use.
//! Plain HTTP on the local network: the page says so, and the room exists only while it is switched on.
//! Standard library only, so it is tested without the rest of the Tauri build.

use std::collections::VecDeque;
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, Shutdown, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

const MAX_FRAMES: usize = 400;
const MAX_PREVIEW_BYTES: usize = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES: usize = 200 * 1024 * 1024;
const MAX_MARK_BYTES: usize = 1024;
const MAX_PENDING_MARKS: usize = 500;
const MAX_CONNECTIONS: u64 = 32;

pub struct RoomFrame {
    pub id: String,
    pub name: String,
    pub rating: u8,
    pub decision: String,
    /// True when the preview is the camera's own embedded JPEG (a RAW not yet developed here); the page says so.
    pub camera_preview: bool,
    pub version: u64,
    pub jpeg: Arc<Vec<u8>>,
}

#[derive(Default)]
pub struct RoomState {
    pub title: String,
    pub version: u64,
    pub frames: VecDeque<RoomFrame>,
    pub marks: Vec<String>,
}

impl RoomState {
    fn bytes(&self) -> usize { self.frames.iter().map(|frame| frame.jpeg.len()).sum() }

    /// Add or replace a frame's preview. The oldest frames leave the room (never the project) past the limits.
    pub fn put(&mut self, id: &str, name: &str, rating: u8, decision: &str, camera_preview: bool, jpeg: Vec<u8>) -> bool {
        if jpeg.is_empty() || jpeg.len() > MAX_PREVIEW_BYTES || !valid_id(id) || !valid_decision(decision) || rating > 5 { return false; }
        self.version += 1;
        let frame = RoomFrame { id: id.into(), name: clean_text(name), rating, decision: decision.into(), camera_preview, version: self.version, jpeg: Arc::new(jpeg) };
        if let Some(position) = self.frames.iter().position(|existing| existing.id == id) { self.frames[position] = frame; }
        else { self.frames.push_back(frame); }
        while self.frames.len() > MAX_FRAMES || (self.frames.len() > 1 && self.bytes() > MAX_TOTAL_BYTES) { self.frames.pop_front(); }
        true
    }

    /// The photographer changed a frame's stars or pick: the room shows it at the next look.
    pub fn set_marks(&mut self, id: &str, rating: u8, decision: &str) -> bool {
        if rating > 5 || !valid_decision(decision) { return false; }
        let next = self.version + 1;
        let Some(frame) = self.frames.iter_mut().find(|frame| frame.id == id) else { return false };
        if frame.rating == rating && frame.decision == decision { return true; }
        frame.rating = rating;
        frame.decision = decision.into();
        frame.version = next;
        self.version = next;
        true
    }

    pub fn remove(&mut self, id: &str) { self.frames.retain(|frame| frame.id != id); self.version += 1; }

    pub fn take_marks(&mut self) -> Vec<String> { std::mem::take(&mut self.marks) }

    /// The room as the page reads it, newest last.
    pub fn json(&self) -> String {
        let frames: Vec<String> = self.frames.iter().map(|frame| format!(
            "{{\"id\":\"{}\",\"name\":\"{}\",\"v\":{},\"rating\":{},\"decision\":\"{}\",\"camera\":{}}}",
            json_escape(&frame.id), json_escape(&frame.name), frame.version, frame.rating, frame.decision, frame.camera_preview)).collect();
        format!("{{\"title\":\"{}\",\"version\":{},\"frames\":[{}]}}", json_escape(&self.title), self.version, frames.join(","))
    }
}

fn valid_id(id: &str) -> bool { !id.is_empty() && id.len() <= 128 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') }
fn valid_decision(decision: &str) -> bool { matches!(decision, "unreviewed" | "keep" | "reject") }
fn clean_text(text: &str) -> String { text.chars().filter(|c| !c.is_control()).take(200).collect() }

pub fn json_escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '<' => out.push_str("\\u003c"),
            '>' => out.push_str("\\u003e"),
            '&' => out.push_str("\\u0026"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

pub struct RoomHandle {
    pub port: u16,
    pub state: Arc<Mutex<RoomState>>,
    stop: Arc<AtomicBool>,
}

impl RoomHandle {
    pub fn stop(&self) { self.stop.store(true, Ordering::SeqCst); }
}

impl Drop for RoomHandle {
    fn drop(&mut self) { self.stop(); }
}

/// Open the room on every network interface. `key` must be long and random; port 0 picks a free one.
pub fn start(key: String, title: String, port: u16) -> std::io::Result<RoomHandle> {
    if key.len() < 16 || !key.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "the room key must be 16 or more letters and digits"));
    }
    let listener = TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), port))?;
    listener.set_nonblocking(true)?;
    let port = listener.local_addr()?.port();
    let state = Arc::new(Mutex::new(RoomState { title: clean_text(&title), ..RoomState::default() }));
    let stop = Arc::new(AtomicBool::new(false));
    let (state_loop, stop_loop, key) = (state.clone(), stop.clone(), Arc::new(key));
    let open = Arc::new(AtomicU64::new(0));
    thread::spawn(move || {
        while !stop_loop.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((stream, _)) => {
                    if open.load(Ordering::SeqCst) >= MAX_CONNECTIONS { let _ = stream.shutdown(Shutdown::Both); continue; }
                    open.fetch_add(1, Ordering::SeqCst);
                    let (state, key, open) = (state_loop.clone(), key.clone(), open.clone());
                    thread::spawn(move || { let _ = handle(stream, &key, &state); open.fetch_sub(1, Ordering::SeqCst); });
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(50)),
                Err(_) => thread::sleep(Duration::from_millis(250)),
            }
        }
    });
    Ok(RoomHandle { port, state, stop })
}

fn query_value<'a>(query: &'a str, name: &str) -> Option<&'a str> {
    query.split('&').find_map(|pair| pair.split_once('=').filter(|(key, _)| *key == name).map(|(_, value)| value))
}

/// Compare keys without stopping at the first different character.
fn same_key(given: &str, key: &str) -> bool {
    given.len() == key.len() && given.bytes().zip(key.bytes()).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
}

fn respond(stream: &mut TcpStream, status: &str, kind: &str, body: &[u8]) -> std::io::Result<()> {
    write!(stream, "HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nX-Frame-Options: DENY\r\nContent-Security-Policy: default-src 'none'; img-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'\r\nConnection: close\r\n\r\n", body.len())?;
    stream.write_all(body)?;
    stream.flush()
}

fn handle(mut stream: TcpStream, key: &str, state: &Mutex<RoomState>) -> std::io::Result<()> {
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
    let mut buffer = Vec::with_capacity(4096);
    let mut chunk = [0u8; 4096];
    let head_end = loop {
        let read = stream.read(&mut chunk)?;
        if read == 0 { return Ok(()); }
        buffer.extend_from_slice(&chunk[..read]);
        if let Some(position) = buffer.windows(4).position(|w| w == b"\r\n\r\n") { break position + 4; }
        if buffer.len() > 16 * 1024 { return respond(&mut stream, "431 Request Header Fields Too Large", "text/plain", b""); }
    };
    let head = String::from_utf8_lossy(&buffer[..head_end]).into_owned();
    let mut words = head.lines().next().unwrap_or("").split_whitespace();
    let (method, target) = (words.next().unwrap_or(""), words.next().unwrap_or(""));
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if !query_value(query, "k").is_some_and(|given| same_key(given, key)) {
        return respond(&mut stream, "403 Forbidden", "text/html; charset=utf-8", FORBIDDEN.as_bytes());
    }
    match (method, path) {
        ("GET", "/") => respond(&mut stream, "200 OK", "text/html; charset=utf-8", PAGE.as_bytes()),
        ("GET", "/frames") => {
            let json = state.lock().map(|room| room.json()).unwrap_or_default();
            respond(&mut stream, "200 OK", "application/json", json.as_bytes())
        }
        ("GET", "/img") => {
            let id = query_value(query, "id").unwrap_or("");
            let jpeg = state.lock().ok().and_then(|room| room.frames.iter().find(|frame| frame.id == id).map(|frame| frame.jpeg.clone()));
            match jpeg { Some(bytes) => respond(&mut stream, "200 OK", "image/jpeg", &bytes), None => respond(&mut stream, "404 Not Found", "text/plain", b"") }
        }
        ("POST", "/mark") => {
            let length: usize = head.lines().find_map(|line| line.split_once(':').filter(|(name, _)| name.trim().eq_ignore_ascii_case("content-length")).and_then(|(_, value)| value.trim().parse().ok())).unwrap_or(0);
            if length == 0 || length > MAX_MARK_BYTES { return respond(&mut stream, "413 Payload Too Large", "text/plain", b""); }
            let mut body = buffer[head_end..].to_vec();
            while body.len() < length {
                let read = stream.read(&mut chunk)?;
                if read == 0 { break; }
                body.extend_from_slice(&chunk[..read]);
            }
            body.truncate(length);
            let Ok(text) = String::from_utf8(body) else { return respond(&mut stream, "400 Bad Request", "text/plain", b"") };
            let accepted = state.lock().map(|mut room| { if room.marks.len() < MAX_PENDING_MARKS { room.marks.push(text); true } else { false } }).unwrap_or(false);
            if accepted { respond(&mut stream, "202 Accepted", "text/plain", b"") } else { respond(&mut stream, "503 Service Unavailable", "text/plain", b"") }
        }
        _ => respond(&mut stream, "404 Not Found", "text/plain", b""),
    }
}

const FORBIDDEN: &str = "<!doctype html><html lang=\"en-GB\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>InFlight</title><body style=\"font-family:system-ui,sans-serif;background:#111;color:#eee;padding:2rem\"><p>This link is not for this shoot, or the shoot has ended. Ask the photographer for the current link.</p></body></html>";

const PAGE: &str = include_str!("shoot_room.html");

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "abcdefghijklmnop1234";

    fn get(port: u16, target: &str) -> (String, Vec<u8>) {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(stream, "GET {target} HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
        let mut out = Vec::new();
        stream.read_to_end(&mut out).unwrap();
        let split = out.windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 4;
        (String::from_utf8_lossy(&out[..split]).into_owned(), out[split..].to_vec())
    }

    fn post(port: u16, target: &str, body: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(stream, "POST {target} HTTP/1.1\r\nHost: x\r\nContent-Length: {}\r\n\r\n{body}", body.len()).unwrap();
        let mut out = String::new();
        stream.read_to_string(&mut out).unwrap();
        out
    }

    #[test]
    fn serves_frames_and_previews_only_with_the_key() {
        let room = start(KEY.into(), "Wedding".into(), 0).unwrap();
        room.state.lock().unwrap().put("f1", "IMG_1.CR3", 0, "unreviewed", true, vec![0xff, 0xd8, 1, 2]);
        assert!(get(room.port, "/frames").0.starts_with("HTTP/1.1 403"));
        assert!(get(room.port, "/frames?k=abcdefghijklmnop1235").0.starts_with("HTTP/1.1 403"));
        let (head, body) = get(room.port, &format!("/frames?k={KEY}"));
        assert!(head.starts_with("HTTP/1.1 200"));
        let json = String::from_utf8(body).unwrap();
        assert!(json.contains("\"title\":\"Wedding\"") && json.contains("\"id\":\"f1\"") && json.contains("\"camera\":true"), "{json}");
        let (head, body) = get(room.port, &format!("/img?k={KEY}&id=f1"));
        assert!(head.contains("image/jpeg"));
        assert_eq!(body, vec![0xff, 0xd8, 1, 2]);
        assert!(get(room.port, &format!("/?k={KEY}")).0.contains("text/html"));
    }

    #[test]
    fn marks_from_the_room_are_queued_for_the_app_to_check() {
        let room = start(KEY.into(), "Shoot".into(), 0).unwrap();
        assert!(post(room.port, &format!("/mark?k={KEY}"), "{\"id\":\"f1\",\"rating\":4}").starts_with("HTTP/1.1 202"));
        assert!(post(room.port, "/mark?k=wrong", "{}").starts_with("HTTP/1.1 403"));
        assert!(post(room.port, &format!("/mark?k={KEY}"), &"x".repeat(2000)).starts_with("HTTP/1.1 413"));
        assert_eq!(room.state.lock().unwrap().take_marks(), vec!["{\"id\":\"f1\",\"rating\":4}".to_string()]);
        assert!(room.state.lock().unwrap().take_marks().is_empty());
    }

    #[test]
    fn photographer_marks_bump_the_version_and_old_frames_leave_the_room() {
        let mut room = RoomState::default();
        assert!(room.put("a", "a.jpg", 0, "unreviewed", false, vec![1]));
        let before = room.version;
        assert!(room.set_marks("a", 5, "keep"));
        assert!(room.version > before);
        assert!(room.json().contains("\"rating\":5,\"decision\":\"keep\""));
        assert!(!room.put("bad id!", "x", 0, "keep", false, vec![1]));
        assert!(!room.put("b", "x", 6, "keep", false, vec![1]));
        for index in 0..MAX_FRAMES + 5 { room.put(&format!("f{index}"), "x.jpg", 0, "unreviewed", false, vec![1]); }
        assert_eq!(room.frames.len(), MAX_FRAMES);
        assert!(!room.frames.iter().any(|frame| frame.id == "a"));
    }

    #[test]
    fn names_cannot_break_out_of_the_page_data() {
        assert_eq!(json_escape("a\"</script>\n"), "a\\\"\\u003c/script\\u003e\\u000a");
    }

    #[test]
    fn refuses_a_short_key() {
        assert!(start("short".into(), "x".into(), 0).is_err());
    }
}
