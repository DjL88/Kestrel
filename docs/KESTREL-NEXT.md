# Kestrel Next: rebuild decision, architecture and acceptance

**Branch:** `rebuild/kestrel-next`, cut from `main` at `1e23ee7` (18 Nov 2026). `main` is untouched; the tag `baseline/pre-rebuild-20261118` (local) marks the baseline.
**Status:** first vertical slice (Natural Auto) implemented, wired and tested locally. Not merged. Not yet seen on a real RAW.

This is the one record of the rebuild. Item status still lives in [ROADMAP.md](ROADMAP.md); the contract is [PRODUCT-SPEC.md](PRODUCT-SPEC.md).

## 1. Decision

Kestrel is rebuilt **in place, one wired vertical slice at a time**, on one branch, behind the existing tests. Not a fresh repository and not an import of the AI Studio archive. Main's safety work (provenance, relinking, epoch-zero guards, export fail-closed, 861 unit tests) is the most valuable thing in the codebase, and a rewrite would throw it away. What gets rebuilt is what measurably fails photographers.

### Sources, verified

| Source | Finding |
| --- | --- |
| `main` at `1e23ee7` | Fresh `npm ci`, `tsc`, 861/861 unit tests: **PASS** on Windows. |
| `kestrel-pro (1).zip` (18 Nov, 20:54) | **Not a usable source.** 19 source files are zero bytes, including `autoEnhance.ts`, `PhotoEditor.tsx`, `types.ts`, `photoEdits.ts`, `batchAutoEdit.ts`, `webglEdit.ts`, `kestrelVision.ts`, `kestrelSubjectSuggest.ts`. No `package-lock.json`. Forked from `main` at about `45d9817`, so it also lacks `scene_develop.rs` (#396), noise work (#398) and the provenance gate (#399). It also ships the owner's photo previews and PDFs under `public/` (must not be committed). |
| `import/ai-studio-pro` (`7f9c79a`) | The earlier, complete Studio export on its base `45d9817`. Used as the Studio reference for behaviour. |
| Studio reference previews | One of the four (`_DJL3307`) is an all-black frame: a failed Studio render, not a photograph. |
| PR #403, #404 (drafts) | Small and correct. Cherry-picked onto this branch with authorship kept, because the rebuild touches the same files. |

### Retain, rebuild, discard

| Component | Decision | Why (evidence) |
| --- | --- | --- |
| `src/core/` safety modules: provenance, relink, cull guards, edit history, export fail-closed, `autoQualityGate.ts` | **Retain** | Tested, and each encodes a real failure the owner hit. |
| `src/core/insightSubjectAuto.ts` (subject-mask validation) | **Retain, extend** | Its mask checks (confidence, coverage, decode, background share) are sound. Gains an `extra` local edit so Natural Auto's local recovery rides the same validated mask. |
| `src-tauri/src/scene_develop.rs` (RAW develop) | **Retain, re-benchmark** | Right structure: scene-linear, highlight reconstruction, filmic shoulder. `Look::default()` is not neutral (+1.3 EV, saturation 1.15, contrast 0.25, sharpen 0.6) and must be judged against NX Studio on real Z8/Z5 II files before more automatic editing is stacked on it (Slice 3). |
| `autoEnhance()` (main) | **Replace** in the app; kept only as the comparison baseline | Full-frame histogram rules. Measured: highlights −1 on the bright-sky robin, which greys the sky; shadows lifted on noisy woodland; a gate-failing +1.25 EV / +1.5 shadows on a black frame. |
| `studioAutoEnhance()` (Studio) | **Do not port.** Keep the intent (local subject handling, explanations, gate, optional first-open preview) | Measured on the same inputs: global clarity 0.2 on every textured photo, bokeh included; highlights −1 on the bright-sky robin; warmth +0.45 and vibrance +0.5 pushed onto orange plumage; fails the new checks on the woodland and black frames. |
| Editor Auto and batch keeper Auto | **Rebuilt** onto Natural Auto (this slice) | One engine, one gate, both entry points. |
| 8-bit editor and export path (`photoEdits.ts`, `webglEdit.ts`) | **Rebuild in Slice 3** (ROADMAP P1.1) | `Uint8ClampedArray` throughout. The analysis layer is already bit-depth agnostic. |
| Dense UI flows | **Rebuild in Slice 4** | Only after the image path is trustworthy; the brief and the owner rank picture quality first. |
| Studio additions not reviewed here (`kestrelRawDecoder.ts`, `burstDedupe.ts`, `xmpSidecar.ts`, `ToneCurveEditor.tsx`, `clippingOverlay.ts`) | **Candidates**, each to enter as its own slice with tests | Present and intact in `7f9c79a`. `kestrelRawDecoder.ts` must not be used to claim RAW parity. |

## 2. Architecture

```
 Original (never written) ── source hash, link, relink ──┐
                                                          ▼
   ┌──────────── Decode adapter (capability-labelled) ────────────┐
   │ desktop: rawler → scene_develop.rs (scene-linear float)       │
   │ web/mobile: browser codec (JPEG/PNG/HEIF); RAW → embedded      │
   │   preview, labelled as such; HE/HE*: unsupported, said plainly │
   └───────────────────────────┬──────────────────────────────────┘
                               ▼  preview (8 or 16-bit RGBA)
   Subject detector (on device) ─► mask grid + confidence
                               ▼
   Natural Auto (src/core/naturalAuto.ts) ─ measures, never paints
     subject / in-focus detail · smooth-bright vs textured highlights
     noise floor + ISO · rich warm / green colour guards
                               ▼  ordinary slider values + optional subject mask
   Staged gate: render → check → full | gentler | declined
                               ▼
   Recipe (reversible, versioned, linked to source identity)
                               ▼
   One renderer for preview and export (today 8-bit CPU/WebGL; Slice 3: 16-bit float)
                               ▼
   Export (JPEG, PNG, TIFF16 when proven) with true dimensions and honest metadata
```

**Capability matrix (today, honest):**

| Capability | Windows | macOS | Web | Phone/tablet |
| --- | --- | --- | --- | --- |
| JPEG/PNG decode, edit, export | Yes | Yes | Yes | Yes (not device-tested) |
| Nikon NEF lossless/lossy decode | Yes (rawler) | Yes (rawler) | Embedded preview only, labelled | Embedded preview only |
| Nikon HE / HE\* decode | **No** (embedded preview, labelled) | System decoder attempted, unverified | No | No |
| Natural Auto + gate | Yes | Yes (same code) | Yes | Yes (same code) |
| Subject mask (on-device model) | Yes | Yes | Yes | Not device-tested |
| 16-bit end-to-end edit/export | **No** (P1.1) | **No** | No | No |

## 3. Slice 1 (this branch): Natural Auto

`src/core/naturalAuto.ts` replaces both automatic-edit heuristics for the editor (**Auto → Suggest a look**) and for unattended batch keeper Auto.

- **Exposure follows the subject**: a trusted mask first, else the in-focus textured detail, else the frame; never a white sky or bokeh. A subject darker than a bright background is lifted **locally** through the validated subject mask, and the sky is bit-identical.
- **Highlights are recovered only where detail can be lost**: textured bright *areas* (a pale bird's feathers), or the subject itself. Smooth skies, bokeh discs and the thin bright edge of a tree crown are left bright.
- **Shadows are lifted only when they hold structure.** Noise is judged against the image's own noise floor, and against ISO (a 640 px preview averages grain away; ISO ≥ 1600 means no shadow lift and no local sharpen). Low-key and subdued scenes keep their mood.
- **Colour is protected**: no vibrance or per-channel contrast when warm plumage or greens are already rich; warmth only from neutral midtones outside the subject, and only above a visible threshold.
- **No global sharpening, clarity or texture, ever.** A clean, sharp, confidently masked subject at low ISO may get a light local sharpen (0.2) inside the mask.
- **Explicit abstention**: "This photo already works" is a real result.
- **Staged gate** (`stageNaturalRecipe`): render the recipe with the export maths, then check for new clipping (frame and subject), subject colourfulness against the brightness change, subject hue drift, background colourfulness, crunchier out-of-focus background, noisy shadows lifted into grey, and a flattened bright background. Full strength, else half strength, else nothing. Judged against the photographer's current look, never the bare pixels.
- **Bit-depth agnostic analysis**: 8-bit and 16-bit previews give identical decisions (tested).
- **Owner comparison tool**: `npm run compare:auto -- <folder> [--stress]` runs legacy and Natural Auto side by side on local JPEG/PNG/WebP, writes before/after PNGs and a report, and uploads nothing.

## 4. Acceptance scenarios: status on this branch

| # | Scenario (brief) | Status | Evidence / gap |
| --- | --- | --- | --- |
| 1 | 500 mixed photos, counts, quit/reopen | NOT RUN here | Existing `auto-cull-500-to-20.spec.ts` runs in the suite. Real 500-photo NEF run is P0.2. |
| 2 | Bird on bright bokeh stays natural | **PASS (synthetic + 1 real preview)** | Unit tests: no darkening, highlights 0, vibrance 0; sky bit-identical with a mask. `_DJL1296` preview: abstains (legacy: highlights −1). |
| 3 | Woodland mood, no grey mush, foreground stays soft | **PASS (synthetic + 1 real preview)** | No global shadow lift; no global detail; gate blocks a forced lift. `_DSC0009`: abstains. |
| 4 | Close robin: real feathers, no halo, no neon green | **PARTIAL** | No global detail; background pixels far from the bird bit-identical; vibrance and contrast held. **Halo at 100% on a native-resolution export is NOT RUN.** |
| 5 | Helicopter is not an osprey | Unchanged by this slice | Existing species gates. |
| 6 | Source provenance | **Improved** | #403 cherry-picked: a cached review JPEG is never an export source. |
| 7 | Export dimensions, ICC, true 16-bit | NOT RUN | Slice 3. |
| 8 | macOS and Windows from one commit | NOT RUN | Actions billing-blocked; Windows only here. |
| 9 | Auto never overrides manual edits; undo intact | **PASS** | Batch runs only on untouched keepers (+ #404 epoch-zero fix); editor Auto previews and needs Apply; staged scaling never touches manual values or existing masks (tested). |

## 5. Next slices, in order

1. **Slice 2: prove the existing journey end to end on real files.** Import 30–500 mixed JPEG/NEF from a local disk and an external drive → cull → Natural Auto on keepers → export at true dimensions → quit → reopen, on the Windows release build. Fix what breaks; no new features.
2. **Slice 3: one 16-bit float pipeline** (ROADMAP P1.1): `scene_develop.rs` output reaches the editor without the 8-bit JPEG hop; one renderer for screen and export; ICC embedded; benchmark `Look::default()` against NX Studio on Z8 and Z5 II files (lossless, HE, HE\*: HE stays an explicit blocker until a real file decodes).
3. **Slice 4: the calm interface.** One Review space, editor with a back arrow and default-open photo info, one Settings home, phone layout without overlaps, all on the journey proven in Slice 2.
4. **Slice 5: Natural Auto on real data.** Blinded owner ratings on matched RAWs (neutral develop vs legacy vs Studio vs Natural vs NX Studio), then tune thresholds from those numbers, not from synthetic scenes.

## 6. Coordination and rollback

- No scheduled tasks exist on this Windows machine. The "hourly workers" run elsewhere (cloud routines or the Mac). **Proposal:** point them at review and test duty on `rebuild/kestrel-next` only (no new feature PRs against `main`), and keep `tools/denoise-training/` with its own owner. Nothing has been changed in their schedules.
- The owner's local branch `feat/background-import-and-cull-20261118` (uncommitted edits in `localShootLoader.ts` and two specs) is untouched; this branch lives in a separate worktree.
- **Rollback:** `main` is unchanged. Dropping the branch (or reverting its commits) restores the baseline completely. No data migration is involved: recipes written by Natural Auto are ordinary `PhotoEdit` values and masks that the existing app already reads.
