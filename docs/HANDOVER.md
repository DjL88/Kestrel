# Kestrel handover (15 November 2026)

Where things stand and what is left, in order. Older detail: `AUDIT-2.md`, `AUDIT-AND-ROADMAP.md`, `DESKTOP.md`, `BACKEND.md`.

## State
- `main` has everything up to PR #126 (web app, species ID, online helper, dialog sweep, export fixes).
- Branch `feat/desktop-shell` (**uncommitted, no PR yet**): Tauri 2 desktop shell in `src-tauri/`, native save dialog plus reveal in Finder, desktop CI workflow, `docs/DESKTOP.md`, icons, `tsconfig` excludes `src-tauri`.
- Checked: macOS debug build runs and the user confirmed it works. Type-check and unit tests pass.
- **Not run since the desktop changes:** the Playwright e2e suite. Run `npm run build && npm run test:e2e` before merging.
- **Not verified:** the Finder reveal after saving (just added), the Windows and Linux builds (CI has never run), real phones, screen readers, the macro pad, real NEFs, a real Gemini call, species accuracy on the user's own photos.

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
