# Kestrel handover (15 November 2026)

Where things stand and what is left, in order. Older detail: `AUDIT-2.md`, `AUDIT-AND-ROADMAP.md`, `DESKTOP.md`, `BACKEND.md`.

## State
- `main` has everything up to PR #126 (web app, species ID, online helper, dialog sweep, export fixes).
- Branch `feat/desktop-shell` (**uncommitted, no PR yet**): Tauri 2 desktop shell in `src-tauri/`, native save dialog plus reveal in Finder, desktop CI workflow, `docs/DESKTOP.md`, icons, `tsconfig` excludes `src-tauri`.
- Checked: macOS debug build runs and the user confirmed it works. Type-check and unit tests pass.
- **Not run since the desktop changes:** the Playwright e2e suite. Run `npm run build && npm run test:e2e` before merging.
- **Not verified:** the Finder reveal after saving (just added), the Windows and Linux builds (CI has never run), real phones, screen readers, the macro pad, real NEFs, a real Gemini call, species accuracy on the user's own photos.

## Added after the first handover
- Native Mac menus (File, Edit, View, Window) and a desktop-aware storage panel.
- Watermark (text or picture, six positions, size, strength) in the export step; shown in previews. Unit and e2e tested. Not yet remembered between sessions.
- Auto-update: `DesktopUpdate` banner, `release.yml` (tag `v*` builds a draft release). **Needs the secret `TAURI_SIGNING_PRIVATE_KEY`** (see `DESKTOP.md`). Untested end to end: needs two real releases.
- Full e2e suite: 120 passed.

## Next session, first steps
1. Run the e2e suite on `feat/desktop-shell`, commit, open the PR to `main`.
2. Run the "Desktop app" workflow in GitHub Actions and download the Windows `.exe` and `.msi`.
3. Ask the user whether the save dialog and Finder reveal now behave.

## Desktop and native apps
- Open a folder of photos in place (scoped `fs` read permission) and add a "find missing originals" scan for a chosen drive. Photos are matched by name, size and modified time, so moved files can be re-found. Folder imports use relative paths.
- Keep the catalogue and models as files on disk rather than web view storage.
- Release builds: attach to GitHub releases. Signing needs an Apple Developer account and notarisation (macOS), and a code-signing certificate (Windows).
- iOS and Android: `tauri ios init` and `tauri android init`; needs Xcode, the Android SDK and the user's developer accounts.
- Update check against the backend (`BACKEND.md`).

## Safe to publish (from AUDIT-2)
- Check persistent storage (#126) works and shows its state.
- Web app manifest and home-screen icons.
- Licence (the user's choice, still pending), a third-party notices file, a content security policy (currently `null` in the desktop config).
- Batch saves; measure with 500 and 2,000 photos.
- Remove the unused `motion` dependency; archive `ROADMAP.md` and `NEXT-STEPS.md`.
- Split `App.tsx` and `PhotoEditor.tsx`.
- Real-device pass: iPhone Safari, Android, VoiceOver or TalkBack.

## Editing and product
- Clipping view on sliders, side-by-side compare, taller photo strip, grid full screen, swipe between photos and hold to peek, light denoise.
- Nikon focus data (needs 5 to 10 real NEF and JPEG files).
- Species: test on 30 to 50 of the user's own named JPEGs; try the Gemini helper with their key; model and library updates from the backend.
- Later: Canon and Sony raws, camera import and tethering (phases 10 and 11), social stories, PhotoSpec-style export, cloud storage with accounts and licence keys.

## Open items
- ChatGPT PRs #119 (higher-resolution Nikon previews), #120 (Nikon identity tags), #121 (shortcuts without key codes): not reviewed by me; check against the e2e suite.
- Which mobile download failed (model or export) was never answered; have the user try on a real phone.

## Gotchas
- Rust: `. "$HOME/.cargo/env"` in each shell. Build the app with `npx tauri build --debug --bundles app`.
- Port 4173 stuck: `lsof -ti :4173 | xargs -r kill`. macOS has no `timeout`.
- Merges only when the user says "Merge now".


## End of 15 November 2026 (evening)
**Merged to main this session (via others and me):** desktop shell, Free/Paid gates, licence keys and settings copy, folder sync with safety checks, drag and drop, watch folder, task manager with traffic-light button, Canon/Sony/Fujifilm and other RAW previews, catalogue performance findings, sync and wording fixes.

**Open:** PR #172, full RAW development in the desktop app (`rawler`). Local checks pass (356 unit, 160 browser, 4 Rust tests on real files). Its Windows and Linux builds were still running when this was written. Merge when they pass.

**Real RAW files tested (not in the repo; scratch folders only):**
| File | Preview | Full develop |
| --- | --- | --- |
| Nikon D7200 NEF, Nikon D3 NEF (portrait) | works | works (D3 needed the orientation fix) |
| Nikon Z8 NEF, **High Efficiency\*** | works, 8256x5504 | **not supported** (licensed codec) |
| Canon 5D II sRAW CR2, Canon 5DS CR2 (50 MP) | works | works |
| Sony A7R V ARW | works | works |
| Fujifilm X-T3 RAF, Panasonic FZ70 RW2, Olympus E-300 ORF, Canon 350D DNG | works | works |

**Still not tested:** Z8/Z5II lossless NEF, Canon R-series CR3, Sony HE, the develop button in the running desktop app (browser tests fake the native call), Windows and Linux builds of the decoder.

**HE / HE\*:** no open decoder exists. **On a Mac it works**: when the built-in decoder fails, the app asks macOS's own RAW engine (`/usr/bin/sips`) and gets a full-size, upright, neutral picture (tested on the owner's Z8 HE\* file, 8256x5504, about 3 s; cleaner at 100% than the camera's JPEG). Other platforms:
- **iOS/iPadOS:** probably the same Apple engine; not built or tested.
- **Windows:** Nikon's NEF Codec and Microsoft's Raw Image Extension are proprietary and cannot be bundled; sources suggest neither reads HE\*. HE\* files use the full-size camera preview there.
- **Android:** the platform decodes DNG only; apps bring their own decoder (Snapseed added NEF). The owner says an app on their phone opens NEF; which app, and whether it decodes or just shows the preview, is unknown. HE\* uses the preview.
- **Everywhere:** only a licensed decoder (intoPIX's TicoRAW, price unknown), converting to DNG, or shooting Lossless covers every platform.

**Next, in order:**
1. Click **Develop from RAW** in the real Mac app on the Z8 HE\* file (this is the first real in-app test of the decoder and the Mac HE fallback).
2. Send or find Z8/Z5II lossless NEFs and a Canon R CR3 to test.
3. Keep developed pictures across restarts; 16-bit editing and colour management.
4. Queue scheduling (limit heavy jobs at once) and register species scan, thumbnails and watch-folder imports as tasks.
5. Fix the "change in the last few ms before closing may not save" weakness (see `docs/PERFORMANCE.md`).
6. Apple Developer ID signing (membership payment pending on the owner's side); Windows signing when a certificate is bought.
7. Cloud, accounts and AI are parked (see `docs/COMMERCIAL-RELEASE.md`).

## Final review, night of 15 November
- **main was red** (29 browser failures). Cause: the editor refactor moved subject and tag controls to the library's Photo info but left the species suggestions rendered nowhere. Fixed in #195 (merged): they are back in Photo info, with their tests.
- **Still red on main, not mine:** `auto-adjust-selected`, `auto-multi-select-look`, `filmstrip-bulk` (x2), `selected-looks` (desktop and phone). They fail on a clean checkout of main; they look for toolbar and photo-navigation controls ("Selected photo actions", "Next photo", the Light slider) that the latest editor toolbar change moved. Whoever owns that toolbar should fix the tests. Four older phone tests were skipped with a reason (they were written for the desktop layout).
- **Rule to keep:** run the whole browser suite before merging; the refactor that broke species was merged with a note saying checks had not been run.
- **New:** right-click menu on photos in the library and filmstrip (#198): Edit, Photo info, Keep/Trash/Review, ratings, copy/paste adjustments, Export, Remove. Touch long-press still means select.
- **Mac RAW:** Nikon HE/HE* develops through macOS (#179). Click Develop from RAW in the real app to confirm.
