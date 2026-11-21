//! Kestrel's own RAW pipeline, shared by every platform: the desktop app links it natively and the web build runs it as
//! WebAssembly, so a photo develops the same way everywhere. Pure functions over bytes: no files, no clock, no network.

pub mod nikon_he;
pub mod scene_develop;
mod develop;

pub use develop::{apply_orientation, develop_jpeg, develop_rgb16, explain, rgb16_bytes};
