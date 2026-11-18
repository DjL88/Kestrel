# Kestrel master-export MVP: one real photograph finished well

**Source of truth:** The original RAW file. **Output target:** full-sensor resolution, high-bit-depth, colour-managed, nondestructive edited master. **Commercial promise:** no invented pixels, no silent JPEG intermediate, no hidden resizing, no unsupported editing operations quietly dropped.

## What the proof-of-concept branch actually does

- Desktop Editor → Edit → **Export edited 16-bit TIFF (POC)**, only for a linked RAW source.
- Reopens the original RAW through the existing identity-aware provider and calls a new native Tauri command with a bounded *saved* edit recipe.
- Native rawler development must return genuine 16-bit RGB; the renderer applies global exposure, white balance warmth, colour, brightness, contrast, highlights, shadows, white/black points and vibrance without an intermediate 8-bit JPEG.
- Refuses crops, rotations, selective masks, denoise, texture, clarity and sharpening until those operations can be rendered faithfully at high bit depth.
- Invalid, unsupported, non-finite and out-of-range adjustments fail closed. Cannot quietly fall back to an embedded preview or manufacture 16-bit from RGB8.
- Writes a user-chosen TIFF. Original bytes and the catalogue recipe remain unchanged.
- Source code contains Rust pixel/roundtrip and parameter-validation tests plus TypeScript recipe-validation tests. **They are not recorded as passing until executed in a real checkout.**

## Not yet proven: do not promote to default Export

1. **Colour management:** The TIFF is not yet ICC-tagged or proven to match Nikon NX Studio; the native intermediate's colour-space assumptions require measurement. The existing browser preview is 8-bit JPEG, so 100%-faithful preview/export parity is **unverified**.
2. **RAW decode coverage:** Z8/Z5II lossless, HE and HE* each need an authentic rights-cleared test file. Unavailable codecs refuse rather than relabel JPEG as RAW.
3. **Edits and output parity:** Crop, straighten, rotate, denoise, feather/eye detail, masks and local edits still need a single calibrated full-resolution native pipeline.
4. **Memory/performance:** Current RGB16 buffers and orientation can take multiple full-frame allocations. Z8 8256 × 5504 must be measured on Windows and macOS and later moved to bounded tile workers where practical.
5. **Quality:** No claim of DxO DeepPRIME/Lightroom/NX Studio parity until real-camera blind 100% crops establish reduced noise *and* authentic feather detail without artifacts.

## The MVP acceptance shoot

Use an explicit *licensed, local* Nikon Z8 and Z5II fixture matrix: daylight plumage, ISO 3200+ woodland bird, backlit bird, specular whites, golden-hour scene, aircraft negative control, landscape. Keep the reference NEF immutable and record SHA-256 before/after.

1. Import on Windows and macOS offline; confirm actual source, dimensions, Nikon compression variant and provenance.
2. Produce a neutral edited RGB16 TIFF and a moderate exposed/toned TIFF. Verify TIFF samples are genuine 16-bit and image dimensions/orientation match the source. Confirm all intentional adjustments and no unrelated changes.
3. Open with a colour-managed viewer, inspect highlights, shadow gradation, saturation, red/orange feathers, complex edges, 100% and 200% crops; compare identical TIFF/JPEG/NEF frames against NX Studio and DxO with equal presentation/white balance.
4. Save and re-open the catalogue; compare source SHA, active recipe, edit history and exported filename. Repeat with disconnected originals and unsupported HE*: correct failure is explicit, not an 8-bit substitution.
5. Run `npm run lint`, `npm test`, targeted Playwright, `cargo test` in `src-tauri`, native smoke tests and memory profiling. Report **PASS / FAIL / NOT RUN / INFRASTRUCTURE BLOCKED**, not a merged-PR proxy for correctness.

## Delivery sequence (single priority track)

1. Make this 16-bit master renderer compile and produce an actual verified TIFF from a Nikon NEF.
2. Add explicit, tested working-space/ICC transform and pixel-level preview/export consistency; do not fake an ICC tag without an underlying transform.
3. Move geometry, masks and authentic denoise/sharpen into the same precision pipeline, then enable normal Export → Master TIFF and JPEG from that one rendered master.
4. Validate real shoot quality and large-file reliability. Only then return to automated culling, broader UX expansion, cloud, licensing, social/export presets and optional AI.

**Decision:** Keep the existing Kestrel repository and shared editor, but treat this one coherent 500-photo import → edit → master export → reopen journey as the release gate. No rewrite and no untested quality claims.
