# Optional backup sync — architecture contract

This module is a transport-neutral, opt-in backup sync primitive. It is **not yet connected** to a real NAS, WebDAV, S3 or cloud provider, and it does not sync RAWs. Use `encodeProjectBackup`/`decodeProjectBackup` at the application boundary; this module only verifies opaque bytes. Never put access tokens, passwords or refresh tokens into backup contents, paths, logs or URL query strings.

## Safe adapter requirements

`BackupRemote` requires strong read-after-write consistency for a newly created object and the head pointer, atomic **create-if-absent**, and atomic **ETag compare-and-swap** for the head. A provider without these guarantees is **unsupported for writes**; do not simulate CAS with a read followed by an unconditional PUT. An SMB/NAS implementation should use exclusive file creation and atomic rename with durable flush, and verify whether the filesystem can implement true conditional replacement. For S3, use a supported conditional request and reject providers that ignore preconditions. A user-owned remote is optional; a failed remote operation never blocks local editing.

Store a last-verified `BackupAnchor` in the **local durable project catalogue**, before acknowledging upload. The anchor detects accidental rollback/fork against the last known remote revision, but it is not a cryptographic signature and cannot defend a brand-new device against a fully malicious server. Do not call this encrypted or authenticated storage. For confidentiality use platform secure transport plus a separately reviewed encryption/key-recovery design. Remote payloads contain project metadata; warn users before enabling cloud storage.

Before accepting a downloaded backup, run `readVerifiedBackup`, then `decodeProjectBackup`, then relink original files by independently verified identity. Never overwrite existing local decisions automatically. Never write or modify camera originals. Missing or changed originals must remain visibly unresolved.

## Remaining implementation

Wire a durable local anchor, explicit conflict-resolution UI, native/permission-scoped file adapter, supported cloud/NAS adapters and opt-in credential vault. Add recovery across interrupted pointer writes and real provider conformance tests. Full unit/lint/build/Playwright/native checks and actual provider deployments are NOT RUN in this source-only branch. Do not mark the roadmap complete or imply installed-app parity.
