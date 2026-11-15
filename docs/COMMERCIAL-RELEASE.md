# Kestrel commercial and release distribution decisions (proposal)

**Decision context:** Mac and Windows betas first; a separate standalone Kestrel domain is planned but not yet registered or verified. Public download site is being built in PR #131. Do not hardcode a speculative domain. The exact name, registrar control and trademark clearance require owner validation.

## Proposed product split

- **Kestrel Local:** £29 GBP one-time *proposed* price. Permanent use of the purchased local desktop editor. Works offline, stores originals and catalogues locally and supports independent export and backup. Define whether major future upgrades are included before checkout.
- **Kestrel Cloud:** £2.99 GBP/month *proposed* entry-level price, **50 GB candidate cap**. Optional subscription for encrypted private cloud storage / sync, subject to a full financial and capacity review. Cloud is not required for desktop activation or local functionality after activation.
- Never describe local filesystem storage as a finite amount of cloud quota: its capacity is determined by the customer's own disk.
- Confirm whether the prices shown to UK consumers include VAT and calculate taxes by country before taking payments. Do not represent this text as a live offer.

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
