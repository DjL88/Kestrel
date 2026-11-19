# Nikon RAW evidence gates (Z8 / Z5II)

Status: **test protocol only; no Nikon HE/HE* or NX Studio parity verified**. Do not interpret successful JPEG output, file dimensions, or an embedded preview as sensor RAW development.

## Source provenance contract

For every image passed to export, record a stable original identity (path/volume handle plus content fingerprint where available), the requested variant and edit-history revision, source dimensions, decoder identity and version, and one of: `sensor-developed`, `system-rendered`, `embedded-preview`, `cached-review`, `unknown`. Never infer sensor development from a NEF extension or JPEG dimensions. Cached review and unknown sources are not eligible for full-quality RAW export. A system-rendered JPEG is distinct from a native RAW development and must not be called Nikon official colour.

Originals must remain read-only; edits are replayable and reversible. On relink, confirm identity before enabling export, including virtual copies and external-volume moves. A matching filename alone is insufficient.

## Lawful fixtures and matrix

Use photographer-owned files with explicit permission, or openly licensed samples with provenance and license recorded locally. Never commit or upload camera photos. Record camera, firmware, NEF compression (lossless, HE, HE*), orientation, exposure, colour profile, image dimensions, platform and OS build. Test Z8 and Z5II separately; unknown combinations are **NOT VERIFIED**, not PASS.

For each fixture:
1. Import offline, hash original before/after, develop at full resolution, and log whether the result is sensor-developed, system-rendered, or preview-only.
2. Compare dimensions and orientation with independently measured metadata. Confirm source pixel dimensions rather than trusting an exported canvas's size.
3. Export JPEG and, where implemented, TIFF; decode the complete file, check nonzero length, dimensions, ICC/profile metadata, crop/rotation, edit replay, and absence of unexpected scaling.
4. Unmount and remount an external drive; verify relink with identity check and nondestructive history/virtual-copy retention. Confirm missing originals permit review but not mislabelled full-quality export.
5. For NX Studio comparisons, use the **same lawfully obtained NEF**, a recorded NX Studio version and explicit processing settings. Compare controlled colour patches, highlights, feather edges and noise at 100% with measured metrics and visual review. Do not claim Nikon official colour or DXO-level detail without evidence.
6. Check concurrent import/export, malformed JPEG fallback, failed decode, large-image memory pressure and cancellation; verify temporary files are cleaned and originals unchanged.

## Verification labels

- **PASS**: test actually executed on the named platform and fixture, with recorded output.
- **FAIL**: test executed and acceptance criterion failed.
- **NOT RUN**: no executable checkout, fixtures or compatible host.
- **INFRASTRUCTURE BLOCKED**: GitHub workflow did not acquire a runner and executed zero steps; not a code failure or a pass.
- **NOT VERIFIED**: claimed camera/colour/detail capability lacks lawful real-file evidence.

## Current engineering risks (static inspection, 19 Nov 2026)

`src-tauri/src/raw.rs` converts the built-in developed image to 8-bit JPEG quality 95 before the editor; the macOS fallback uses `sips` to produce JPEG and validates a full decode. These are **not** evidence of 16-bit scene-linear export or NX Studio colour parity. The system-JPEG validation incurs an additional full decode; memory/latency are **NOT RUN**. The real-file Rust test skips when `KESTREL_RAW_SAMPLES` is absent; a passing test process without fixtures must not be cited as Nikon compatibility evidence.

Do not modify denoiser training scripts owned by #347 or successors. Do not provision cloud resources, accept SDK terms, or retry hosted runners while billing is blocked.
