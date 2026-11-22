# InFlight control plane

One small, optional service for the parts of InFlight that need a server: licence activation with offline grants, a managed AI gateway (provider keys stay here), and a signed registry for models and desktop release notices. **InFlight works fully offline without it.** Nothing here receives originals, catalogues or EXIF.

It is one Node process with one route table (`src/app.ts`). Zod schemas validate every request, and the same schemas generate `/openapi.json`. There are no microservices. The shared contract lives in `src/core/` and is used by the server and the app alike:

| Shared module | Used by the server for | Used by the app for |
| --- | --- | --- |
| `signedEnvelope.ts` | Ed25519-signing grants and manifests over canonical JSON | Verifying them against **pinned** keys (WebCrypto) |
| `entitlementGrant.ts` | Building the offline grant | Mapping a verified grant into `commercialAccess.ts` capabilities, offline |
| `dataUpdateManifest.ts` + `modelDelivery.ts` | Refusing assets the client would refuse (`..`, absolute paths) | Verifying a download's size and SHA-256 before an atomic swap; keeping the old file on mismatch |
| `licence.ts` | Verifying `KESTREL1` keys at activation | Verifying the same keys offline |
| `onlineHelper.ts`, `gemini.ts`, `recipeProposal.ts` | Building upstream requests; validating and clamping upstream output | Validating the server's answer again before use |
| `jpegInspect.ts` | Refusing images over 512 KB or 1024 px, or with EXIF/XMP | Never sending such an image |

## Run it on Windows (no Docker, no database install)

```powershell
npm ci
$env:KCP_DEV_MODE = "1"; $env:KCP_DEV_ADMIN_EMAIL = "admin@example.test"; $env:KCP_DEV_ADMIN_PASSWORD = "change-me-local-only"
npm run control-plane
```

Development mode uses an in-memory SQLite database (built into Node 22.13+ as `node:sqlite`) and throwaway keys. It prints the public key the client should pin. Without `KCP_GEMINI_API_KEY`, the `/v1/ai/*` routes answer `AI_NOT_CONFIGURED`.

Tests (they also run in the root `npm test`):

```powershell
npm --prefix services/control-plane test
npm --prefix services/control-plane run lint
```

Every route scenario runs twice: on SQLite (`api.test.ts`, `security.test.ts`) and on Firestore (`*.firestore.test.ts`). `store.test.ts` checks the storage contract on both. Without an emulator, "Firestore" means the in-memory fake in `test/memoryFirestore.ts`. It refuses what real Firestore refuses: reads after writes in a transaction, `undefined` values, `create` over an existing document, and queries that need a composite index. To run the same tests against the real Firestore emulator (needs Java 11 or later; downloads the Firebase CLI and the emulator once):

```powershell
npm --prefix services/control-plane install
npm --prefix services/control-plane run test:emulator
```

## Storage

Route handlers only use the `Store` interface in `src/store.ts`. Each operation that must be atomic (AI allowance, device slots, single-use refresh tokens, idempotent billing events, model promotion) is one method, so each store makes it atomic in its own way. The rules both share (when a licence is usable, what a billing event does, how an extension is counted) are pure functions in the same file.

| `KCP_STORE` | Where | Used for |
| --- | --- | --- |
| `sqlite` (default) | `node:sqlite` at `KCP_DATABASE_PATH` (or `:memory:`) | Local development and tests. Nothing to install. |
| `firestore` | Google Cloud Firestore, native mode. `KCP_FIRESTORE_PROJECT` and `KCP_FIRESTORE_DATABASE` default to the Cloud Run project and `(default)` | Cloud Run. `FIRESTORE_EMULATOR_HOST` points it at an emulator. |

Firestore collections: `accounts`, `account_emails` (keeps email hashes unique), `refresh_tokens`, `licences` (with a `deviceCount` that the activation transaction reads and updates, so two devices racing for the last slot are handled one after the other), `device_activations` (id `<licence>|<device hash>`), `ai_usage_quotas`, `billing_events`, `model_assets`, `desktop_releases`, `settings` and `audit_log`. Queries use equality filters or a single ordering, so no composite index is needed. The Google client is loaded only when `KCP_STORE=firestore`, so local runs never need it.

## Endpoints

| Route | Auth | What it does |
| --- | --- | --- |
| `POST /v1/auth/session` | none, rate-limited | Email and password → 15-minute HS256 JWT + single-use refresh token |
| `POST /v1/auth/google`, `POST /v1/auth/apple` | provider ID token | People sign in with a verified email. Creates the account if new, attaches any waiting entitlement, returns a plain user session. Rate-limited. |
| `POST /v1/auth/refresh` | refresh token | Rotates the session |
| `POST /v1/licences/activate` | signed `KESTREL1` key | Atomic device-slot count → Ed25519 offline grant (default 30 days, client cap 90) |
| `GET /v1/me/entitlements` | bearer | Plans, AI allowance, next revalidation |
| `POST /v1/ai/identify` | bearer + `userConsent: true` | One metadata-free JPEG ≤512 KB/≤1024 px → checked species answer. 12 s upstream deadline; failures refunded |
| `POST /v1/admin/models`, `POST /v1/admin/models/promote`, `GET /v1/admin/models/licences` | admin | Register a candidate, make a version live (rollback = promote an older one; the manifest revision still rises), list licence records. An ONNX model must register with `contract` and `licence` (SPDX id, https source, rights confirmed) and cannot go live without a licence record. Versions are immutable |
| `POST /v1/ai/suggest` | bearer + consent | Bounded slider proposal only, never pixels. `{}` → `alreadyBalanced: true` |
| `GET /v1/models/manifest?app=&channel=` | none | Signed `dataUpdateManifest` with live assets for that app version |
| `GET /v1/desktop/releases?platform=` | none | Latest release for a notice; links allow-listed to `github.com` |
| `POST /v1/billing/webhook` | HMAC-SHA256 `kestrel-signature: t=..,v1=..` | 5-minute replay window, idempotent on event id (replay → 409) |
| `POST /v1/contact` | none; per-sender and global rate limits | Website contact form: name, email, message and `consent: true`. A filled-in hidden `website` field (a robot) gets a normal answer and nothing is stored |
| `GET /v1/admin/config` | none | Tells the admin page whether Google sign-in is set up (the public OAuth client id). No data |
| `POST /v1/admin/session/google` | Google ID token | Allow-listed (`KCP_ADMIN_EMAILS`), verified Google account for this OAuth client (`KCP_GOOGLE_CLIENT_ID`) → 15-minute admin session, no refresh token |
| `POST /v1/admin/licences/grant` | admin | Gives a plan by email, free and idempotent. No key; it attaches when the person signs in. |
| `/v1/admin/*` | admin bearer | Overview, audit, licensees with their devices and AI allowance, free a device, usage, payments (SumUp checkouts from the commerce ledger, plus billing events), contact messages and their status, accounts, issue (with note and expiry)/revoke/extend licences, AI kill switch and quotas, tax, model register/promote (rollback = promote older), release publish. Every call is written to the append-only `audit_log`, allowed or denied. With `KCP_ADMIN_EMAILS` set, an admin role alone is not enough: the account's email must be on the list |

Admin routes accept only bearer tokens in a header. There are no cookies, so a browser holds no ambient credential that a CSRF attack could use. CORS is granted only to the app's own origins (`KCP_ALLOWED_ORIGINS`).

## Security tests

`test/security.test.ts` covers the twelve required negative scenarios: unsigned webhook (401), replayed webhook (409, no change), user on admin (403, audited), expired token (`AUTH_TOKEN_EXPIRED`), missing consent or EXIF present, oversized image (413), malformed upstream (rejected or clamped, quota refunded), 10-way quota race (exactly one 200 and nine 429), 15 s hang aborted at exactly 12 s, offline grant continuity, tampered model checksum (old weights kept), and model path traversal. The suite uses `node:test` like the rest of the repository, not Vitest.

## Deploying

The service runs on Cloud Run in `europe-west2`, with Firestore. `infra/gcp` (Terraform) creates the database, the image repository, the service account, the secrets and the service; the steps are in `infra/gcp/README.md` under "Phase 2". Secrets come from Secret Manager. The owner adds their values with `gcloud`; they are never in Terraform or git. The service is given the licence-issuing private key (`KCP_LICENCE_PRIVATE_KEY_PEM`) only while `licence_issuing_enabled` is on, because only the admin console's "issue a key" needs it.

Still open: a shared rate-limit store before running more than one instance (Terraform caps the service at one), the payment provider's real event names (SumUp, step 4), and sign-in for people (step 3).
