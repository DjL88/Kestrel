# Optional regional project sync

Local projects remain the default. Import, cull, edit, export and back up a catalogue without an account or connection. A subscriber can sign in and enable sync for a project. A locally imported original stays in place. Another device downloads previews first and can pin a project and its originals for offline use.

## Storage and catalogue

Use a private object bucket per supported jurisdiction with isolated account and project namespaces. The API derives the destination from a pinned account residency setting. The API checks membership, entitlement and quota before issuing short-lived, object-scoped URLs. Keep catalogue data, queues, logs and backups in the same approved residency boundary. No cross-region fallback.

Cloudflare R2 is a candidate for binary objects where its jurisdiction guarantees match the launch promise. Location hints are best effort. If a UK-only or another country-specific guarantee is required, use a provider with that specific placement commitment. Review where metadata, authentication and request processing run before making a residency claim.

Start with a local outbox that can retry catalogue and preview uploads, using operation IDs and expected revision numbers. Never overwrite an original. Store originals as immutable objects, verify checksums after resumable transfer, and publish their catalogue reference only after verification. If concurrent edits cannot be merged safely, preserve both recipes as versions. Reconnecting after a subscription, permission or quota change must leave local edits usable.

## Release gates

1. Prove two-device catalogue and preview sync, interrupted uploads, duplicate retries, conflict recovery, account isolation, and offline reopen using synthetic files.
2. Add opt-in original sync, visible storage quota, pause and resume, cancellation and deletion controls. Keep local backups restorable without the sync service.
3. Verify the browser/editor workflow on iOS, macOS, Windows and Android, then test native file access, offline storage, share/export and account recovery on physical devices before platform release. Keep image analysis on-device wherever supported.

No services are provisioned by this proposal.

- [R2 data-location guarantees](https://developers.cloudflare.com/r2/reference/data-location/)
- [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
