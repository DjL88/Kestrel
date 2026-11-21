# Signed asset curator and verified local cache — source-only handoff

Status 21 November 2026: **PARTIAL, NOT DEPLOYED**. This branch adds two reusable, pure boundaries; it does not silently download or install models. No photography is uploaded. Full app and device validation remain NOT RUN.

## End-to-end contract

1. The existing equipment discovery workflow identifies upstream candidates; `planCuratedAssets` quarantines anything without independent rights and quality reviewers, source attribution, fixture evidence, explicit licence, bounded bytes and a non-executable data kind. Candidate approval is NOT a signature or proof of legal permission.
2. An owner-approved release worker must build the existing control-plane `/v1/models/manifest` contract (not a second feed), store immutable content-addressed objects and sign exact canonical manifest bytes with a dedicated Ed25519 release key. Reuse the pinned signature verifier in **draft PR #655**; reconcile its model-only schema with the existing `dataUpdateManifest` and control-plane schema BEFORE wiring this module. Do not accept a digest from an unsigned manifest.
3. On device, after verifying pinned signature, sequence/rollback, expiry, URL origin and compatibility, `activateApprovedAsset` verifies SHA-256, runs a trusted per-kind smoke test, writes an immutable content slot, verifies readback and atomically CAS-switches the active pointer. Prior version stays retained. `readVerifiedActive` fails closed on corruption; the bundled offline fallback remains available.
4. The platform adapter MUST supply crash-durable atomic compare-and-swap (fsync/SQLite transaction), immutable storage, quota accounting, and previous-known-good retention. The existing `src/providers/modelStore.ts` stores blobs but is **not** a durable CAS/rollback implementation. Do not wire it directly without that adapter.
5. Native/WASM decoders, executable code and GPU runtimes are **not** data assets. Distribute via signed app/OS-store releases. Nikon HE/HE* remains gated on independent rights and real camera tests.

## Privacy, cost and consent

No background photos, EXIF, model inference prompts or BYO credentials go to the curator. Large model download requires informed storage/network choice; smaller lens/knowledge data can be checked at most daily with consent. A weekly **dry-run** curation job needs a human approval before signing and publishing. No cloud resource, paid GPU, personal photo bucket, IAM principal or signing key has been created by this branch. Proposed production IAM: isolated read-only upstream fetcher; quarantined staging writer; separate human approval identity; signer with access only to the dedicated release key; immutable distribution writer; public read-only objects. Set a hard monthly egress/storage budget and alerts before activation. Keep audit records and SBOM/weights licences. Never claim that third-party weights are Kestrel-owned.

## Explicit integration owners

- **W5:** reconcile #655 manifest schema and existing control-plane manifest; native/IndexedDB durable pointer adapter, bounded garbage collection, disk budget, previous-known-good recovery, real smoke tests, key rotation and revocation, weekly dry-run publisher. Candidate VLM remains **unselected** until commercial rights, model card, memory, latency, negative-case hallucination and provenance are independently reviewed. No default download.
- **W1:** wire a verified cached asset selector into the existing task manager/launch without touching originals or blocking the editor; keep rollback status unobtrusive.
- **W2/W3:** only consume tested, rights-cleared lens and anatomy/model assets with version receipts; do not infer Nikon codec rights or measured mask accuracy.
- **W4:** existing Soar/Glide/Fly Solo and Colour Confidence controls only; no new AI panel. Fly Solo must never start unsolicited inference.

## Acceptance not yet executed

Crash during staging, tampered content, stale signed manifest, wrong CPU/NNAPI/CoreML architecture, label/model mismatch, full disk, network loss, corrupt pointer, simultaneous updates, old version reopen and source hash invariance; then signed real fixtures on Windows/macOS/iOS/Android. Unit cases in this PR are authored but not executed. Source publication is not native deployment.
