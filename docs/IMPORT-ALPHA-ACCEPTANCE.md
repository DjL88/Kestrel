# Kestrel Alpha — real-photo import and recovery acceptance

Status: **manual acceptance plan, not a passed test report**. Run on an installed desktop build with rights-cleared camera originals. Never use the only copy of a shoot for destructive filesystem tests.

## Before importing

- Record Kestrel version, OS, machine/RAM, source volume type (internal/external/NAS), camera model and NEF compression mode.
- Make an independent backup of all originals. Keep a separate copy of the Kestrel catalogue backup. A catalogue backup does **not** contain RAW originals.
- Start with 10 mixed JPEG/NEF files, then 500, then 2,000. Record duration, peak memory, thumbnails visible, freezes and failures.
- For Z8 and Z5II include Lossless Compressed, HE★ and HE where available. Verify actual developed RAW versus embedded-preview provenance; successful preview import does not establish HE decoding.

## Acceptance scenarios

| Test | Procedure | Required result |
| --- | --- | --- |
| Basic import | Import 10 originals, keep/reject, crop/edit, export and close | Correct count, no originals changed, exported dimensions match the selected preset |
| Reopen | Quit and restart offline; reopen the shoot | Decisions, edits, selections and original links remain correct |
| Large import | Repeat with 500 then 2,000 real files | All expected photos counted; no silent omissions or unresponsive UI |
| Interrupted import | Cancel during a batch, restart and reimport | No partial decisions presented as complete; recovery is understandable |
| Same filename | Import distinct files named DSC_0001.NEF from separate folders | No silent overwriting or wrong-photo associations |
| Duplicate metadata | Use distinct originals with same name, size and modified timestamp | Do not assume these are the same original; record any identity collision as a release blocker |
| Disconnected drive | Quit, unmount external/NAS volume, reopen, reconnect | Missing originals are identified; cached previews are not presented as full RAW; edits remain |
| Moved folder | Move a backed-up test folder and attempt relink | Never relink to a merely similarly named different photograph |
| Storage full | Simulate low/quota-limited storage using a disposable test environment | Clear warning, no silent loss of saved edits or catalogue |
| Full-size export | Export portrait and landscape 45MP RAW-derived photos | Requested dimensions and orientation, no silent downsize; record source/ICC/bit depth |
| Backup recovery | Export catalogue backup, restart in isolated test profile and restore | Decisions/recipes recover; originals must be relinked separately |
| Undo/redo | Reject, restore, undo, redo and reopen | No surprising removal or stale redo after restore |

## Known code risks to watch

1. `pickedKey` in `src/providers/linkedOriginals.ts` uses **name + size + modified time**, not file contents or a portable volume identity. Two distinct originals can collide. This is a **P0 identity issue**, not an accepted limitation.
2. `loadLocalFileListShoot` in `src/providers/localShootLoader.ts` currently creates frame IDs from **sequence index + filename** and project IDs from `Date.now()`. Test rapid repeated imports and duplicate metadata before claiming collision resistance.
3. Browser directory selection is currently **single-level**; native folder selection supports nested discovery. Verify the correct import path rather than assuming identical behaviour.
4. `src-tauri/src/raw.rs` still develops to `to_rgb8()` and quality-95 JPEG; an embedded preview or full dimensions are **not** proof of a high-bit-depth RAW edit.

## Test report template

- Build/commit:
- OS/device/RAM:
- Camera and RAW compression:
- Source volume and available space:
- File count / expected / imported:
- Time to first useful thumbnails / total import:
- Peak memory / UI responsiveness:
- Reopen / missing-drive / relink result:
- Export dimensions / colour / precision:
- Failures with exact reproduction steps:
- **Pass / Blocked / Fail** (never infer pass from an unexecuted case):

Do not sign off the 500-photo Alpha until all P0 identity, recovery and fidelity failures are resolved and the scenarios are rerun on real hardware.
