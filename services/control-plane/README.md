# Kestrel control plane

One small, optional service for the parts of Kestrel that need a server: licence activation with offline grants, a managed AI gateway (provider keys stay here), and a signed registry for models and desktop release notices. **Kestrel works fully offline without it.** Nothing here receives originals, catalogues or EXIF.

It is one Node process with one route table (`src/app.ts`). Zod schemas validate every request, and the same schemas generate `/openapi.json`. There are no microservices and no cloud resources. The shared contract lives in `src/core/` and is used by the server and the app alike:

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

## Endpoints

| Route | Auth | What it does |
| --- | --- | --- |
| `POST /v1/auth/session` | none, rate-limited | Email and password → 15-minute HS256 JWT + single-use refresh token |
| `POST /v1/auth/refresh` | refresh token | Rotates the session |
| `POST /v1/licences/activate` | signed `KESTREL1` key | Atomic device-slot count → Ed25519 offline grant (default 30 days, client cap 90) |
| `GET /v1/me/entitlements` | bearer | Plans, AI allowance, next revalidation |
| `POST /v1/ai/identify` | bearer + `userConsent: true` | One metadata-free JPEG ≤512 KB/≤1024 px → checked species answer. 12 s upstream deadline; failures refunded |
| `POST /v1/ai/suggest` | bearer + consent | Bounded slider proposal only, never pixels. `{}` → `alreadyBalanced: true` |
| `GET /v1/models/manifest?app=&channel=` | none | Signed `dataUpdateManifest` with live assets for that app version |
| `GET /v1/desktop/releases?platform=` | none | Latest release for a notice; links allow-listed to `github.com` |
| `POST /v1/billing/webhook` | HMAC-SHA256 `kestrel-signature: t=..,v1=..` | 5-minute replay window, idempotent on event id (replay → 409) |
| `/v1/admin/*` | admin bearer | Overview, audit, accounts, issue/revoke/extend licences, AI kill switch and quotas, model register/promote (rollback = promote older), release publish. Every call is written to the append-only `audit_log`, allowed or denied |

Admin routes accept only bearer tokens in a header. There are no cookies, so a browser holds no ambient credential that a CSRF attack could use. CORS is granted only to the app's own origins (`KCP_ALLOWED_ORIGINS`).

## Security tests

`test/security.test.ts` covers the twelve required negative scenarios: unsigned webhook (401), replayed webhook (409, no change), user on admin (403, audited), expired token (`AUTH_TOKEN_EXPIRED`), missing consent or EXIF present, oversized image (413), malformed upstream (rejected or clamped, quota refunded), 10-way quota race (exactly one 200 and nine 429), 15 s hang aborted at exactly 12 s, offline grant continuity, tampered model checksum (old weights kept), and model path traversal. The suite uses `node:test` like the rest of the repository, not Vitest.

## Before deploying anywhere

These still need the owner's decision, and none is built: the hosting vendor and region, a PostgreSQL `Store` adapter (the schema is portable), a shared rate-limit store for more than one instance, the billing provider's real event names, key custody (signing keys in a secret manager), and a sign-in screen in the app.
