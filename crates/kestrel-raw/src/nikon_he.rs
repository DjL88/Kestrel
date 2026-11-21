//! Nikon High Efficiency (HE and HE*) RAW decoding from the sensor data.
//!
//! In HE and HE* modes the Z 8, Z 9, Z f, Z6III, Z5II, Z50II and ZR store the Bayer mosaic as a TicoRAW (JPEG XS)
//! codestream, which rawler cannot read. The `ticoraw` crate (MIT OR Apache-2.0, pure Rust, no `unsafe`) decodes that
//! codestream to the camera's 14-bit CFA values. Kestrel then wraps the mosaic, its levels, colour matrix, as-shot white
//! balance, crop and orientation in an uncompressed DNG held in memory, and hands that DNG to rawler. Every later stage
//! (demosaic, Kestrel's own develop in `scene_develop.rs`, the 16-bit master) is therefore the same code every other
//! camera uses. The original file is only read.
//!
//! Patent note: the TicoRAW/JPEG XS codec is covered by patents, and the crate's copyright licence is not a patent
//! licence. The owner decided (19 Nov 2026) to ship it in every build; it stays behind the default-on `nikon-he`
//! Cargo feature so a build without it remains one flag away (NOTICE.md).
//!
//! Verified 19 Nov 2026 on the 12 CC0 conformance samples reachable from ticoraw's manifest (Z 9, Z 8, Z f, Z6III, Z5II and
//! Z50II, HE and HE*): every decoded mosaic's SHA-256 equals the Adobe-verified `cfa_sha256`.

// Without the feature only rawler runs, so the HE-only items are unused there.
#![cfg_attr(not(feature = "nikon-he"), allow(dead_code))]

use rawler::decoders::RawDecodeParams;
use rawler::rawsource::RawSource;
use rawler::RawImage;

/// Which decoder produced the sensor data, so no screen can claim more than happened.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SensorDecoder {
    /// rawler read the file directly (lossless and lossy-compressed NEF, other makers, DNG).
    Rawler,
    /// Nikon High Efficiency, decoded by ticoraw from the TicoRAW codestream.
    NikonHe,
    /// Nikon High Efficiency*, decoded by ticoraw from the TicoRAW codestream.
    NikonHeStar,
}

impl SensorDecoder {
    pub fn label(self) -> &'static str {
        match self {
            SensorDecoder::Rawler => "rawler",
            SensorDecoder::NikonHe => "nikon-he",
            SensorDecoder::NikonHeStar => "nikon-he-star",
        }
    }
}

/// Enough of the file's start for the container and codestream headers. ticoraw documents "a megabyte or two"; Z8 and
/// Z5II files keep their IFDs and MakerNote well inside this.
const INSPECT_PREFIX: usize = 4 * 1024 * 1024;

/// The High Efficiency mode of a NEF, read from its headers only, or `None` for anything else (lossless or lossy
/// compressed NEF, other makers, damaged files). Never decodes pixels.
#[cfg(feature = "nikon-he")]
pub fn high_efficiency_mode(bytes: &[u8]) -> Option<SensorDecoder> {
    let prefix = &bytes[..bytes.len().min(INSPECT_PREFIX)];
    high_efficiency_mode_of_prefix(prefix, bytes.len()).or_else(|| mode_of(ticoraw::inspect_nef(bytes).ok()?))
}

/// The same answer from only the start of a file (the page sends the first few megabytes, not a 60 MB RAW).
pub fn high_efficiency_mode_of_prefix(prefix: &[u8], file_len: usize) -> Option<SensorDecoder> {
    match prefix_verdict(prefix, file_len) {
        PrefixVerdict::HighEfficiency(mode) => Some(mode),
        PrefixVerdict::NotHighEfficiency | PrefixVerdict::NeedMore => None,
    }
}

/// What the start of a file shows, including "read more": how far the headers reach depends on the body (about 4 MiB
/// on a Z5II, 8 MiB on a Z 8, because of the embedded previews before the sensor data).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrefixVerdict {
    HighEfficiency(SensorDecoder),
    NotHighEfficiency,
    /// The headers run past the bytes given; ask again with more of the file.
    NeedMore,
}

#[cfg(feature = "nikon-he")]
pub fn prefix_verdict(prefix: &[u8], file_len: usize) -> PrefixVerdict {
    match ticoraw::inspect_nef_prefix(prefix, file_len) {
        Ok(info) => mode_of(info).map_or(PrefixVerdict::NotHighEfficiency, PrefixVerdict::HighEfficiency),
        Err(ticoraw::TicoError::Truncated { .. }) if prefix.len() < file_len => PrefixVerdict::NeedMore,
        Err(_) => PrefixVerdict::NotHighEfficiency,
    }
}

#[cfg(not(feature = "nikon-he"))]
pub fn prefix_verdict(_prefix: &[u8], _file_len: usize) -> PrefixVerdict {
    PrefixVerdict::NotHighEfficiency
}

#[cfg(feature = "nikon-he")]
fn mode_of(info: ticoraw::NefInspection) -> Option<SensorDecoder> {
    if info.codec != ticoraw::RawCodec::TicoRaw {
        return None;
    }
    // The strip is a TicoRAW codestream; the MakerNote says which of the two rates it is. A missing tag is still HE.
    match info.compression {
        Some(ticoraw::NikonCompression::HighEfficiencyStar) => Some(SensorDecoder::NikonHeStar),
        _ => Some(SensorDecoder::NikonHe),
    }
}

#[cfg(not(feature = "nikon-he"))]
pub fn high_efficiency_mode(_bytes: &[u8]) -> Option<SensorDecoder> {
    None
}

/// A lossless DNG of a High Efficiency NEF's sensor data: every photosite as decoded, with levels, colour matrix,
/// as-shot white balance, crop and orientation. Built in memory; nothing is written beside the original.
#[cfg(feature = "nikon-he")]
pub fn high_efficiency_to_dng(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let decoded = ticoraw::decode_nef(bytes).map_err(|error| {
        format!("This Nikon High Efficiency RAW could not be decoded from its sensor data ({error}). The original is unchanged.")
    })?;
    if decoded.color.color_matrix.is_none() {
        // Wrong colours would look like a Kestrel bug; say so instead of guessing an identity matrix.
        return Err(format!(
            "Kestrel has no colour profile for High Efficiency files from the {}, so it will not guess the colours.",
            decoded.model.trim()
        ));
    }
    ticoraw::dng::encode_uncompressed_dng(&decoded)
        .map_err(|error| format!("The decoded sensor data could not be prepared for development ({error})."))
}

#[cfg(not(feature = "nikon-he"))]
pub fn high_efficiency_to_dng(_bytes: &[u8]) -> Result<Vec<u8>, String> {
    Err("This build of Kestrel does not include the Nikon High Efficiency decoder.".to_string())
}

fn rawler_decode(bytes: &[u8]) -> Result<RawImage, String> {
    let source = RawSource::new_from_slice(bytes);
    rawler::decode(&source, &RawDecodeParams { image_index: 0 }).map_err(|error| crate::explain(&error.to_string()))
}

/// Decode any RAW file's sensor data. High Efficiency NEFs go through ticoraw and an in-memory DNG; everything else
/// goes straight to rawler. The decoder used is returned with the image.
pub fn decode_sensor(bytes: &[u8]) -> Result<(RawImage, SensorDecoder), String> {
    if let Some(mode) = high_efficiency_mode(bytes) {
        let dng = high_efficiency_to_dng(bytes)?;
        let raw = rawler_decode(&dng)?;
        return Ok((raw, mode));
    }
    rawler_decode(bytes).map(|raw| (raw, SensorDecoder::Rawler))
}

/// A DNG copy of any RAW Kestrel can decode from the sensor data. Today only High Efficiency NEFs need it (rawler and
/// every other editor already read the rest), so other files are refused rather than re-wrapped.
pub fn dng_copy(bytes: &[u8]) -> Result<Vec<u8>, String> {
    if high_efficiency_mode(bytes).is_none() {
        return Err("Only Nikon High Efficiency RAW files need a DNG copy; this file can be opened as it is.".to_string());
    }
    high_efficiency_to_dng(bytes)
}

#[cfg(all(test, feature = "nikon-he"))]
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
            orientation: 6,
            crop: Some(ticoraw::Crop { x: 2, y: 2, width: width - 4, height: height - 4 }),
            baseline_exposure: None,
        }
    }

    #[test]
    fn decoded_sensor_data_reaches_rawler_photosite_for_photosite() {
        let synthetic = synthetic_z8(64, 48);
        let dng = ticoraw::dng::encode_uncompressed_dng(&synthetic).expect("encode");
        let raw = rawler_decode(&dng).expect("rawler reads the DNG Kestrel hands it");
        assert_eq!((raw.width, raw.height), (64, 48));
        assert_eq!(raw.orientation.to_u16(), 6, "portrait frames must stay portrait");
        match &raw.data {
            rawler::RawImageData::Integer(samples) => assert_eq!(samples, &synthetic.image.pixels, "no photosite may change"),
            other => panic!("expected integer CFA data, got {other:?}"),
        }
        let developed = crate::scene_develop::develop_display_rgb16(&raw, &crate::scene_develop::Look::default())
            .expect("develop")
            .expect("Kestrel's own develop handles a Bayer DNG");
        assert!(developed.width() >= 56 && developed.height() >= 40, "{}x{}", developed.width(), developed.height());
    }

    #[test]
    fn ordinary_and_damaged_files_are_not_mistaken_for_high_efficiency() {
        assert_eq!(high_efficiency_mode(b""), None);
        assert_eq!(high_efficiency_mode(b"not a raw file at all"), None);
        let dng = ticoraw::dng::encode_uncompressed_dng(&synthetic_z8(16, 16)).unwrap();
        assert_eq!(high_efficiency_mode(&dng), None, "a DNG is not a High Efficiency NEF");
        assert!(dng_copy(&dng).is_err(), "only HE files need a DNG copy");
    }

    #[test]
    fn junk_never_panics_and_is_refused_in_plain_words() {
        let error = decode_sensor(b"II*\0junk").unwrap_err();
        assert!(!error.contains("Some(") && !error.is_empty(), "{error}");
        let error = high_efficiency_to_dng(b"II*\0junk").unwrap_err();
        assert!(error.contains("original is unchanged"), "{error}");
    }

    #[test]
    fn a_prefix_of_an_ordinary_file_is_not_high_efficiency() {
        let dng = ticoraw::dng::encode_uncompressed_dng(&synthetic_z8(32, 32)).unwrap();
        assert_eq!(high_efficiency_mode_of_prefix(&dng[..64.min(dng.len())], dng.len()), None);
        assert_eq!(high_efficiency_mode_of_prefix(b"", 0), None);
    }

    /// SHA-256 of the whole mosaic as little-endian u16, row-major: ticoraw's conformance `cfa_sha256`.
    fn cfa_sha256(raw: &RawImage) -> Option<String> {
        use sha2::{Digest, Sha256};
        let rawler::RawImageData::Integer(samples) = &raw.data else { return None };
        let mut hasher = Sha256::new();
        for sample in samples { hasher.update(sample.to_le_bytes()); }
        Some(hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect())
    }

    #[test]
    fn the_reported_cfa_hash_is_the_decoders_own_mosaic_hash() {
        use sha2::{Digest, Sha256};
        let synthetic = synthetic_z8(40, 24);
        let raw = rawler_decode(&ticoraw::dng::encode_uncompressed_dng(&synthetic).unwrap()).unwrap();
        let mut hasher = Sha256::new();
        for sample in &synthetic.image.pixels { hasher.update(sample.to_le_bytes()); }
        let expected: String = hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect();
        assert_eq!(cfa_sha256(&raw).as_deref(), Some(expected.as_str()));
    }

    #[test]
    fn decoder_labels_are_stable() {
        assert_eq!(SensorDecoder::Rawler.label(), "rawler");
        assert_eq!(SensorDecoder::NikonHe.label(), "nikon-he");
        assert_eq!(SensorDecoder::NikonHeStar.label(), "nikon-he-star");
    }

    /// Optional, owner-provided HE/HE* files: point KESTREL_RAW_SAMPLES at a folder holding them. Every HE NEF there
    /// must decode from its sensor data at full size; this is the real-file evidence the board asks for.
    #[test]
    fn owner_high_efficiency_files_decode_from_sensor_data() {
        let Some(folder) = std::env::var_os("KESTREL_RAW_SAMPLES") else { return };
        let mut decoded = 0;
        for entry in std::fs::read_dir(folder).expect("samples folder").flatten() {
            let path = entry.path();
            if !path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("nef")) { continue }
            let bytes = std::fs::read(&path).unwrap();
            let Some(mode) = high_efficiency_mode(&bytes) else { continue };
            let started = std::time::Instant::now();
            let (raw, decoder) = decode_sensor(&bytes).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
            assert_eq!(decoder, mode);
            // The page's header-only check, reading more only when told to, reaches the same answer.
            let mut prefix = 4 << 20;
            let verdict = loop {
                match prefix_verdict(&bytes[..prefix.min(bytes.len())], bytes.len()) {
                    PrefixVerdict::NeedMore if prefix < bytes.len() => prefix *= 2,
                    other => break other,
                }
            };
            assert_eq!(verdict, PrefixVerdict::HighEfficiency(mode), "{}: header check", path.display());
            // File name only (never the private folder path), and time in plain milliseconds, so
            // tools/raw-evidence/run_owner_decode.py can read each line.
            let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            eprintln!("{name} | {} | {}x{} | {:.1}ms", decoder.label(), raw.width, raw.height, started.elapsed().as_secs_f64() * 1000.0);
            // The whole mosaic as little-endian u16, the hash ticoraw's conformance manifest (Adobe-verified) lists
            // as cfa_sha256, so a run over those public CC0 samples shows bit-exact decoding, not just a picture.
            if let Some(hex) = cfa_sha256(&raw) {
                eprintln!("cfa-sha256 | {name} | {hex}");
            }
            decoded += 1;
        }
        eprintln!("High Efficiency files decoded from sensor data: {decoded}");
    }
}
