//! Kestrel's RAW pipeline for the web app, run inside a Web Worker. The same `kestrel_raw` code as the desktop app, so a
//! photo develops the same way in the browser: sensor decode (rawler, and ticoraw for Nikon High Efficiency), Kestrel's
//! own develop, orientation and a full-resolution JPEG. The original bytes are only read.
//!
//! Built for `wasm32-wasip1`, not `wasm32-unknown-unknown`: rawler reads the clock for its timing logs, which panics
//! without WASI. The worker supplies the few WASI functions the standard library needs (`src/providers/wasiShim.ts`).
//! A plain C interface, no bindings generator: the page copies bytes in, calls one function, and copies the result out.

use std::sync::Mutex;

/// The last result (a JPEG, or a UTF-8 error message), kept until the page has copied it out.
static RESULT: Mutex<Vec<u8>> = Mutex::new(Vec::new());

fn keep(bytes: Vec<u8>) {
    if let Ok(mut slot) = RESULT.lock() {
        *slot = bytes;
    }
}

/// Room for `len` bytes the page will fill. Freed with `kr_free`.
#[no_mangle]
pub extern "C" fn kr_alloc(len: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len.max(1));
    let pointer = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    pointer
}

/// Release memory from `kr_alloc`.
///
/// # Safety
/// `pointer` and `len` must be exactly what `kr_alloc` returned and was given.
#[no_mangle]
pub unsafe extern "C" fn kr_free(pointer: *mut u8, len: usize) {
    if !pointer.is_null() {
        drop(Vec::from_raw_parts(pointer, 0, len.max(1)));
    }
}

/// Develop the RAW file at `pointer..pointer+len` to a full-size JPEG. Returns 0 with the JPEG as the result, or 1 with a
/// plain-English message as the result.
///
/// # Safety
/// `pointer` must point to `len` initialised bytes from `kr_alloc`.
#[no_mangle]
pub unsafe extern "C" fn kr_develop(pointer: *const u8, len: usize) -> u32 {
    let bytes = std::slice::from_raw_parts(pointer, len);
    match kestrel_raw::develop_jpeg(bytes) {
        Ok(jpeg) => { keep(jpeg); 0 }
        Err(message) => { keep(message.into_bytes()); 1 }
    }
}

/// 0 for an ordinary RAW, 1 for Nikon High Efficiency, 2 for High Efficiency*, 3 for "send more of the file", from a
/// file's first bytes and full length.
///
/// # Safety
/// `pointer` must point to `len` initialised bytes from `kr_alloc`.
#[no_mangle]
pub unsafe extern "C" fn kr_sensor_mode(pointer: *const u8, len: usize, file_len: usize) -> u32 {
    let prefix = std::slice::from_raw_parts(pointer, len);
    use kestrel_raw::nikon_he::{PrefixVerdict, SensorDecoder};
    match kestrel_raw::nikon_he::prefix_verdict(prefix, file_len.max(len)) {
        PrefixVerdict::HighEfficiency(SensorDecoder::NikonHe) => 1,
        PrefixVerdict::HighEfficiency(SensorDecoder::NikonHeStar) => 2,
        PrefixVerdict::NeedMore => 3,
        _ => 0,
    }
}

/// Where the last result starts. Valid until the next call that makes a result.
#[no_mangle]
pub extern "C" fn kr_result_pointer() -> *const u8 {
    RESULT.lock().map(|slot| slot.as_ptr()).unwrap_or(std::ptr::null())
}

/// How long the last result is.
#[no_mangle]
pub extern "C" fn kr_result_len() -> usize {
    RESULT.lock().map(|slot| slot.len()).unwrap_or(0)
}
