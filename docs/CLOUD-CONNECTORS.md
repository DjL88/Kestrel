# Cloud drive connectors: Dropbox, Google Drive, OneDrive

**Status (21 Nov 2026):** CODED and unit-tested against fake servers (`src/core/cloudDrive.test.ts`,
`src/providers/cloudDriveConnectors.test.ts`). NOT VERIFIED against the real services: that needs the three app
registrations below. Web sign-in uses a pop-up. Desktop sign-in opens the system browser and catches the redirect on
`http://localhost:53682/oauth-callback` with a one-shot listener on this computer only (`src-tauri/src/oauth_loopback.rs`,
4 Rust tests pass with plain `rustc`; the Tauri wrapper in `lib.rs` is NOT compiled yet, see ROADMAP). Phone apps: not built.

## What the person sees
Connections → Add a connection → pick the logo → **Sign in with …**. The provider's own page opens in a pop-up; Kestrel never
sees the password. Afterwards Kestrel can read and write only its own folder:

| Service | Scope | What Kestrel can see |
|---|---|---|
| Dropbox | "App folder" access type | `Apps/<app name>/` only |
| Google Drive | `drive.file` | files and folders Kestrel created |
| OneDrive | `Files.ReadWrite.AppFolder` | `Apps/<app name>/` only |

All use OAuth 2.0 code + PKCE, so no secret ships in the app (Google "Desktop app" clients are the one exception, see below).
Tokens stay on the device. They are removed when the connection is removed.

## Owner steps (about 10 minutes each)
Register **both** redirect URIs with every provider: `https://<your-site>/oauth-callback.html` (web), and `http://localhost:53682/oauth-callback` (desktop app). For development also `http://localhost:3000/oauth-callback.html`.

1. **Dropbox** — https://www.dropbox.com/developers/apps → Create app → *Scoped access* → **App folder** → name it.
   Permissions tab: tick `files.content.read`, `files.content.write`, `account_info.read`, Submit. Settings tab: add the redirect URI.
   Copy **App key** → `VITE_DROPBOX_APP_KEY`.
2. **Google Drive** — https://console.cloud.google.com/apis/credentials (use the Kestrel project). Enable the *Google Drive API*.
   OAuth consent screen: add scope `.../auth/drive.file` (non-sensitive: no security assessment needed). Create **OAuth client ID**.
   Type *Web application* needs a secret that cannot be hidden in a browser; use *Desktop app* and set both
   `VITE_GOOGLE_DRIVE_CLIENT_ID` and `VITE_GOOGLE_DRIVE_CLIENT_SECRET` (Google documents it as non-confidential). Decision for the owner.
3. **OneDrive** — https://entra.microsoft.com → App registrations → New registration → account type *Personal and work/school*,
   platform *Single-page application*, redirect URI as above. API permissions: Microsoft Graph delegated `Files.ReadWrite.AppFolder`,
   `offline_access`. Copy **Application (client) ID** → `VITE_ONEDRIVE_CLIENT_ID`.

Put the ids in the build environment (see `.env.example`). Each id switches on that provider's button; absent ids leave it listed but off.

## Known limits
- Dropbox single upload is capped at 150 MB (larger originals are refused with a plain message; chunked sessions not built).
- Public release needs each provider's app review where required (Google verification, Dropbox production approval) and official logo assets in `ProviderIcon.tsx`.
- Phone-app sign-in, NAS auto-discovery and a "Test with real account" Playwright run are the next items.
