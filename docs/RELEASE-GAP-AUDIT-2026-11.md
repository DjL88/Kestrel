# Kestrel release-readiness and competitive gap audit

**Audit baseline:** GitHub `main` commit `d30d95d7091136edf8e6bea461df7f9148ffea94`, 15 November 2026. This is a **source/release/config review**, not a substitute for physical Mac/Windows QA or real camera-file rendering tests. Findings supersede stale statements in `docs/ROADMAP.md`, `docs/NEXT-STEPS.md`, and `docs/AUDIT-2.md`; those remain historical design discussions, not current release status.

## Product decision

Deliver **a trustworthy local-first desktop photography workflow** before cloud/mobile. Kestrel can differentiate on uncluttered workflow, offline ownership, transparent culling and accessible one-off pricing. Do **not** claim general Lightroom/DxO/Capture One RAW-development parity until image quality and decoder coverage are established.

### Actual state

| Feature | Current status | Evidence / release decision |
| --- | --- | --- |
| Import/cull/rate/compare | Implemented in React app | Regression tests exist; verify 500/2,000 real photos, duplicates and missing-file recovery |
| Global adjustments, masks, presets, undo | Implemented | WebGL2/CPU paths exist. Colour, 16-bit workflow, export parity and full-size validation insufficient |
| Export/watermark/backup | Implemented | Need TIFF/ICC/metadata matrix, 45MP+ file QA, disk-full/cancel/crash tests |
| Local model-based subject/species suggestions | Implemented, qualified | Species file download opt-in and checksum checked; field accuracy/latency unverified, no automated model manifest deployment |
| Mac & Windows Tauri shells | Implemented foundation | Native menu, filesystem save dialogs, debug-build CI; no publicly available signed installer or OS smoke-test evidence |
| Full native RAW development | **Not implemented** | `BrowserRawDecoder.decodeFullRaw` throws `NATIVE_RAW_UNSUPPORTED`; Tauri Rust entry contains menus/plugins but no native RawDecoder. NEF/NRW browser path extracts embedded JPEG previews. |
| Canon CR3 / Sony ARW | **Not implemented** | Import extension filter doesn't admit these formats; no validated full-native decoder |
| Lens/camera data updater | **Planning+monitoring only** | `dataUpdateManifest.ts` pure validator and scheduled upstream GitHub issue creation; no signed remote manifest, secure atomic local activation or rollback |
| Folder sync | **Partially implemented** | Manual send/bring JSON snapshot, confirmation and browser E2E; no verified native arbitrary-folder permissions, conflict detection, atomic remote writes or stable cross-device identity |
| Free / Paid | **Partially implemented** | Ed25519 local key verification; `useAccess.ts` sets `BETA_ALL_FEATURES_OPEN` except explicit `VITE_KESTREL_PLAN=free`. No payment fulfilment or activated customer purchases |
| Cloud subscription, hosted AI, accounts | **Not built** | `cloudInterfaces.ts` contains rejected offline adapter, `docs/CLOUD-PLAN.md` proposes infrastructure; `docs/AI-INTEGRATION.md` describes an MCP design, not deployed service |
| Self-update | **Disabled** | `UPDATER_ENABLED=false`, `createUpdaterArtifacts=false`, placeholder updater public key in Tauri config. Do not enable before signatures/rollback tests |
| Website | Static landing page code | No confirmed DNS/custom domain/host deployment; GitHub app release list includes only `species-model-1`, no installers |
| App legal/public release | Incomplete | Root LICENSE/NOTICE absent; code signing, privacy/terms/support, tax and software licence decisions outstanding |
| Mobile | Android debug shell present; iOS proposal | Explicitly outside first desktop beta |

**Important:** `.github/workflows/ci.yml` runs lint, node tests, npm tests and Playwright. `.github/workflows/desktop.yml` builds macOS/Windows/Linux debug bundles when triggered. PR #155 browser CI passed at review time; its native workflow was still running when checked. Physical device validation is not evidenced.

### Correctness concerns discovered

1. **Project sync misidentifies files across devices.** The help text says file identity is name/size/date, but `projectSnapshot.ts` serialises `frame.stableKey`; folder imports use `folder://<relativePath>`, whereas direct imports use `local-file://<name>::<size>::<modified>`. Same photo imported differently will not match; similarly titled projects share the same `syncNameFor(title)` path, risking overwrite. Resolve using a validated portable fingerprint/manifest and unique project identity, then add tests for cross-device layouts, collisions and conflict resolution.
2. **Desktop sync storage permissions need real QA.** `folderConnector.ts` uses Tauri `plugin-fs` absolute paths chosen by dialog, but blanket `allow-*` capability entries do not prove the selected path is within an approved runtime scope. Implement scoped grants with read/write tests on macOS and Windows; fail safely if inaccessible.
3. **Browser catalogue ≠ desktop SQLite catalogue.** The current `BrowserCatalogueStore` uses IndexedDB; the Tauri shell doesn't supply SQLite. Protect browser/webview storage by recovery tests and mandatory backup paths; build SQLite only if proven necessary, with safe migration.
4. **Commercial beta bypasses paywall by design.** `BETA_ALL_FEATURES_OPEN` defaults true. Lock Paid features *only* when licence issuing/payment has been verified and tested; never introduce a partially functioning checkout.
5. **Image fidelity requires proof.** WebGL2 and CPU detail output differs on edges per `docs/render-engine.md`; renderer still runs on main thread. A preview-only NEF image must never be described as a full-resolution RAW development.
6. **Site promises proposed future cloud plans.** `site/index.html` contains £2.99 Cloud + AI and 365-day retention copy; these services don't exist. Mark as 'planned' or remove pricing until functioning, and clearly label the available Free/Paid choices only when real installers and purchase path exist.
7. **Outdated documents.** `docs/ROADMAP.md` says no Tauri, `docs/AUDIT-2.md` says no CI PWA install, while code now includes both. This canonical audit is the present release ledger; avoid future copy-paste of stale status.

## Competition: feature standards (November 2026)

Official current product references:
- Adobe Lightroom Classic vs Lightroom comparison: https://helpx.adobe.com/lightroom-classic/desktop/kb/lightroom-feature-comparison.html
- Adobe November 2026 Classic release notes: https://helpx.adobe.com/lightroom-classic/desktop/introduction-to-lightroom-classic/release-notes.html
- DxO PhotoLab feature list: https://www.dxo.com/en/dxo-photolab/features/
- Capture One Pro: https://www.captureone.com/en/products/capture-one-pro
- Capture One feature and pricing matrix: https://www.captureone.com/en/pricing/capture-one-pro

| Professional benchmark | Kestrel gap | Priority |
| --- | --- | --- |
| Full RAW engine, high-bit-depth colours, supported camera & lens profiles | Core block: JPEG-preview NEF only, no tested camera-neutral RAW developer | P0 for 'RAW editor' positioning |
| Professional colour management (ICC, working/output spaces, soft proofing) | Mostly absent/unvalidated | P1 for colour-sensitive professional deliverables |
| Raw denoise + lens optical correction (DxO strength) | Dedicated RAW denoise/lens calibrations absent; existing detail sliders are not equivalent | P1 |
| Non-destructive parametric edits, masks, undo, virtual copies | Working framework; correctness and edge-quality must be verified | P0 reliability |
| Tethering/live view/on-set workflow (Capture One strength) | No native capture integration | P3 deliberately deferred |
| Catalogue/collections, metadata, hierarchical keywords, external drives | Basic projects/tags exist; no robust SQLite or pro DAM equivalent | P1 targeted improvements; P3 full DAM |
| Smart/assisted culling, focus/eyes and auto-stacking (Lightroom recent updates) | Assisted culling and subject model exist but accuracy unproven on diverse wildlife | P1 quality benchmark |
| Heal/clone, advanced denoise, HSL/curves/soft proof, HDR | Partial or absent | P2 after RAW quality |
| Batch export/metadata/ICC/TIFF/print | Basic presets/export exist, professional output matrix not established | P0 export quality; P1 broad format |
| Managed cloud, collaborative review, multi-device | Manual folder snapshot only; managed cloud not built | P3, later independent service |
| Smooth UX, custom shortcuts, price/offline ownership | Kestrel differentiator; hardware and usability testing needed | P0 |

## One priority-ordered project plan

**Rules:** For each item either (a) ship with tests and real-machine evidence, (b) label as experimental with strict limits, or (c) hide/remove from the production UI. Do not leave a clickable capability that silently fails. Each PR owns one bounded change. No merges without CI and owner's authorised AI Studio pull/verification per current workflow.

### P0 — Ship a safe desktop beta

| ID | Deliverable | Done when |
| --- | --- | --- |
| P0-01 | **Truthful release surface** | Marketing and UI distinguish preview-only RAW, experimental sync, and planned cloud/AI; no live checkout or cloud claims; known limitations visible and consistent |
| P0-02 | **Native real-device smoke pack** | macOS Apple Silicon/Intel and Windows test: install, create/open/reopen/move/backup/export project, cancel, disk-full, crash/restart, external SSD/NAS relink; documented results and regressions |
| P0-03 | **Data safety & Sync-folder decision** | Portable file identity, unique project IDs, conflict/overwrite handling, native path scope and atomic write validated; otherwise hide Sync folder from stable beta |
| P0-04 | **Render/export correctness** | Repeatable reference TIFF/JPEG quality tests incl colour patches, texture, highlights, feather details, orientation, output profile, EXIF metadata and full-resolution performance; no deceptive RAW labels |
| P0-05 | **Installer + legal readiness** | Decide code licence, third-party notices, privacy/support/refund terms, owner domain/brand rights. Produce signed and notarised macOS build and signed Windows build; verify both on clean machines |
| P0-06 | **Reliable updates** | App-version matching, pinned updater public key, signed immutable artefacts, checked installer signatures, old→new update and rollback, no interrupted editing or corrupt catalogues |
| P0-07 | **Public beta and Free/Paid truth** | Website links only verified installers; Free feature paths work offline. Keep all Paid beta features unlocked until signed licence issuance and paid checkout are functional, with explicit beta terms |

**Decide beta position before P0-04:** It can launch as a **JPEG/embedded-RAW-preview culler and editor** if precisely labelled; it cannot truthfully launch as a full RAW Lightroom replacement without P1-01 below, which should be promoted to P0 if full RAW is mandatory.

### P1 — Full photography workflow & professional quality

| ID | Deliverable | Done when |
| --- | --- | --- |
| P1-01 | **Native RAW decoder (Nikon first, then Canon/Sony)** | Verified Z8/Z5II samples by compression mode (HE/HE* separate), NEF full-resolution 16-bit processing against NX Studio; then Canon CR3 and Sony ARW with actual camera/version fixtures and clear support matrix |
| P1-02 | **Colour pipeline and optical profiles** | Linear/high-bit-depth colour, ICC input/working/output, correct orientation/white balance; tested lens distortion, vignetting and CA corrections with verified calibration |
| P1-03 | **Scalable durable catalogue** | 500/2,000-file import, no lost edits or duplicate projects, no user-visible lockups; SQLite/worker/cache migration only where measurement justifies |
| P1-04 | **Natural detail & denoise** | CPU/GPU output agreement, lens-aware sharpening, edge-preserving noise reduction, 100%-zoom validation on wildlife (fine feathers/hair, high ISO) |
| P1-05 | **Human-trustworthy culling** | Real wildlife benchmark with subject/eye focus and false positives; suggestions always reversible, confidence honest, graceful fallback offline |
| P1-06 | **Commerce with minimal customer data** | External hosted checkout, merchant receipts, verified licence issue/activation, recovery/revocation limits, offline licence continuity; Free usable without account |
| P1-07 | **Data-only update engine** | Signed manifests with pinned trust key, checksums, model runtime compatibility, temp downloads, atomic activation, last-known-good retention and opt-in large downloads; upstream watcher never publishes unreviewed assets |

### P2 — Competitive refinements

Selective tone curves and HSL colour editor; proven advanced masks, heal/clone and dust removal; side-by-side before/after; batch metadata/keyword tagging, DNG/TIFF export and soft proofing; ergonomics, focus/macro keypad and performance polish. Ship only when each has a working end-to-end QA path.

### P3 — Optional ecosystem, separate products/workstreams

Managed regional cloud storage, payments and 365-day read-only retention; hosted AI and Claude MCP integration with explicit photo consent; mobile apps; camera tethering; print/soft-proofing studio tools; collaboration and professional DAM. Each must be either a fully funded independent service with privacy/security/QA or absent from the product UI.

## Release decision board

- **First downloadable beta:** do not wait for P2/P3. Ship P0, with explicit JPEG/preview-only scope if native RAW isn't ready.
- **Marketed full RAW editor:** require P1-01 and P1-02 first.
- **'Automatic camera support' claim:** only after tested decoder AND trusted signed data-update path. A camera name from a manufacturer page is never verified processing support.
- **'Cloud/AI for £2.99' claim:** only after billing, storage, regional privacy, quota, security and lifecycle tests exist.
- **'Professional colour accuracy' claim:** only after documented, reproducible colour-management and export standards.
- **Sync folder:** verify or hide, especially to prevent unsignalled cross-device overwrites.

**Workflow suggestion:** keep this one file as the canonical live checklist; update rows only when an implementation PR and reproducible test evidence support the status. Other roadmap documents are background, not authoritative status.
