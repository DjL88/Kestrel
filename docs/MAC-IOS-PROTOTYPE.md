# Kestrel Mac and iOS prototype — local owner build

Kestrel shares the exact same React workflow across platforms. The Mac installer is built
from `main` with Tauri; iOS requires Apple's Xcode and your Apple Developer account.
Neither step requires paid GitHub Actions. Sign/notarise only when your certificates are ready.

## Build a Mac installer

On the **Mac**, install Node.js 22 LTS, Xcode Command Line Tools and Rust. In Terminal:

```bash
xcode-select --install
rustup target add aarch64-apple-darwin x86_64-apple-darwin
cd /path/to/Kestrel
bash scripts/macos/Build-Kestrel.sh
```

The script:
- Refuses to change an uncommitted checkout, unless you explicitly use `--no-update`.
- Fetches the newest `main` and uses its exact Git revision.
- Confirms release versions match, installs locked dependencies, and builds a **universal**
  Apple silicon + Intel Mac application via `npm run desktop:build -- --target universal-apple-darwin`.
- Copies only a freshly compiled DMG into `src-tauri/target/prototype`, with SHA-256 and
  JSON build receipt. Never uploads the installer, accesses signing credentials or changes photos.

This first installer is **unsigned/unnotarised**. It is for installation on your own Mac,
not a claim of public distribution readiness. Settings → Build information shows the Git
revision; it should match the Windows installer for cross-platform parity.

### Optional online licence service

If the control plane is actually deployed, the build may include these **public** values:

```bash
export VITE_KESTREL_CONTROL_PLANE_URL='https://YOUR-LIVE-CLOUD-RUN-ADDRESS'
export VITE_KESTREL_GRANT_KEYS='KEY_ID=BASE64_PUBLIC_KEY'
```

The Kestrel signing PRIVATE keys, Cloud API credentials and Apple developer passwords must
never be put in VITE-prefixed settings. Signed one-off Pro keys remain usable offline.

## iPhone / iPad preparation on your Mac

**Identifiers.** iPhone, iPad and Android use `app.kestrel.photo` (`src-tauri/tauri.ios.conf.json` and `tauri.android.conf.json`, which Tauri merges over `tauri.conf.json` for those platforms). The desktop apps keep `app.kestrel.desktop` on purpose: a desktop app's saved catalogue and settings live in a folder named after its identifier, so renaming it would make an installed Kestrel look empty. The Apple App ID `app.kestrel.photo` (with Sign in with Apple) and Services ID `app.kestrel.photo.web` already exist on team `G53UPS2B95`.

**Make Xcode usable (needs your password, once).** The Command Line Tools are not enough for iOS:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
xcodebuild -version
```

Open Xcode once, sign in under Settings → Accounts, and let it install the iOS platform and simulator. `xcodegen` and the iOS Rust targets (`aarch64-apple-ios`, `aarch64-apple-ios-sim`) are already installed on this Mac.

**After `tauri ios init`:** open the generated project under `src-tauri/gen/apple`, select the Kestrel target → Signing & Capabilities, confirm the team and bundle ID, and add the **Sign in with Apple** capability (Firebase's Apple sign-in on iOS also needs the app registered in the Firebase console with this bundle ID, and its `GoogleService-Info.plist`; neither is added yet).

1. Install the latest compatible **Xcode** and accept its licence. Ensure your Apple
   Developer team is accessible in Xcode Settings → Accounts.
2. In a separate clean Kestrel checkout, install dependencies and the iOS Rust targets:
   `npm ci`
   `rustup target add aarch64-apple-ios aarch64-apple-ios-sim`
3. If `src-tauri/gen/ios` is absent, initialise that native project deliberately:
   `npx --no-install tauri ios init`
   Review its generated bundle identifier, app icon, file/document permissions and
   capabilities before committing. Do not overwrite an existing Xcode project.
4. Launch the iOS development build from Tauri or open the generated Xcode project.
   Choose **your** team and a development provisioning profile in Xcode. Signing secrets
   remain in your local Apple Keychain/Developer account.
5. When the prototype is feature-complete, prepare an archived iOS build for **TestFlight**.
   App Store Connect / TestFlight invitations can distribute the app to trusted testers;
   public App Store release is a separate signed submission.

Apple's standard TestFlight testing mechanism does not automatically grant a Kestrel
**Pro entitlement**. Issue complimentary signed Pro keys using Kestrel Admin and verify
offline continuity. Protect tester personal information and keep originals local.

Do not claim an iOS IPA has been created until the Xcode/Tauri project has actually been
initialised, built and signed on your Mac. The Windows Android APK builder is documented
separately at [ANDROID-PROTOTYPE.md](ANDROID-PROTOTYPE.md).

## Not yet verified (native setup)

`tauri ios init` has not been run (it needs Xcode selected, above), so there is no iOS project in the repository and nothing has been built for a simulator or device. The Android package rename (`app.kestrel.desktop` to `app.kestrel.photo`) is an edit to the committed Gradle and Kotlin files that has **not been compiled**: build it once with `scripts/android/Build-Kestrel.ps1` on the Windows laptop before merging.

## Deferred to final validation phase

Check a real DMG install/upgrade/uninstall, Apple security prompts, 500-photo journey,
iOS photo picker/permissions/import/edit/export, memory use, folder/drive handling,
offline reopen, and cross-platform UI on actual machines. The instructions and builder
do not establish that these devices have passed tests.
