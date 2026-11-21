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

A Play Store release is **separate** work. Build a release **AAB** with your release keystore kept privately; configure Play App Signing, an application listing, data safety and app access disclosure; then use Play's internal/closed testing track for invited testers. Do not reuse the debug APK/keystore for production. The app package ID is `app.kestrel.photo` (set in `src-tauri/tauri.android.conf.json` and the Gradle files; the earlier prototype used `app.kestrel.desktop`, so a phone with that APK needs it uninstalled, as this is a different Android app). Treat it as permanent once the first Play release is uploaded. Google Play in-app purchase policies must be addressed before offering paid digital Pro features inside a Play-distributed app.

## Evidence still required (deferred to the final validation phase)

Run a clean ARM64 install, real photo-picker/permissions, multi-hundred-photo import, local RAW preview/develop, interrupted editing, export/share, offline restart and catalogue recovery on actual Android devices. Check landscape tablet, iPhone-equivalent narrow phone screens and foldable layouts. Code and script existence do **not** prove the APK has been compiled or works.
