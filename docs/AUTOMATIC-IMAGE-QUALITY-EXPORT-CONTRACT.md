# Kestrel automatic image-quality and export contract

**Owner decision: 20 November 2026.** This replaces any proposal to make photographers choose RAW/JPEG/TIFF processing on individual photos inside the editor. Related: #418 (Q-01/Q-02/Q-03/Q-08/Q-11, F), #514. This is an implementation contract, **not** evidence that current code meets it.

## Photographer journey

1. **Import:** select a shoot/folder once. Display each photo as soon as a truthful provisional preview is available, without holding the whole shoot behind batch preprocessing. Immediately permit culling. Never write to the original.
2. **Decode and develop:** process photos one at a time under a bounded resource scheduler. Select the **highest-fidelity verified sensor-decoding path** available automatically, respecting original format, camera compression mode and codec/legal support. Preserve source hash/fingerprint and decoder provenance. Promote from review preview to a high-precision image source when verified.
3. **Edit:** the same simple interface for JPEG/HEIC/PNG/RAW/TIFF; adjustments are non-destructive and reproducible. Camera JPEG/TIFF inputs should not be advertised as having sensor precision they never contained. No per-photo RAW/TIFF/decoder dropdowns, explicit development buttons or experimental TIFF controls in editing panels. Quality warnings can be viewed in Photo Info when relevant.
4. **Settings:** choose a simple default **Best quality** or **Balance responsiveness** processing preference. The latter may affect preview scheduling, memory/GPU budget, and background queue, **not cap final export precision** or replace a verified master with JPEG. Expose technical diagnostics only in advanced information, never as routine photo-by-photo decisions.
5. **Export:** select any supported combination of:
   - **Original**: byte-for-byte unchanged source with filename/provenance, where authorisation and source availability permit.
   - **Edited master TIFF**: full-resolution, colour-managed, 16-bit/channel **only if** high-precision decoding *and* editing are verified; clearly explain when unsupported or unavailable.
   - **JPEG/PNG and social sizes:** proper colour profiles, quality/preset, dimension and filename choice.
   - **Before / After:** original rendered view and final edit as a still, split or side-by-side comparison. Distinguish *Original file* from *before visual*.
   - **Tutorial:** non-generative storyboard, screenshots or video replay of genuinely recorded reversible edit operations, with optional captions and export for social.
6. **Reopen:** retained project recipe reproduces exactly the same edited master from the verified original. Missing/relinked sources are identity-checked before high-resolution output.

## Engine boundaries and hard stops

- Original RAW bytes are immutable; previews, cache and edited masters are separate representations.
- Review-ready JPEG previews are **not** automatic evidence of high-fidelity RAW development. Never call an 8-bit JPEG-derived TIFF a sensor-precision master.
- Nikon HE/HE* decoder selection must be capability- and rights-gated. Unsupported camera/compression never silently downgrades to a JPEG for full-quality export. Show a plain-language, calm notice; keep culling available.
- Preview renderer and master renderer may use different resource paths, but adjusted appearance must be matched against a colour-managed reference including ICC/white balance, orientation, highlights, saturation and feather detail.
- A high-depth file container or floating-point calculation after 8-bit conversion cannot restore original shadow/highlight information.
- Non-generative only: tutorial sequences reconstruct actual source images and real adjustment/mask state. Never invent/replace image content.

## State transition (per photo)

`discovered -> preview-ready -> sensor-decode-queued -> high-precision-ready -> edit-master-ready`

Additional terminal/recoverable substates: `unsupported-codec`, `needs-original-relink`, `decode-failed`, `insufficient-resources`, `cancelled`. The user can still cull from the preview, but full-quality RAW export is blocked until a validated master source exists.

## Acceptance and test matrix

| Gate | Example proof | Status before implementation |
| --- | --- | --- |
| Preview readiness | First photo usable while remaining 499 continue import | NOT RUN |
| Original integrity | Original SHA-256 identical before/after edit/export/relink | NOT RUN |
| Nikon HE* | Real rights-cleared Z8/Z5II HE* source, codec provenance and full image dimensions | NOT RUN |
| Native 16-bit master | Measured genuine >8-bit source precision, no JPEG master intermediate | NOT RUN |
| Colour/feathers | NX Studio reference, ICC, 100% crops, highlights, fine bird feathers | NOT RUN |
| Quality fallback | Unsupported HE* preserves original; cull works; master export refused honestly | NOT RUN |
| Resource use | 500 -> 2,000 images, 8/16/32 GB, phone, bounded memory and cancel | NOT RUN |
| Export original | Byte-identical original, no loss or overwrite | NOT RUN |
| TIFF and social | Full-res correctly profiled TIFF; JPEG/PNG and social dimensions | NOT RUN |
| Before/after | Accurate pre/post look, correct recipe, no silent master downgrade | NOT RUN |
| Share tutorial | Non-generative storyboard/video follows edit history; accessible captions | NOT RUN |
| Offline and relink | No network dependency; identity-confirmed master regeneration after reopen | NOT RUN |

## Implementation slices — coordinate, do not overlap

A. **Ingestion + provenance**: background development scheduling and per-photo source capabilities. Existing starting points: `src/useBackgroundDevelop.ts`, `src/providers/rawDevelop.ts`, `src/providers/rawMaster16.ts`, Rust `crates/kestrel-raw`. Never advertise completion before HE* verified sample tests.

B. **One processing preference** in global Settings: default to maximum verified quality, optional responsiveness setting without affecting final output. Respect ongoing #512/#513 Settings/Editor integrations.

C. **Editor cleanup**: remove old experimental “Export edited 16-bit TIFF (POC)” only once equivalent or better safe export route exists; avoid deleting the only access to a working experimental diagnostic path before migration. No RAW-vs-TIFF choice in editor.

D. **Export unification**: build on `src/components/PhotoExportPanel.tsx` and `src/components/ExportWizard.tsx`; keep experimental high-precision export disabled/clearly labelled until validated. Group photo export from the user's goal, not internal decoder type.

E. **Comparison/tutorial**: render shareable authentic before/after and a user-approved edit-history storyboard (later video), with camera image provenance and no generative substitution.

F. **End-to-end evidence gate**: run exact-main `npm run lint`, `npm test`, `npm run build`, responsive Playwright, Nikon real fixtures, installed Mac/Windows/phone, and original-hash/relink tests. Report PASS/FAIL/NOT RUN. Review open PRs and #418 file claims before touching implementation paths.

**Definition of complete:** a photographer imports a real Nikon HE* shoot, starts reviewing immediately, edits without technical decoder decisions, obtains a provably full-quality colour-managed master when supported, exports original/TIFF/JPEG/social/before-after/tutorial, closes/reopens offline and reproduces the result without changes to the original.
