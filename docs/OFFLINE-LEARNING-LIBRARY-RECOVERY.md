# Offline-first learning, metadata recovery and optional collective intelligence
Status: implementation roadmap and source-grounded gap audit, 18 November 2026. No hosted resources provisioned.

## Product contract
- Local import, cull, edit, export, library browsing, undo, backups and personalised Auto Develop must work with network disabled, expired tokens, quota failures and unavailable AI.
- Originals and developed pixels never upload as part of library metadata backup or learning. Previews are also excluded from this proposed metadata-only service.
- A licence key is an entitlement, **not** an account identifier, encryption secret, or authentication credential. Restore requires a verified account/recovery method; offline licences remain valid according to signed entitlements.
- Local catalogue remains writable when cloud sync is unavailable. Never delete local edits because a licence expires or a subscription lapses.
- The first phase is open-source/local libraries and existing user-owned folder/S3/WebDAV connectors. Managed Firestore/Vertex is later, optional, and separately approved.

## Existing code evidence (main 34c1ec8)
- `src/core/projectBackup.ts`: versioned `kestrel-project` v1 JSON with frames, recipes, masks, history and project settings; import validates structural fields.
- `src/core/storageConnectors.ts`: `StorageConnector`, scoped `kestrel/v1` layout and folder/S3/WebDAV checks.
- `src/providers/projectLocations.ts`: locally remembered locations; not a portable cross-device original identity.
- `src/providers/linkedOriginals.ts`: native linked originals. Existing audit says source identity is not yet portable.
- `PRIVACY.md`: no Kestrel account/telemetry backend today; online Gemini and optional connectors are user-controlled; connector credentials currently live in browser storage.
- `docs/CLOUD-PLAN.md` and `docs/cloud-sync-proposal.md`: proposed regional service and outbox, not production deployment.
- `docs/RELEASE-GAP-AUDIT-2026-11.md`: 500/2,000-photo real-world recovery, native high-bit-depth RAW and physical-device acceptance remain open.
- Open draft PR #362 provides only a pure confidence-mask blending prototype, not integrated learning.

## Proposed local architecture
1. Durable local catalogue: versioned snapshots + append-only edit/decision journal; atomic checkpoint, checksum, schema migrations and recoverable rollback. For desktop prefer SQLite with WAL, backed by portable JSON export. Browser keeps IndexedDB adapter. Never store licence secrets inside the catalogue.
2. Stable project and frame IDs: random opaque IDs plus optional verified content fingerprint for relink. Do not treat filename, modified time or local path as cross-device identity. Keep path hints *local only*; user confirms ambiguous matches. Hashing is local and cancellable.
3. Local style learner: bounded per-subject/camera/ISO/style preference statistics from (suggestion, user correction, acceptance). Keep raw events locally with retention and reset; learn parameters before attempting image-model training. Guard against one-off stylistic choices, outliers and insufficient examples.
4. Local Auto pipeline: technical tone and exposure checks, confidence-weighted masks, subject-specific recipes, reversible preview, local objective quality guard. Do not infer true image quality from popularity.
5. Optional provider-neutral guardian: separate consent and BYO credentials; send only explicitly approved reduced previews, never as part of metadata sync. AI outputs are untrusted bounded proposals; local validation and user undo remain mandatory.

## Metadata-only recovery
- Explicit opt-in per account/project; local backup available without an account.
- Upload only allowlisted, versioned project structure: opaque project/frame IDs, ratings, decisions, tags after privacy review, adjustment recipes, edit history, virtual-copy relationships, subject mask *parameters* (not bitmap masks or thumbnails), and personal style coefficients.
- Do NOT upload image pixels, previews, thumbnails, source paths, filenames, GPS, capture timestamps, device identifiers, free-form prompts, arbitrary EXIF, API keys, licence keys, or mask rasters. Some tags/subject labels and editing patterns are still personal data; require minimisation and clear controls.
- Project manifests include schema version, per-record revision, operation ID, pseudonymous device ID, checksum and encryption envelope. Encrypt metadata client-side with a recoverable account-held key; do not derive encryption from licence key. Key recovery and cross-device bootstrap require explicit design/security review.
- Offline outbox uses idempotent operation IDs, retry with exponential backoff and jitter, server revision preconditions, checksum verification, and never discards an unacknowledged local operation.
- Concurrent edits: merge independent frame operations when safe; preserve both branches for conflicting recipes, decisions and deletes. Tombstones are delayed and recoverable. Never last-write-wins destructive edits.
- Restore: download manifest into a *new staging catalogue*, validate signature/checksum/schema/limits, migrate, inspect and commit atomically. Missing originals show 'Reconnect originals' rather than displaying a broken or incorrect developed image. No silent relink by basename alone.
- Online sync is eventual, not blocking. Show last successful backup, pending edits, conflicts and account recovery status. A device can work offline indefinitely.
- Residency: user-selected region, strict tenant/account isolation, no cross-region fallback. Reconcile regional processing of telemetry and backups before promising residency.

## Collective learning (separate consent)
- Personal learning stays on device by default. Collective telemetry consent is independent from account backup, cloud guardian and diagnostics.
- Opt-in uploads **allowlisted numeric summaries** only: subject class coarse, camera family coarse where justified, ISO band, baseline vs final adjustment deltas, accepted/reverted signals, model version and coarse quality diagnostics. No images, file hashes, filenames, timestamps or precise location.
- Limit contribution per user and cohort; aggregate only sufficiently large groups; robust trimmed/weighted estimates with outlier controls and stratified holdouts. Medians are not automatically 'best practice'.
- Firestore could hold minimal account/consent/state and small metadata records; analytics-scale data belongs in a separate controlled aggregate pipeline. Vertex AI is a possible central trainer, not an on-device runtime. Use signed, versioned, locally cached model updates with rollback and no forced connectivity.
- Privacy: opt-in off by default, preview exactly what is shared, revoke, export, erase linked records, retention, regional processing and abuse protections. Anonymous-style data can still be identifying; review UK GDPR obligations before collection.
- Never train on user image pixels or expose personal style profiles to other accounts without separate permission.

## Delivery sequence and acceptance gates
P0 A. Catalogue reliability: local schema/journal/backup consistency, source identity and safe restore; synthetic interrupted-write and wrong-photo relink tests. Exit: 500 then 2,000 real mixed frames recover on Windows/macOS with NAS disconnect, restart, quota exhaustion and missing volume.
P0 B. Metadata allowlist: pure serializer and validator, explicitly rejects paths, images, keys, arbitrary EXIF and unknown fields. Test hostile and oversized payloads; prove backup roundtrip.
P1 C. User-owned connector sync: local outbox, revisions, duplicate retries, conflict copies, offline restarts and staged restore. Test two devices with synthetic fixtures before any managed backend.
P1 D. Local style learner: consent-free device-local preference vectors, undo/reset, user-correction metrics, per-subject fallback. Benchmark held-out users and avoid degraded defaults.
P2 E. Account-bound metadata backup: secure identity/recovery, encryption, region pinning, signed entitlements separated from accounts, quotas and deletion. Requires security/privacy review and explicit cloud budget approval before deployment.
P2 F. Collective telemetry: separate opt-in, schema, suppression, aggregation, deletion and cohort fairness evaluation. No deployment until privacy review and owner approval.
P3 G. Central Vertex training and model distribution: only when labelled outcomes and holdout evaluation demonstrate improvement; signed updates, local fallback, opt-out and rollback.

## Automation worker instructions
Every hourly pass: inspect main SHA and all open PR ownership/conflicts/checks; repair own pending work first; select highest-value unclaimed bounded slice; write tests; execute local checks when checkout/dependencies exist; open draft PR; report PASS/FAIL/NOT RUN, evidence, next task. Never merge during blocked checks or without authorised immediate AI Studio verification. Never provision GCP/Vertex/Firestore, upload photos, accept SDK terms, spend on hosted CI or touch denoiser training scripts owned by #347/successors.
