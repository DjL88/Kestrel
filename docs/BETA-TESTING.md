# Beta testing (closed, 10–20 people)

How the first closed beta runs: who builds what, how testers get the app and a free Pro licence, and how feedback
comes back. Kestrel works fully offline, so no tester needs an account or a server for the beta.

## Builds and who makes them

All builds come from the **same commit of `main`**, and testers report the commit shown in
**Settings → Build information**.

| Platform | Built on | How | Given to testers as |
| --- | --- | --- | --- |
| Windows 10/11 | Windows laptop | `scripts\windows\Build-Kestrel.ps1` (see [INSTALL-FROM-SOURCE.md](INSTALL-FROM-SOURCE.md)) | `Kestrel_<version>_x64-setup.exe`, uploaded to the downloads bucket (`releases/windows/`) |
| macOS | Mac | `npm ci && npm run desktop:build` | `.dmg`, signed and notarised with the Apple Developer account before it goes to testers |
| iPhone / iPad | Mac (Xcode) | `npx tauri ios init` once, then `npx tauri ios build` | TestFlight (internal testers, then up to 10,000 external testers after Apple's beta review) |
| Android | Windows laptop | `npx tauri android build --apk` | Debug APK for the owner's own phone. Testers get a signed AAB through **Google Play internal testing** (up to 100 testers, no review wait) |

Unsigned Windows and macOS builds show a warning the first time they open. For a beta of friends that's acceptable
on Windows ("More info → Run anyway"). Sign and notarise the macOS build, because recent macOS versions make
unsigned apps hard to open.

### Android signing (owner, once)

Google Play needs an **upload key** that you create and keep. Run this on your own computer and choose the
password yourself (Claude must not type it):

```powershell
keytool -genkeypair -v -keystore $HOME\.kestrel-signing\kestrel-upload.jks -keyalg RSA -keysize 4096 -validity 10000 -alias kestrel-upload
```

Keep an offline copy of the `.jks` file and its password. Then enrol in **Play App Signing** when you create the app
in Play Console (package name `app.kestrel.desktop`, as in `src-tauri/gen/android/app/build.gradle.kts`). The
release signing configuration still has to be added to the Gradle build. It will read the keystore path and password
from environment variables, never from the repository.

## Free licences for testers

Beta testers get a normal one-off Pro key at no charge. A key holds no personal data, only the plan, a random ID
and the date.

- **On the Mac** (where the licence private key lives, `~/.kestrel-signing/licence.key.pem`):
  `node tools/licence/issue.mjs` prints one key. Run it once per tester.
- **Later, from the admin console** (`/admin` → Gift a key), once the control plane is deployed with
  `licence_issuing_enabled` and the licence private key is in Secret Manager. Then each key is recorded against the
  tester's email and can be revoked.

Keep a private list (not in this repository) of who got which key, so a key can be revoked if it leaks.

The tester enters the key in **Settings → Licence**. Pro works offline from then on.

## What to ask testers to do

Give each tester this short script, so feedback is comparable:

1. Install, open, choose a language. Note anything confusing in the first minute.
2. Import a folder of 50–500 of your own photos (RAW and JPEG; say which camera).
3. Cull: mark Pick / Reject, try Auto cull. Did it ever hide or lose a photo?
4. Edit five photos: sliders, crop, a mask, denoise. Compare with what you normally use.
5. Export them. Check the files open elsewhere and look right.
6. Quit, reopen, and check everything is still there.
7. Send **Settings → Build information**, your device and operating system, and what went wrong or felt slow.

Feedback goes through the website contact form (saved to the admin inbox) or a shared form. Testers' photos are
**never** sent to Kestrel. Ask for screenshots only.

## Before going public

- Every beta blocker fixed, and the same tests passing on Windows, macOS, Android and iOS hardware.
- Tax and VAT confirmed (see [BACKEND-HANDOVER.md](BACKEND-HANDOVER.md)), SumUp live, store in-app purchases set up.
- Signed installers on the website, `latest.json` switched from "coming soon" to the release.
