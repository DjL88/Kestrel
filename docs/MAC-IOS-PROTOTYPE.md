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

## Deferred to final validation phase

Check a real DMG install/upgrade/uninstall, Apple security prompts, 500-photo journey,
iOS photo picker/permissions/import/edit/export, memory use, folder/drive handling,
offline reopen, and cross-platform UI on actual machines. The instructions and builder
do not establish that these devices have passed tests.
