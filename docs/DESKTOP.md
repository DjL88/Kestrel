# Kestrel desktop app

The desktop app is the web app inside a Tauri 2 shell (`src-tauri/`). Same code, same tests; the shell adds native saving and, later, folders and signing.

## Run it
Needs Rust (`rustup`, stable) and, on macOS, the Xcode command line tools.

### Windows: build it the same way as the Mac
Use `scripts/windows/Build-Kestrel.ps1` (needs Git, Node 22, Rust with the MSVC toolchain and the Visual Studio 2022
C++ build tools; it checks each and says what is missing). It updates to the latest main, builds the optimised release
installer and opens its folder. After installing, **Settings → Build information** must show the same source revision
as the Mac. Builds from the cloud workflow are debug builds and pause whenever GitHub Actions does, which is why a
Windows PC drifted behind the Mac; see `ROADMAP.md`, section 2.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\Build-Kestrel.ps1
```

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
The macOS build is run by the owner. Windows builds are now made locally with the script above; a clean-machine Windows install/uninstall and the 500-photo scenario in `ROADMAP.md` are still to be observed. Linux builds only in CI.

## Updates
**On only in releases that ship signed update files.** `release.yml` builds the app with `VITE_KESTREL_UPDATER=1` when the `TAURI_SIGNING_PRIVATE_KEY` secret exists, and `UPDATER_ENABLED` in `src/components/DesktopUpdate.tsx` reads it. Local, PR and unsigned builds never check. Update files are made only by `release.yml`, never by ordinary CI. The plugin refuses any update whose signature does not match the public key in `tauri.conf.json`. On Windows the update is the NSIS installer (`updaterJsonPreferNsis`), the same kind people install, so an update never leaves a second MSI copy.

The app checks `https://github.com/DjL88/Kestrel/releases/latest/download/latest.json` when it opens. If a newer signed version exists it shows "Install and restart"; nothing installs without a tap, and nothing is shown when offline or when there is no release yet.

To publish one:
1. One-off: add the **private** update key as the repository secret `TAURI_SIGNING_PRIVATE_KEY` (step 1 of the checklist below). It was generated at `~/.kestrel-signing/kestrel.key` (no password) on the development Mac and is not in the repository. Back it up: without it, installed apps cannot be updated. The matching public key is in `src-tauri/tauri.conf.json`. With the secret present, `release.yml` makes signed update files and `latest.json` by itself.
2. Raise `version` in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, merge, then `git tag v0.1.1 && git push origin v0.1.1`.
3. `release.yml` builds Mac (universal), Windows and Linux, and creates a **draft** release. Publish the draft and apps pick it up.

Apple notarisation and Windows signing are separate secrets (checklist below); until they are added, first installs show an "unidentified developer" or SmartScreen warning.

## Signing and notarising checklist
`release.yml` already reads every secret below. Each part switches on by itself once **all** of its secrets exist, and a
part with only some of its secrets stops the release rather than shipping something mislabelled. The draft release text
states what was actually signed. The accounts, payments and certificates are the owner's; nothing here is switched on
until they exist. Add secrets at **GitHub → Kestrel → Settings → Secrets and variables → Actions → New repository
secret**, or with `gh secret set NAME --repo DjL88/Kestrel` from a terminal.

**1. Update key (free, already made).** On the development Mac:
`gh secret set TAURI_SIGNING_PRIVATE_KEY --repo DjL88/Kestrel < ~/.kestrel-signing/kestrel.key`. It has no password, so
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is not needed. Copy `kestrel.key` to a password manager or offline backup first: if it
is lost, installed copies can never update again. The next tagged release then includes signed update files and
`latest.json`, and that release's app checks for newer versions. Run the update test at the end of this section before telling testers about updates.

**2. macOS (Apple Developer Program, paid yearly membership in the owner's name or company).**
1. Enrol at developer.apple.com/programs. The name on the membership is what macOS shows as the developer.
2. On the Mac, Xcode → Settings → Accounts → Manage Certificates → **+** → *Developer ID Application*. (Not "Apple
   Development" or "Mac App Distribution".)
3. Keychain Access → My Certificates → right-click the *Developer ID Application* certificate → Export as `.p12`, with a
   new password. Then `base64 -i DeveloperID.p12 | pbcopy`, and delete the `.p12` file once the secret is saved.
4. Secrets: `APPLE_CERTIFICATE` (the base64 text), `APPLE_CERTIFICATE_PASSWORD` (the export password),
   `APPLE_SIGNING_IDENTITY` (the full name from `security find-identity -v -p codesigning`, for example
   `Developer ID Application: Your Name (TEAMID1234)`).
5. Notarising: make an app-specific password at account.apple.com → Sign-In and Security, then add `APPLE_ID` (the
   Apple Account email), `APPLE_PASSWORD` (the app-specific password, never the real one) and `APPLE_TEAM_ID` (the ten
   characters in brackets above, also on developer.apple.com → Membership).
6. Check on a clean Mac: download the DMG from the draft release, open it with no warning, and confirm
   `spctl -a -vv /Applications/InFlight.app` says "Notarized Developer ID".

**3. Windows (choose one route).** Since June 2023 certificate authorities only issue code-signing keys on hardware tokens
or cloud HSMs, so a new certificate normally cannot be exported as a `.pfx` for CI.
- **Azure Artifact Signing, formerly Trusted Signing (recommended, Basic tier about US$9.99 a month, no hardware).** Check
  first that Microsoft currently accepts the owner for identity validation: individual validation has been limited by
  country, and a UK company (Companies House) is the safer route. If neither is accepted, use an OV certificate from a CA
  with cloud signing and an exportable route, or the Microsoft Store. Then in the Azure portal: create a Trusted Signing
  account, complete identity validation, create a *Public Trust* certificate profile, register an app (Microsoft Entra
  ID → App registrations) with a client secret, and give it the *Trusted Signing Certificate Profile Signer* role on the
  account. Secrets: `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, `AZURE_SIGNING_ENDPOINT` (the account's
  region endpoint, for example `https://weu.codesigning.azure.net`), `AZURE_SIGNING_ACCOUNT` and `AZURE_SIGNING_PROFILE`
  (the two names chosen in the portal).
- **SSL.com eSigner (the route for a UK individual; owner's choice, 25 Nov 2026).** Azure only verifies individuals in the
  US and Canada. Buy an *IV (Individual Validated) Code Signing* certificate at ssl.com (about US$129 a year) and an
  *eSigner* cloud-signing plan (Tier 1: 20 signings a month, US$20 a month or US$180 a year; each release signs a few
  files). After validation, enrol the certificate in eSigner and choose **TOTP** for automated signing; keep the TOTP
  secret it shows (the base32 text, not the QR picture). Secrets: `ES_USERNAME` and `ES_PASSWORD` (the ssl.com login),
  `ES_CREDENTIAL_ID` (the certificate's eSigner credential ID) and `ES_TOTP_SECRET`. `release.yml` downloads SSL.com's
  CodeSignTool and `scripts/windows/esigner-sign.ps1` signs each file Tauri asks it to.
- **A certificate file**, only if one that can be exported as `.pfx` is available: `WINDOWS_CERTIFICATE` (base64 of the
  `.pfx`: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx")) | Set-Clipboard`) and
  `WINDOWS_CERTIFICATE_PASSWORD`. Set only one Windows route; the release stops if more than one is present.
- Check on a clean PC: the installer shows the publisher name in the User Account Control prompt, installs and uninstalls
  cleanly, and an install over an older version keeps the catalogue. New certificates still build SmartScreen reputation
  over the first downloads.
- Local Windows builds from `scripts/windows/Build-Kestrel.ps1` stay unsigned; signing is only in `release.yml`.

**Update test (owner, on real machines):** publish two real releases, update from the first to the second on both systems, confirm the catalogue and open project survive, and confirm a tampered update file is refused. Keep the update key backed up.

## Native checks still to do
- Moving a project: originals moved or backed up to another drive are found again by name, size and modified time.
- External drive and network share: add photos from them, unplug, reopen the project, reconnect.
- Crash recovery: force-quit during an edit and during an export; reopen and confirm the last saved edit and the catalogue are intact.

## Unsigned prototype installers
First releases are unsigned on both systems. Mac testers right-click, Open on first launch; Windows testers use More info, Run anyway. The website describes the current unsigned-install prompts without calling the app a Beta tier. Signing is added later: Apple once the membership is active, Windows when a certificate is bought (or via the Microsoft Store). The signing checklist above still applies.

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

## Local prototype installation (no paid GitHub Actions)

- **Windows:** `scripts/windows/Build-Kestrel.ps1` builds an NSIS installer from an exact Git revision.
- **Mac:** `scripts/macos/Build-Kestrel.sh` builds a universal DMG from the same revision: signed when a Developer ID Application certificate is in the keychain, notarised when the Apple ID details are set, unsigned otherwise (the file name says which). See [MAC-IOS-PROTOTYPE.md](MAC-IOS-PROTOTYPE.md).
- **Android:** `scripts/android/Build-Kestrel.ps1` builds an ARM64 APK for personal devices. See [ANDROID-PROTOTYPE.md](ANDROID-PROTOTYPE.md). The committed Android Gradle configuration requires **Android SDK API 37**; older API 34 guidance is obsolete.
- **iOS:** initialise/build the native Tauri project using Xcode and your own Apple Developer credentials on the Mac. See [MAC-IOS-PROTOTYPE.md](MAC-IOS-PROTOTYPE.md).

The native app is not called Beta. These are prototype distribution artefacts, with testing
and verification remaining before public release. Signing, notarisation, Store/Play
submission and paid feature purchases are not enabled merely by having compiled bundles.
