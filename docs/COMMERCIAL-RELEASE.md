# Kestrel commercial and release distribution decisions (proposal)

**Decision context:** Mac and Windows betas first; a separate standalone Kestrel domain is planned but not yet registered or verified. Public download site is being built in PR #131. Do not hardcode a speculative domain. The exact name, registrar control and trademark clearance require owner validation.

## Three-tier product split — Mac and Windows first

| Tier | Price | Entitlements |
| --- | --- | --- |
| **Free** | £0 | Basic local editing and export, user-owned projects/backups, offline. No registration required. |
| **Paid** | £29 one-off (proposed) | Lifetime local desktop app, full import → cull → edit → export, all local advanced tools, unlimited permitted personal use. No mandatory cloud or continuous sign-in. |
| **Subscribe** | £2.99/month (proposed, in addition to the one-off licence) | All Paid benefits plus optional private cloud sync/storage and hosted AI assistance while subscribed; 50 GB is only a candidate tier pending cost validation. |

**Unresolved purchase design:** If a Free user subscribes without already owning Paid, checkout should either bundle a Paid entitlement or make the £29 prerequisite explicit. Do not charge and silently leave their editing features locked. Existing paid customers should never have to repurchase their local licence.

The native desktop beta includes Free and Paid. Cloud subscription and hosted AI ship only after the service has passed access-control, privacy, security, cost and billing tests. Do not advertise them as live.

### Data minimisation and login

- Free needs **no account**. The paid desktop app can activate once and cache a verifiable, signed entitlement locally for offline use. Its independent backup and export remain available without online validation.
- The intended cloud account uses **username + password + selected country**. A hosted identity service holds properly salted, slow password hashes and authentication secrets. Never hold passwords in plaintext or implement password storage in the frontend. If only usernames are collected, offer secure recovery codes: without an email address or another verified factor, password recovery is genuinely harder. Passkeys may be an optional upgrade.
- Use a random, non-guessable internal account ID; usernames are not security boundaries and may change. Only store that ID, a unique username, **cloud data-residency country**, opaque identity-provider subject, licence/plan state, minimal billing-provider subscription reference, account timestamps and verified device identifiers when needed.
- No card data, postal addresses, legal names, full payment receipts, API secrets or identity documents in the Kestrel application database. A hosted **merchant of record** (e.g. Paddle, subject to commercial approval) collects required billing email/address, payment methods, tax and invoices. Kestrel may still be a controller/processor for the minimum linked identifiers, login events and IP-related logs; do not promise to store *zero* customer data.
- Hosted checkout + verified webhook → server-side subscription entitlement. Validate provider signatures, deduplicate webhook IDs, handle refunds/disputes, and reconcile subscription status. Never unlock access solely from a browser redirect or a client-set flag.
- A username/password pair is not a licence secret: server issues a signed, revocable device licence, securely bound to the account. **Five active desktop devices is a possible soft cap**, with a self-service device list, revoke, hardware changes and offline tolerance. No silent device fingerprinting, invasive telemetry or routine activation limits unless abuse justifies them.

### Country and privacy

- At first **cloud activation**, show a plain-language storage-country choice (residence/data-location preference). Do not infer it solely from IP, browser locale, billing country or language.
- Map chosen countries to supported *verified* storage/data-processing regions, subject to the legal/data-residency assessment. Example design: UK → UK-resident provider if guaranteed; EU member → approved EU region; US → approved US region. For other countries, explain the proposed location and gain explicit agreement or decline service until supported. A self-declared country does not establish tax residence or lawful transfer grounds.
- Pin the region per account/project before writing any cloud objects. Keep image objects, previews, catalogue metadata, auth tenancy data, queue payloads, operational logs and backups within the stated scope of the residency promise. No automatic cross-region fallback; country changes require a deliberate migration process with notice, checksum verification and deletion of prior copies.
- Each user's cloud objects private by default, immutable originals, scoped short-lived signed URLs, authenticated project membership, per-account quota and full audit of security-sensitive changes. Choose encryption-at-rest/in-transit and a documented operator access policy.
- User data protection rights, legitimate operational logging, incident response, clear privacy notice and retention/deletion controls still apply even when personal collection is minimised.

### Subscription cancellation and cloud lifecycle

1. Until the **end of the last paid subscription period**, cloud uploads and authorised hosted AI remain available. On cancellation or overdue payment, a server may disable uploads immediately under the published policy; no accidental charges or silent resubscriptions.
2. After paid access ends, **uploads and hosted AI stop**. Existing remote files remain **read-only and downloadable for 365 days**, giving the owner time to export or resubscribe. Local originals and edits remain untouched.
3. The backend records the final paid-through timestamp *from verified billing events*. Server time governs expiry (not the desktop clock). Provide the exact read-only deadline in the account UI and repeated advance deletion warnings through the chosen recovery channel. If a user refuses all external contact details, warn that external reminders may be impossible; show notices on login instead.
4. After the 365-day window, remote data is **eligible for deletion** only according to a separately published, reviewed retention/deletion process; no auto-deletion is implemented by this code. Preserve a short additional operational buffer where applicable. Restoration after permanent deletion cannot be promised.
5. Resubscription before deletion restores cloud upload/AI permissions subject to a new verified entitlement and quota. If the account exceeds a reduced quota, allow download before upload.
6. The one-off Paid licence is **permanent**, independent of cloud status. Never hold users' local work hostage to a failed payment.

The `commercialAccess.ts` capability helper is deliberately **not** wired to any real billing system or filesystem locks. Server-side authorization is mandatory for any future cloud call. Its year-long download window is for planned UI behaviour only, and does not schedule deletion.

### Costs to validate before setting cloud quota

At 50 GB, object capacity is only one cost. Model storage + bandwidth + Class A/B operations + metadata/database + auth + monitoring + backup replication + support + payment processing + VAT + failed payments / refunds / disputes / abuse + app-store fees. Cloudflare R2 Standard is a potential vendor (published reference: https://developers.cloudflare.com/r2/pricing/) but no account, bucket, payment product, or cloud service is provisioned here. Compare providers and select residency guarantees before production.

### Entitlement boundary

`src/core/commercialAccess.ts` is a **pure policy helper for eventual UI integration**; no UI, server verification, licence issuance, purchase or payment integration ships with it. Any server request must verify licence and cloud entitlement itself; client-side state is **not an authorisation system**.

- One-time purchase becomes a cryptographically verifiable, cached local licence with a deliberately specified offline grace policy (do not implement DRM until the product and threat model are agreed).
- No cancellation, network error, missing account or expired cloud plan may erase local data or prevent local backup/recovery.
- Unlicensed/trial users must still retrieve/export their existing personal work and independent project backups, even if they cannot initiate new edits.
- Enforce quota server-side at upload reservation and commit (include multipart/resumable uploads and concurrent requests).
- A cancelled cloud account must have a published read-only/export grace window and clear deletion notice; never silently delete remote files.
- No credential, API key, private signature or photo content in checkout redirect URLs or release manifests.
- Store receipts and account identifiers in the smallest appropriate data residency boundary.

## Desktop-first OTA releases

- Ship **outside Mac App Store** for the initial macOS beta if GitHub updater is required. Use Tauri v2 signature-verifying updater and macOS Developer ID signing + notarisation. The Mac App Store distribution variant must use App Store updates.
- Windows: signed MSI/NSIS installer, Tauri v2 updater, distinct architectures, restore-on-failure tests. Windows signing is distinct from Tauri updater signing.
- Host immutable per-version signed update bundles and `latest.json` on GitHub Releases. Generate the manifest from exactly the signed artefacts. Tauri updater verifies signatures against a pinned public key in the native app; publishing private signing keys to the repo or browser is prohibited.
- **Do not wire the updater to a generic GitHub 'latest release' until updater artefacts and signatures exist.** Species-model-only releases do not provide applications. Prefer an app-only release channel/tag and a maintained signed update manifest.
- Update checks may run automatically; use an unobtrusive availability notice and safe install on restart rather than surprising active edits. Require clean-save and recoverable migrations; test offline app launch, unsigned/tampered bundles, failed downloads, rollback and old-catalogue compatibility.
- No updater transport is implemented yet, because `src-tauri/`, native signed binaries and signing keys do not exist.

## Mobile release policy

- iOS / iPadOS via TestFlight/App Store: update executable code **through Apple distribution**, not a GitHub OTA updater. Tauri updater's availability does not override Apple App Review Guideline 2.5.2. App Store Mac builds must also update via the App Store.
- Android via Google Play: update executable code through Google Play only. APKs distributed independently can have a separately reviewed sideload/update process, but should not be conflated with Play releases.
- Data, species-library metadata and licensed model files can be delivered through the application's verified content-delivery mechanism subject to store guidelines, privacy and download consent. This is different from replacing executable application code.

## Standalone domain setup

1. Owner confirms and purchases the chosen domain; check brand clearance, DNS and registrar MFA.
2. Use root domain for Kestrel marketing, `www` alias, `app` for an optional hosted browser beta, `api` for future authenticated services; `updates` only if GitHub-hosted update manifests are insufficient.
3. Launch marketing statically on GitHub Pages or another suitable static host. Configure HTTPS, DNS ownership validation, SPF/DKIM/DMARC if support email is provisioned, and avoid any payment/account promises until the service exists.
4. Add privacy, software licence, legal entity/contact/support information, refund and cancellation terms before enabling checkout. Public GitHub repo currently lacks a root LICENSE; owner must choose an appropriate licence separately.
5. Only advertise installable Mac/Windows packages after notarisation/signing, physical-device QA, reproducible provenance, privacy and backup tests.

## Still requires owner approval

- Exact domain spelling and acquisition; legal entity and licence policy.
- Whether £29 includes all future major versions, and activation-device limits.
- Cloud storage cap after cost validation (50 GB is a proposed starting tier, not a commitment).
- Payment provider and tax handling, desktop Apple Developer/Windows signing arrangements.
- Which regions to support and their verified storage, metadata and log residency.
- The release signing keys and CI secret ownership, never shared through a prompt or committed to GitHub.

Primary upstream references:
- https://v2.tauri.app/plugin/updater/
- https://developer.apple.com/app-store/review/guidelines/
- https://support.google.com/googleplay/android-developer/answer/16559646?hl=en-GB
- https://developers.cloudflare.com/r2/pricing/

## Free and Paid in the app (current)
- One list: `src/core/features.ts`. Free: import, cull by hand, edit, export, watermark, macro pad, backup. Paid: masks and subject detection, the Auto tab, species ID, any online AI, auto-cull, and exporting more than the daily allowance.
- Free exports are limited to `FREE_DAILY_EXPORT_LIMIT` (10) photos per local day, counted on the device (`src/core/dailyAllowance.ts`). It is an honest limit, not a lock: the count is in local storage. Backup and recovery are never counted or blocked.
- **Beta: everything is open** (`useAccess.ts`) until licence activation exists. To see and test the Free experience: `VITE_KESTREL_PLAN=free KESTREL_PLAN_PREVIEW=free npx playwright test tests/free-plan.spec.ts`. Those tests skip in normal runs.
- Apple notarisation will use the owner's Apple ID as the repository secret `APPLE_ID` (never committed), plus an app-specific password and Team ID the owner creates.
