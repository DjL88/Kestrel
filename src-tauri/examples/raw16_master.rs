//! Export a real RAW to RGB16 TIFF without installing the desktop app.
//!
//! cargo run --release --manifest-path src-tauri/Cargo.toml --example raw16_master -- <original.NEF> <new-output.tiff> [edit.json] [framing.json]
//!
//! This diagnostic intentionally fails if the output exists and never writes to
//! the original. ICC and actual photographic colour accuracy remain unverified.
use kestrel_lib::raw_precision::{
    develop_raw_rgb16_tiff_with_edit_and_framing, parse_master_edit, parse_master_framing,
    NativeMasterEdit, NativeMasterFraming,
};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<PathBuf> = std::env::args_os().skip(1).map(PathBuf::from).collect();
    if !(2..=4).contains(&args.len()) {
        eprintln!("Usage: raw16_master <original-RAW> <NEW-output.tiff> [edit-recipe.json] [framing.json]");
        std::process::exit(2);
    }
    let source = &args[0];
    let output = &args[1];
    if !source.is_file() { return Err("Original file was not found.".into()); }
    if output.exists() { return Err("Output already exists; no files were overwritten.".into()); }
    if output.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("tiff") || e.eq_ignore_ascii_case("tif")) != Some(true) {
        return Err("Output must have a .tiff or .tif extension.".into());
    }
    let edit = if let Some(path) = args.get(2) {
        parse_master_edit(&fs::read_to_string(path)?)?
    } else {
        NativeMasterEdit::default()
    };
    let framing = if let Some(path) = args.get(3) {
        parse_master_framing(&fs::read_to_string(path)?)?
    } else {
        NativeMasterFraming::default()
    };
    println!("Decoding original RAW locally: {}", source.display());
    let bytes = fs::read(source)?;
    let tiff = develop_raw_rgb16_tiff_with_edit_and_framing(&bytes, edit, framing)?;
    // This is the only write. create_new prevents accidental overwrite; on
    // write error remove the incomplete diagnostic output, not the RAW source.
    let mut dest = OpenOptions::new().write(true).create_new(true).open(output)?;
    if let Err(error) = dest.write_all(&tiff) {
        drop(dest);
        let _ = fs::remove_file(output);
        return Err(error.into());
    }
    dest.sync_all()?;
    println!("POC 16-bit TIFF written: {} ({} bytes)", output.display(), tiff.len());
    println!("Not colour-certified: ICC, preview parity and feather detail need real-photo validation.");
    Ok(())
}
