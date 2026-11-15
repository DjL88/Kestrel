# Kestrel: audit, roadmap and build prompts

Reviewed: `djl88/Kestrel` (TypeScript, about 7.5k lines, 90 files) and `djl88/Z-Studio` (Kotlin, Android).
Not verified: I could not build or run Kestrel. This machine has no Node or Bun. Everything below comes from reading the code and README, not from running tests.

## 1. Verdict

Kestrel is a solid **culling** app with an editor that is not yet an editor. The architecture is sensible (pure `core/`, swappable `providers/`, offline service worker, British English message table, reduced-motion respected, 136 ARIA attributes, unit tests plus a Playwright flow). It cannot yet replace Lightroom or DXO.

| Your need | State today |
| --- | --- |
| Import hundreds, sort, cull to a target | Good. Burst grouping, keeper target, compare view, Keep/Reject, ratings, auto-cull. |
| Auto-cull quality | Weak. It scores a 4x4 grid of Laplacian sharpness plus clipping. It cannot tell whether the **subject** is sharp, and it cannot see closed eyes. The README admits this. |
| Crop, straighten | Present, with auto-level and auto-crop. Good base. |
| Basic enhancement (shadows, highlights, detail) | **Missing.** The recipe has three 3-step choices: exposure, warmth, colour (`src/core/photoEdits.ts`). No shadows, highlights, whites, blacks, contrast, clarity, sharpening or curves. |
| Subject, background and gradient masks | **Missing.** Only a manual focus point. No mask data model or rendering. |
| Denoise | **Missing.** |
| Remove twigs and bird poo | **Missing.** |
| RAW | Embedded JPEG preview only. Real NEF decode is unvalidated. Z8 HE and HE* are not supported by LibRaw. |
| Speed and battery | Risky. Pixel work is a per-pixel JavaScript loop on the main thread over `getImageData`. There is no Worker, OffscreenCanvas or WebGL. This is the opposite of low power. |
| Mobile, web, desktop | Web and PWA work. Tauri is only planned, and no `src-tauri` exists. |

## 2. Findings

### Critical
1. **Rendering engine is the wrong foundation.** `applyPhotoEdit` runs a CPU loop with gamma lookup per pixel on the main thread. Adding masks, tone curves, sharpening and denoise on top of it will freeze the UI and drain the battery. Fix it before adding any feature.
2. **Edit recipe is too small to grow.** `PhotoEdit` is three integers. Make it a versioned, serialisable recipe: global ops, an ordered mask list (each with its own ops), a heal list and crop. Add a migration function.
3. **No RAW pipeline.** Without a real decode, "replace Lightroom" is not possible. The native route (LibRaw, with a Nikon SDK caveat) needs Tauri, which does not exist yet.

### High
4. **`App.tsx` is 1,116 lines** and `PhotoEditor.tsx` is 511. Split state into hooks or a small store before the editor grows. This is also part of what makes the UI feel busy.
5. **Auto-cull is not trustworthy for wildlife.** Whole-frame sharpness favours busy backgrounds. It needs a subject mask (see section 4) so that sharpness is measured on the bird's eye or body.
6. **Browser storage ceiling.** IndexedDB holds small blobs, and large imports need folder-handle re-grants. Hundreds of 45MP files will hit this. A local database (SQLite in Tauri or OPFS in the browser) is the fix.
7. **Fragile tooling.** `package.json` is still named `react-example`. It ships `@google/genai`, `express` and a `GEMINI_API_KEY` in `.env.example` that nothing in `src` uses. That conflicts with offline-first and no generative AI, so remove them. There is no CI, `.github` folder or lint beyond `tsc`. The build and the e2e test were not run by me.
8. **`vite.config.ts` has AI Studio HMR flags (`DISABLE_HMR`).** Keep them: you want to pull the project back into AI Studio, and it relies on them. Also keep `metadata.json` and port 3000.

### Medium (your users: colourblind, autistic and ADHD, night use)
9. **Colour cues are mostly fine already** (blue and orange with check and X icons in both grid and filmstrip). The gaps were small touch targets and no night or high-contrast theme, both now addressed.
   Original concern: I found no systematic review. Keep, Reject and Unreviewed must differ by icon and label, not hue. Add a high-contrast mode. Provide a colourblind-safe palette (blue and orange, not red and green) for flags, histogram clipping warnings and mask overlays. Copper `#f2ae79` on dark is a good start.
10. **Night mode is only partly delivered.** The theme is dark, which is good. Add a "night" variant: dimmer neutral surround, no pure white, a warm-only option, and an editing preview that stays accurate. Colour adjustments judged on a tinted screen can mislead, so keep the image area neutral.
11. **Clutter risk.** `MacroPadModal`, `TopWorkspaceBar` and the "Workspace options" popover hold many controls. Adopt progressive disclosure: one primary action per screen, advanced controls collapsed, and a persistent "what next?" strip (Import, Cull, Edit, Export).
12. **Satisfaction and low overwhelm.** Add a visible progress ring toward the keeper target ("42 of 50"), calm completion states, and no auto-moving content. Undo must be everywhere.
13. **Large-touch and keyboard parity.** There is a good keyboard registry. Check 44px minimum touch targets on mobile.

### Low
14. Z-Studio is a tether and publishing app. Do not port its UI. Its useful ideas are small: the straighten-dial interaction (`RotationDial.kt`) and the NEF decode notes. Its denoise is a cloud call to a NAFNet model, which conflicts with offline-first. Drop it.
15. Z-Studio's colour-matrix presets (Cyberpunk, Sepia) are not what a Lightroom user needs. Skip them.

## 3. What to keep
`core/` and `providers/` separation, `platformBoundaries.ts`, keyboard command registry, virtual copies, edit history, ZIP export, portable backups, British English table, the Nikon validation harness, service-worker offline build.

## 4. Technical direction

**Render engine.** WebGL2 (WebGPU later) with a linear-light, float pipeline in a Worker through OffscreenCanvas. Edits are uniforms in a single shader pass, so slider drags cost almost nothing and battery use stays low. The same code renders the preview and the export. Keep the CPU path only as a test reference.

**Recipe v2 (JSON, versioned).**
- Global: exposure, contrast, highlights, shadows, whites, blacks, temperature, tint, vibrance, saturation, texture, clarity, sharpening, noise reduction amount.
- Masks: list of `{ kind: subject | background | linearGradient | radialGradient | brush, geometry, feather, invert, ops }`.
- Heal: list of `{ source, target, radius, feather }`.
- Crop and rotation (already present).

**Local AI (ONNX Runtime Web, WebGPU with WASM fallback, optional downloaded models with checksums, as the README already specifies).**
- Subject segmentation: a small salient-object or SAM-class model, with a click-to-refine option. Show the mask, a confidence value and a manual correction route.
- Quality signals: eye detection for birds and animals, then sharpness measured inside the subject mask.
- Denoise: **Do not use a heavy neural denoiser as the default.** Your complaints are slowness and over-processing. Default to a fast, tunable, edge-aware, luminance-first denoise (shader-based non-local-means or wavelet), with chroma noise handled harder than luminance and a strength capped by ISO. Add an optional small learned denoiser on desktop, with a **split before and after loupe at 100%** and a "protect detail" mask that spares the subject. Process the visible tile for preview and the full image only on export.
- Object removal: **non-generative** patch-based healing (PatchMatch-style), driven by a brush or click. Suited to twigs, poo and sensor dust. An "auto-suggest blemishes" detector (small bright or thin dark structures) is a later add-on.

**Platform.** Tauri v2 for desktop and mobile, sharing the web UI. Rust for decode, LibRaw, SQLite and thumbnails. Keep the web build working as the offline PWA.

**Power.** Cache thumbnails and proxies, decode embedded previews first, avoid re-rendering on idle, use GPU compositing, throttle background analysis when on battery, and add an "Eco" setting.

## 5. Roadmap

| Phase | Outcome | Done when |
| --- | --- | --- |
| 0. Hygiene (1 to 2 days) | Rename package. Remove unused Gemini and Express dependencies and AI Studio comments. Add GitHub Actions for lint, unit tests and e2e. Split `App.tsx`. | CI green. Package name and README correct. |
| 1. Accessibility and calm UI (about 1 week) | Colourblind-safe tokens, non-colour cues, high-contrast and night themes, 44px targets, progress ring, decluttered top bar. | Checked with a CVD simulator and keyboard-only. |
| 2. Render engine and recipe v2 (2 to 3 weeks) | WebGL2 Worker pipeline. Full tonal sliders, histogram, tone curve. Preview equals export. | A 45MP preview slider drag stays smooth, and a CPU reference test matches within tolerance. |
| 3. Masks (2 to 3 weeks) | Gradient, radial and brush masks. Overlay and invert. Subject and background masks via local ONNX model. | Mask edit is reversible and exports identically. |
| 4. Smart cull (2 weeks) | Subject-aware sharpness, eye detection, "get me to N" suggestions with reasons. | Matches your own picks on a test shoot of at least 300 frames. |
| 5. Denoise and heal (2 to 3 weeks) | Tunable fast denoise and patch-based removal. | Visible-tile preview under 300ms, and no halos at 100%. |
| 6. Native shell and RAW (3 to 4 weeks) | Tauri, SQLite catalogue, LibRaw decode, Nikon sample validation. | Real Z8 and Z5II NEFs decode. HE variants are documented. |
| 7. Mobile (2 to 3 weeks) | Phone culling, tablet editing. | Offline round trip with desktop catalogue. |

Recommended order: 0, 1, 2, then 6 in parallel with 3, then 4, 5, 7. Phase 2 unlocks all of the editing features.

## 6. Prompts for ChatGPT, Gemini or any coding agent

Give each prompt the repo link plus this file. Run one at a time, and ask for tests and a short summary of changes.

**Common preamble (paste first):**
> You are working in the TypeScript repo djl88/Kestrel, an offline-first photo culling and editing app. Rules: no generative AI, no network calls at runtime, British English in all user-facing text, keep `src/core` pure and testable, do not break existing tests, add tests for new logic. The user is partially colourblind and autistic/ADHD, so never use colour as the only cue and keep screens uncluttered. Work in small commits. After each change, run `npm run lint`, the core unit tests and `npm run build`, and report results honestly.

**P0 Hygiene.**
> Rename the package to `kestrel`. Remove `@google/genai`, `express`, `dotenv` if nothing in `src` uses them (verify with grep). Leave `.env.example` and the `DISABLE_HMR` flag alone, because AI Studio uses them. Add `.github/workflows/ci.yml` running install, `tsc --noEmit`, the unit tests under `src/core` and a production build. Then split `src/App.tsx` into focused hooks and components without changing behaviour.

**P1 Accessibility.**
> Audit every use of colour to convey state (Keep, Reject, unreviewed, clipping, selection). Add distinct icons and text labels, and define a colourblind-safe token palette (blue and orange family) in `src/index.css`. Add three themes: Default dark, Night (dimmer, no pure white, neutral image surround) and High contrast, with a settings toggle that persists. Ensure all touch targets are at least 44px and focus rings are visible. Add a progress ring showing keepers against the target.

**P2 Render engine.**
> Replace `src/core/photoEdits.ts` pixel loops with a WebGL2 pipeline running in a Worker with OffscreenCanvas, working in linear light with float textures. Define `EditRecipeV2` (global tone and colour ops, ordered masks, heal list, crop) with a `migrateRecipe` function from the current three-choice `PhotoEdit`. Add sliders for exposure, contrast, highlights, shadows, whites, blacks, temperature, tint, vibrance, saturation, texture, clarity and sharpening, plus a histogram. Keep the old CPU code as a reference implementation and add a test that compares both on fixture images. Preview and export must share the same shader code.

**P3 Masks.**
> Add masks to `EditRecipeV2`: linear gradient, radial gradient and brush. Each mask carries feather, invert and its own tone and colour ops. Render them in the shader from mask textures. Add an overlay toggle that uses a colourblind-safe tint, and make all mask edits undoable via the existing edit history. Then add a subject/background mask using an ONNX Runtime Web model loaded as an optional, checksum-pinned download, with WebGPU and WASM fallback. Show the confidence and offer click-to-refine. Do not bundle a model with an unchecked licence.

**P4 Smart cull.**
> Extend `autoCull.ts` so sharpness is measured inside the subject mask, and add eye detection for birds and animals where a model is available. Produce ranked suggestions toward the keeper target, with one short human-readable reason each, preferring variety across bursts. Never overwrite explicit user decisions. Add a calibration test set of fixtures and report agreement with manual labels.

**P5 Denoise and heal.**
> Implement a fast, non-generative denoise in a shader or Worker: luminance and chroma controls, ISO-aware default strength, a detail-protection slider and an optional subject-protect mask. Add a 100% split before/after loupe. Process only the visible tile for preview and the full image on export. Then implement patch-based healing (PatchMatch-style) with a brush or click: the user paints a blemish, the algorithm samples nearby texture, and the result is stored as a heal entry in the recipe so it is reversible. No generative models.

**P6 Native shell.**
> Add a Tauri v2 shell (`src-tauri`) with Rust commands implementing the `MetadataExtractor` and `RawDecoder` interfaces in `platformBoundaries.ts` using kamadak-exif and LibRaw, a SQLite catalogue with stableKey relinking, and a thumbnail cache. Keep the web build working. Add the decoder acceptance harness described in `docs/nikon-raw-validation.md` and document which NEF compression modes decode.

**P7 Mobile.**
> Using Tauri mobile or the PWA, build a phone layout for swipe culling and a tablet layout for editing. Use the share sheet for export and test offline use after first load. Sync only the decision log and recipes, never originals.

## 7. Open questions for you
1. Which desktop do you use (macOS Apple silicon?). That decides the first native target.
2. Do you shoot RAW only, or RAW plus JPEG? Embedded previews may cover much of your culling.
3. Which genres matter most: birds in flight, dogs, landscapes?

## 8. Design rules added after your feedback
- **Universal by design.** One shared core (recipe, catalogue, decision log as versioned JSON) plus a thin adapter per platform: web/PWA, Tauri desktop (macOS, Windows, Linux), Tauri mobile (iOS, Android) and a Chrome extension that only sends a chosen image to Kestrel.
- **Touch first.** Pinch to zoom and pull gestures are the primary interaction on phones and tablets. On desktop, the macro keypad and scroll dial map to the same commands (`keyboardCommands.ts` already supports this).
- **Optional cloud later.** Sync only the append-only decision log and edit recipes, never originals. Local use never needs an account.
- **RAW plus JPEG pairs.** Treat a RAW and its JPEG as one frame in the catalogue, and cull on the JPEG or embedded preview. Keep the decoder interface camera-neutral, with Nikon as one adapter among others.
- **AI Studio round trip.** Edit on GitHub, then re-import to AI Studio. Keep `package.json` scripts, `vite.config.ts` flags and `metadata.json` intact.
