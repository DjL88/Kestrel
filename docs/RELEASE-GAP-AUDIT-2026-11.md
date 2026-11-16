# Kestrel end-to-end product audit

## Live assessment: 16 November 2026

This section supersedes the archived 15 November review below. Scope: source inspection of import, catalogue, culling, species analysis, editing/export, accessibility, native shells, connectors, MCP, website and release workflows, plus the browser checks recorded below. This is not a physical-device, penetration, model-accuracy or professional colour certification. No production service was deployed or signing credentials configured.

**Verdict:** Kestrel has a substantial local-first editing workflow, not just a culling prototype. It is not yet a verified Lightroom/DxO-quality replacement or a released five-platform product. Finish trust, photo quality and large-library recovery before adding more tools. Keep the shared editor; introduce platform adapters rather than five separate editing engines.

### Requested journey: what actually exists

| Stage | Implemented | Gap / release condition |
| --- | --- | --- |
| Hundreds/thousands of photos | Progressive file batches (12 files), folder batches (16), virtualised contact sheet, IndexedDB catalogue, reconnect and JSON backups | The 300-image browser scenario uses synthetic 640px images, not thousands of camera originals. Directory scan is single-level. File picker identity is name/size/modified, folder identity is path; neither is a portable content identity. Benchmark real 500/2,000-photo imports, cancellation, collisions, storage exhaustion and relink. |
| Preserve and recover originals | Recipes/flags do not rewrite originals; source download and catalogue backups exist. Kestrel warns when an imported or reconnected original could not be stored for reopening. | `saveLocalFileBlob` skips files over 35 MiB and returns false on storage failure. Keep the originals and reselect them if needed; catalogue backups do **not** contain originals. Large-library recovery and portable identity still need real-device testing. |
| Find the best photos | Local detail/clipping heuristic, byte-duplicate checks, keeper target and burst limits; uncertain results stay for review | Not subject/eye focus or aesthetic judgement. A sharp background/noise can outrank a soft animal. Hashing candidates over 32 MiB is skipped in the current scan. Existing decisions are protected; validate real wildlife rankings before presenting these scores as certainty. |
| Identify subjects/species | Local subject model and optional species model, editable suggestions/tags, small metadata-stripped opt-in online helper path | Species ranking is relative to the bundled label list, **not** calibrated real-world confidence. Unknown species need a proven abstention path; distinct individual-animal identity is not established by species matching. Scan failures can be swallowed without a useful per-photo summary. |
| Auto-edit when enabled | Local automatic colour/tone on first editor open; explicit selected-photo and keeper batch actions; history and undo | It is not a complete unattended import-to-edited-keepers pipeline. Batch preview failures are skipped without counts/reasons. Preserve manual edits and add a single reviewable, cancellable batch result before automating more. |
| Opinion without inventing image content | Local critique measures clipping, noise/detail and some subject-relative tone; deterministic slider fixes | No validated artistic/composition/eye judgement. Keep AI outputs as bounded tags, scores, geometry or recipe proposals, never generated/replaced pixels or source-file writes. |
| View/export original quality | Shared framing/edit operations, zoom detail, full-size PNG, smaller social exports, original-file download | Native RAW development **now exists**, but converts developed pixels to 8-bit RGB and quality-95 JPEG before editing (`src-tauri/src/raw.rs`). Browser RAW uses embedded previews unless developed. Full pixel dimensions are not lossless RAW quality, ICC management or a 16-bit workflow. |
| Connections | S3-compatible and WebDAV connectors, folder snapshots, local stdio MCP | Not managed cloud or a hosted MCP service. Remembered credentials use browser storage, not a system keychain. Cross-device identity/conflicts and native folder permissions still need acceptance. |
| Calm, accessible interface | Progressive disclosure, phone tools, words/icons for decisions, high contrast, readable font, text scaling, reduced stimulation/motion | Not a completed accessibility audit. Verify keyboard/screen-reader operation, 200% zoom/reflow, contrast on every theme and comprehensible labels with intended users. Icon-only controls still occur in compact views. |

Evidence: `src/providers/localShootLoader.ts`, `browserCatalogueStore.ts:320-328`, `browserAutoCull.ts`, `batchAutoEdit.ts`, `browserPreviewProvider.ts`, `src/App.tsx:1071-1133`, `src/core/autoCull.ts`, `autoTags.ts`, `speciesMatch.ts:46-66`, `critique.ts`, `src/useSpeciesScan.ts`, `src/components/DecisionButtons.tsx`, `ThemePicker.tsx` and `src/index.css:125-173`. The full-preview URL cache is count-limited, but source/developed Blob maps are not byte-budgeted; a 256px analysis canvas still begins by decoding a full source image. Measure peak decoded-image memory rather than inferring scalability from catalogue-save timing.

### Platform and distribution status

| Target | Current evidence | Next acceptance |
| --- | --- | --- |
| Windows | Tauri shell and installer build workflow | Clean-machine install/uninstall, real RAW/import/export and offline recovery; sign installer before general release. |
| macOS | Tauri shell, universal packaging, rawler plus system-decoder fallback | Verify both CPU architectures and each claimed camera/compression mode; sign/notarise and test clean installs. A system decoder being available does not prove a specific camera works. |
| Android | Generated Tauri/Gradle shell and responsive UI | Reproducible signed AAB/APK, system photo-picker permissions, scoped storage, lifecycle interruption, large-photo memory and save/share on real devices. |
| iOS | Responsive web UI and app icons; no complete native iOS project/release pipeline evidenced | Generate/build on macOS, signing/TestFlight, photo-library permissions, save/share, background recovery and real iPhone/iPad memory tests. Chromium phone emulation is not Safari or iOS QA. |
| Chrome extension | No extension package evidenced | Small Manifest V3 companion: explicit user-selected image only, minimum permissions, transfer to workspace with confirmation. No background page scraping, embedded provider secrets or separate editor/catalogue. |
| Download website | Static `site/` deployed by Pages workflow; release-asset discovery | Publish only verified installers, checksums, support/privacy/known limits and a clear per-platform availability table. Site is not a secrets backend. |

Platform evidence: `.github/workflows/release.yml:17-24,50-58`, `publish-site.yml:23-29`, `src-tauri/gen/android/app/build.gradle.kts:1-20`, `site/index.html:54-65,125-171`. Current release workflow describes unsigned draft artefacts; this audit did not verify live release availability.

### Changes made during this audit

1. **No silent loss of requested export resolution.** Previously the export compositor automatically shrank even "Full size" to a device safety budget. It now rejects an oversized requested output *before canvas allocation*, explains the requested dimensions and recovery options, and does not substitute a smaller file. Preview thumbnails may still shrink. Explicit smaller presets and crops still work. Native/tiled high-resolution output is still needed to support larger edited exports on constrained devices.
2. **Auto-cull is stoppable inside its modal.** Added a labelled Stop scan control, cancellation status and usable retry. Closing also cancels the task rather than reporting a spurious failure. An interrupted scan never applies partial decisions.
3. **Provider regressions are included in `npm test`.** The previous command excluded `src/providers/*.test.ts`, including export and catalogue transaction checks.
4. **Missing-original warning.** The Library and Quick edit now say immediately when an import or reconnection cannot be retained in browser storage, without blocking the current session. Reopening detects missing sources and offers reconnection; backups are explicitly identified as catalogue-only.
5. **Honest RAW provenance.** The editor and export dialog now state that native-developed RAW is edited from an 8-bit JPEG. Mixed selections distinguish developed files from those using embedded previews.
6. **Acceptance navigation.** The ten-photo workflow now exercises the current desktop macro-pad settings route, and export helpers account for short-screen layouts.

Verification in this workspace:

- `npm run lint`, `npm test` (442 passed) and `npm run build` passed.
- Six focused desktop/phone Chromium cases passed: oversized full-size rejection and explicit smaller-size recovery, downloaded PNG dimensions, scan stop/retry without partial decisions.
- The full Chromium browser suite passed with **215 passed and 43 skipped**, including the synthetic 300-photo/20-keeper desktop workflow and the ten-photo offline workflow in desktop and phone layouts. The phone 300-photo scenario remains explicitly skipped.
- Native builds/devices, real RAW samples, professional colour and model-accuracy benchmarks were not run. Phone Chromium layout tests do not establish Safari/iOS correctness.

### Priority order and measurable exit gates

| Priority | Work | Done when |
| --- | --- | --- |
| **P0.1: Trust the library** | Immediate warnings for unpersisted files are implemented; durable save/reopen/backup and portable collision-resistant source identity and safe relink/sync remain | 500 then 2,000 real mixed RAW/JPEG files survive restart, missing drive, renamed folder, quota failure and interrupted import without lost edits or wrong-photo associations. Never overwrite a sync conflict silently. |
| **P0.2: Trust the image** | Explicit source provenance and dimensions everywhere; remove mandatory JPEG intermediate for lossless/high-bit-depth RAW editing; colour-managed, tiled/native output | Real Z8/Z5II compression-mode fixtures, portrait orientation, colour charts, clipped highlights and feather detail compared with approved reference renders. PNG preserves decoded-raster pixels/dimensions; original download is byte-identical; preview/export crops and masks agree. Document unsupported modes rather than falling back without a label. |
| **P0.3: Trust automation** | Reviewable shortlist and auto-edit batch summary; subject/eye scoring and unknown-species abstention; visible errors/cancellation | Rights-cleared, labelled wildlife/pet/people/landscape set including out-of-list species and difficult backgrounds. Publish ranking agreement, false auto-rejects, species mistakes/abstentions and latency. Manual decisions/recipes never overwritten; all automatic actions undoable. |
| **P0.4: Calm usability** | One obvious next action per stage: Add photos, Review picks, Improve, Save/share; advanced controls remain available but folded | Intended-user sessions complete import-to-share without coaching; no colour-only state or required gestures; keyboard-only and screen-reader passes; 200% zoom/reflow and reduced-motion checks. Offer Skip, Stop and Undo, not forced automatic choices. |
| **P0.5: Complete acceptance coverage** | Macro-pad and short-screen navigation have been updated; the full browser suite passes with 43 existing skips | Resolve applicable skips and add the missing phone 300-photo flow before claiming mobile batch acceptance; retain the ten-photo offline/reopen/export assertions. |
| **P1.1: Downloadable desktop beta** | Signing/notarisation, clean-device smoke tests, truthful website/downloads | Real Windows/macOS evidence for install, offline open/edit/export/relink, full disk, close-after-edit and update/recovery. Root licence/third-party notice and privacy/support decisions resolved. |
| **P1.2: Shared mobile workflow** | Android release build first, then iOS build/signing; shared recipes/catalogue semantics | Real phones/tablets handle photo selection, orientation, touch targets, interrupted sessions, storage quotas and original-versus-edited save/share without silent resizing. |
| **P1.3: Optional backend** | Static download site separate from authenticated AI/OAuth broker; secrets in server/OS secret storage | No provider private keys in browser/extension/build artefacts; authentication, request quotas, upload consent, deletion/retention and failure UX verified. Local import/edit/export still work with backend unavailable. See `BACKEND.md`. |
| **P2: Extension and richer connections** | Minimal selected-image companion; secure third-party authorisation and conflict-aware sync | End-to-end Chrome permissions/transfer tests; connector credentials scoped/revocable; MCP reads/proposes only, with confirmation before applying recipes. No deletion or arbitrary filesystem access granted to AI. |

Proposed performance gates, not measurements: on a declared reference desktop, first useful thumbnails within 3 seconds, Stop acknowledgement within 250 ms, and no UI unresponsiveness over 100 ms during background analysis. Record total time and peak memory for 500/2,000 original photos on each target, then agree device-specific budgets. Catalogue-only timing in `PERFORMANCE.md` is not an import/render benchmark.

### Keep it fun without making it noisy

Show the photos, not a dashboard. Use friendly factual progress ("20 keepers ready; 8 need a look"), optional before/after moments, and easy experiments on virtual copies. Avoid streaks, surprise sounds, forced celebrations and pressure to accept AI choices. Calm mode should remove decorative movement, not feedback or control. Test these ideas with people rather than assuming a diagnosis implies one preferred interface.

## Archived review: 15 November 2026

Everything below is historical evidence and planning from the previous baseline, **not current feature status or the current priority order**. In particular its claims that native RAW and Canon/Sony import are unimplemented are obsolete; the live assessment above describes today's code.

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
