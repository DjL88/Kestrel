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
