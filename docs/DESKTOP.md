# Kestrel desktop app

The desktop app is the web app inside a Tauri 2 shell (`src-tauri/`). Same code, same tests; the shell adds native saving and, later, folders and signing.

## Run it
Needs Rust (`rustup`, stable) and, on macOS, the Xcode command line tools.

```bash
npm install
npm run desktop:dev      # window with live reload
npm run desktop:build    # release bundle in src-tauri/target/release/bundle
```

## What is native today
- **Saving exports and backups** opens the system save dialog (`src/providers/desktopShell.ts`). Outside the app, the browser download is used as before. The window may write only the file the person picked.
- Everything else (catalogue, models, edits) still lives in the web view's storage.

## Next
1. Open a folder of photos directly, without copying (needs the `fs` read scope for the chosen folder only).
2. Keep models and catalogue as files on disk, so the system cannot clear them.
3. Signing and notarising: needs an Apple Developer account (macOS), a code-signing certificate (Windows). CI currently builds unsigned debug bundles.
4. iOS and Android use the same shell (`tauri ios init`, `tauri android init`); icons are already generated in `src-tauri/icons`.
5. Update check against the backend described in `BACKEND.md`.

## Not verified
Only the macOS build on this machine has been run. Windows and Linux builds run in CI (`desktop.yml`) and have not been opened by a person.

## Updates
**Currently switched off** (`UPDATER_ENABLED` in `src/components/DesktopUpdate.tsx`) until signing, update and rollback are tested on real Mac and Windows machines. Update files are made only by `release.yml`, never by ordinary CI.

The app checks `https://github.com/DjL88/Kestrel/releases/latest/download/latest.json` when it opens. If a newer signed version exists it shows "Install and restart"; nothing installs without a tap, and nothing is shown when offline or when there is no release yet.

To publish one:
1. One-off: add the **private** update key as the repository secret `TAURI_SIGNING_PRIVATE_KEY`. It was generated at `~/.kestrel-signing/kestrel.key` (no password) on the development Mac and is not in the repository. Back it up: without it, installed apps cannot be updated. The matching public key is in `src-tauri/tauri.conf.json`.
2. Raise `version` in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, merge, then `git tag v0.1.1 && git push origin v0.1.1`.
3. `release.yml` builds Mac (universal), Windows and Linux, and creates a **draft** release. Publish the draft and apps pick it up.

Apple notarisation and Windows signing are still separate; until then first installs show an "unidentified developer" or SmartScreen warning.
