# Kestrel roadmap

**The single roadmap for Kestrel on every platform.** It replaces the earlier roadmaps, next-step lists and audits; [README.md](README.md) says which of those are history.

- [PRODUCT-SPEC.md](PRODUCT-SPEC.md) says *what Kestrel must be*.
- This file says *where it actually is* and *what comes next*.
- Update this file in the same PR as any change that moves an item.

Every status uses exactly one of these labels:

| Label | Meaning |
| --- | --- |
| **VERIFIED** | Observed working by running it. The evidence is stated. |
| **MERGED** | On `main` with passing local checks, but not yet observed in an installed app. |
| **PARTIAL** | Part of the behaviour exists. What is missing is stated. |
| **NOT BUILT** | Doesn't exist yet. |
| **BLOCKED** | Can't proceed. The blocker is stated. |

*Last reconciled: 18 November 2026, after the integration pass that merged #353–#361 and #364 and closed #362 and #363.*

## 1. Where Kestrel is today

| Area | Status | Evidence and gaps |
| --- | --- | --- |
| Library and catalogue | PARTIAL | IndexedDB catalogue, versioned project backup JSON and linked originals all work. Not yet proven: 500 and 2,000 real-photo durability, a portable photo identity, the desktop SQLite store, and safe restore. |
| Import | MERGED | Background parallel scanning with no interface freeze (#350). The owner's Windows test (191 NEFs, 2–3 s each, interface locked) used a build from **before** #350, so it hasn't been checked on Windows yet. |
| Relink (reconnect originals) | MERGED | Matches by name, size and time, with a fallback on name and size only. Opening a photo now checks its size and that it didn't change during the read (#364). A reconnect of 600 photos on Windows succeeded on 18 Nov; the app closed afterwards only because its debug console window was closed. |
| Culling (Select) | PARTIAL | Local heuristics, subject detector (YOLOX), grouping, filters, keeper tiers. Safety rails merged: tiny detections never auto-keep (#338); a broken model fails safe (#344); a missing detector never decides from texture (#349); corrupt scores are ignored (#354, #360); flat previews are review-only (#358). Not yet proven: real-shoot recall. On the owner's real shoot it identified a Grey heron correctly. |
| Species suggestions | PARTIAL | BioCLIP on-device, with 112 UK birds plus other groups. **The White-throated dipper is missing**, so the owner's Dippers were mislabelled. The list needs checking against what the owner actually shoots. |
| RAW development | PARTIAL | Native decoding (rawler) produces an 8-bit JPEG for the shared editor. The 16-bit TIFF path is experimental. **Nikon HE and HE\* (most of the owner's Z8 and Z5II files) can't be decoded on Windows.** They fall back to the embedded preview. macOS tries its system decoder. |
| Editor | PARTIAL | Reversible recipes, Auto, masks, history, crop and quick edits. Confidence-weighted masks aren't integrated yet. |
| Export | PARTIAL | Full-size PNG and social sizes. An oversized export is refused rather than shrunk. Not built yet: a tiled native engine for large output, ICC validation and batch multi-export. |
| Desktop: Windows | PARTIAL | Installed 26.11.2 is a **debug** build of PR #339 (17 Nov, 20:18). It's slow, shows a console window, and **closing that console quits the app**. There's no optimised build of current `main`: **BLOCKED** by GitHub Actions billing (expected to clear about 24 Nov). |
| Desktop: macOS | PARTIAL | Same Tauri shell. Builds aren't signed. Which commit the Mac is running hasn't been recorded; #355 now shows it in the app. |
| Mobile | PARTIAL | A responsive interface and an Android shell exist. iOS isn't release-ready. Not tested on physical devices. |
| Sign-in (Google, Apple, email and password) | PARTIAL | Optional Settings → Account section with a Firebase Auth provider. Google and Apple are **web only**; email and password are wired for every platform but untested outside the browser. Firebase project `kestrel-photo` has all three providers enabled and off unless `VITE_FIREBASE_*` is set. **NOT BUILT:** Firebase project and Google/Apple console setup, the Windows/macOS system-browser flow with a `kestrel://` callback, native iOS and Android sign-in, and any server-side use of the identity. Not run against a real Firebase project. |
| Cloud and sync | PARTIAL | User-owned connectors (folder, S3, WebDAV) and proposals. No managed backend, by design for now. |
| AI | PARTIAL | Local detection and an optional Gemini helper. Not built yet: provider abstraction, style learning and consented aggregation. |
| Denoiser (TrueDetail) | PARTIAL | Training tools in `tools/denoise-training/`. A first CPU-trained model gained +9.1 dB PSNR on held-out *synthetic* noise (18 Nov). Not integrated into the app, and not judged on real high-ISO frames. HE NEFs need DNG conversion before training can use them. |

## 2. One Kestrel on every platform

The owner saw a different Kestrel on Windows than on the Mac. This is not a design decision. These are the causes, and the rule that fixes each one.

| Cause | Rule | Status |
| --- | --- | --- |
| The installers came from **different commits**. Every PR build looks like a "release", and the version number doesn't identify a build. | Test installs are optimised builds of `main` only, built from the same commit for every platform. **Settings → Build information** shows the commit and build time; compare them before reporting a difference. | Build info: MERGED (#355). Cloud builds of `main`: BLOCKED (Actions billing). **Local route:** `scripts/windows/Build-Kestrel.ps1` builds the optimised installer of `main` on the Windows PC, as the Mac already does (NOT RUN yet on Windows). |
| A desktop service worker could keep serving an **older cached interface** after a new install. WebView2 on Windows (`http://tauri.localhost`) allowed the web worker and kept it across reinstalls; the Mac's `tauri://` scheme never did, which is why only Windows lagged. | Desktop builds never register the web offline worker, and remove any old one. Desktop builds also ship a self-removing `offline.js`: the first launch of a new installer deletes only Kestrel's app-shell cache, unregisters the old worker and reloads into the new app (`offline-build.ts`, tested in `src/providers/offlineBuild.test.ts`). | MERGED (#356, #368) |
| **Layout depends on window size.** Below 768 px wide the filter bar moves into a pop-over. Below 900×550 the editor uses the phone layout. Below 1024 px wide photo info is hidden. A laptop at 125–150% scaling crosses these lines easily. | Correct by design (see [mobile-layout-policy.md](mobile-layout-policy.md)), but a control must never become hard to find. When something is collapsed, the button that reveals it stays visible and is labelled. | Needs a check on Windows at 125% and 150% scaling: **P0.1** |
| **RAW decoding differs.** macOS can fall back to its own decoder; Windows can't. | Show which decoder produced every image (RAW, OS fallback or embedded preview). Never suggest that one platform can do something it can't (#359). | PARTIAL |
| **Debug and optimised builds differ.** A debug build is slow, has a console window, and quits when that window closes. | Only optimised builds go to the owner. A debug build is for developers only. | BLOCKED until Actions billing clears |

Platform-specific code lives only in adapters (`src-tauri/`, `src/providers/*`). Shared behaviour lives in `src/core/` and `src/components/`. A feature isn't done until its status is recorded here for every platform it affects.

## 3. The order of work

Work runs P0, then P1, then P2, then P3. Inside P0, take the first item that isn't blocked.

### Draft implementation under review: background Import → Cull → Develop (18 Nov)

A separate **unmerged, unverified** branch proposes an initial non-modal pipeline after import:
- Queue only imported frames and let the user browse while culling and development work is shown in Task Manager.
- Automatically move high-confidence Keep decisions and byte-verified exact duplicates; uncertain results require review. Protect decisions, active editor, manual recipes and crops made while jobs run.
- Auto-develop only untouched keeper photographs. Assess the proposed 256px RGB result for extra white/channel clipping, crushed blacks and substantial saturated hue drift; refuse questionable unattended edits. Existing manual edits remain available to review via **Auto → Suggest a look**, never overwritten.
- Abort on project change, honour task cancellation, and leave originals unchanged. Already available explicit Auto-Cull remains usable.
- Not yet done: import becomes usable **before** its whole batch completes, calibrated subject-aware edits, safe automatic crops, prompt-free photo sorting, real-image aesthetic evaluation, real RAW/ICC proof, and cross-platform performance validation.
- Gate: synthetic 500-photo Playwright interaction test, manual-edit-during-job, duplicate retry, offline restart and actual Windows/macOS test before marking this behaviour MERGED or VERIFIED.

### P0: Trust the existing workflow on Windows (the current milestone)

The goal is the [release scenario](PRODUCT-SPEC.md#7-release-acceptance-the-scenario-to-optimise) on Windows: one coherent app, not more separate features.

0. **One green test baseline on every machine.** *Cause found and fixed (#368), on Linux Chromium 1243:* the 22 distinct failures (31 runs) were not environmental. Recent merges changed the app while Actions was paused, and the browser tests were never rerun:
   - **Photo info open by default (#339) + an app bug:** Escape pressed to close Workspace options also reached the app-wide shortcut handler and closed Photo info underneath, so tests (and people) lost the panel. One Escape now closes one layer.
   - **#335 also blocked the opted-in online helper:** keeping the closed-list local model to photos marked Wildlife was right, but the helper's job is to classify *unlabelled* photos. The helper may now look at them (a species name still needs a wildlife answer).
   - **Tests not updated for #336/#339:** the renamed softer theme, the single settings section, photo info open by default, and focus checked at the right moment in Auto-cull.

   Result: 325 passed, 68 skipped by design, 1 timing flake under parallel load (`quick-edits-simple`, passes 3/3 alone). This explains why the Windows run (a build from before those merges) showed 0 failures and macOS showed 22.
   - *Accepted when:* the same commit gives the same Playwright result on Windows and macOS. Rerun on both after #368.
1. **Same build everywhere.** When Actions is available, build `main` optimised for Windows and macOS from one commit, and install both. Confirm the build information matches. Check the Windows layout at 100%, 125% and 150% scaling.
   - *Accepted when:* Windows and Mac show the same commit and the same controls at the same window size.
2. **Real-shoot import on Windows.** 191, then 500, then 2,000 of the owner's NEF and JPEG files from a local disk and an external drive. Cover crash and restart, a missing drive, relinking, and backup and restore.
   - *Accepted when:* the interface stays usable during import; there are no wrong-file links; every decision and edit survives a restart.
3. **Honest RAW provenance.** Every image shows which decoder produced it. HE and HE\* on Windows say plainly that an embedded preview was used. Pick a Windows route to real HE decoding (for example a user-run DNG conversion flow) and record it here.
   - *Accepted when:* no screen implies a full RAW decode that didn't happen.
4. **Species list matches real shooting.** Add the White-throated dipper. Check the list against the owner's catalogue subjects, and regenerate `src/assets/species/uk.json` with `tools/species/make_labels.py`.
   - **Found 18 Nov:** nothing classifies a fresh import as wildlife automatically. The local model (rightly) names only photos marked Wildlife, but only choosing the kind in Photo info or opening the editor sets it, so a 500-photo bird import gets no names. Feed the on-device subject detector's animal/bird finding into the photo's kind (never aircraft or unknown).
   - *Accepted when:* the owner's Dippers get a Dipper suggestion, or "unknown", and never a confident wrong bird; and a fresh bird import gets suggestions without hand-labelling.
5. **Culling on a real shoot.** Measure keep recall and wrong rejects on one of the owner's labelled shoots. The Lightroom ratings in the owner's catalogue can serve as labels (`tools/lightroom/read_lrcat.py`).
   - *Accepted when:* no uncertain photo is auto-rejected, and recall is reported with numbers.
6. **Full-resolution export integrity.** Check dimensions, crop and mask parity, colour metadata, an interrupted export, and that originals are unchanged.
   - *Accepted when:* an exported Z8 frame matches the expected pixel size and the original's checksum hasn't changed.

### P1: Effortless and reliable
- One Settings home. Simpler Quick Edit. Photo info shown by default. Responsive navigation. Macro-pad workflow.
- Confidence-mask integration, built in this order:
  1. Keep semantic confidence, pixel coverage and effect strength separate.
  2. Edge-aware refinement at full resolution.
  3. Linear-light blending that preserves alpha.
  4. Tiled processing with overlap and deterministic seams.
  5. Subject-specific recipes (eyes and feathers, skin and hair, background).

  Test synthetic ramps, fine strands, high ISO, 16-bit precision and tile seams. (Design carried over from the closed #362.)
- A local personal style learner that needs no cloud service.
- A metadata-only serialiser and local sync outbox, with synthetic tests of conflict-safe sync between two devices. (Gates carried over from the closed #363: originals and previews never upload; a licence isn't an account or a key; local writing works with the network off.)
- Integrate the denoiser: ONNX on the device, judged on real high-ISO frames by eye and with metrics, and calibrated per camera.

### P2: Differentiation
- TrueDetail detail and denoise improvements, measured against rights-cleared real shoots (`scripts/truedetail_shoot_benchmark.py`, #357). No claims of parity without evidence.
- Optional AI Guardian with bring-your-own providers: bounded proposals, preview transfer under the user's control, and spend controls.
- Account-bound metadata backup and restore, without image uploads or a need to be online.
- Tutorial and before/after export for social sharing.
- **Wishlist: admin push notifications (FCM data messages).** A text box and Send button on an admin-only page that sends a short message to everyone who opted in. *Needs, in order:* (1) the Firebase Blaze plan and one Cloud Function that checks an `admin` custom claim on the signed-in account (set once by hand for the owner) and calls FCM `send` to a topic, because FCM send credentials must never ship in the app; (2) an admin page, not linked from the app; (3) an opt-in switch in Settings → Account that subscribes the device to the topic (off by default, no sign-in needed to read, honouring "no telemetry or accounts by default"); (4) per-platform receivers: a web service worker, Android's messaging service, and iOS APNs with the Push capability (needs the Apple key). Data messages show nothing by themselves, so each receiver must draw the notification and respect the system permission. Depends on sign-in working on web first. NOT BUILT.

### P3: Collective intelligence and commercial maturity
- Opt-in, privacy-filtered collective statistics with cohort protections, deletion and consent.
- Central model training, and signed offline updates only after demonstrated held-out improvement.
- Signed installers, real-device acceptance on each platform, licensing, support, and an accessibility audit.

## 4. Integration log

| Date | Merged | Closed | Local evidence |
| --- | --- | --- | --- |
| 18 Nov 2026 | #353, #354, #355, #356, #357, #358, #359, #360, #361, #364 (with a fix so reconnected photos with a changed modified time still open) | #362 (mask prototype nothing used; design moved to P1), #363 (plan doc; gates moved to P1) | Windows 11, combined branch: `tsc` PASS; 752/752 unit tests PASS; Python harnesses 11/11 PASS; `vite build` PASS; Playwright 226 PASS, 0 FAIL. The resulting `main` (ced3c32) has code identical to the tested combination. Rust `cargo test`: NOT RUN (no Rust toolchain on the Windows machine), so #353 and #359 are test and message changes only. |
| 18 Nov 2026 (macOS check) | none | none | macOS arm64, Python 3.9, on a scratch merge of all twelve PRs and then on `main` (7206899): `tsc` PASS; `npm test` 752/752 PASS; `vite build` PASS; **Rust `cargo test` 24/24 PASS** with real files from eight makers (Canon CR3, Fujifilm RAF, Nikon NEF, OM ORF, Panasonic RW2, Pentax PEF, Sony ARW, DNG), which closes the "Rust NOT RUN" gap in the row above; Python tools PASS; Playwright 229 PASS / 31 FAIL, the same 22 distinct tests that failed on `main` before the twelve PRs. See P0.0. |
| 18 Nov 2026 (consolidation, #368) | #368: self-removing desktop worker; `scripts/windows/Build-Kestrel.ps1`; Escape fix; online helper may classify unlabelled photos; browser tests updated to #336/#339; denoiser `index_photos` uses `read_lrcat`'s parser | none | Linux, on `main` + #368: `tsc` PASS; `npm test` 756/756 PASS; `vite build` PASS (web ships the caching worker, desktop the self-removing one); `cargo test --release` 19/19 PASS (no sample files here); Python `scripts`, `tools/denoise-training`, `tools/lightroom` PASS; Playwright (Chromium 1243) 325 PASS, 68 skipped, 1 flake. PowerShell scripts: NOT RUN (no Windows). |
