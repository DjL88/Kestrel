# RAW-to-export provenance and colour validation gate (Z8 / Z5II)

Status: **unverified**. This is a reproducible validation gate, not evidence of Nikon HE/HE* support, NX Studio parity, or production-quality colour.

## Static implementation observations (18 November 2026)

- `src/providers/browserExport.ts:loadExportSource` obtains a URL from `getFullPreviewUrl` and decodes it with browser `loadImage`. It rejects an offline fallback and some unavailable embedded JPEG cases, but does **not** establish that the URL represents a full-resolution demosaiced NEF rather than an embedded JPEG. A successful export is therefore **not proof of RAW development**.
- `composeExport` validates source dimensions and rejects an unsafe full-export canvas rather than silently downscaling. It cannot establish that the source pixels were decoded from the original RAW or that their bit depth, colour space and ICC profile were preserved.
- `src/core/photoEdits.ts` and the WebGL/canvas path currently operate on browser-decoded pixel data. Do not describe this as a verified 16-bit/float RAW development and colour-managed export pipeline.
- The existing `docs/nikon-raw-validation.md` distinguishes the Nikon SDK and LibRaw compatibility; camera model support does not imply HE/HE* support.

## Acceptance matrix — one record per body, firmware, compression and operating system

For Nikon Z8 and Z5II, separately test lossless, HE* and HE **only when a lawful sample actually exists**. Do not manufacture a HE sample by changing the extension. Record: camera model, firmware, NEF compression (confirmed from metadata), original SHA-256, image pixel dimensions, NX Studio version, candidate decoder/version, OS/architecture, output profile, Picture Control, white balance, transfer curve, and SDR/HLG state. Mark each cell PASS / FAIL / NOT RUN / UNSUPPORTED / UNKNOWN; never infer a cell from another mode or body.

### Gate A: Original and developed association

1. Keep the NEF read-only. Snapshot its hash before and after import, edit, relink, export and app restart.
2. Import two distinct originals with the same basename, byte size and modification timestamp. Confirm no automatic cross-link; ambiguous matches require an explicit selection.
3. Test moved files, missing volumes, NAS disconnect/reconnect, a renamed original, and a deleted original. A cached JPEG may permit review but must never be presented as proof that the NEF is available.
4. Save and reload crop, rotation, local masks and edit history. Confirm edits remain linked to the intended original and no original bytes change.

### Gate B: Decode provenance and pixel integrity

1. For each file, log the **actual decoder and source kind**: native NEF development, OS decoder, embedded JPEG, offline review image or externally developed raster. UNKNOWN must be visible, not guessed.
2. Record decoded dimensions versus expected sensor/crop dimensions. An embedded JPEG with matching dimensions is still not a proven RAW decode.
3. Compare pixel dimensions, orientation, colour metadata and file hashes before and after export; check no unintended reduction or substitution on allocation failure.
4. Repeat at desktop maximum dimensions and the mobile canvas boundary. Preserve requested export dimensions or fail clearly.
5. Reopen exported TIFF/JPEG/PNG in an independent viewer and check dimensions, readable ICC metadata (if supported), orientation, transparency and alpha handling. Never claim high-bit-depth TIFF output unless measured.

### Gate C: NX Studio reference (licensed/owned files only)

1. Use the **same** rights-cleared NEF in NX Studio and candidate decoder; document all settings and exact output profiles.
2. Compare neutral grey/white patches, skin or natural colour patches, highlights, shadow transitions, feather detail and fine patterns at 100% and 200%. Keep both visual crops and numerical measurements.
3. For quantitative checks, first convert both outputs into the same explicitly documented colour space and transfer function; align orientation and crop; avoid comparing unaligned JPEGs or different Picture Controls.
4. Record CIE ΔE (with the specified ΔE variant), clipping percentage, spatial detail metrics, and visual artefacts. Set acceptance thresholds **before** seeing candidate results.
5. Report unsupported compression and missing legal fixtures as separate statuses. A passing synthetic test never implies HE/HE* compatibility or NX Studio colour parity.

## Immediate code follow-up (not implemented by this document)

Introduce a typed, persisted export-source provenance result alongside `getFullPreviewUrl`: source kind, decoder, source pixel dimensions, original identity/hash where available, and verified/unknown state. Full-resolution RAW export should require verified native/external developed pixels, or an explicit user-visible warning that an embedded JPEG is being exported. Keep offline culling available, preserve original files and nondestructive histories, and do not upload images.

## Verification for this document

Static source inspection only. **Unit, TypeScript, Playwright, native desktop, Nikon hardware, NX Studio and real NEF checks: NOT RUN.** GitHub Actions without runner allocation are infrastructure blocked, not passes or code failures.
