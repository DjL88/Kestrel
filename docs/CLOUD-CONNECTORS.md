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
Register these redirect URIs with Dropbox and OneDrive: `https://inflight.studio/V2Proto/oauth-callback.html` (the V2 preview, which is served under `/V2Proto/`), `https://inflight.studio/oauth-callback.html` (the app once it is live at the root), and `http://localhost:53682/oauth-callback` (desktop app). For development also `http://localhost:3000/oauth-callback.html`. The web redirect follows the build's base path (26 Nov 2026: it used to ignore `/V2Proto/` and could not have worked there).

Where the ids go (26 Nov 2026): desktop installers read them from `.env.local` on each build machine (`npm run desktop:build` prints which are missing). The V2 preview image takes `_DROPBOX_APP_KEY` and `_ONEDRIVE_CLIENT_ID` as Cloud Build substitutions (`.cloudbuild/v2proto.yaml`). Google Drive is desktop-only for now (see below), so the web build takes no Google Drive id.

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

## Registration status (21 Nov 2026)
All three apps are registered under the owner's accounts, named "Kite44" (to be renamed InFlight). The client ids are in the owner's build environment, not in Git. **Still not verified against a real sign-in.**

| Service | Registered as | Redirects registered | Status and limits |
|---|---|---|---|
| Dropbox | Scoped access, App folder; `files.content.read/write`, `account_info.read`, `files.metadata.read` | web and `http://localhost:53682/oauth-callback` | Development status, owner only. Needs Dropbox production approval for other users. |
| Google Drive | Desktop-app OAuth client in the `kestrel-hosting` project, `drive.file` scope, Drive API enabled | Desktop clients take no redirect list; Google accepts any `http://localhost:<port>` loopback | Consent screen in **Testing**: only listed test users, refresh tokens expire after about 7 days. Publish (Branding page first) for real users. |
| OneDrive | Entra app, "Any Entra ID tenant + personal accounts"; Graph delegated `Files.ReadWrite.AppFolder`, `offline_access` | web as **Single-page application**; loopback as **Mobile and desktop** | A multi-tenant app may need publisher verification for wide use. "Allow public client flows" not yet checked. |

Findings that change the plan above:
- A Google **Desktop-app** client cannot register the https web redirect, so web pop-up sign-in for Google Drive cannot work with it. Since 26 Nov 2026 the web build says so and points to the desktop app or the Drive folder. Options for later: a Web-type client with the token exchange done by the control plane (the secret stays server-side). Undecided.
- The Google client secret is shown only once at creation. Keep it in the owner's password manager. It ends up inside the shipped app, so Secret Manager would only be a private record.
- The loopback redirect is registered under Entra's "Mobile and desktop" platform, not "Single-page", so no Origin header is needed to redeem the code.
- The development redirect `http://localhost:3000/oauth-callback.html` is not registered with any provider yet.

## Known limits
- Dropbox single upload is capped at 150 MB (larger originals are refused with a plain message; chunked sessions not built).
- Public release needs each provider's app review where required (Google verification, Dropbox production approval) and official logo assets in `ProviderIcon.tsx`.
- Phone-app sign-in, NAS auto-discovery and a "Test with real account" Playwright run are the next items.
