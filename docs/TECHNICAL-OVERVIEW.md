# InFlight technical overview and answer bank

Written 26 November 2026 from the code on `main` at commit `57246e38`; facts refreshed on 27 November 2026 against `main` at `aad8f869` (version **26.12.0**). The refresh covered Paddle sandbox and testers, the cloud runner, storage, email and contact, release signing, image scanning (removed) and prices. Facts marked **owner-reported** come from the owner, not the code. Every other statement below comes from the repository (code, Terraform, website policies and the docs that describe the code). Where the code cannot tell us something, the text says **Unknown** or names what the owner must confirm. This is not marketing copy: use it to answer questions accurately, and never claim more than it says.

**Status words used throughout**

| Word | Meaning |
| --- | --- |
| **Built** | The code exists, is wired into the app and has unit tests. |
| **Off by default** | Built, but held behind a switch or feature flag in /admin or Terraform. |
| **Not deployed** | Built, but the cloud resource it needs has not been created or approved. |
| **Not verified** | Built and unit-tested against fakes, but not yet proven against the real service or device. |
| **Planned** | Designed in the roadmap; no working code yet. |

---

## 1. What InFlight is

InFlight is an offline-first, nondestructive photo workflow for photographers: **import, cull, develop, mask, export and reopen**. Its first quality focus is birds and wildlife (Nikon Z8 and Z5II in particular), but it opens RAW files from Canon, Nikon, Sony, Fujifilm, Panasonic, OM System, Pentax and DNG, and nothing in the editing engines is tied to one maker.

- **One codebase** serves Windows and macOS (desktop app), the web, and later iOS and Android.
- **Originals are never written, moved or replaced.** InFlight stores links to the originals, small previews and reversible edit "recipes".
- **Core use is fully offline.** Import, cull, edit, export and local backups need no account, server, upload or paid online help.
- **Every on-device tool and model is free (Basic).** Pro is a subscription that adds cloud capacity and the optional online helper.
- **Ages:** anyone 13 or over can use InFlight on their own device without an account; an account, sharing, cloud storage or buying needs 18 or over (`site/terms.html`).
- **Wording:** people read "models", not "AI", except for their own AI helper (#1859). The app's promise: models measure and suggest; nothing model-made is written into a file's metadata; originals never change.

The product was called **Kestrel**, then **Kite44**, and is now **InFlight** (domain `inflight.studio`). Internal names in the code, storage keys, backup files (`.kestrel.json`) and the GitHub repository (`DjL88/Kestrel`) still say Kestrel on purpose, so saved data, licence keys and updates keep working.

The business is a UK sole trader trading as InFlight, which is the data controller for personal data (see `site/privacy.html`).

---

## 2. How it works, end to end

1. **Import.** The person picks files, a folder, a removable drive or a NAS. InFlight reads metadata (EXIF via `exifr` in the browser; Rust in the desktop app), builds small thumbnails and review previews incrementally so the interface never locks, and records each photo's original path, a stable identity, and its project. RAW and JPEG pairs are recognised. Nothing is copied or changed at the source.
2. **Cull (Kestrel Select).** Flag or unflag, star ratings, filters, burst grouping and side-by-side compare with a shared zoom. On-device models find the subject, check sharpness and group bursts. Automation never removes a flag the person set and never auto-rejects an uncertain photo.
3. **Species and subject names.** A bounded chain: camera hints, then on-device subject detection, then the optional on-device species model, then cloud help only if the person opted in. An unknown species stays unknown.
4. **Develop (TrueDetail).** RAW files are decoded by InFlight's own Rust pipeline (`crates/kestrel-raw`) in the desktop app, or the same code compiled to WebAssembly in the browser. The editor labels whether a picture came from a real RAW decode, an operating-system fallback, or only the embedded JPEG preview.
5. **Edit.** Light, colour, detail, crop, straighten, masks, denoise, spot healing and Auto. Every change is a reversible recipe with undo, history and before/after. Masks are confidence-weighted. Spot healing copies pixels from elsewhere in the same photo; nothing is generated (`src/core/heal.ts`).
6. **Export.** One Export action can write several outputs at once (full-size, web and social sizes, formats). It always shows dimensions, format, quality and destination, and **never silently reduces resolution**: if a full-size export cannot be produced it says so.
7. **Reopen and recover.** Closing and reopening keeps every decision, recipe, virtual copy and source link. A missing original shows a relink option, never a different photo with the same name. A portable metadata-only project backup (`.kestrel.json`) restores decisions and recipes on another device; it does not contain the original photos.

What lives where on the person's device:

| Data | Where |
| --- | --- |
| Catalogue (projects, decisions, ratings, recipes, history) | IndexedDB in the browser or the app's webview (`kestrel-cull-v1`, `src/providers/browserCatalogueStore.ts`). The product spec names a SQLite catalogue for desktop as the target; **the code today uses IndexedDB on desktop too.** |
| Previews | A separate preview cache (browser storage, or a disk cache in the desktop app, `src-tauri/src/preview_cache.rs`). |
| Originals | Where the photographer put them. Read-only to InFlight. |
| Optional sidecars | XMP ratings are read; edit-status sidecars can be written next to exports, never over originals. |

---

## 3. Codebase and stack

| Area | Folder | Technology |
| --- | --- | --- |
| Shared pure logic (edit maths, culling, licences, signed envelopes, pricing, storage rules) | `src/core/` (about 790 files) | TypeScript, unit-tested with `node:test` |
| Platform adapters (file access, previews, models, connectors, sign-in) | `src/providers/` | TypeScript |
| Interface | `src/components/`, `src/v2/` (the V2 workspace) | React 19, Tailwind CSS 4, Vite 8 |
| Editing engine actions (denoise, masks, upscale, RAW develop) | `src/engine/` | TypeScript, Web Workers, WebGL |
| Desktop shell | `src-tauri/` | Tauri 2 (Rust); WebView2 on Windows, WKWebView on macOS |
| RAW pipeline | `crates/kestrel-raw`, `crates/kestrel-raw-wasm` | Rust (`rawler`, `ticoraw` for Nikon HE), WebAssembly (WASI) for the browser |
| On-device vision-language model runner | `crates/kestrel-vision` | Rust, ONNX Runtime (`ort`), CPU only, no network |
| SFTP storage | `crates/kestrel-sftp` | Rust (`russh` on `ring`, pure Rust) |
| Backend ("control plane") | `services/control-plane` | One Node 22 process, Zod-validated routes, OpenAPI generated from the same schemas |
| Cloud runner (heavy jobs) | `services/cloud-runner` | Node, Cloud Run job |
| Private web preview gateway | `services/v2proto` | Node, Cloud Run |
| Public website and admin console | `site/` | Static HTML/JS on Firebase Hosting |
| Infrastructure | `infra/gcp` | Terraform (Google Cloud) |
| Tools (model conversion, species lists, denoise training, i18n audit, local MCP) | `tools/` | TypeScript, Python |

- **Languages:** British English plus 14 full translations (Welsh, Danish, German, Spanish, Finnish, French, Irish, Scottish Gaelic, Icelandic, Italian, Norwegian Bokmål, Dutch, Portuguese, Swedish) and regional English and French spellings (`src/i18n/locales`).
- **Tests:** about 690 unit-test files (`npm test`), Playwright browser tests on desktop and phone layouts, Rust tests for the crates and the desktop shell, and Python tests for tools. GitHub Actions (`.github/workflows/ci.yml`) is the check of record.
- **Accessibility:** no colour-only cues, keyboard access, reduced motion, scalable text, the Atkinson Hyperlegible font option, and a calm default theme.

---

## 4. The RAW engine and WebAssembly

- **Decoder:** `crates/kestrel-raw` decodes the sensor data with `rawler` and, for Nikon High Efficiency (HE and HE\*) files, `ticoraw` (MIT or Apache-2.0). Then InFlight's own develop step (`develop.rs`, `scene_develop.rs`, `camera_look.rs`, lens correction with Lensfun data) produces the working picture.
- **Desktop:** the crate is linked into the Tauri app and runs multi-threaded (`rayon`).
- **Web:** the same crate is compiled to WebAssembly (`crates/kestrel-raw-wasm`, built with `npm run raw:wasm`). It runs single-threaded in a Web Worker because the site does not require cross-origin isolation. A decoder crash becomes a trap the worker catches, and a fresh instance starts.
- **Honesty rule:** the editor says whether it used a real RAW decode, an OS fallback, or an embedded JPEG preview. The README records a run where 12 public samples from 8 makers developed at full size; support for a camera is only claimed after real files from it pass.
- **Nikon HE patent note:** the HE codec is patented, and the crate's software licence is not a patent licence. Including it in every build was an owner decision (19 November 2026, `NOTICE.md`). `--no-default-features` builds without it.
- **Not yet true:** a fully 16-bit, colour-managed RAW workflow end to end, or verified parity with Lightroom, DxO or Nikon NX Studio. Do not claim either.

---

## 5. On-device machine learning

All models run on the device with ONNX Runtime (`onnxruntime-web` in the browser and webview; `ort` in Rust for the vision-language model). Every model file is pinned by size and SHA-256; the app refuses a file that does not match, and keeps the old one if an update fails its check.

| Model | Job | Licence | How it arrives |
| --- | --- | --- | --- |
| YOLOX-Tiny | Finds people, animals and vehicles for culling | Apache-2.0 | Bundled |
| U2-Netp | Subject masks and crops | Apache-2.0 | Bundled |
| BioCLIP (int8) | Species suggestions (birds and mammals) | MIT | Bundled; opt-in download in a browser tab |
| CLIP ViT-B/32 image encoder | Category gate before species; vehicle and aircraft kinds | MIT | Bundled |
| DINOv2 ViT-S/14 | Burst grouping and look-alike frames | Apache-2.0 | Bundled |
| RF-DETR Nano | Multi-subject detection | Apache-2.0 | Desktop installer pack, or download |
| EfficientSAM-Ti | Tap-to-select masks | Apache-2.0 | Desktop installer pack, or download |
| NAFNet (SIDD) | Denoise | MIT | Desktop installer pack, or download |
| BiRefNet-lite | Fine-edge masks | MIT | Desktop installer pack, or download |
| BioCLIP 2 | Larger species model | MIT weights; IOC World Bird List names, CC BY 4.0 | Optional download |
| PP-OCRv5 mobile | Reads aircraft registrations and military serials, only inside aircraft boxes | Apache-2.0 | Opt-in download (Settings → Assistance) |
| SmolVLM2-500M (int8) | The "Vision guardian": plain yes/no second opinions on other models' results | Pack is pinned by checksum; see `crates/kestrel-vision` | Desktop app only, installed separately, no network |

Species name lists (world birds, mammals, reptiles, amphibians, dragonflies, butterflies and moths) are shipped as files checked the same way (`models/bundled-models.json`).

**Model updates** come from one signed list: the models bucket's `manifest/stable.json`, signed with an Ed25519 key (`kestrel-2026-11`). The app checks the signature against a pinned public key and each file's size and SHA-256 before an atomic swap. It checks at most once a day, only when online; offline nothing changes and nothing is reported as an error.

**Is InFlight "generative AI"?** No image pixels are generated. Specifically:

- No diffusion or image-generation model is used anywhere. Spot healing copies real pixels from the same photo.
- The optional learned denoise (NAFNet) cleans the photo's own pixels on the subject, and is used only when a detail check shows real detail survived (`qualifyLearned`); otherwise the built-in denoise is used. Enlarging uses a deterministic Lanczos-3 resampler on the device and in the cloud runner; **no learned enlarger is shipped** (`src/core/upscaleResample.ts`, `services/cloud-runner/src/process.ts`).
- Automatic tags (species and subject suggestions) are never written into exported files, XMP sidecars or the open-formats export; only names a person typed or accepted are (`exportMetadataOptions.ts`, `photoSidecar.ts`, `catalogueExport.ts`).
- The on-device SmolVLM2 model, and the optional online helper (Google Gemini, `gemini-2.5-flash` by default), are language models, but they only return text and bounded numbers (a species suggestion, a yes/no check, a colour opinion, or slider values that the app clamps). They never write pixels and never apply edits without the person's review policy.

---

## 6. Platforms

| Platform | State |
| --- | --- |
| Windows and macOS | Tauri 2 desktop app. Full workflow, bulk RAW, on-device models, local drives, NAS, SFTP, tethering (USB PTP, FTP inbox, hot folder). Optimised `release=true` builds are what the owner installs. |
| Web | The same React app. Works offline once loaded and cached. Browser file permissions and storage limits apply, and the browser must be re-granted folder access after a restart. Served today as the private **/V2Proto** preview (Google sign-in, owner allow-list, `services/v2proto`). |
| iOS and Android | Tauri mobile configurations and an Android prototype exist (`src-tauri/tauri.ios.conf.json`, `docs/ANDROID-PROTOTYPE.md`). **No store release.** The website lists both as "Coming soon". |
| Browser extension | Planned only. |

---

## 7. Hosting and infrastructure

Everything hosted runs in one Google Cloud project, `kestrel-hosting`, mostly in **London (`europe-west2`)**, defined in Terraform (`infra/gcp`). Secrets are added with `gcloud` by the owner and are never in Terraform or Git.

### 7.1 Services

| Component | What it is | Notes |
| --- | --- | --- |
| Website `inflight.studio` | Firebase Hosting serving `site/` | Marketing pages, policies, status page, the admin console (`/admin`) and client galleries (`/gallery`). Some `/v1/...` paths are rewritten to the control plane. |
| Control plane | Cloud Run service `kestrel-control-plane` | The only API. Scales to zero; capped at **one instance** because its rate limiter is in memory. |
| Database | Firestore (native mode) | All server data. Firestore security rules deny every client read and write; only the control plane's service account reaches it (`firestore.rules`). |
| Live cursors | Firebase Realtime Database | Only pointer positions and display names in shared projects, nothing kept afterwards; rules limit each person to their own entry and validate every field (`database.rules.json`). |
| Cloud runner | Cloud Run job `kestrel-cloud-runner` | Heavy jobs (denoise, masks, Lanczos enlarging, cloud edit settings) on a JPEG preview; it has no RAW decoder and refuses RAW input. The job exists in `kestrel-hosting`; whether people can use it depends on the **Cloud editing power** switch and the `cloudRecipe` flag (on since 27 Nov, owner-reported). **Unknown from the code:** how many jobs have run live. |
| Daily account deletions | Cloud Run job plus Cloud Scheduler | Carries out deletions 30 days after a request. |
| Web preview | Cloud Run `inflight-v2proto` | Staging. Every merge to `main` deploys here and nowhere else. |
| Sign-in | Firebase Authentication (project `kestrel-photo`) | See section 8. |
| Push alerts | Firebase Cloud Messaging | Names, counts and random ids only. |
| Email | Gmail SMTP (`infra/gcp/mail.tf`) | Owner's choice on 25 Nov: a **personal Gmail account for now** (Google allows about 500 recipients a day; InFlight stops at 450), later Google Workspace sending from `hello@inflight.studio` (about 2,000; InFlight stops at 1,500). Off until the **Emails from InFlight** switch is on. The public contact address on every policy page is `hello@inflight.studio`. **Unknown from the code:** which account the live server sends from today (see /admin → Advanced → Emails sent today). |
| Learning | Vertex AI batch training | **Off by default**; only from people who opt in. |
| Secrets | Secret Manager | Paddle keys, Gemini key, signing keys, SMTP app password. |
| Builds | Cloud Build (web preview, control-plane image) and GitHub Actions (checks, draft desktop releases) | |

### 7.2 Storage buckets

The bucket names start with the project id (`kestrel-hosting-`).

| Bucket | Access | Holds |
| --- | --- | --- |
| `…-kestrel-models` | **Public read** (`allUsers` objectViewer), versioned | Signed model manifest and ONNX files |
| `…-kestrel-downloads` | **Public read** (`allUsers` objectViewer), versioned | Installers, `SHA256SUMS.txt`, `latest.json`, the desktop updater's `updater/latest.json` |
| `…-kestrel-tfstate` | Private, public access prevented, versioned | Terraform state |
| `…-inflight-gallery` | Private, public access prevented | Client gallery previews under `galleries/` (90-day rule), opened only through short-lived signed links; and, when cloud photos are switched on, shared-project cloud photos under `projects/` (the 2.5 GB that Pro includes; more is paid from Cloud Credit) |
| `…-kestrel-safe-copy` | Private (defined in `safe-copy.tf`) | Managed backup. **Not deployed**: the bucket exists only once the owner approves it |
| `…-kestrel-cloud-inputs` | Private, public access prevented, Google-managed encryption | Cloud runner inputs, deleted when the job finishes |
| `…-inflight-compliance` | Private, versioned, cannot be destroyed by Terraform; the service can add and read, never delete | Signed Online Safety Act risk assessments |

The public buckets are safe for integrity because the app verifies the manifest signature and every file's checksum, and only the `kestrel-publisher` service account can write to them. See section 12.6 for the listing exposure.

### 7.3 Releases and updates

- `main` is staging and deploys only to /V2Proto. Going live is a deliberate promotion by the owner (`docs/RELEASE-FLOW.md`).
- Desktop installers are built by `.github/workflows/release.yml` on a `v*` tag, which is refused unless the commit is on `main`, and produce a **draft** GitHub release only.
- The desktop updater (Tauri) reads `updater/latest.json` from the downloads bucket and verifies each update's signature against a public key pinned in `src-tauri/tauri.conf.json`. Updates start only when the owner runs `scripts/release/publish-updater.mjs`.
- Nothing uploads automatically to the App Store, TestFlight or Google Play.

### 7.4 Cost controls

- A Google Cloud budget alert emails the billing admins.
- A hard monthly ceiling on metered spend (Gemini calls, cloud jobs) inside the control plane: each call reserves its estimated cost first and is refunded if the work did not happen (`spendGuard.ts`; owner approved £20, default metered ceiling £15). This is a brake, not an invoice; the Google billing console is the truth.
- Services scale to zero when nobody uses them.

---

## 8. Accounts and authentication

**No account is needed** to install, import, edit or export. Sign-in is only for licences, cloud features and shared projects.

| Method | How | Status |
| --- | --- | --- |
| Google | Firebase Authentication. Desktop opens the system browser and catches the answer on a one-shot localhost listener (`src-tauri/src/oauth_loopback.rs`). | Built |
| Apple | Firebase Authentication; desktop goes through the website's Apple page | Built |
| Microsoft (personal, work and school) | Firebase Authentication with the Entra app "InFlight". On desktop it is behind a second flag until tried in a real installed build. | Built, switched on per build (`VITE_MICROSOFT_SIGN_IN`) |
| Email and password | Firebase Authentication, with verification and reset emails | Built |

How a session works:

1. The app signs in with Firebase and gets an ID token signed by Google.
2. It exchanges that token at the control plane (`POST /v1/auth/firebase`, also `/google` and `/apple`). The server checks the signature against the provider's published keys, the audience and the issuer, and refuses an unverified email, so nobody can claim a purchase made for someone else's address.
3. The control plane issues a **15-minute access token** (HS256 JWT) and a **single-use refresh token** that rotates on every refresh.
4. Accounts with the same verified email across providers can be merged, with preview and undo (`/v1/me/merge*`).

**Admin console (`/admin`).** Only Google accounts on an allow-list (`KCP_ADMIN_EMAILS`) for the admin OAuth client can sign in. An admin session lasts 15 minutes with no refresh token. Admin calls use a bearer header only (no cookies, so no CSRF), CORS is limited to InFlight's own origins, and **every admin call, allowed or refused, is written to an append-only audit log**.

**Licences.** A licence is a signed `KESTREL1` key (Ed25519). Activation counts device slots atomically and returns an **offline grant** signed with Ed25519: 30 days by default, never more than 90 on the client. The app verifies grants against pinned public keys with WebCrypto, so Pro keeps working offline until the grant runs out. Account, licence, device registration and any backup encryption key are separate concepts; a licence key is never an encryption key or the only form of authentication.

---

## 9. Payments and pricing

- **Paddle Billing** sells Pro. Paddle is the **merchant of record**: it sells to the buyer, works out and pays VAT or sales tax in every country, sends the receipt and pays InFlight the rest. InFlight never quotes tax and never handles card details.
- **Prices (default matrix, `src/core/pricingMatrix.ts`):** Pro **£2.99 a month** or **£29.99 a year**, UK prices including VAT. Pro has been subscription-only since 26 November 2026; older one-off licences are still honoured. The retired one-off price is no longer passed to the server.
- **Sandbox and testers.** The control plane talks to Paddle's sandbox or production (`KCP_PADDLE_ENVIRONMENT`). In the sandbox anyone could pay with Paddle's public test card, so only testers may start a checkout: the admins plus the private tester list (`KCP_SANDBOX_TESTERS`, never in the repository), and payments for anyone else are ignored (`appContext.ts`). **Owner-reported, 27 Nov:** monthly and annual subscription prices and £5/£10/£20 top-ups are set up in Paddle, but the **Selling Pro** and **Cloud top-ups** switches stay off until Paddle approves the `inflight.studio` domain (in review). Which environment the live server uses is not in the repository.
- **Pricing matrix.** One table in Admin → Payments and money → Prices holds the GBP base and the rules for other currencies (EUR, USD, CAD, AUD, NZD, CHF, DKK, SEK, NOK by default). Each currency is either converted from GBP at a stored European Central Bank reference rate with "charm" rounding, or hand-set. Until rates are refreshed only GBP is offered, so nothing is guessed. The website and the app read the same prices from `/v1/pricing`, and Admin pushes them to Paddle and shows any difference, so checkout charges what the site shows.
- **Checkout flow.** The app asks the control plane for a checkout, which creates a Paddle transaction and opens Paddle's overlay on `/pro-checkout`. The app polls the order; once Paddle confirms it, the server issues the signed Pro grant. In production, checkout stays off until the owner switches it on in /admin.
- **Webhooks.** Paddle notifications are verified (HMAC-SHA256 signature, five-minute window) before anything is read, then the transaction is fetched back from Paddle and matched to the stored order. Repeats never create a second sale or licence. A failed check answers 503 so Paddle retries.
- **Cloud Credit (pay as you go).** Top-ups from £5, optional automatic top-up, credit rolls over and unused credit is refundable. Refunds owed after an account deletion appear in Admin → Payments and money → Refunds owed.
- **Basic vs Pro.** Basic is free for good and needs no account: import, cull, edit, export, every on-device model, and 500 cloud-runner photos a month when signed in. Pro adds 5,000 cloud-runner photos a month, larger checks, 2.5 GB of cloud storage for the web app's cloud projects, and the optional online helper. If Pro ends the account returns to Basic; nothing made is ever locked.
- **Refunds and chargebacks.** A full refund or chargeback of a Pro order removes Pro automatically; each Paddle event is handled once (`paddleRefundRevocation`, `server.ts`).
- **Not built yet:** Apple and Google in-app purchase (the entitlement model is ready for them).

---

## 10. Storage and drives ("Where your work lives")

InFlight writes **only inside its own `kestrel` folder** (backups, sync files) and, if chosen, an `export` folder where each save gets its own dated folder. It never changes or deletes photographs and never touches anything else on the drive.

| Connection | How | Platforms | Status |
| --- | --- | --- | --- |
| Local folder or external drive | Native file access (desktop) or the browser's folder picker | All | Built |
| NAS as a mounted drive (SMB) | Mount it in Finder or as a mapped drive, then add it as a folder | Desktop, browser | Built. UNC paths without a drive letter not verified |
| WebDAV (Synology, QNAP, Nextcloud, ownCloud) | Direct, with a dedicated user | Desktop; browser over https only | Built |
| S3-compatible (MinIO, Synology, any S3) | Direct, access key and secret, SigV4 signed | All | Built |
| SFTP | `crates/kestrel-sftp`; the server's host key is shown and pinned on first use, and a changed key is refused | Desktop only | Built |
| Dropbox | OAuth with PKCE, "App folder" access only | All | Built, **not verified**; app key not confirmed |
| Google Drive | OAuth, `drive.file` scope (only files InFlight created) | Desktop only (the client type cannot sign in from a web page) | Built, **not verified**; consent screen still in Testing |
| OneDrive | OAuth with PKCE, `Files.ReadWrite.AppFolder` | All | Built, **not verified** |
| SharePoint and Teams libraries | Same Entra app, `Sites.Selected`; only sites an organisation's IT admin grants | All | Built, **not verified** on a real Microsoft 365 tenant |

Rules that apply to every connection:

- **Plain `http://`** is allowed only to this computer, the local network and Tailscale addresses. Anything on the internet must use https with a valid certificate. The same rule is enforced in the code (`isLocalHost`, `src/core/storageConnectors.ts`) and in the desktop app's HTTP permission (`src-tauri/capabilities/default.json`), and a test checks they match.
- **Passwords** for WebDAV, S3 and SFTP are kept for the session only. Older versions that saved them in plain text are purged on start (`connectionStore.ts`).
- **OAuth sign-ins** never show the password to InFlight; the provider's own page is used. The resulting tokens stay on the device (see 12.6).
- Writes go to a `.partial` file and are then renamed, and exports are write-once, so an interrupted upload never replaces good data.

---

## 11. Optional cloud features

All optional, all opt-in. Several are built but held back until the owner approves the cloud resource.

| Feature | What it does | Status |
| --- | --- | --- |
| Cloud runner | Runs heavy jobs on a JPEG preview (2,560 px) for a busy or small device; the result is a few KB of edit settings | Built; gated by consent, kill switch, plan and quota |
| Shared projects | Members, roles, comments, photo leases, revisions, live cursors, cloud photos | Built; behind switches |
| Client galleries | A link for clients to view previews and leave feedback; links stored as one-way hashes | Built; behind switches |
| Safe copy (managed backup) | Recipes, previews or originals, each its own switch, all off by default | **Not deployed**: answers "not configured" until a bucket is approved |
| Help improve suggestions | Numbers and fixed words about how a person corrected a suggestion, under a pseudonym; Vertex AI trains in batches | **Off by default**; separate opt-in; opting out deletes everything stored |
| Online helper (InFlight's own Gemini) | A second opinion on a downscaled, metadata-free preview | Pro or invited plan, plus its own consent |
| Bring your own AI | The person's own Gemini, Anthropic, OpenAI-compatible key, or a local Ollama or LM Studio | Built; nothing is sent until they choose a provider and agree |

---

## 12. Security and privacy

### 12.1 Data stays on the device

- Originals, catalogues, previews and edits stay on the person's device or their own storage. The control plane never receives originals, catalogues or EXIF (`services/control-plane/README.md`).
- No telemetry, tracking or account by default. Each of backup, learning statistics, diagnostics and cloud AI previews needs its own opt-in. Consent is versioned, so a change of destination asks again.
- When an image does leave the device (online helper, cloud runner), it is a **downscaled JPEG with metadata removed**. The server refuses images over 512 KB or 1,024 px, or that carry EXIF or XMP (`jpegInspect.ts`). Upstream calls have a 12-second deadline and failures are refunded.

### 12.2 Integrity and signing

| What | Protection |
| --- | --- |
| Model files and manifest | Ed25519-signed manifest, pinned public key, SHA-256 and size per file, atomic swap, old file kept on mismatch, path-traversal refused |
| Licences and offline grants | Ed25519, verified offline against pinned keys |
| Desktop updates | Tauri updater signature, public key pinned in the app |
| Installers | `SHA256SUMS.txt` published beside them. **Not signed yet (26.12.0 included):** `release.yml` signs and notarises for Apple, signs for Windows (Azure Trusted Signing or a certificate file) and signs update files as soon as the matching repository secrets exist, but no secrets have been added and no signed release has run (`docs/ROADMAP.md`, `docs/DESKTOP.md`). Local Mac builds can sign with a Developer ID certificate once it is in the keychain (not yet run). The website says early builds are not yet signed by Apple or Microsoft (`site/install.html`). |
| Webhooks | Paddle: HMAC-SHA256 with a five-minute window. Generic billing webhook: HMAC-SHA256, replay window, idempotent on event id |
| Releases | Desktop tags build only from `main`, and only as drafts |

### 12.3 Encryption

- **In transit:** HTTPS everywhere off the local network; plain http only to the local network or Tailscale (already encrypted).
- **At rest in Google Cloud:** Google-managed encryption on Firestore and Cloud Storage. No customer-managed keys are configured.
- **On the device:** InFlight does not add its own encryption to the catalogue, previews or project backups; it relies on the operating system's disk encryption (BitLocker, FileVault) and the browser's storage. Project backups are plain JSON.
- **Managed backup:** a separately reviewed end-to-end encryption and key-recovery design is still required before calling any cloud backup "encrypted storage" (`docs/OPTIONAL-BACKUP-SYNC.md`).

### 12.4 Secrets handling

- Server secrets (Paddle API key, webhook secret and client token, Gemini key, signing keys, SMTP app password) live in **Secret Manager** and reach Cloud Run as environment variables. They are never in Terraform, Git or the front-end build.
- The licence-issuing private key is given to the service only while licence issuing is switched on.
- `VITE_*` build values are public identifiers (Firebase web config, OAuth client ids), never secrets.
- The manifest signing key is reachable only by the `kestrel-publisher` service account, with an offline copy kept by the owner.
- A scheduled job renews the Paddle API key before it expires (`paddle-key-rotation.tf`), and /admin warns if it fails.

### 12.5 Application hardening

- **Desktop content security policy:** scripts only from the app itself (plus WebAssembly), no plugins, no framing, no form posts, and cross-origin isolation headers (`tauri.conf.json`).
- **Admin page:** a strict CSP (`default-src 'none'`), `noindex`, `no-referrer`, `X-Frame-Options: DENY`, `no-store`.
- **Firestore:** deny-all client rules, tested on the emulator.
- **Every request is validated** with Zod; outputs from AI are validated and clamped before use.
- **Twelve required negative security tests** (unsigned and replayed webhooks, user on admin route, expired token, missing consent, EXIF present, oversized image, malformed upstream, a 10-way quota race, a hung upstream aborted at 12 s, offline grant continuity, tampered model checksum, model path traversal) run in `npm test` against both SQLite and Firestore fakes.
- **Reports, not scanning.** InFlight does not scan photos, on the device or in the cloud (owner decision; image scanning removed in #1814). Anyone with a gallery link can report a photo or a gallery; an admin chooses no action, removing the photo or closing the gallery, with a reason both sides see (Admin → Messages → Reports about shared galleries). For child sexual abuse material the admin removes it, closes the account and reports by hand to the NCA and the IWF (`docs/safety/README.md`).

### 12.6 Known gaps and open items (be upfront about these)

1. **Public bucket listing.** The models and downloads buckets grant `allUsers` the `roles/storage.objectViewer` role (`infra/gcp/main.tf`). That role includes `storage.objects.list`, so anyone can list every object name in those buckets, including unreleased installers or model files placed there before announcement. Integrity is not affected (signatures and checksums), and the files are meant to be public, but the listing reveals more than intended. Fix: grant `roles/storage.legacyObjectReader` (read an object by name, no listing) instead. **Open in the code as of this commit.**
2. **Cloud-drive OAuth tokens** (Dropbox, Google Drive, OneDrive, SharePoint) are stored in the app's local storage on the device (`src/providers/oauthSession.ts`), not in the operating system's credential store. The same applies to bring-your-own AI keys (`aiSettings.ts`). The product spec asks for the OS credential store; this is not built.
3. **Google Drive desktop client secret** ships inside the desktop app. Google documents this client type as non-confidential, but it means the privacy page's line "secrets never in the app" needs that footnote.
4. **Rate limiting is in memory**, so the control plane is capped at one instance until a shared store is added.
5. **Installer signing:** release builds, including 26.12.0, are not signed yet (see 12.2).
6. **The admin page asked with `confirm()`**, which embedded browsers cancel silently; fixed by #1880 (questions in the page).
7. **Cloud connectors and SharePoint** have not been tested against real accounts.
8. **Policies are drafts.** `LICENSE`, `NOTICE.md` and the privacy pages say they need legal review before public release.

---

## 13. Compliance

| Topic | Position in the code and policies |
| --- | --- |
| UK GDPR | InFlight (UK sole trader) is the data controller. ICO registration has been applied for and is pending (`site/privacy.html`). |
| Data rights | Download my data (articles 15 and 20: account, licences, devices, shared projects, cloud photo list, comments, orders, alert devices, email preferences and balance, as JSON and CSV). Delete my account (article 17): the person types DELETE, it happens 30 days later unless they sign in to cancel, and a daily job carries it out in resumable steps. |
| Retention | Purchase records are kept six years for UK tax law; licences are detached from the person but kept as rows. Cloud runner inputs are deleted when the job finishes. Live cursors are not kept. |
| Data location | Server data in London (`europe-west2`). Firebase Authentication, Hosting and Messaging, and Gemini use Google's global or US locations, as listed on `site/subprocessors.html`. Some regions are marked for the owner to confirm. |
| Subprocessors | Google Cloud, Firebase (Auth, Hosting, Messaging, Realtime Database), Google Workspace or Gmail (email), Vertex AI (model training, off by default), Gemini API (online helper). No photo-scanning service. Paddle, Apple and Google stores are independent controllers. |
| Payments and tax | Paddle is merchant of record and handles VAT and sales tax worldwide. Admin → Advanced → Tax tracks turnover against UK thresholds. |
| Online Safety Act | Illegal-content and children's-access risk assessments are in `docs/safety/`; signed copies are kept in the private compliance bucket and downloadable from /admin. Acceptable-use and reporting routes exist for galleries. |
| Cookies | Policy at `/cookies`. The admin console and web app use no tracking cookies; the /V2Proto preview sets one secure, HTTP-only session cookie. |
| Third-party licences | All bundled models are Apache-2.0 or MIT, listed with checksums; notices in `docs/notices/` and `NOTICE.md`. Nikon HE support carries a patent note. |
| Accessibility | Built to avoid colour-only cues, with keyboard access, reduced motion and scalable text. No formal WCAG audit is recorded in the repository. |
| Certifications | **None.** No SOC 2, ISO 27001 or penetration test report is in the repository. |

---

## 14. Not verified or unknown

- Whether production currently has each switch on (Pro checkout, shared projects, galleries, cloud runner, learning, compliance bucket). Check /admin → Switches. Owner-reported on 27 Nov: Selling Pro and Cloud top-ups off (Paddle domain review); `accountData` and `cloudRecipe` flags on.
- Whether the shipped installers for a given release are code-signed and notarised.
- Real-account tests for Dropbox, Google Drive, OneDrive and SharePoint.
- Whether the live server uses Paddle's sandbox or production.
- How many cloud runner jobs have run live, and the live email sending account.
- The sending account and data location for email, and the Realtime Database region.
- Physical-device parity for phones and tablets.
- Measured RAW colour against Nikon NX Studio, and any parity with Lightroom or DxO.

---

## 15. Answer bank

Short answers, safe to paste. Each one is true to the code at the commit above.

### Customers

**Does InFlight upload my photos?**
No. Your photos stay on your computer, drive or NAS. InFlight only uploads something if you switch on a cloud feature, and then only what that feature says (usually a small preview with the camera details removed).

**Do I need an account?**
No. Install it and use it. An account is only needed for Pro, cloud features and shared projects.

**Will it change or delete my original files?**
Never. InFlight reads your originals and stores your edits as reversible recipes in its own catalogue. It writes only inside its own folders.

**Does it work offline?**
Yes. Importing, culling, editing, exporting and backups all work with no connection. Pro keeps working offline for up to 30 days between check-ins.

**Will InFlight invent things in my photos?**
No. InFlight does not generate image content. Its models find subjects, make masks, group bursts, suggest species and reduce noise in your own pixels. Spot healing copies from elsewhere in the same photo.

**Which cameras does it support?**
RAW from Canon, Nikon (including High Efficiency), Sony, Fujifilm, Panasonic, OM System, Pentax and DNG, with newer support for Samsung, Hasselblad, Phase One, Leica and Leaf. Support for a specific body is confirmed only once real files from it pass.

**What does Pro cost and what do I get?**
£2.99 a month or £29.99 a year in the UK, including VAT. Pro adds 5,000 cloud-runner photos a month, 2.5 GB of cloud storage for cloud projects and the optional online helper. Every on-device tool is free in Basic.

**Who takes my payment?**
Paddle, our reseller and merchant of record. Paddle handles the card, the tax and the receipt. InFlight never sees your card details.

**Can I use my NAS, Dropbox, OneDrive or Google Drive?**
Yes. A NAS works as a mounted drive, over WebDAV, S3 or SFTP. Dropbox, OneDrive and Google Drive connect through their own sign-in pages and InFlight can only reach its own folder there.

**How do I get my data or delete my account?**
In the app, choose Download my data, or Delete my account. Deletion happens 30 days later, and you can cancel by signing in before then.

**Is it available on iPhone, iPad or Android?**
Not yet. Desktop (Windows and macOS) comes first; phone and tablet apps are in development.

### Partners and integrators

**Is there an API?**
The control plane has a documented HTTP API (OpenAPI generated from its schemas), but it serves InFlight's own apps and is not offered as a public partner API.

**Can InFlight work with our storage or tethering?**
It speaks WebDAV, S3, SFTP, SMB (as a mounted drive), Dropbox, Google Drive, OneDrive and SharePoint, and it receives photos from tether apps' folders, camera Wi-Fi FTP transfer and USB (PTP) in the desktop app.

**How does SharePoint access work for a business?**
Your IT admin grants InFlight access to a specific site using Microsoft's `Sites.Selected` permission. InFlight can reach only the sites you grant, never the rest of the tenant.

**Which models do you use and are they licensed for commercial use?**
YOLOX-Tiny, U2-Netp, BioCLIP, CLIP, DINOv2, RF-DETR, EfficientSAM, NAFNet, BiRefNet, PP-OCRv5 and SmolVLM2. The bundled ones are Apache-2.0 or MIT, each pinned by checksum with its notice shipped.

### Investors

**What is the architecture in one line?**
One React and TypeScript app, wrapped in Tauri for desktop, with a Rust RAW engine (also compiled to WebAssembly), on-device ONNX models, and one small optional Node service on Google Cloud for licences, payments and cloud features.

**What does it cost to run?**
Very little at low traffic: services scale to zero, the control plane is one instance, and a hard monthly spend ceiling (owner-approved £20) brakes metered AI and cloud jobs. Heavy work runs on the customer's own device.

**How is revenue collected?**
Through Paddle as merchant of record, so global VAT and sales tax are handled without InFlight registering in each country. Pro is a subscription; Cloud Credit is pay as you go.

**What is defensible?**
Offline, on-device intelligence for wildlife photographers (subject, species, burst and focus checks), a calm and accessible interface, and a strict never-mislead rule on RAW decoding and confidence. It is not parity with Lightroom or DxO and should not be pitched as such.

**What is the platform status?**
Desktop is the full product. Web runs as a private preview. Phone apps are not released. Store in-app purchases are not built.

**Who builds it?**
A sole trader owner directing several AI coding agents in one repository, with GitHub Actions as the check of record and a staging-first release flow.

### Security reviewers

**Where is customer data stored?**
On the customer's device by default. Account, licence, order and shared-project records are in Firestore in London (`europe-west2`). Sign-in is handled by Firebase Authentication.

**How is authentication handled?**
Firebase Authentication (Google, Apple, Microsoft, email and password). The control plane verifies the provider's ID token (signature, audience, issuer, verified email) and issues a 15-minute HS256 access token and a single-use rotating refresh token.

**How is the admin console protected?**
Google sign-in limited to an email allow-list, 15-minute sessions with no refresh, bearer tokens only (no cookies), CORS limited to our origins, a strict CSP, and an append-only audit log of every call, allowed or refused.

**How are secrets managed?**
In Google Secret Manager, injected into Cloud Run at run time, never in Git, Terraform or the front-end build. Build-time `VITE_*` values are public identifiers only.

**Is data encrypted?**
In transit with HTTPS (plain http only on the local network or Tailscale). At rest in Google Cloud with Google-managed keys. On the device InFlight relies on the operating system's disk encryption; it does not add its own.

**How do you stop tampered models or updates?**
The model manifest is Ed25519-signed and checked against a pinned key, every file is checked for size and SHA-256 before an atomic swap, and desktop updates are signature-checked against a key pinned in the app.

**Can clients read your database directly?**
No. Firestore rules deny all client reads and writes; only the control plane's service account has access, and the rules are tested on the emulator.

**What happens to images sent for AI help?**
Only with consent, only a downscaled JPEG with metadata removed (the server refuses EXIF and anything over 512 KB or 1,024 px), with a 12-second deadline. The service is built not to keep the image after answering (see the privacy notice). Google does not use paid Gemini API data to train its models.

**Do you have SOC 2, ISO 27001 or a pen test?**
No, not yet.

**Known issues?**
Yes, and we track them: public model and download buckets currently allow object listing (fix: switch to a get-only role), cloud-drive tokens and bring-your-own AI keys are stored in app storage rather than the OS credential store, rate limiting is single-instance, and release builds are not code-signed yet. See section 12.6.

**How do you handle illegal content?**
InFlight does not scan photos. Anyone with a gallery link can report a photo; an admin decides with a reason both sides see, and child sexual abuse material is removed, the account closed and the matter reported to the NCA and the IWF. Photos that stay on a device are never seen by us.
