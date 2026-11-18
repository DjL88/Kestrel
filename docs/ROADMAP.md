# Kestrel: product contract and roadmap

**This is the single source of truth for what Kestrel is, where it stands and what comes next.** It replaces the
earlier handovers, audits and plans (moved to `docs/archive/`). Topic documents linked below hold detail; if one
disagrees with this page, this page wins and the other is corrected. Last consolidated 18 November 2026, after
merging PRs #353–#364 (except #362, closed) into main.

Every statement below is in one of four states, and must stay that way:

- **Built**: in main and covered by automated tests.
- **Unverified**: in main, but not yet proven on real devices, real camera files or real users.
- **Planned**: agreed direction, not built.
- **Open decision**: needs the owner.

## 1. What Kestrel is

Kestrel makes professional-quality photo editing approachable, intelligent and enjoyable, without sacrificing image
quality, creative control, privacy or reliability. It should feel simple to someone editing their first photograph and
have the depth a professional wildlife photographer expects. **The complexity belongs inside the software, not on the
screen.** Kestrel is not Lightroom with a different interface: it is an intelligent workflow that makes excellent
results easier, while keeping precise control for experienced photographers.

Primary users: wildlife and bird photographers processing many RAWs; enthusiasts who want a reliable Auto; professionals
who need confidence in colour, detail and exports. First quality focus: birds and wildlife on Nikon Z8/Z5II, without
becoming Nikon-only or wildlife-only (any brand rawler/LibRaw reads is supported once real files pass).

Three product pillars (directions, not parity claims): **Kestrel Select** (culling and comparison), **Kestrel
TrueDetail** (RAW, detail and noise), **Kestrel Insight** (understandable guidance and checks).

### Non-negotiable principles

1. **Offline means fully working.** Import, cull, edit, export, backup and personal learning never need a server,
   account or paid AI.
2. **Originals are immutable and stay where they are.** Kestrel stores links, previews, metadata and reversible
   recipes. It always says when a source is missing or only an embedded preview was used.
3. **Never** silently downsample a requested full-size export, replace an original, attach a recipe to the wrong photo,
   discard decisions, or overstate species, eye-focus, colour or RAW-decoding confidence.
4. **One obvious action, depth on demand.** Auto gives an excellent starting point with one strength control; advanced
   tools unfold when asked. No destructive edits, no unrequested generated pixels, reliable undo.
5. **Uncertain means review.** Automation never rejects a photo on low-confidence evidence; unknown stays unknown.
6. **Calm and accessible.** Restrained colour, text plus icon for every state, predictable navigation, keyboard access,
   reduced motion, scalable text. Default appearance is the softer dark theme.
7. **Same behaviour everywhere** (section 3), with native adapters only where a platform differs, and no parity claim
   until tested on the physical device.
8. **Privacy by default.** No image upload, telemetry, tracking or account for core use. Each cloud feature (backup,
   collective statistics, diagnostics, AI preview) is a separate opt-in.

## 2. The photographer's journey (the release scenario)

Everything is judged against this, end to end, not feature by feature:

> A photographer installs Kestrel on **Windows**, imports 500 Nikon Z8/Z5II mixed NEF/JPEG photos from an external
> drive, reviews bursts and keeps the best, uses Auto and subject-aware masks, refines feather detail, exports full-size
> and social versions, closes the app, reopens it offline, and finds every decision and recipe intact. If the drive is
> missing, Kestrel offers safe relinking. No data loss, wrong-file association, silent downsampling, fake certainty or
> required connectivity occurs at any point.

Acceptance is observed on real hardware with real files. 300 synthetic JPEGs passing in Chromium does not establish
2,000-photo Nikon RAW reliability.

| Stage | Expected behaviour | State |
| --- | --- | --- |
| Launch and projects | Opens into Projects with an obvious Import; first run explains originals stay put, edits are reversible, backups hold decisions not RAWs | Built (Projects, wizard, backups); onboarding wording to check against this |
| Import | RAW/JPEG/TIFF/HEIF, incremental thumbnails, linked originals, RAW+JPEG paired not duplicated, progress and cancel | Built in browser and desktop; **Unverified** at 500/2,000 real files; RAW+JPEG pairing to confirm |
| Select | Keep/reject/undo, stars, filters, bursts, compare, keyboard and macro pad; subject-aware sharpness; uncertain kept for review | Built; guardrails strengthened (#354, #358, #360); subject/eye accuracy **Unverified** on real shoots |
| Edit | Large photo, back arrow, info panel; simple Quick edits and Auto; masks, crop, history, before/after | Built; confidence-weighted mask blending **Planned** |
| TrueDetail | Labelled RAW provenance; high-bit-depth colour-managed pipeline; denoise that keeps feathers | RAW development built but 8-bit JPEG into the editor; 16-bit TIFF path experimental; denoiser training pipeline built, model **not wired into the app** |
| Export | One Export: full-size master plus web/social in one go; dimensions, format, profile shown; never silently smaller | Built (PNG, social JPEG, refusal instead of shrinking); TIFF/ICC matrix and native tiled export **Planned** |
| Reopen and recover | Everything intact offline; missing originals offer relink, never a wrong image | Built (IndexedDB, relink, changed-original guard #364); **Unverified** across crash, NAS disconnect, moved folders on Windows |
| Move devices | Metadata-only backup/restore; opt-in sync later | Portable JSON backup built; sync **Planned** (see `OFFLINE-LEARNING-LIBRARY-RECOVERY.md`) |

## 3. One product on every platform

All platforms run **the same React/TypeScript app** (`src/`). Core behaviour (catalogue rules, culling, recipes,
rendering, export rules) lives in `src/core/` and is shared. Platform differences are allowed only in adapters
(`src/providers/`, `src-tauri/`), and every difference is listed here. If a difference is not in this table, it is a bug.

| Platform | Shell | Where it stands |
| --- | --- | --- |
| Windows | Tauri 2, WebView2 | **Milestone platform.** Builds locally with `scripts/windows/Build-Kestrel.ps1`; never opened on a clean machine |
| macOS | Tauri 2, WKWebView | Built and used locally by the owner; signing/notarisation outstanding |
| Web/PWA | Browser, offline worker | Built; browser RAW = embedded preview only, and the app says so |
| Android | Tauri 2 Gradle shell | Debug shell only; outside the Windows milestone |
| iOS | — | Not started beyond responsive UI; outside the Windows milestone |

### Known, deliberate platform differences

| Difference | Why | User-facing rule |
| --- | --- | --- |
| Nikon HE/HE* NEF: macOS may develop them through the system RAW engine; **Windows cannot** (rawler and LibRaw lack the codec) | Licensing of the HE codec | Say so plainly (#359) and use the embedded preview, labelled. **Open decision** for the Windows milestone: accept, or support Adobe DNG Converter output as the documented route |
| Browser RAW uses the embedded JPEG | No native decoder in a browser | Labelled "Embedded preview" everywhere |
| Desktop has no offline service worker; web does | Desktop bundles its files | Desktop builds ship a self-removing worker (see below) |

### Why Windows looked different from the Mac, and the fix

Three separate causes, now addressed:

1. **Different source.** Windows installers came only from GitHub's cloud builds, which are paused by the billing hold
   (and were *debug* builds: slower). The Mac was built locally from current code. **Fix:** build Windows locally from
   main with `scripts/windows/Build-Kestrel.ps1`, exactly as the Mac does.
2. **Stale cached app.** Older installers registered the web offline worker inside WebView2 (`http://tauri.localhost`),
   which survives reinstalls and kept serving the previous version. The Mac's `tauri://` scheme never allowed it.
   **Fix:** #356 stops registering it on desktop, and desktop builds now ship a replacement `offline.js` that deletes
   only Kestrel's app-shell cache, unregisters itself and reloads, so the first launch of a new installer shows the new
   app (`offline-build.ts`, tested in `src/providers/offlineBuild.test.ts`).
3. **No way to tell builds apart.** **Fix:** #355 shows the source revision and build time in Settings → Build
   information. Both computers must show the same revision.

Rule from now on: **a platform build is compared by its revision, not its version number,** and a difference between
platforms with the same revision is a bug to report with both revisions.

## 4. Roadmap

Ordered by what the release scenario needs. Each item has its gate; nothing is "done" without the gate observed.

### P0: a complete, trustworthy Windows experience

| # | Work | Done when |
| --- | --- | --- |
| P0.1 | **Same build on Windows and Mac** | Owner builds both from the same main revision; Settings shows identical revisions; first launch after install shows the new app; clean-machine install/uninstall on Windows works |
| P0.2 | **500 then 2,000 real photos** | Mixed Z8/Z5II NEF+JPEG from an external drive: import, restart, crash, moved folder, missing drive, NAS disconnect, backup/restore, with no lost decision/recipe and no wrong-file association |
| P0.3 | **Honest RAW** | Provenance label on every photo (RAW developed / system decoder / embedded preview); HE/HE* decision taken and implemented; 16-bit path either promoted with ICC tests or kept clearly experimental |
| P0.4a | **Automatic species naming works on a fresh import** | Today the local species model only names photos already classified as Wildlife (right: it cannot answer "not an animal"), but nothing classifies them automatically: only choosing the kind in Photo info or opening the editor does. Feed the on-device subject detector's animal/bird finding (with its confidence) into the photo's kind, never aircraft or unknown; then a 500-photo bird import gets names without hand-labelling |
| P0.4 | **Culling guardrails** | Uncertain photos always kept for review; deterministic score validation; batch summaries reviewable and undoable (largely built: #348, #349, #354, #358, #360; confirm on a real shoot) |
| P0.5 | **Export integrity** | Full-size dimensions, crop/mask parity between preview and export, colour metadata, interrupted export, originals byte-identical, multi-destination export in one action |

### P1: effortless and reliable

| # | Work | Done when |
| --- | --- | --- |
| P1.1 | One Settings home; simple Quick edits; info panel by default; macro-pad flow | Intended-user sessions complete import-to-share without coaching; keyboard-only and screen-reader passes |
| P1.2 | Confidence-weighted masks in the real renderer | Edge-aware, tile-safe blending in preview **and** export with seam tests; separate subject confidence, mask coverage and strength (design notes from closed #362) |
| P1.3 | RAW denoiser in the app | Model trained on the owner's photos (`tools/denoise-training`), run before demosaic in the native RAW path, measured on real high-ISO shots against the current colour-noise slider |
| P1.4 | Local personal style learning | Learns from accepted/reverted Auto proposals (Lightroom recipe export `tools/lightroom/read_lrcat.py` as a seed); reset and undo; never a cloud dependency |
| P1.5 | Metadata-only serializer and sync outbox | Allowlisted fields only; conflict-preserving two-device synthetic tests (`OFFLINE-LEARNING-LIBRARY-RECOVERY.md`) |

### P2: differentiation

TrueDetail measured against rights-cleared real shoots (`TRUEDETAIL-REAL-SHOOT-ALPHA.md` harness, #357); optional
provider-neutral AI Guardian with bounded proposals and spend controls; account-bound metadata backup; tutorial /
before-after export from a user-approved edit history.

### P3: collective intelligence and commercial maturity

Opt-in, privacy-filtered collective statistics; central model training with signed offline updates only after holdout
improvements; signed installers and real-device acceptance per platform; licensing, support and accessibility audit.
Android and iOS releases are scheduled here unless the owner pulls them forward.

## 5. How work is done

For every contributor, human or agent (`CLAUDE.md` points here):

1. **Read this page and check main first.** Look at open PRs and their files before starting; do not duplicate
   another PR's area. Extend the canonical code path rather than adding a parallel one: there is one denoiser
   pipeline, one Lightroom reader, one offline worker.
2. **Pick the highest-value item above**, in a small branch, with tests. Synthetic or lawfully licensed fixtures only;
   never upload user photos, provision cloud resources, accept SDK licences or spend money.
3. **Report results exactly:** PASS / FAIL / NOT RUN / INFRASTRUCTURE BLOCKED, with the command.
4. **Merging.** Normal rule: required checks pass on CI. **While GitHub Actions is paused for billing (until about
   24 November 2026), the owner has authorised merging after the same checks pass locally:** `npm run lint`,
   `npm test`, `npm run build`, `cargo test --release` in `src-tauri`, and the Python suites in `scripts/`,
   `tools/denoise-training/` and `tools/lightroom/`. Record what was run in the PR.
5. **Update this page** when something moves state (Planned → Built, Unverified → verified). Do not start a new plan
   document; add a section here or to the relevant topic document.

## 6. Document map

| Topic | Document |
| --- | --- |
| Desktop builds, signing, updates | `DESKTOP.md`, `scripts/windows/Build-Kestrel.ps1` |
| Latest evidence-based audit | `RELEASE-GAP-AUDIT-2026-11.md` (its priority list is folded into section 4) |
| Calm, guided UX | `GUIDED-WORKFLOW-PLAN.md`, `accessibility.md`, `mobile-layout-policy.md` |
| RAW quality | `RAW-QUALITY-PLAN.md`, `nikon-raw-validation.md`, `truedetail-*.md`, `TRUEDETAIL-REAL-SHOOT-ALPHA.md` |
| Denoiser | `../tools/denoise-training/README.md` |
| Culling | `CULL-BENCHMARK.md`, `CULL-RELEASE-GATE.md`, `CULL-UNCERTAINTY.md` |
| Models | `models.md`, `SPECIES-TAGGING-SPIKE.md` |
| Offline learning, recovery, sync, cloud | `OFFLINE-LEARNING-LIBRARY-RECOVERY.md` (current), `CLOUD-PLAN.md`, `cloud-sync-proposal.md`, `BACKEND.md` |
| Commercial and publishing | `COMMERCIAL-RELEASE.md`, `PUBLISHING.md` |
| History | `archive/` (superseded handovers, audits and plans, kept for context only) |
