# Kestrel public launch plan — 15 November 2026

This is a **release plan, not a claim that native installers or hosted services exist**. The website in `site/` is static and needs no server or database. It queries public GitHub releases for signed application binaries. Model-only releases (`species-model-1`) are never presented as installers.

## What this change publishes

- An accessible pre-release landing page with macOS, Windows, iOS and Android availability states, help, privacy copy and an honest Nikon RAW limitation.
- A GitHub Pages workflow for the static site. **Owner action:** Settings → Pages → Build and deployment → GitHub Actions. Set a custom domain later; do not enter a domain in the repo until DNS is owned/verified.
- App installers are displayed only from a non-draft, non-prerelease release tagged `vMAJOR.MINOR.PATCH`. The first matching `.dmg`/`.pkg`, `.msi`/`.msix`/`.exe`, and `.apk`/`.aab` respectively appear when uploaded. **Do not publish AAB as a direct-install Android option:** AAB is a store upload format; before Android release, remove that alternative or use the Play listing. For release v1, publish a signed APK for direct Android download.
- An iOS download remains unavailable until a real App Store or TestFlight link is supplied in a separate verified change. Never distribute unsigned or arbitrary IPA links.

## Critical publication gates (in order)

1. **Product and legal:** Owner picks the Kestrel licence (public repo currently has no root LICENSE), verifies ownership of the Kestrel name/domain, completes third-party model/font/icon notices, privacy policy and basic support/contact/terms as appropriate. Do not auto-choose a licence.
2. **PWA pilot:** Host built editor separately from marketing site (e.g. `app.<owned-domain>`); HTTPS; correct base path, cache/version updates, persistent-storage prompts, Safari/iOS and Android physical-device testing, offline import/edit/export/reopen, IndexedDB backups and capacity handling. Audit whether today's PWA manifest and icons are complete. Avoid publishing a photo-loss-prone hosted editor as stable.
3. **Native desktop:** Add Tauri v2 shell and minimal native filesystem adapter. Build Windows/macOS on matching runner OS, test folder/NAS permissions, reliable catalogue persistence, installer launch, clean uninstall, crash recovery. Mac needs Developer ID code signing and notarisation; Windows needs signing to avoid trust friction. No auto-update until signed update manifests and rollback are tested.
4. **RAW quality gate:** Test real Nikon Z8/Z5II lossless and both High Efficiency variants on full-resolution decode, expected dimensions, colour and export quality. Embedded previews do not establish RAW support. Do not advertise unsupported modes.
5. **Mobile:** PWA first; Tauri mobile only after on-device experience is proven. App Store/TestFlight and Play Console require developer accounts, approvals, store assets and privacy declarations. Never label the website's placeholder as an app-store listing.
6. **Release provenance:** CI lint, unit, Playwright, native smoke tests, manual QA, signed binaries, SHA-256 checksums, version notes, explicit support matrix and release approval. Tag `vX.Y.Z` only when an actual app release is ready; model versions use a separate namespace.
7. **Website:** Activate GitHub Pages, verify published URL on a mobile browser, confirm empty release state, then verify actual release-asset links with a test release. Set up user-owned DNS only after a domain is chosen.

## Optional accounts and sync — not needed for first download

- Keep the authoritative catalogue, edit history and source files **on the device**. Sign-in and cloud sync must never gate local workflows.
- Start with a local-only `AccountProvider` and `SyncProvider` boundary; no auth or uploads until policy, residency and abuse controls are designed.
- First online sync should exchange small reversible edit/decision metadata and low-resolution previews only with project-level opt-in. Original RAW sync is a separately consented feature.
- The backend, when built, needs verified identity, tenant/project membership, object-scoped short-lived upload/download URLs, encrypted transport/storage, upload checksum verification, quotas, delete/export controls, revocable sessions and audit events that avoid photo data. Never use public buckets for user photos.
- Residency: specify where identities, metadata, storage, logs and backups live; no fallback to another region. The existing `docs/cloud-sync-proposal.md` is a starting point but not a provisioning guide.
- Funding: no cloud storage/auth provider or paid API is provisioned in this PR. Require explicit cost and provider approval before infrastructure deployment.

## External AI assistant integration — future MCP-style local tool bridge

A Claude/ChatGPT/other assistant integration should be a **local companion process attached to the native Kestrel app**, not an unauthenticated web endpoint.

Phase 1 — read-only, explicitly selected project/photo:
- `kestrel.get_capabilities`
- `kestrel.list_selected_photos` (IDs, filename, safe metadata, edit summary; no private file paths by default)
- `kestrel.get_edit_recipe`
- `kestrel.preview_proposed_edits` (dry-run, with explanation and visual preview)

Phase 2 — deliberately approved edits:
- `kestrel.apply_edit_recipe` with allowlisted, bounded adjustments; expected photo ID and catalogue revision; active project and per-operation user confirmation. Preserve undo and a before/after record.
- `kestrel.revert_proposal` through the normal history system.

Security boundaries:
- Disabled by default; local transport only (stdio or appropriately authenticated loopback with origin checks), no open network listen port. Authentication and client identity where needed.
- Never let the assistant execute arbitrary code, file paths, shell commands, fetch URLs or export/upload originals. Treat returned AI text and tool inputs as untrusted. Reject unknown fields, oversized inputs and out-of-range edits.
- Every write requires visible approval scoped to the exact photos, parameters and destination; no hidden bulk edits, deletion or upload.
- No photograph sent to Claude, Gemini or any online provider without separate explicit consent. An assistant can reason over safe metadata without receiving image pixels. Locally generated previews can be offered only after explicit selection and consent.
- A local MCP server is feasible for an eventual Tauri desktop app. The existing Gemini helper is a separate **user-provided-key** integration, not a Claude plugin; do not expose that key to MCP clients.

## AI Studio boundary

Kestrel's Vite/React UI may still be iterated in AI Studio. Keep `metadata.json`, port 3000 and `DISABLE_HMR`. Have AI Studio push changes to its **own branch**, not `main`, especially while other PR workers run. AI Studio cannot establish native signing, local filesystem entitlements or confidential cloud credentials merely by importing the web app. Native packaging and infrastructure must be verified outside AI Studio.

## Out of scope for this first PR

Native binaries, cloud accounts, production backend, Claude credentials, payment systems, app-store submissions, real hosting/domain activation and merge to main.
