# Claude resume / GCP handover — 21 November 2026

**Owner says Claude is available again from approximately 02:40 UK time.** This is a durable handover, NOT a scheduled Claude task. Read this before using parallel workers or touching production services.


## Live integration update — same day, after worker merges

**DO NOT recreate or overwrite flight guidance while installing local vision models.** Integration is **MERGED to main in [PR #684](https://github.com/DjL88/Kestrel/pull/684)** (merge SHA `42e6ba1c81352ff7c22d723f2ab470228aaddad3`). It combines original #670 and translated/accessibility #675 with current dock/editor changes. Both older draft PRs were closed as superseded. Do not apply either again. Build/TypeScript/unit/Playwright checks remain **NOT RUN**. PR #679 Colour Confidence is now MERGED, as are RAW foundations #666/#671, photo adviser #668, anatomy evidence #674, model manifest verifier #655, and export queue #678. Merged library code is NOT a proven end-to-end workflow.

**Claude's exclusive work:** candidate rights-cleared offline VLM(s), reproducible downloads with hash/licences, actual inference installation and benchmarks, and consented optional GCP dry-run. Do not redeploy cloud without approval; do not take over App/PhotoEditor/mode UI already coordinated in #684. Model/renderer changes must integrate through existing photo source hash, reversible recipe, and strict Soar/Glide/Fly Solo permissions. Any connected model must not fake species-specific colour truth or generate image pixels.

**Immediate handoff:** First inspect live main and PRs before following stale numbered steps below. After local-model development, communicate exact actual runtime/model SHA, OS/architecture, licence, measured RAM/latency, no-network inference result, and integration hook to Workstream 1. Preserve working copy of current code and avoid redundant implementation.


## Authoritative instructions
Read [Outstanding Programme](OUTSTANDING-PROGRAMME-2026-11-21.md), particularly §4A (signed offline assets and opt-in cloud), §4B (quiet Colour Confidence), §4C (natural masks and flight guidance), [ROADMAP](ROADMAP.md), [product philosophy](PRODUCT-PHILOSOPHY.md), and [taskboard #418](https://github.com/DjL88/Kestrel/issues/418).

**Non-negotiables:** genuine non-generative photographs, offline-first, local-source privacy, reliable RAW/ICC/full-resolution output, generous Free + optional one-time Pro major licences, five workstreams not six, wildlife as toughest quality benchmark while all genres remain supported. User-facing names: **Soar** (conservative opt-in improvements), **Glide** (quiet suggestion, default), **Fly Solo** (on demand); no old driving names, sparkle/magic wand UI or standalone AI assistant pane.

## Immediately actionable source branch / PR

**MERGED [PR #684](https://github.com/DjL88/Kestrel/pull/684)** — source is now on main at `42e6ba1c81352ff7c22d723f2ab470228aaddad3`. Older #670/#675 are closed/superseded.

Implemented source changes:
- Existing App View menu, Settings and local preferences now share one Soar/Glide/Fly Solo control and persistent setting, with Glide default and legacy preference fallback.
- Existing PhotoEditor respects Fly Solo by not mounting its automatic Colour Check until the user selects Check colour; results expire on recipe/framing changes.
- Existing mask controls have a reversible Blend edges action that gently feathers boundaries and scales exceptionally strong local changes without touching originals, mask identity or manual strokes.
- PhotoEditor compares a small global-only render against one with masks, after edit settles and with stale task cancellation; hints are **advisory small-preview evidence**, not proof of exact raw/high-bit quality.
- New confidently detected subject masks start more gently in Soar. Re-finding a mask preserves manual brush strokes instead of silently clearing them.
- Ordinary icon replaces a magic wand at crop auto-level.
- Unit tests for guidance policy, mask treatment and preview boundary evidence, and Playwright test for persisted settings/on-demand colour checks are authored.

**This change was manually source-reviewed and merged despite unavailable executable validation, at the owner's established prototype-first direction. Tests/builds/installed-device validation remain NOT RUN, not PASS. Correct discovered failures in a fresh PR and report exact SHA.**

### Claude first implementation sprint
1. Fetch CURRENT main, latest open PRs and #418; treat prior #670/#675 as superseded, #679/#668/#667/#666/#671/#674/#655/#678 as already merged source. Coordinate with active architecture #677, RAW #683 and current authentication work. Do not redo existing work.
2. Do NOT check out obsolete #670. Start from current main in a fresh branch for model work and its integration contracts. Never overwrite another worker's commits or force-push over active edits.
3. Execute real checks: **npm ci; npm run lint; npm test; npm run build; npm run test:e2e -- tests/flight-guidance.spec.ts tests/colour-check.spec.ts; npm run test:raw-master**. Run applicable Rust/native/device tests too. Fix failures rather than describing them as passed.
4. Localise new flight guidance and mask terms using existing British English source / all supported locales. Verify View/Settings agree, Fly Solo requests are truly manual, no repeated colour checks or stale halo advice, mask painting/crop/re-find does not lose deliberate refinements. The small-preview halo heuristic is not a substitute for a high-bit mask edge implementation.
5. Reconcile with #669 (ColourCheckPanel); keep advice unobtrusive and in standard flow. Use screen readers, keyboard, desktop, tablet and phone. Real bird with visible legs and a branch, birds in flight, portrait hair, fur and sky/landscape should be used to evaluate actual mask boundary and anatomy quality.
6. Run validation against latest main including merged #684; fix issues in new focused PRs. Record exact SHA, executed checks and untested installed-device evidence on #418. Do not falsely change already merged #684 back to draft.

## Specialized follow-on work Claude can orchestrate

### Local photography understanding
- Reuse existing Colour Check, AI Review, subject detector, Natural Auto and signed local model store. Do **not** create a second generic assistant or a visible AI tab.
- Research/benchmark one or two small commercial-rights-cleared quantised VLMs for offline subject/light/colour plausibility and plain explanation; test measured CPU/GPU memory, inference latency, power, abstention and cross-genre negative cases before bundling.
- Keep pixel truth in deterministic Kestrel analysis (RAW source/profile provenance, clipped channels, chroma drift, lighting and ROI masks); a model must not claim that a Eurasian Robin has an exact RGB breast colour solely from species ID, or alter scene pixels. Proposals are bounded reversible standard sliders and masks only.
- Model packages belong in signed immutable data assets with local staged downloads, pinning, hash verification, compatibility smoke tests, atomic rollback and no hidden upload/network dependency.

### GCP backend worker if needed and explicitly authorised
- Inspect the actual deployed and planned architecture first: services/control-plane, docs/BACKEND.md, docs/EQUIPMENT-UPDATES.md, infra/gcp and Firebase/Storage/Secret Manager. Existing manifests and storage contracts win; no duplicate portal/manifest/updater.
- Prepare a minimal **weekly curated asset publisher**, initially in dry-run: inspect official Lensfun/camera data, approved ONNX weights and locally authored photography knowledge; validate provenance/licences and sample tests; publish immutable versioned objects; sign one manifest with protected dedicated signing key. Client updates small lens data silently only if allowed, large models by informed user choice; previous known-good and bundled offline fallback survive corruption, interruption, full storage and power loss.
- Native executable RAW codec updates ship with signed app/OS-store releases, not a hot-swapped model asset. Nikon HE/HE*: validate Nikon NEF/NRW SDK versus LibRaw November 2026 development support, patent/redistribution rights (including possible intoPIX/TicoRAW arrangements), real camera samples and memory limits. Don't ship unlicensed decoding or claim every camera variant without evidence.
- **Do not provision billable services, training GPUs, production credentials or personal-photo buckets without owner-approved region, IAM, budget and privacy gates.** Produce a deployment plan, dry-run and estimate first. Kestrel needs low ongoing costs and zero mandatory online use.
- Optional remote Z9-class full-resolution work: make local memory-bounded previews, serial decode and high-bit scratch first; then opt-in NAS/user desktop or encrypted regional short-lived cloud job with explicit upload/time/cost, consent, retention/deletion and source/result checksums. Cloud processing sees plaintext during processing, so don't claim end-to-end encryption.

### Training with consenting professionals
- Begin with the user's own RAW originals plus approved edits **made inside Kestrel**, rights-cleared ground truth and calibrated synthetic camera-noise pairs. Lightroom catalogue interoperability is a different purpose; do not train commercial models on Adobe-generated rendered or develop-setting data absent written legal clearance.
- Create an invitation-only opt-in panel in separate graduated stages: anonymous diagnostic/accepted slider stats; user-selected privacy-screened small crops; separately consented RAW pairs with clear photographer rights. Participation is not required for Pro and never silent. Rights, DPIA, subject access/deletion, regional retention and security must exist before uploading.
- Weekly **data curation/evaluation**, not unconditional weekly Vertex AI training. Use budget-capped owner-approved training jobs only when lawful data quality, cross-genre benchmarks and resource costs are justified. Proprietary future model ownership requires original training data/weights/algorithm rights, not just rebranding third-party ONNX packages.

## Five existing accountable workstreams
1. Full photographer journey and PR integration; source/edit/export/offline recovery.
2. RAW colour/demosaic/TrueDetail and high-bit natural mask blending.
3. Subject/bird leg/feet/feather/occlusion segmentation, burst culling, confidence.
4. Soar/Glide/Fly Solo, natural guidance, colour confidence, accessible adaptive UI.
5. Signed local models/data, licensing, cloud rights/costs and private training pipeline.

**At exit:** one meaningful user-visible result, exact changed file/PR/commit IDs, REAL PASS/FAIL/NOT RUN evidence, updated #418 and roadmap, remaining IMPLEMENTATION separated from PROTOTYPE VALIDATION. Each worker audits the whole app, fixes its own gaps and hands off every other one with owner/path/reproducer. No manufactured 100%-done claim.
