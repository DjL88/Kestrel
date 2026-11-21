//! One-shot loopback listener for desktop sign-in to Dropbox, Google Drive and OneDrive.
//!
//! The app opens the provider's sign-in page in the system browser with `http://localhost:53682/oauth-callback` as the
//! redirect. This listens on 127.0.0.1 only (never the network), accepts the single redirect, hands the query string
//! (`code` and `state`, or `error`) to the app and stops. The app checks `state` and swaps the code for a token itself.
//! Standard library only, so it is tested without the rest of the Tauri build.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream};
use std::time::{Duration, Instant};

pub const PORT: u16 = 53682;
pub const CALLBACK_PATH: &str = "/oauth-callback";
const PAGE: &str = "<!doctype html><html lang=\"en-GB\"><meta charset=\"utf-8\"><title>Kestrel</title><body style=\"font-family:system-ui,sans-serif;background:#111;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0\"><p>You can close this tab and go back to Kestrel.</p></body></html>";

/// Listen on this computer only.
pub fn bind(port: u16) -> std::io::Result<TcpListener> {
    let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port))?;
    listener.set_nonblocking(true)?;
    Ok(listener)
}

/// Split `GET /path?query HTTP/1.1` into path and query. Anything else is not a callback.
pub fn parse_request_line(head: &str) -> Option<(String, String)> {
    let line = head.lines().next()?;
    let mut parts = line.split_whitespace();
    if parts.next()? != "GET" { return None; }
    let target = parts.next()?;
    if !parts.next()?.starts_with("HTTP/") { return None; }
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    Some((path.to_string(), query.to_string()))
}

/// True for the redirect that carries an answer (a code or an error), not a stray request such as /favicon.ico.
pub fn is_answer(path: &str, query: &str) -> bool {
    path == CALLBACK_PATH && query.split('&').any(|pair| pair.starts_with("code=") || pair.starts_with("error="))
}

fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}", body.len());
    let _ = stream.flush();
}

/// Wait for the one redirect. Returns its query string, or why none came. Other requests are answered 404 and ignored.
pub fn wait_for_callback(listener: &TcpListener, timeout: Duration) -> Result<String, String> {
    let deadline = Instant::now() + timeout;
    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_nonblocking(false);
                let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                let mut buffer = [0u8; 8192];
                let mut length = 0;
                while length < buffer.len() {
                    match stream.read(&mut buffer[length..]) {
                        Ok(0) | Err(_) => break,
                        Ok(read) => { length += read; if buffer[..length].windows(2).any(|w| w == b"\r\n") { break; } }
                    }
                }
                let head = String::from_utf8_lossy(&buffer[..length]).into_owned();
                match parse_request_line(&head) {
                    Some((path, query)) if is_answer(&path, &query) => { respond(&mut stream, "200 OK", PAGE); return Ok(query); }
                    _ => respond(&mut stream, "404 Not Found", ""),
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline { return Err("Sign-in did not finish in time. Nothing changed; try again.".to_string()); }
                std::thread::sleep(Duration::from_millis(40));
            }
            Err(error) => return Err(format!("Could not listen for the sign-in: {error}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn get(port: u16, target: &str) -> String {
        let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
        write!(stream, "GET {target} HTTP/1.1\r\nHost: localhost\r\n\r\n").unwrap();
        let mut out = String::new();
        stream.read_to_string(&mut out).unwrap();
        out
    }

    #[test]
    fn parses_only_get_requests() {
        assert_eq!(parse_request_line("GET /oauth-callback?code=a&state=b HTTP/1.1\r\n"), Some(("/oauth-callback".into(), "code=a&state=b".into())));
        assert_eq!(parse_request_line("GET /x HTTP/1.1"), Some(("/x".into(), String::new())));
        assert_eq!(parse_request_line("POST /oauth-callback?code=a HTTP/1.1"), None);
        assert_eq!(parse_request_line("garbage"), None);
    }

    #[test]
    fn only_the_callback_with_an_answer_counts() {
        assert!(is_answer("/oauth-callback", "code=a&state=b"));
        assert!(is_answer("/oauth-callback", "state=b&error=access_denied"));
        assert!(!is_answer("/oauth-callback", "state=b"));
        assert!(!is_answer("/favicon.ico", "code=a"));
        assert!(!is_answer("/oauth-callback/extra", "code=a"));
    }

    #[test]
    fn stray_requests_are_ignored_and_the_real_redirect_is_returned() {
        let listener = bind(0).unwrap();
        let port = listener.local_addr().unwrap().port();
        let browser = std::thread::spawn(move || {
            let stray = get(port, "/favicon.ico");
            let answer = get(port, "/oauth-callback?code=abc&state=xyz");
            (stray, answer)
        });
        let query = wait_for_callback(&listener, Duration::from_secs(5)).unwrap();
        assert_eq!(query, "code=abc&state=xyz");
        let (stray, answer) = browser.join().unwrap();
        assert!(stray.starts_with("HTTP/1.1 404"));
        assert!(answer.starts_with("HTTP/1.1 200") && answer.contains("close this tab"));
    }

    #[test]
    fn gives_up_after_the_timeout_and_listens_on_this_computer_only() {
        let listener = bind(0).unwrap();
        assert!(listener.local_addr().unwrap().ip().is_loopback());
        assert!(wait_for_callback(&listener, Duration::from_millis(150)).unwrap_err().contains("did not finish"));
    }
}
