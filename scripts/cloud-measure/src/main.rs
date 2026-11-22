//! Prints one JSON line per RAW file: size, decode+develop (16-bit) time, JPEG develop time, peak-ish output size.
//! Read-only on the inputs. No network. Usage: cloud-measure <file>... [--runs N]
use std::{env, fs, time::Instant};

fn main() {
    let mut runs = 3usize;
    let mut files = vec![];
    let mut it = env::args().skip(1);
    while let Some(a) = it.next() {
        if a == "--runs" { runs = it.next().and_then(|v| v.parse().ok()).unwrap_or(3); } else { files.push(a); }
    }
    for path in files {
        let bytes = match fs::read(&path) { Ok(b) => b, Err(e) => { println!("{{\"file\":{:?},\"error\":{:?}}}", path, e.to_string()); continue; } };
        let (mut rgb16_ms, mut jpeg_ms) = (vec![], vec![]);
        let (mut w, mut h, mut jpeg_bytes, mut err): (u32, u32, usize, Option<String>) = (0, 0, 0, None);
        for _ in 0..runs {
            let t = Instant::now();
            match kestrel_raw::develop_rgb16(&bytes) {
                Ok(img) => { w = img.width(); h = img.height(); rgb16_ms.push(t.elapsed().as_secs_f64() * 1000.0); }
                Err(e) => { err = Some(e); break; }
            }
            let t = Instant::now();
            match kestrel_raw::develop_jpeg(&bytes) {
                Ok(j) => { jpeg_bytes = j.len(); jpeg_ms.push(t.elapsed().as_secs_f64() * 1000.0); }
                Err(e) => { err = Some(e); break; }
            }
        }
        let name = std::path::Path::new(&path).file_name().unwrap().to_string_lossy().to_string();
        if let Some(e) = err { println!("{{\"file\":{:?},\"bytes\":{},\"error\":{:?}}}", name, bytes.len(), e); continue; }
        let med = |v: &mut Vec<f64>| { v.sort_by(|a, b| a.partial_cmp(b).unwrap()); v[v.len() / 2] };
        println!("{{\"file\":{:?},\"bytes\":{},\"width\":{},\"height\":{},\"runs\":{},\"develop_rgb16_ms\":{:.0},\"develop_jpeg_ms\":{:.0},\"jpeg_bytes\":{}}}",
            name, bytes.len(), w, h, runs, med(&mut rgb16_ms), med(&mut jpeg_ms), jpeg_bytes);
    }
}
