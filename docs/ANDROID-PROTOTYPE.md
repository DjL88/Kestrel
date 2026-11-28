# Kestrel Android prototype — Windows build and local installation

This workflow builds the **same Kestrel application source** as desktop for Android ARM64, using Tauri 2. It does not upload to Google Play, charge any accounts or expose signing secrets. The output is a development-signed **APK** for your own devices and trusted testers, **not** a production Play Store artefact.

## One-time setup on Windows

1. Install **Node.js 22 LTS**, **Git**, **Rust** with rustup, and **JDK 17** (configure JAVA_HOME).
2. Install **Android Studio**; in *SDK Manager* install **Android API 37** (this repo's Gradle compileSdk), **Android SDK platform-tools**, **Android SDK build-tools** and **Android NDK (side-by-side)**.
3. In PowerShell, set the SDK path as needed: `$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"`. The script also searches this standard location.
4. Run `rustup target add aarch64-linux-android`.
5. Enable USB debugging on the test phone and connect it by USB. Confirm Android's trust prompt on the phone.

## Build from clean current main

From the Kestrel checkout, run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\android\Build-Kestrel.ps1
```

The script refuses to overwrite uncommitted changes. If you intend to build an already selected commit/branch instead, use `-NoUpdate`. It installs the locked npm dependencies, checks native and web version consistency, and runs `npx --no-install tauri android build --debug --apk --target aarch64`.

The generated file is copied to:

```text
src-tauri/target/prototype/Kestrel-<version>-android-arm64-<gitSHA>-debug.apk
```

The same folder holds a `.sha256` receipt and `.json` manifest containing the exact commit, APK digest and build date. The script rejects old APKs left over from previous builds.

## Install on a connected test phone

```powershell
powershell -ExecutionPolicy Bypass -File scripts\android\Build-Kestrel.ps1 -NoUpdate -Install
```

Or install the generated file separately by running `adb install -r "path\to\Kestrel.apk"`. This preserves application data when the APK and currently installed app share Android signing identity; otherwise Android may refuse the upgrade. **Do not uninstall** an existing app just to get past a signing mismatch without first backing up its catalogue.

## Licence and backend configuration

The Android APK can import/edit/export locally without a network. Authentic signed Pro keys are verified offline. To add optional online device activation during build, set the **public** environment values:

```powershell
$env:VITE_KESTREL_CONTROL_PLANE_URL = 'https://YOUR-LIVE-CLOUD-RUN-ADDRESS'
$env:VITE_KESTREL_GRANT_KEYS = 'KEY_ID=BASE64_PUBLIC_KEY'
```

Only use the actual deployed server address and pinned verification key. These are not secrets. Do not set private signing keys, Apple credentials, Google Play credentials or Cloud Run admin secrets in `VITE_*` variables. The builder warns if online licensing is unconfigured; it will not silently present cloud features as connected.

## Going from prototype APK to Play Store

A Play Store release is **separate** work. Build a release **AAB** with your release keystore kept privately; configure Play App Signing, an application listing, data safety and app access disclosure; then use Play's internal/closed testing track for invited testers. Do not reuse the debug APK/keystore for production. The app package ID is currently `app.kestrel.desktop`; decide a stable production ID before first release because changing it creates a different Android app. Google Play in-app purchase policies must be addressed before offering paid digital Pro features inside a Play-distributed app.

## Building on a Mac (verified 27 Nov 2026)

The Homebrew SDK layout works: `brew install --cask android-commandlinetools` (SDK at `/opt/homebrew/share/android-commandlinetools`) with `platforms;android-37.0`, `build-tools;36.0.0`, `ndk;27.0.12077973` and `openjdk@17`. Set `ANDROID_HOME`, `NDK_HOME` and `JAVA_HOME` (the `openjdk@17` `libexec/openjdk.jdk/Contents/Home` folder; `/usr/bin/java` is only a stub), then `npx --no-install tauri android build --debug --apk --target aarch64` from the repo root. For `cargo check --target aarch64-linux-android` also export `CC_aarch64_linux_android`, `AR_aarch64_linux_android` and `CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER` pointing at `$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin/aarch64-linux-android24-clang` (and `llvm-ar`). Use the NDK's own `clang`, never the Homebrew one. The build needs about 6 GB free disk (a debug build with `CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0` needs about 4 GB; with full debug info it ran a nearly full disk out of space twice) and downloads about 180 MB of bundled models into `public/models/`. Android never links the desktop-only native crates (`kestrel-raw`, `kestrel-vision`, `kestrel-sftp`, `nusb`, `rawler`): they sit under `cfg(not(any(target_os = "android", target_os = "ios")))` in `src-tauri/Cargo.toml`, and their commands and modules are `#[cfg(desktop)]` in `src-tauri/src/lib.rs`. Phones use the WebAssembly RAW pipeline.

## Owner checklist before any Play Store release (nothing here has been done)

1. **Application ID.** `app.kestrel.photo` (set in `src-tauri/gen/android/app/build.gradle.kts` and `tauri.android.conf.json`). It can never change after the first upload. Confirm it, or choose another before the Play Console app record is created.
2. **Signing.** Create an *upload key* (a keystore kept off the repository and out of chat; `key.properties` and `keystore.properties` are already git-ignored) and enrol in Play App Signing so Google holds the app-signing key. Back the keystore up twice. Add the upload key's SHA-1 and SHA-256 to Firebase project `kestrel-photo` for the Android app before native Google sign-in is attempted (see ROADMAP, Sign-in).
3. **Play Console app record.** Developer account ($25 once; individual accounts created after Nov 2023 must run a closed test with at least 12 testers for 14 days before production access; check the current rule), app name, category (Photography), default language en-GB, contact email, privacy policy URL (`https://inflight.studio/privacy.html`).
4. **Data safety form.** Must match behaviour: local-first, no telemetry by default; optional account (email, Google, Apple sign-in), optional cloud sync and cloud edits (photos leave the device only on an explicit action), optional licence activation, crash/diagnostics only if added. Declare encryption in transit and the in-app deletion route. Set `android:allowBackup` deliberately (the template leaves Android's default, which backs app data up to Google Drive; decide whether the catalogue should be included and say so in the form).
5. **Permissions to justify** (read from the debug APK with `aapt2 dump badging`, 27 Nov 2026): `INTERNET` (cloud, licence, signed asset downloads); `POST_NOTIFICATIONS` (finished exports; asked only when used); `RECEIVE_BOOT_COMPLETED` and `WAKE_LOCK` (both added by the notification plugin so scheduled notifications survive a restart; if InFlight never schedules a notification for later, drop the plugin's scheduling or remove these two with a manifest `tools:node="remove"` entry, because Play asks why each is needed). No storage permission is requested: files come through the system picker (the web view's file chooser, which Tauri routes to the Storage Access Framework), which is what Play expects. Do **not** add `MANAGE_EXTERNAL_STORAGE` or broad media permissions.
6. **Target SDK and 64-bit.** `targetSdk` and `compileSdk` are 37, `minSdk` 24 (confirmed in the built APK). Play requires a 64-bit build: `aarch64` is built (`armv7` is optional and not needed). Play also requires native libraries to support 16 KB memory pages. The first debug build linked with 4 KB alignment (NDK r27); `.cargo/config.toml` now passes `-Wl,-z,max-page-size=16384` for every Android target, and a relink with that flag showed `LOAD` alignment `0x4000`. Re-check the final release `.so` with `llvm-readelf -lW` before upload.
7. **AAB, not APK.** Play requires an Android App Bundle for new apps (`tauri android build --aab`). The bundled models are about 180 MB, close to the 200 MB base-module download limit: move the optional species lists and models to the opt-in download (or a Play Asset Delivery pack) before building the first AAB, and check the size.
8. **Paid Pro.** Play requires Play Billing for digital features sold inside a Play-distributed app (ROADMAP, Pro). Decide whether the Android app sells Pro, or only unlocks it for existing subscribers; Paddle checkout links inside the app are not allowed for the first.
9. **Store listing assets.** 512 px icon, 1024×500 feature graphic, at least 2 phone screenshots (plus 7- and 10-inch tablet screenshots, which matter for the tablet-first editor), short and full descriptions that do not claim more than the app does (no RAW-parity or species-accuracy claims).
10. **Never** upload from this repository's automation. Uploads, tracks and promotion stay with the owner.

## What the 27 Nov 2026 Mac check found (source and build only; no device or emulator)

- **Built:** `cargo check --target aarch64-linux-android --lib` PASSED (1 m 30 s); `tauri android build --debug --apk --target aarch64` PASSED and produced a 240 MB universal debug APK for `app.kestrel.photo` (versionCode 26012000, `arm64-v8a` only). About 230 MB is the Rust library, which embeds the whole web build, including about 180 MB of bundled models.
- **Run on emulators (28 Nov 2026, API 36 Google APIs arm64, Pixel 8 phone and Pixel Tablet AVDs):** the APK installs and launches on both; welcome, quick setup, projects and the new-project dialog render; the software-GPU emulator drew faint duplicated headers after scrolling (probably the emulator, check on a real device). The keyboard resizes the page correctly after the insets fix. **NOT RUN:** a real photo import through the system file picker, RAW develop, export, offline restart, a physical device, a foldable.
- **Found on the emulator:** (a) the status-bar clock was dark on the dark app (Android followed the phone's light setting); (b) `env(safe-area-inset-bottom)` is 0 in the Android web view, so the new-project dialog's Cancel and Create buttons sat under the gesture bar; (c) **Back with a dialog open exits the whole app**: only `PhotoExportPanel` uses `useBackToClose`, so the V2 dialogs and screens push no history entry for Android's Back to pop. (a) and (b) are fixed in `MainActivity.kt` (light system icons; the native side now pads for system bars, cut-outs and the keyboard and tells the page there are none left). (c) is fixed in `src/providers/overlayBack.ts` (phone and tablet app only): each open `role="dialog"` owns one history entry, and Back sends the topmost one an Escape so it closes itself as usual; a dialog that refuses (for example while saving) is not retried, so the next Back leaves. Checked on the phone emulator: first Back closes the new-project dialog and the app stays, second Back leaves. **Still open:** Back from a full screen (editor to projects) is not wired; only dialogs and panels are.
- **Fixed earlier (PR #1913):** the manifest no longer declares an Android TV launcher (it would have put the app in Play's TV quality review); 16 KB page alignment (above); a source test guards both.
- **Open, owner or later work:** (1) the build rewrites the tracked manifest, adding Share/Open-with intent filters for every photo type from `bundle.fileAssociations`; they were reverted, not shipped, because Android has no handler yet for a file handed to the app (`take_opened_files` is desktop only), so the app would open and ignore the photo. (2) Touch targets are 44 px (policy, tests and `.decision-button`), under Material's 48 dp; Play does not enforce it, but accessibility reviewers do. (3) The installed shell turns off pinch zoom (`user-scalable=no`); the in-app 125/150% text size is the substitute, and should be checked with Android's own font scaling. (4) Android sets no cross-origin isolation headers (`tauri.android.conf.json`), so WebAssembly runs single-threaded there: slower RAW development; measure it. (5) `android:allowBackup` and the broad `external-path` entry in `file_paths.xml` are Tauri template defaults; review them for the data-safety form. (6) The back gesture closes dialogs through `useBackToClose` history entries and Tauri's `onBackPressed` (deprecated); verify predictive back on an Android 14+ device at target SDK 37. (7) System bars: `enableEdgeToEdge()`, `viewport-fit=cover` and 25 `safe-area-inset` rules exist; unverified on a device with gesture navigation, a cut-out and a foldable. (8) Heavy work already defers by design: phones skip BioCLIP and the fine-edge model (`optionalModelFitsDevice(..., 'phone')`), canvas is capped at 50 MP on Android, the cull pool at 4 workers; the 2 GB / 14-18 s WebAssembly develop of a 45 MP RAW has not been measured on a phone.

## Evidence still required (deferred to the final validation phase)

Run a clean ARM64 install, real photo-picker/permissions, multi-hundred-photo import, local RAW preview/develop, interrupted editing, export/share, offline restart and catalogue recovery on actual Android devices. Check landscape tablet, iPhone-equivalent narrow phone screens and foldable layouts. Code and script existence do **not** prove the APK has been compiled or works.
