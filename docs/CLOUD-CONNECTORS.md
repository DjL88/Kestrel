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

## Registration status (21 Nov 2026, corrected 26 Nov 2026)
The 21 Nov note below said all three apps were registered as "Kite44". On 26 Nov the lead looked in the consoles and the
Microsoft one was **not found**, so the table below is not reliable: see "What was actually found" at the end of this
file for what exists now. **None of the three has been verified against a real sign-in.**

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

## What was actually found (26 Nov 2026)
Checked by the lead in the consoles. Client ids are public identifiers; no secret is in Git or in this file.

| Service | What exists | Still missing |
|---|---|---|
| OneDrive (and Sign in with Microsoft) | Entra app **"InFlight"** in the owner's tenant, client id `2d7f2fd3-bf07-4afa-8707-8c4a9d643b7e`. Accounts: any Entra tenant plus personal Microsoft accounts. Redirects: Web `https://kestrel-photo.firebaseapp.com/__/auth/handler` (Firebase sign-in); Single-page `https://inflight.studio/oauth-callback.html`; Mobile and desktop `http://localhost:53682/oauth-callback`. Graph delegated: `User.Read`, `openid`, `email`, `profile`, `offline_access`, `Files.ReadWrite.AppFolder`. The same app serves OneDrive and Sign in with Microsoft. | Client secret (owner creates it and pastes it only into Firebase Auth's Microsoft provider). Single-page redirect for the V2 preview, `https://inflight.studio/V2Proto/oauth-callback.html`, and for development, `http://localhost:3000/oauth-callback.html`. Publisher verification, before wide use by other organisations. |
| Google Drive | "Desktop app" OAuth client `172130699322-d6hqgmdm7d56oh4609tfutrtb009ok8e.apps.googleusercontent.com` in the `kestrel-hosting` project. | Consent screen is still **Testing** (only listed test users; refresh tokens expire after about 7 days). Its client secret is the owner's and goes only in the build machine's `.env.local`. A desktop client cannot sign in from a web page, so Google Drive is desktop-only. |
| Dropbox | **Not confirmed.** The app key is unknown. | Create or locate the app (Scoped access, App folder) and give the lead the app key. |

Where each id goes:
- **Web (V2 preview image):** Cloud Build trigger substitutions in `.cloudbuild/v2proto.yaml`, passed into `services/v2proto/Dockerfile` as build arguments: `_ONEDRIVE_CLIENT_ID` and `_DROPBOX_APP_KEY` (added by PR #1727), and `_MICROSOFT_SIGN_IN` (`1` once Firebase's Microsoft provider is enabled). Google Drive takes no web id.
- **Desktop installers:** `.env.local` on each build machine (`npm run desktop:build`, or `scripts/windows/Build-Kestrel.ps1` on Windows): `VITE_ONEDRIVE_CLIENT_ID`, `VITE_DROPBOX_APP_KEY`, `VITE_GOOGLE_DRIVE_CLIENT_ID`, `VITE_GOOGLE_DRIVE_CLIENT_SECRET`, `VITE_MICROSOFT_SIGN_IN=1`. Desktop Microsoft sign-in also needs `VITE_MICROSOFT_DESKTOP_SIGNIN=on`, which stays off until it has been tried in a real installed build (see `src/core/microsoftSignIn.ts`). The GitHub desktop workflows build draft installers without any of these, so their builds have sign-in and drives off.

## SFTP, shared drives and a NAS away from home (26 Nov 2026)
- **SFTP** (desktop app only; a browser cannot speak SSH). `crates/kestrel-sftp` (russh on ring, pure Rust) opens one session per call. **Test the connection** shows the server's SHA-256 fingerprint; saving trusts it, and any later call to a server with a different key is refused (`host-key-changed:` to the page). Password or OpenSSH key, kept for the session only; address, user, folder and fingerprint are kept so **Sign in again** refills them. Writes `kestrel/v1/...` via a `.partial` file then rename; `export/...` is write-once. Live check: `KESTREL_SFTP_TEST=host:port:user:password[:root] cargo test` in the crate.
- **SMB / office shares**: connect the share on the computer (Finder, Go, Connect to Server; or a mapped drive letter on Windows), then add it as a **folder**. UNC paths (`\\server\share`) without a drive letter are not verified.
- **NAS away from home and plain http** (owner, 26 Nov 2026): plain `http://` is allowed only to this computer, the local network (10.x, 172.16 to 31.x, 192.168.x, `.local` names) and Tailscale (100.64 to 100.127 addresses and `.ts.net` names), because a Tailscale tunnel is already encrypted. Anywhere else on the internet needs https with a valid certificate (Tailscale HTTPS, or Synology DDNS with Let's Encrypt). The rule is `isLocalHost` in `src/core/storageConnectors.ts` (WebDAV and S3), and the desktop app's HTTP permission (`src-tauri/capabilities/default.json`) allows exactly the same addresses, checked by `scripts/native-http-scope.test.mjs`. Self-signed certificates do not connect. QuickConnect does not carry WebDAV or SFTP. In the web version a browser also blocks plain http from an https page, so a LAN or Tailscale address over http works in the desktop app only.

## SharePoint and Teams libraries (26 Nov 2026)
- **What the person does:** in *Where your work lives*, they choose **SharePoint or a Microsoft Teams library**, paste the library's address (for example `https://contoso.sharepoint.com/sites/Photos/Shared Documents`) and sign in with Microsoft. InFlight finds the site and library (`/sites/{host}:/{path}:` then `/sites/{id}/drives`) and keeps its files in an `InFlight` folder there. It reuses the OneDrive connector, addressed by `/drives/{id}/root:/InFlight/...`.
- **Scope:** `Sites.Selected` plus `offline_access`, on the `organizations` (work or school) endpoint and the **same Entra app** as OneDrive (`VITE_ONEDRIVE_CLIENT_ID`). InFlight reaches only the sites an organisation's admin grants it, never the rest of the account. The scope is set by one constant, `SHAREPOINT_SCOPE` in `src/core/cloudDrive.ts`, while the owner decides between this and the wider delegated `Files.ReadWrite.All`.
- **Owner step (once):** Entra, App registrations, the InFlight app, API permissions, Add, Microsoft Graph, **Delegated**, `Sites.Selected`. Supported account types must include work or school accounts. The redirect URIs are already there from OneDrive.
- **Each business's IT admin (once per site):**
  1. Consent to InFlight for the organisation: Entra, Enterprise applications, InFlight, Permissions, *Grant admin consent*.
  2. Grant the site, with PnP PowerShell: `Grant-PnPAzureADAppSitePermission -AppId <InFlight client id> -DisplayName InFlight -Site https://contoso.sharepoint.com/sites/Photos -Permissions Write`. Or use Graph: `POST /sites/{site-id}/permissions` with `{"roles":["write"],"grantedToIdentities":[{"application":{"id":"<client id>","displayName":"InFlight"}}]}`.
  If this step is missing, InFlight says the organisation hasn't given it access to the site yet.
- **Not verified:** a real Microsoft 365 tenant. The unit tests use a stand-in for Graph.
