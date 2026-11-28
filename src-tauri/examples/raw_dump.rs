//! Dump the untouched sensor data of a RAW file for the noise-training tools.
//!
//!   cargo run --release --example raw_dump -- <file.raw> <out-folder>
//!
//! Writes `<name>.u16` (little-endian 16-bit samples, row by row, the whole sensor area) and `<name>.json` (size, colour
//! filter pattern, black and white levels, ISO, make and model, and `decoder`: which decoder read the file).
//!
//! It uses the app's own sensor decoder, `kestrel_raw::nikon_he::decode_sensor`, so the dump is exactly what Kestrel sees,
//! whatever the brand: Nikon High Efficiency (HE and HE*) NEFs are decoded from the TicoRAW codestream by ticoraw
//! (`decoder` is `nikon-he` or `nikon-he-star`), and every other file by rawler (`rawler`). The original is only read.
use kestrel_raw::nikon_he::{decode_sensor, SensorDecoder};
use rawler::decoders::RawDecodeParams;
use rawler::rawimage::{RawImageData, RawPhotometricInterpretation};
use rawler::rawsource::RawSource;
use std::path::Path;

/// What was written, for the one-line summary.
struct Dumped {
    width: usize,
    height: usize,
    cpp: usize,
    cfa: Option<String>,
    decoder: SensorDecoder,
}

/// The ISO from the file's own EXIF, read from the original bytes. The decoded image does not carry it (the High
/// Efficiency path goes through an in-memory DNG), and rawler's metadata reader works on every NEF, HE included. The
/// extended ISO tag first, then the standard EXIF ISO (the Z 8 only fills the standard one). `None` when the file has
/// neither; the JSON then says `null`, never a guess.
fn file_iso(bytes: &[u8]) -> Option<u32> {
    std::panic::catch_unwind(|| {
        let source = RawSource::new_from_slice(bytes);
        let params = RawDecodeParams { image_index: 0 };
        let exif = rawler::get_decoder(&source).ok()?.raw_metadata(&source, &params).ok()?.exif;
        exif.iso_speed.or(exif.iso_speed_ratings.map(u32::from))
    })
    .ok()
    .flatten()
}

/// Decode `bytes` and write `<name>.u16` and `<name>.json` into `out`.
fn dump(bytes: &[u8], name: &str, out: &Path) -> Result<Dumped, Box<dyn std::error::Error>> {
    let (image, decoder) = decode_sensor(bytes)?;
    let iso = file_iso(bytes);

    let cfa = match &image.photometric {
        RawPhotometricInterpretation::Cfa(config) => Some((config.cfa.name.clone(), config.cfa.width, config.cfa.height)),
        _ => None,
    };
    let samples: Vec<u16> = match &image.data {
        RawImageData::Integer(values) => values.clone(),
        RawImageData::Float(values) => values.iter().map(|v| v.clamp(0.0, 65535.0) as u16).collect(),
    };
    if samples.len() != image.width * image.height * image.cpp {
        // A short or long dump would be read as a different picture; refuse instead.
        return Err(format!("decoded {} samples for a {}x{} image with {} channel(s)", samples.len(), image.width, image.height, image.cpp).into());
    }
    std::fs::create_dir_all(out)?;
    let mut raw = Vec::with_capacity(samples.len() * 2);
    for value in &samples { raw.extend_from_slice(&value.to_le_bytes()); }
    std::fs::write(out.join(format!("{name}.u16")), raw)?;

    let json = serde_json::json!({
        "name": name,
        "make": image.clean_make,
        "model": image.clean_model,
        "width": image.width,
        "height": image.height,
        "cpp": image.cpp,
        "cfa": cfa.as_ref().map(|c| c.0.as_str()).unwrap_or(""),
        "cfa_width": cfa.as_ref().map(|c| c.1).unwrap_or(0),
        "cfa_height": cfa.as_ref().map(|c| c.2).unwrap_or(0),
        "black": image.blacklevel.as_vec(),
        "white": image.whitelevel.as_vec(),
        "iso": iso,
        "decoder": decoder.label(),
    });
    std::fs::write(out.join(format!("{name}.json")), format!("{json}\n"))?;
    Ok(Dumped { width: image.width, height: image.height, cpp: image.cpp, cfa: cfa.map(|c| c.0), decoder })
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        eprintln!("usage: raw_dump <file> <out-folder>");
        std::process::exit(2);
    }
    let path = Path::new(&args[1]);
    let out = Path::new(&args[2]);
    let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("raw").to_string();

    let bytes = std::fs::read(path)?;
    let done = dump(&bytes, &name, out)?;
    println!("{name}: {}x{} cpp={} cfa={:?} decoder={}", done.width, done.height, done.cpp, done.cfa, done.decoder.label());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A synthetic Z 8 sensor: a smooth gradient on an RGGB mosaic with Z 8 levels. No camera file is needed.
    fn synthetic_z8(width: usize, height: usize) -> ticoraw::DecodedRaw {
        let pixels = (0..height)
            .flat_map(|y| (0..width).map(move |x| (1008 + ((x * 7 + y * 13) % 12000)) as u16))
            .collect();
        ticoraw::DecodedRaw {
            make: "NIKON CORPORATION".into(),
            model: "NIKON Z 8".into(),
            image: ticoraw::CfaImage { width, height, pixels },
            color: ticoraw::ColorInfo {
                cfa_pattern: [0, 1, 1, 2],
                black_level: [1008; 4],
                white_level: 15520,
                color_matrix: Some([(10000, 10000), (0, 1), (0, 1), (0, 1), (1, 1), (0, 1), (0, 1), (0, 1), (1, 1)]),
                as_shot_neutral: Some([(1, 2), (1, 1), (2, 3)]),
            },
            orientation: 1,
            crop: None,
            baseline_exposure: None,
        }
    }

    fn scratch(tag: &str) -> std::path::PathBuf {
        let folder = std::env::temp_dir().join(format!("kestrel-raw-dump-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&folder);
        folder
    }

    /// Every key the Python tools read (`make_pairs.py`, `raw_source.py`) is present, `decoder` says what read the file,
    /// and the `.u16` is the decoder's own mosaic, little-endian, with no sample changed.
    #[test]
    fn a_dump_has_the_keys_the_python_tools_read_and_says_which_decoder_read_it() {
        let synthetic = synthetic_z8(64, 48);
        let dng = ticoraw::dng::encode_uncompressed_dng(&synthetic).expect("encode");
        let out = scratch("synthetic");
        let done = dump(&dng, "frame", &out).expect("dump");
        assert_eq!((done.width, done.height, done.cpp), (64, 48, 1));
        assert_eq!(done.decoder, SensorDecoder::Rawler, "a DNG is read by rawler, never labelled as High Efficiency");

        let meta: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(out.join("frame.json")).unwrap()).expect("valid JSON");
        for key in ["name", "make", "model", "width", "height", "cpp", "cfa", "cfa_width", "cfa_height", "black", "white", "iso", "decoder"] {
            assert!(meta.get(key).is_some(), "missing key {key}: {meta}");
        }
        assert_eq!(meta["name"], "frame");
        assert_eq!((meta["width"].as_u64(), meta["height"].as_u64(), meta["cpp"].as_u64()), (Some(64), Some(48), Some(1)));
        assert_eq!(meta["cfa"], "RGGB");
        assert_eq!((meta["cfa_width"].as_u64(), meta["cfa_height"].as_u64()), (Some(2), Some(2)));
        assert_eq!(meta["decoder"], "rawler");
        assert!(meta["iso"].is_null(), "no ISO in the file means null, not a guess: {}", meta["iso"]);
        assert!(meta["black"].as_array().unwrap().iter().all(|v| v.as_f64() == Some(1008.0)), "{}", meta["black"]);
        assert_eq!(meta["white"][0].as_f64(), Some(15520.0), "{}", meta["white"]);

        let bytes = std::fs::read(out.join("frame.u16")).unwrap();
        assert_eq!(bytes.len(), 64 * 48 * 2);
        let samples: Vec<u16> = bytes.chunks_exact(2).map(|pair| u16::from_le_bytes([pair[0], pair[1]])).collect();
        assert_eq!(samples, synthetic.image.pixels, "no photosite may change");
        let _ = std::fs::remove_dir_all(&out);
    }

    #[test]
    fn a_file_that_is_not_a_raw_writes_nothing() {
        let out = scratch("junk");
        assert!(dump(b"II*\0junk", "junk", &out).is_err());
        assert!(!out.join("junk.json").exists() && !out.join("junk.u16").exists());
        let _ = std::fs::remove_dir_all(&out);
    }

    /// Optional, owner-provided files: point KESTREL_RAW_SAMPLES at a folder holding Nikon HE/HE* NEFs. Each must dump at
    /// full size and be labelled as decoded from the sensor data by ticoraw, which is what the bare rawler decoder could
    /// not do (the reason this example now calls `decode_sensor`).
    #[test]
    fn owner_high_efficiency_files_dump_from_sensor_data() {
        let Some(folder) = std::env::var_os("KESTREL_RAW_SAMPLES") else { return };
        let out = scratch("owner");
        let mut dumped = 0;
        for path in std::fs::read_dir(folder).expect("samples folder").flatten().map(|e| e.path()) {
            if !path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("nef")) { continue }
            let bytes = std::fs::read(&path).unwrap();
            if kestrel_raw::nikon_he::high_efficiency_mode(&bytes).is_none() { continue }
            let name = path.file_stem().and_then(|s| s.to_str()).unwrap().to_string();
            let done = dump(&bytes, &name, &out).unwrap_or_else(|e| panic!("{name}: {e}"));
            assert!(done.decoder.label().starts_with("nikon-he"), "{name}: {}", done.decoder.label());
            let size = std::fs::metadata(out.join(format!("{name}.u16"))).unwrap().len() as usize;
            assert_eq!(size, done.width * done.height * 2, "{name}: the dump is the whole sensor area");
            // File name only, never the private folder path.
            eprintln!("{name} | {} | {}x{} | cfa {:?}", done.decoder.label(), done.width, done.height, done.cfa);
            dumped += 1;
        }
        let _ = std::fs::remove_dir_all(&out);
        assert!(dumped > 0, "KESTREL_RAW_SAMPLES was set, but no Nikon HE/HE* NEFs were found");
    }
}
