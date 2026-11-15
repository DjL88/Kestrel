# Kestrel: next steps and prompts

Read `docs/ROADMAP.md` for the audit and the reasoning. This file is the working plan: what is done, what to do next, and a prompt for each step to paste into ChatGPT, Gemini, AI Studio or Claude Code.

## Status
- Done (PR #20): dependency tidy-up, Dark/Night/High contrast themes, 44px touch targets, roadmap.
- Parked: CI workflow at `docs/ci.yml.example`. Run `gh auth refresh -h github.com -s workflow`, then move it to `.github/workflows/ci.yml`.

## Order of work
1. A. Brand and accessibility tokens
2. B. Render engine and recipe v2 (unlocks everything else)
3. C. Masks
4. D. Smart cull
5. E. Denoise and heal
6. F. RAW plus JPEG pairs and a camera-neutral decoder
7. G. Touch-first gestures and desktop macro keypad
8. H. Native shell, mobile, extension, optional sync

## Ground rules (paste at the start of every prompt)
> Repo: djl88/Kestrel (React, TypeScript, Vite, Tailwind 4). Offline-first, no runtime network calls, no generative AI. British English. Keep `src/core` pure and unit-tested. Keep `DISABLE_HMR` in `vite.config.ts`, `metadata.json`, port 3000 and the npm scripts so the project still imports into AI Studio. Never use colour as the only cue, keep text and icons at 3:1 contrast or better (4.5:1 for text), and respect `prefers-reduced-motion`. Work in small commits, run `npm run lint`, `npm test` and `npm run build`, and report results honestly, including anything you could not run.

## A. Brand and accessibility tokens
Decisions already made: use the second palette (Sky Blue `#4EA8DE`, Ember Red `#E03A3E`, Kestrel Orange `#FF6B35`, Deep Space `#0D0E12`, Card Navy `#161A22`, Highland Mist `#94A3B8`). Red is only for branding and delete confirmations. Text on orange is near-black.

> Add the palette as CSS tokens in `src/index.css` (`@theme`), keeping the existing Dark, Night and High contrast themes working. Bundle Plus Jakarta Sans (headings and UI) and Inter (body and metadata) locally with `@fontsource` packages, with no Google Fonts requests. Orange buttons use near-black text. Keep and Reject keep their check and X icons and words. Selection uses blue plus a 2px outline. Add settings for text size (100%, 125%, 150%), a dyslexia-friendly font option and a Reduced stimulation mode (no animation, calmer colours, secondary controls collapsed). Check that no state relies on colour alone, add a short `docs/accessibility.md` that records the contrast ratios, and add unit tests for any pure logic.

## B. Render engine and recipe v2
> Replace the CPU pixel loop in `src/core/photoEdits.ts` with a WebGL2 pipeline that runs in a Worker using OffscreenCanvas, working in linear light with float textures. Define a versioned `EditRecipeV2` (global tone and colour, ordered masks, heal list, crop) and a `migrateRecipe` function from the current `PhotoEdit`. Add sliders for exposure, contrast, highlights, shadows, whites, blacks, temperature, tint, vibrance, saturation, texture, clarity and sharpening, plus a histogram with clipping warnings that use shapes as well as colour. Keep the old CPU code as a reference and add a test that compares both on fixture images within a tolerance. Preview and export must use the same shader code. Fall back to the CPU path when WebGL2 is unavailable. Measure and report time per slider change on a 24MP image.

## C. Masks
> Add masks to `EditRecipeV2`: linear gradient, radial gradient and brush, each with feather, invert and its own tone and colour ops. Render them in the shader. Add an overlay toggle that uses a colour-blind-safe tint plus an outline, and make every mask edit undoable through the existing edit history. Then add subject and background masks using ONNX Runtime Web with an optional, checksum-pinned model download (WebGPU with WASM fallback). Show confidence and offer tap-to-refine. Do not bundle a model whose licence is unchecked, and list the model, licence and size in `docs/models.md`.

## D. Smart cull
> Extend `src/core/autoCull.ts` so sharpness is measured inside the subject mask. Add eye detection for birds and animals where a model is available. Produce ranked suggestions toward the keeper target, each with one plain-English reason, preferring variety across bursts. Never overwrite explicit decisions. Add a fixture set with manual labels and report agreement. Make the suggestions reviewable in one calm screen, with Accept all, Accept one and Undo.

## E. Denoise and heal
> Implement a fast, non-generative denoise: separate luminance and chroma strength, ISO-aware defaults, a detail-protection slider and an optional subject-protect mask. Add a 100% split before/after loupe. Preview only the visible tile and process the full image on export, off the main thread. Then add patch-based healing (PatchMatch style) for twigs, droppings and dust: the user brushes the blemish, and the result is stored as a reversible heal entry in the recipe. No generative models. Add an Eco setting that lowers quality for battery.

## F. RAW plus JPEG, camera-neutral
> Treat a RAW and its same-named JPEG as one frame (a `FramePair`) in the catalogue, culling on the JPEG or embedded preview and exporting from whichever the user chooses. Make the decoder interface in `src/core/platformBoundaries.ts` camera-neutral, and move Nikon-specific code into a Nikon adapter. Add tests for pairing rules (case, extensions, sidecars, bursts).

## G. Touch first and macro keypad
> Make pinch-to-zoom, drag-to-pan, swipe to keep or reject, and pull-down to compare the primary interactions on touch devices. Add haptic feedback where available and keep every gesture reachable by a visible button. On desktop, let the macro keypad and scroll dial control slider selection and values through the existing `keyboardCommands.ts` registry, with a mapping screen and conflict detection. Add Playwright tests for touch emulation.

## H. Native shell, mobile, extension and optional sync
> Add a Tauri v2 shell with Rust commands for metadata, RAW decode (LibRaw), a SQLite catalogue and a thumbnail cache. Keep the web and PWA build working. Then build a phone layout for culling and a tablet layout for editing. Add a Chrome extension that only sends a user-chosen image to Kestrel. Design optional sync as an append-only log of decisions and recipes keyed by `stableKey`, never uploading originals, with sign-in strictly optional.

## Checks to run before each pull request
```bash
npm run lint
npm test
npm run build
npm run test:e2e   # run `npx playwright install chromium` once first
```

## Update: your feedback on layout, assisted editing, Nikon and the macro pad

Done in this branch: the adjustments panel sits beside the photo from 768px wide (it used to need 1024px) and its edge can be dragged or moved with the arrow keys; presets (built-in and your own saved looks); an **Auto colour and tone** button with plain-English reasons; the dial and Alt+scroll wheel now step through every slider.

### Macro pad (SinLoon 6 key + knob)
`src/core/keyboardCommands.ts` already has a six-key and one-knob profile. Defaults: knob turns send `-` and `=`, the cycle key sends `Q`, `R` resets, `\` toggles before/after, `W` neutralises warmth, Shift+C and Shift+V copy and paste. The vendor software can reassign each key and knob turn to those characters. I could not read the product page, so check the pad's real behaviour when it arrives (some knobs send volume or media keys, which a browser cannot see). Alt+scroll works with any scroll tool.

### Nikon colour, NX Studio and SnapBridge
Nikon's colour science and Picture Control data are proprietary. The "-style" presets are approximations, not matches. Realistic routes, in order:
1. Read the Picture Control name and settings stored in the NEF and JPEG metadata and show them.
2. Import Nikon `.NP3` Picture Control files the user already owns and map their contrast, saturation and hue to the sliders.
3. Validate any RAW colour path against NX Studio exports with `docs/nikon-raw-validation.md`.
Do not claim parity with NX Studio until that comparison passes.

### Prompts
**Masks, then subject detection**
> Read `docs/ROADMAP.md` and `docs/NEXT-STEPS.md`. Add masks to the edit recipe: linear gradient, radial gradient and brush, each with feather, invert and its own tone and colour adjustments (reuse `applyPhotoEdit` on a copy, then blend by the mask's alpha). Store geometry as normalised coordinates, define how masks behave when the crop changes, validate them in `projectBackup.ts`, and add handles directly on the photo with touch and pointer support. Keep the CPU path as the reference and add GPU masks as a later pass. Add unit tests for the alpha maths. Then add subject and background masks with an optional, checksum-pinned ONNX model (WebGPU with WASM fallback), showing confidence and tap-to-refine. Check the model's licence first and record it in `docs/models.md`.

**Assisted colour**
> Extend `src/core/autoEnhance.ts`: add skin-tone and green-foliage protection, a confidence value for the white-balance estimate, a "match this photo to another" option for a burst, and a before/after toggle on the Auto button. Subject-aware exposure should use the subject mask once it exists. Keep it explainable, deterministic and offline.

**Moveable panels**
> Let the user dock the adjustments panel left, right or bottom, and split it into collapsible groups (Basic, Colour, Tone, Detail, Presets) that can be reordered by drag or keyboard. Persist the layout locally, keep touch targets at 44px on touch devices, and keep every function reachable without drag.

## Trash, removal and reset (feat/safe-trash)
- Buttons follow where a photo is. To review: Keep, Trash, Reset. Keepers and Trash: a cross sends it back to review, and the bin moves it on (Keepers to Trash, Trash to removed). Reset is always beside them.
- Keeper to Trash, and removal from the library, ask first. Removal sets `removedAt` on the photo. The original file is never touched, the record stays so it can be restored (Workspace options, Removed photos) or undone, and adding the same file again revives it as an unreviewed photo.
- One photo resets straight away and stays in its edit history. Several photos ask first.
- The edited marker (sliders icon) shows on grid cards and the filmstrip. When masks are merged, extend `isEdited` in `src/core/editedState.ts` to count active masks.
