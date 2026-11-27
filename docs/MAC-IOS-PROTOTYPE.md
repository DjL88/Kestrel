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
  Mac application for this Mac's chip via `npm run desktop:build -- --target aarch64-apple-darwin` (or universal with `--universal`).
- Copies only a freshly compiled DMG into `src-tauri/target/prototype`, with SHA-256 and
  JSON build receipt. Never uploads the installer or changes photos.
- **Signs it when it can.** If exactly one *Developer ID Application* certificate is in this Mac's keychain
  (`security find-identity -v -p codesigning`), the app is signed with it; set `APPLE_SIGNING_IDENTITY` to choose when
  there are several. It notarises with a saved notarytool profile (`KESTREL_NOTARY_PROFILE=inflight-notary`, made once
  with `xcrun notarytool store-credentials`), or with `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password from
  account.apple.com) and `APPLE_TEAM_ID` set in the same Terminal. The script then checks the result
  (`codesign --verify`, `stapler validate`, `spctl`) and names the DMG `-unsigned`, `-signed` or `-notarised` by what
  was actually verified. Credentials stay in the keychain and that Terminal; nothing is stored or uploaded.

```bash
KESTREL_NOTARY_PROFILE=inflight-notary bash scripts/macos/Build-Kestrel.sh
```

It builds for this Mac's own chip. `--universal` adds Intel, but fails today: onnxruntime (`ort-sys`) has no
x86_64-apple-darwin prebuilt.

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

## Not yet verified (native setup)

`tauri ios init` has been run (21 Nov, Xcode 26.1.1, `xcodegen` and CocoaPods from Homebrew) and the project is in `src-tauri/gen/apple` (bundle ID `app.kestrel.photo`, team `G53UPS2B95`; the entitlements file is empty, so there is no Sign in with Apple entitlement). `npx tauri ios build --debug --target aarch64-sim --ci` produced `Kestrel.app` and it **launched on the iPhone 17 simulator (iOS 26.1)** and showed the Projects screen. Not done: a physical iPhone or iPad, a signed device or TestFlight build, importing, editing or exporting a photo, and a release build. After fixes (21 Nov): the page pads for the status bar and notch, the page, window and launch screen are dark, the app is set to dark mode, the Kestrel icon replaces Tauri's default, pinch, double-tap and focus zoom are off inside the app (`index.html`), iPhone is portrait-only and iPad is landscape-first with all four orientations. Still seen: a darker-grey band about 97 pt tall below the web view on an iPhone 17 (the web view stops short of the bottom edge); not yet explained. Landscape for a fullscreen photo on iPhone needs a native orientation hook and is not built. The Android package rename (`app.kestrel.desktop` to `app.kestrel.photo`) is an edit to the committed Gradle and Kotlin files that has **not been compiled**: build it once with `scripts/android/Build-Kestrel.ps1` on the Windows laptop before merging.

## iOS readiness check (27 Nov 2026, Mac, Xcode 26.1.1, `main` at `18536873`)

Result labels are PASS / FAIL / NOT RUN. This is a readiness inventory, not a release.

| Step | Result | Evidence |
| --- | --- | --- |
| `cargo check --target aarch64-apple-ios-sim` (src-tauri) | PASS | Finished in 3 min 10 s, no errors |
| `cargo check --target aarch64-apple-ios` (src-tauri) | PASS | Finished in 2 min 08 s, no errors |
| `x86_64-apple-ios` (Intel simulator) | NOT RUN | The project builds `arm64` only (`ARCHS`, `EXCLUDED_ARCHS`); not needed on Apple silicon |
| `tauri ios init` | Already done | `src-tauri/gen/apple` is committed (21 Nov). Do not re-run: it would overwrite it |
| `tauri ios build --debug --target aarch64-sim --ci` | PASS | After freeing disk (the first two tries ran out of space): `** BUILD SUCCEEDED **`, `InFlight.app` at `src-tauri/gen/apple/build/arm64-sim/`, debug build on `main` at `f01922b3` |
| Launch on iPhone 17 Pro (iOS 26.1), screenshots | PASS (iPhone only) | Launches, shows the blank dark screen for a few seconds, then Welcome, Quick setup (step 1 of 6) and Projects. Two defects seen, below. iPad (Pro 11-inch M5): NOT RUN, the Simulator access prompt for it was not answered. Importing, editing and exporting a photo: NOT RUN |
| Phone and tablet layout in the browser pane (375 x 812, 1180 x 820) | PASS (web only) | Projects hub fits with no sideways scroll; of 13 controls at phone width only the search box is under 44 px (40 px tall). This is the web build, not the app shell |

Defects seen in the iPhone 17 Pro Simulator (not fixed here: they are in shared frontend and `src-tauri/gen/apple` files other sessions are editing):

1. **Welcome and Quick setup screens ignore the top safe area.** The InFlight logo is drawn under the Dynamic Island. The Projects screen pads correctly, so the first-run screens need the same `env(safe-area-inset-top)` padding.
2. **Grey band under the web view, confirmed.** About 100 pt of lighter grey sits below the page on every screen (the web view ends at roughly y = 777 pt of 874 pt), so the bottom of the page is cut short. Cause still unexplained; start with the web view's frame in `ios_orientation.rs` (`fill_window`) and the launch storyboard.
3. The first tap on "Continue as guest" did nothing and the second worked, on a screen that was still settling: recheck on a device.

### What compiles for iOS, and what is kept off it

Every desktop-only part is already gated, so the iOS build is the shared UI plus the Tauri shell and its plugins.

- **In the iOS build:** `tauri`, `tauri-plugin-dialog`, `-fs`, `-opener`, `-http`, `-persisted-scope`, `-notification`, and `objc2` for the orientation hook (`src-tauri/src/ios_orientation.rs`).
- **Desktop only** (`[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]`, and every module and command in `lib.rs` behind `#[cfg(desktop)]`): `kestrel-raw` (rawler, ticoraw), `kestrel-vision` (onnxruntime through `ort`, which has no iOS build here), `kestrel-sftp`, `nusb` (USB tether), `sysinfo`, `image`, the updater, single-instance and process plugins. So `ptp_usb`, `ftp_inbox`, `shoot_room`, `local_vision`, `import_io`, `preview_cache`, `external_edit`, `sftp`, `raw`, `oauth_loopback` and `resource_sample` do not exist on iOS.
- **What the phone uses instead:** `isMobileShell()` (`src/providers/desktopShell.ts`) turns off the native RAW path, so RAW decode runs through the WebAssembly pipeline (`crates/kestrel-raw-wasm`) and models run through `onnxruntime-web` on one CPU thread. Folder export, SFTP, tethering and the hot folder say "needs the desktop app".
- **Capabilities:** `capabilities/default.json` (dialog open and save, fs, http, notification) applies on every platform. `capabilities/desktop.json` is limited to macOS, Windows and Linux, so on iOS the opener plugin has **no** permission to open a URL. That matches the code (`SiteLink` and Buy Pro are hidden in the mobile shell), but any new link-out on a phone needs an explicit mobile permission.
- **Generated files:** `tauri ios build` rewrites `LSItemContentTypes` in `gen/apple/kestrel_iOS/Info.plist` in a different order each time. Run `git checkout` on that file after a local build rather than committing the shuffle.

### Phone readiness against the mobile wireframes and `docs/mobile-layout-policy.md`

- **Layout:** one responsive editor. Below 800 x 550 CSS px it is the compact, photo-first layout with four 56 px bottom tabs (Flight, Adjust, Formats, More). From 800 x 550 an iPad in landscape gets the desktop left/right panel.
- **Touch targets:** every control a finger uses is at least `--touch-min` (44 px) on touch phones (`pointer: coarse`, `src/v2/ui/v2.css`). One known exception: the Projects search box is 40 px tall.
- **Safe areas:** `viewport-fit=cover` plus `env(safe-area-inset-*)` padding is in place. Still open from 21 Nov: a darker band about 97 pt tall under the web view on an iPhone 17.
- **Orientation:** iPhone upright except for a full-screen photo (`ios_orientation.rs`); iPad turns freely. Not checked on a device.
- **Gestures:** swipe-down closes a sheet; pinch, double-tap and focus zoom are off for the page (`index.html`). Zoom and pan inside the photo are not verified on a touch screen.
- **Getting photos in:** the Files and Photos pickers come from `tauri-plugin-dialog`; there is no folder watch, no USB or LAN tether and no background import. iOS gives the app a copy or a security-scoped link per pick, so "link to the original in place" is weaker than on desktop. Not run.
- **Offline models on a phone:** the bundled set is 173 MB (CLIP 85 MB, DINOv2 43 MB, species lists 46 MB), which counts towards the App Store download size. The 400 to 640 MB packs (RF-DETR, EfficientSAM, NAFNet, BiRefNet) are laptop-sized, so on a phone they should stay off or run in the cloud. On-device vision (`kestrel-vision`), 16-bit RAW develop at scale, denoise and bulk culling belong to desktop and the cloud runner, as ROADMAP platform role 14 says.
- **Sign-in and purchase:** iOS offers email and password only, and Google, Apple and Microsoft sign-in say they are not built for installed apps, so Apple's Sign in with Apple rule (4.8) is not triggered. Buy Pro is hidden on the phone. An in-app purchase (StoreKit) is not built, so a phone user cannot buy Pro there.

### Owner checklist before a TestFlight or App Store build (none of this was done or changed)

1. **Apple Developer Program:** confirm team `G53UPS2B95` is a paid membership that is current. The keychain has a *Developer ID Application: David Leitch (G53UPS2B95)* certificate, which implies it is. It has no *Apple Distribution* certificate, which an App Store or TestFlight build needs. Create it in Xcode (Settings → Accounts → Manage Certificates) or at developer.apple.com.
2. **Bundle identifier:** register `app.kestrel.photo` as an explicit App ID. Decide now: it is permanent once an App Store Connect record exists. The desktop identifier `app.kestrel.desktop` stays separate.
3. **Provisioning:** no provisioning profile is downloaded on this Mac. Xcode can create a development profile once the App ID exists and a device is registered; an App Store profile comes with the Distribution certificate. Register a test iPhone and iPad by UDID for development builds.
4. **App Store Connect record:** create the app (name InFlight, primary language, SKU, bundle ID above) and choose the category (Photo & Video). Do not upload a build until you decide to.
5. **Privacy:** add an App Privacy answer set (the app collects nothing by default; account email, licence and cloud processing are opt-in, so say exactly what they send), a privacy policy URL (`https://inflight.studio/privacy.html`) and support URL.
6. **Privacy manifest:** the app has no `PrivacyInfo.xcprivacy`. Apple requires one that declares the "required reason" APIs the Rust code is likely to touch (file timestamps, system boot time through `mach_absolute_time`, disk space, user defaults), with an approved reason code for each. Choose the reason codes yourself; they are a legal declaration.
7. **Usage descriptions:** none are set. The pickers (`PHPicker`, document picker) need no photo-library permission. Add `NSPhotoLibraryAddUsageDescription` only if "save to Photos" is added, and `NSCameraUsageDescription` or `NSLocalNetworkUsageDescription` only if the camera or LAN features come to iOS (the LAN and USB tether features are desktop only today). Decide the wording in the language of the store listing.
8. **Tracking:** the app has no tracking, so no `NSUserTrackingUsageDescription` and no ATT prompt should be added. Confirm that stays true before ticking "No tracking".
9. **Export compliance:** `ITSAppUsesNonExemptEncryption` is unset, so App Store Connect asks on every upload. The app uses only HTTPS (exempt standard encryption), and an owner decision is needed to add `ITSAppUsesNonExemptEncryption = false` and answer the annual self-classification.
10. **Entitlements:** the file is empty. Sign in with Apple, Associated Domains and In-App Purchase each need a capability on the App ID and an entitlement before they are used.
11. **In-app purchase:** Apple requires StoreKit for selling Pro inside the app (Paddle checkout cannot be offered there). Decide whether the first iOS release is free with email sign-in and existing licences only, or waits for StoreKit and a Paid Apps agreement with bank and tax details.
12. **Review notes:** a demo account or licence key for App Review, and wording that originals are never modified.
13. **Version and build number:** `CFBundleShortVersionString` and `CFBundleVersion` are both `26.12.0`. Every upload needs a build number higher than the last one, so decide whether it stays tied to the product version.

### Next five actions

1. Allow Simulator access for the iPad, then launch the built app on an iPad Pro 11-inch (M5) and screenshot Projects, a project, Cull and Edit on both iPhone and iPad. A full build needs about 6 GB of free disk.
2. Fix the grey band under the web view, the first-run screens' top safe area and the 40 px Projects search box, then re-check at both sizes (frontend files; coordinate with the frontend sessions first).
3. Decide items 1, 2, 5, 6, 9 and 11 above, then add the privacy manifest and `ITSAppUsesNonExemptEncryption` to `gen/apple` in a small PR.
4. Run a debug build on a real iPhone with the Apple Development certificate: import 50 JPEGs and RAW files from Files and Photos, edit, export, reopen, offline.
5. Add an iOS `cargo check` and a Simulator build to a manual or nightly workflow so gating regressions are caught (macOS runner minutes are paid, so not on every push).

## Deferred to final validation phase

Check a real DMG install/upgrade/uninstall, Apple security prompts, 500-photo journey,
iOS photo picker/permissions/import/edit/export, memory use, folder/drive handling,
offline reopen, and cross-platform UI on actual machines. The instructions and builder
do not establish that these devices have passed tests.
