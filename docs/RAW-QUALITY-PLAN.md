# RAW image quality: phased plan

This is the single biggest gap between Kestrel and Lightroom/DxO/NX Studio on
image quality. It's worth its own plan rather than a line in the general
roadmap, because the real fix is architectural (what format data moves through
the pipeline in), not a setting to flip.

## Where things actually stand (2026-11-17)

- `src-tauri/src/raw.rs` (`develop()`/`develop_any()`) is the **default, only
  path the editor, crop, and export actually use**. It demosaics correctly via
  `rawler`, then immediately flattens to 8-bit RGB and encodes a quality-95
  JPEG. Every edit and export downstream inherits that loss — both the bit-
  depth loss and the JPEG compression artefacts.
- `src-tauri/src/raw_precision.rs` already existed as an unwired prototype: a
  genuine 16-bit path (`develop_raw_rgb16_tiff`) that decodes straight to a
  16-bit RGB TIFF, with no 8-bit intermediate, and deliberately **fails closed**
  rather than faking 16-bit by upsampling 8-bit values. It has no Nikon High
  Efficiency support (no system-decoder fallback, unlike `raw.rs`) and no ICC
  profile embedding.
- This pass wired `raw_precision.rs` to one explicit action: **"Save 16-bit
  TIFF (experimental)"** in Edit options, next to "Develop from RAW". It
  downloads a side TIFF for the current photo. It does **not** change what the
  editor shows, what sliders operate on, or what Export produces — those are
  still the 8-bit JPEG path. This is deliberately a small, honest, additive
  step: real 16-bit data is now obtainable and testable against real camera
  files, without touching the pipeline everyone already depends on.
- None of this has been run against a real camera file in this change — there
  are no camera RAW samples in the repo (by design; see `raw.rs`'s own test
  comment). `raw_precision.rs`'s unit tests cover the encode/orient logic with
  synthetic pixel buffers, which is real coverage but not proof against an
  actual Z8/Z5II/Canon/Sony file.

## What "done" looks like, in order

### Phase 0 — already done this pass
Experimental 16-bit TIFF side-export, wired, not yet proven on real files.

### Phase 1 — prove it on real files
Run `cargo test` with `KESTREL_RAW_SAMPLES` pointed at real Z8/Z5II (and
ideally Canon/Sony) files covering each compression mode you shoot. Compare
the 16-bit TIFF against NX Studio's own output: same crop, same orientation,
same highlight/shadow detail, no banding. This needs a real machine with real
files — it can't be done in a cloud sandbox. **Do this before anything below.**

### Phase 2 — make it the editor's working space, not a side door
This is the real architectural change:
- Decode to 16-bit once, keep it in memory/IndexedDB-backed storage as the
  working raster instead of (or alongside) the 8-bit JPEG.
- The edit math in `webglEdit.ts`/`canvasEdit.ts` needs to operate at higher
  precision than the browser's standard 8-bit `<canvas>` — likely WebGL
  float/half-float textures throughout, only quantizing to 8-bit at the very
  end for on-screen display (screens are 8-bit anyway) and, separately, for
  JPEG export.
- `rawDevelop.ts`'s `matchPreviewOrientation` currently round-trips through
  `getImageData` (`Uint8ClampedArray`, always 8-bit) to compare orientation
  against the embedded preview. That specific step can safely stay 8-bit (it's
  just comparing thumbnails for rotation, not touching pixel values that
  matter), but don't let that pattern leak into the actual edit path.

### Phase 3 — colour management
ICC input profile (camera's colour space) → a defined working space → ICC
output profile for export. `lcms2` or equivalent. Needed for "Full-size PNG is
lossless" to mean something against a reference, not just against itself.

### Phase 4 — promote TIFF/16-bit to "Full size" export
Once Phases 1–3 hold up: offer 16-bit TIFF (or 16-bit PNG) as a "Full size"
export option alongside the current 8-bit PNG, clearly labelled, so a
photographer doing real post-production elsewhere gets genuine headroom.

### Phase 5 — Nikon High Efficiency / HE* in the 16-bit path
`raw.rs` already has a macOS `sips` fallback for HE/HE* (8-bit only, since
`sips` outputs a flattened image). A 16-bit HE/HE* path needs either `rawler`
gaining TicoRAW support upstream, or a different decoder for that one mode.
Until then, say so explicitly in the UI rather than silently falling back.

## What NOT to do
Don't quietly make 16-bit the default editing path before Phase 1 is done on
real files — that's exactly the "ship first, verify never" pattern the rest of
this repo's audits are trying to avoid. Keep the JPEG path as the proven
default until the 16-bit one has real-file evidence behind it.

## Legal note
`rawler` (the decoder both paths use) is LGPL-2.1. See `NOTICE.md` — this
needs a real legal answer on static linking before any of the above ships in a
signed, paid build, not just a code change.
