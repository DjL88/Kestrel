//! Dump the untouched sensor data of a RAW file for the noise-training tools.
//!
//!   cargo run --release --example raw_dump -- <file.raw> <out-folder>
//!
//! Writes `<name>.u16` (little-endian 16-bit samples, row by row, the whole sensor area) and `<name>.json` (size, colour
//! filter pattern, black and white levels, ISO, make and model). It uses the same decoder as Kestrel, so any camera the
//! app can open can be used to build training data, whatever the brand.
use rawler::decoders::RawDecodeParams;
use rawler::rawimage::RawImageData;
use rawler::rawsource::RawSource;
use std::io::Write;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        eprintln!("usage: raw_dump <file> <out-folder>");
        std::process::exit(2);
    }
    let path = std::path::Path::new(&args[1]);
    let out = std::path::Path::new(&args[2]);
    std::fs::create_dir_all(out)?;
    let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("raw").to_string();

    let source = RawSource::new(path)?;
    let params = RawDecodeParams { image_index: 0 };
    let decoder = rawler::get_decoder(&source)?;
    let iso = decoder.raw_metadata(&source, &params).ok().and_then(|meta| meta.exif.iso_speed);
    let image = decoder.raw_image(&source, &params, false)?;

    let cfa = match &image.photometric {
        rawler::rawimage::RawPhotometricInterpretation::Cfa(config) => Some((config.cfa.name.clone(), config.cfa.width, config.cfa.height)),
        _ => None,
    };
    let samples: Vec<u16> = match &image.data {
        RawImageData::Integer(values) => values.clone(),
        RawImageData::Float(values) => values.iter().map(|v| v.clamp(0.0, 65535.0) as u16).collect(),
    };
    let mut file = std::fs::File::create(out.join(format!("{name}.u16")))?;
    let mut bytes = Vec::with_capacity(samples.len() * 2);
    for value in &samples { bytes.extend_from_slice(&value.to_le_bytes()); }
    file.write_all(&bytes)?;

    let json = format!(
        "{{\"name\":{:?},\"make\":{:?},\"model\":{:?},\"width\":{},\"height\":{},\"cpp\":{},\"cfa\":{:?},\"cfa_width\":{},\"cfa_height\":{},\"black\":{:?},\"white\":{:?},\"iso\":{}}}\n",
        name, image.clean_make, image.clean_model, image.width, image.height, image.cpp,
        cfa.as_ref().map(|c| c.0.as_str()).unwrap_or(""), cfa.as_ref().map(|c| c.1).unwrap_or(0), cfa.as_ref().map(|c| c.2).unwrap_or(0),
        image.blacklevel.as_vec(), image.whitelevel.as_vec(),
        iso.map(|v| v.to_string()).unwrap_or_else(|| "null".into()),
    );
    std::fs::write(out.join(format!("{name}.json")), json)?;
    println!("{name}: {}x{} cpp={} cfa={:?}", image.width, image.height, image.cpp, cfa.map(|c| c.0));
    Ok(())
}
