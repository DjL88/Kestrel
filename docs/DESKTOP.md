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

## Signing and notarising checklist
Needs accounts only the owner can create, so none of this is switched on. Do it in this order, testing on real machines between steps.

**macOS** (Apple Developer Program membership):
1. Create a "Developer ID Application" certificate; export it as `.p12` and base64 it.
2. Add repository secrets: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password), `APPLE_TEAM_ID`.
3. Pass those as `env` to the `tauri-action` step in `release.yml`. Tauri then signs and notarises the `.app` and `.dmg`.
4. Check on a clean Mac: download the DMG from the draft release, open it with no warning, and confirm `spctl -a -vv Kestrel.app` says "Notarized Developer ID".

**Windows** (a code-signing certificate; an EV or cloud-signing service avoids SmartScreen warnings sooner):
1. Choose the signing route (certificate file, Azure Trusted Signing or similar) and add its secrets.
2. Set `bundle.windows.signCommand` or the certificate thumbprint in the release build only.
3. Check on a clean PC: the installer shows the publisher name, installs and uninstalls cleanly, and an install over an older version keeps the catalogue.

**Before turning updates on** (`UPDATER_ENABLED`): publish two real releases, update from the first to the second on both systems, confirm the catalogue and open project survive, and confirm a tampered update file is refused. Keep the update key backed up.

## Native checks still to do
- Moving a project: originals moved or backed up to another drive are found again by name, size and modified time.
- External drive and network share: add photos from them, unplug, reopen the project, reconnect.
- Crash recovery: force-quit during an edit and during an export; reopen and confirm the last saved edit and the catalogue are intact.

## Unsigned beta (current decision)
First releases are unsigned on both systems. Mac testers right-click, Open on first launch; Windows testers use More info, Run anyway. The website explains this under "Installing the beta". Signing is added later: Apple once the membership is active, Windows when a certificate is bought (or via the Microsoft Store). The signing checklist above still applies.

## Consistent release versions

Kestrel displays the web package version in the About footer. The native application and signed updates have their own version fields. To keep the public footer, installer and GitHub release aligned, **all three must match**:

- `package.json` → `version`
- `src-tauri/tauri.conf.json` → `version`
- `src-tauri/Cargo.toml` → `[package].version`

Before tagging, update all three, then run:

```bash
node --test scripts/check-release-version.test.mjs
node scripts/check-release-version.mjs
KESTREL_RELEASE_TAG=v0.1.1 node scripts/check-release-version.mjs
```

Use the actual intended tag in the last command. Normal CI checks consistency on every PR. The desktop release workflow also rejects a mismatching `vX.Y.Z` tag **before it invokes the installer publishing action**, avoiding a misleading download or auto-update. The updater itself remains disabled until real signed update and rollback validation is complete.

## Android (debug build works)
`src-tauri/gen/android` is the generated Android Studio project (committed; build output is ignored). To build on a Mac: install JDK 17 and the Android command-line tools (`brew install openjdk@17` and `brew install --cask android-commandlinetools`), then the SDK pieces (`platform-tools`, `platforms;android-34`, `build-tools;34.0.0`, `ndk;27.0.12077973`), add the Rust targets (`rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`), set `JAVA_HOME`, `ANDROID_HOME` and `NDK_HOME`, and run `npx tauri android build --debug --apk --target aarch64`.

Menus, the updater, restart and reveal-in-Finder are desktop-only (`capabilities/desktop.json`, `#[cfg(desktop)]`). **Not yet verified:** the app has not been run on a phone or emulator, so touch behaviour, file picking, saving and photo import on Android are untested. Play Store release needs a signing key (a keystore the owner keeps safe), a Play Console app listing and the owner's developer account.
