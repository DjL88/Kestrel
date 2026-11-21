# Kestrel — from good to outstanding
**Owner direction: 21 November 2026 · Programme charter + executable roadmap**

> **Purpose:** Build the most enjoyable, trustworthy complete *authentic photographic* workflow. Wildlife is our demanding image-quality proving ground, **not** an exclusion of portraits, landscape, travel, family, sports, macro or other genres. Depth over breadth. Simplicity when wanted, precision when needed.

This is the **current cross-workstream delivery programme**. [PRODUCT-SPEC.md](PRODUCT-SPEC.md) and [PRODUCT-PHILOSOPHY.md](PRODUCT-PHILOSOPHY.md) remain binding product contracts. [ROADMAP.md](ROADMAP.md) tracks implementation and evidence; [issue #418](https://github.com/DjL88/Kestrel/issues/418) is the shared taskboard. **This programme takes priority over historic task ordering when priorities differ**; do not erase remaining tasks or manufacture completion.

## 0. What success means

A person can take 500 actual mixed RAW/JPEG/HEIC photos from a camera card, folder, phone or NAS; safely import/relink; find their best frames; improve them naturally; batch-match a consistent look; inspect subjects at pixel detail; finish captions/copyright/colour and export at the promised full quality; then reopen entirely offline with **no lost edits or external RAW/denoise/export app**. The simplest journey takes a few understandable choices; every decision stays reversible. Source images never change. Advanced users can inspect profiles, masks, curves, output sharpening, metadata, colour spaces and export settings without a maze of duplicated controls.

### Hard constraints
1. **No generative scene editing.** No invented/replaced objects, hallucinated feathers, generative fill, altered wildlife facts or model-written image pixels. Local intelligence can recommend reversible settings/crops, analyse subjects and produce accurate editable masks. Ordinary physically grounded RAW development/denoise/interpolation remains permitted with empirical artefact guardrails; no unsupported claims of 'true' detail reconstruction. **An optional text assistant may explain/edit sliders, not paint the photo.**
2. **Offline is complete.** No login/network required for free import, culling, local models, RAW development, editing, export, reopening or recovery. Optional BYO remote services and online licence purchase/sync must fail without locking local work. No hidden image upload.
3. **Free is genuinely useful.** Free includes authentic RAW and raster develop, local cull, manual edit, reasonable presets, local backup/relink, original-size high-quality ordinary output, accessibility and privacy. Never artificially degrade image quality, inject watermarks, or make access to originals/edits contingent on payment. Pro earns its value from *advanced automation and throughput*, deeper workflow, advanced masks/batch intelligence/export styles and selected premium Kestrel-owned local models, not by withholding ordinary image correctness.
4. **Two editions only: Free / Pro.** Major-version entitlement is explicit (e.g. Pro v1 stays usable offline indefinitely; Pro v2 is a new optional paid major upgrade). Minor and security/bug-fix releases for a licensed major version are included; define support windows before selling. Never surprise-disable an installed major release. No recurring subscription is required; optional third-party BYO AI usage is user-funded and opt-in. Keep licence validation signed and offline-resilient, not a continuous cloud dependency.
5. **Proprietary destination, legal provenance today.** Own the Kestrel rendering pipeline, proprietary algorithms, dataset rights, training recipes, weights and UX progressively. Do **not** assume a clean-room reimplementation avoids relevant patents, codec licences, trade secrets or dataset rights. Maintain an SBOM and component/weight/codec rights register including licence, attribution, patent flags, commercial rights, replacement plan and counsel decision. Do not copy code, binary internals, model weights, proprietary output datasets or protected trade secrets. Independent interface testing, documented standards and independent mathematical implementation may be lawful in defined circumstances, but require specific UK/EU/US legal review before distribution. Nikon HE/HE* and JPEG XS / TicoRAW require a **separate patent/distribution clearance gate**. Do not use other vendors' trained model outputs to train a replacement without appropriate permissions.
6. **No false completion.** Distinguish DESIGNED, CODED, MERGED, TESTED, VERIFIED-ON-DEVICE and BLOCKED. Lack of GitHub Actions billing is NOT a passing test. Do not mark an unrun acceptance test green or pretend a planned local model is already commercially trained.
7. **One app / one core.** No divergent mobile editor. Progressive adaptive UX with common photo identity, recipe, processing stages, zoom, crop and export truth across Windows/macOS/iOS/Android/web. Browser may have declared resource limits; don't silently reduce requested output.

## 1. Competitive evidence translated into product bets

**DxO:** high-ISO natural denoise/demosaic, optical correction, camera profiles; **Adobe Lightroom Classic:** Assisted Culling, easy sync, metadata/search, dependable workflow; **Capture One:** colour accuracy/control and predictable tools; **Photomator/Apple Photos:** effortless tasteful results; **Narrative Select/Photo Mechanic:** eye-detail inspection and rapid ingestion. Do not chase all their studio/tethering/retouch/printing breadth. Specific credible sources and current public references:
- DxO PhotoLab/DeepPRIME: https://www.dxo.com/dxo-photolab/features/ ; https://www.dxo.com/en/news/introducing-photolab-9-6/
- Adobe Assisted Culling: https://helpx.adobe.com/lightroom-classic/desktop/organize-photos-in-lightroom-classic/assisted-culling.html
- ONNX Runtime local inference providers: https://onnxruntime.ai/docs/execution-providers/index.html and mobile: https://onnxruntime.ai/docs/tutorials/mobile/
- LibRaw code licensing and provenance: https://www.libraw.org/about
- UK permitted software observation/interoperability exceptions: https://www.legislation.gov.uk/ukpga/1988/48/part/I/chapter/III — **not** a blanket patent/copyright permission.
- UK privacy safeguards for ML: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/artificial-intelligence/guidance-on-ai-and-data-protection/how-should-we-assess-security-and-data-minimisation-in-ai/

Prioritise **switching blockers**, then the Kestrel differentiators. No speculative AI-buzzword features.

## 2. The five end-to-end workstreams

### WORKSTREAM 1 — The complete photographer journey / integration lead
**Accountable outcome:** A photographer finishes a shoot in Kestrel without procedural dead ends, missing originals, context-switching or an external export tool.
- Own cross-module **one photo identity/recipe/task engine**; progressive ingest from camera card/folders/phone/NAS (source hashes, RAW+JPEG pairing, dedupe, safe optional second backup), linked originals, transactional catalogue/relink/reopen, persistent edit history and virtual versions.
- Own a single unified batch queue used for background processing/import/analysis/export, bounded CPU/RAM, cancel/retry/resume after crash/restart, permissions reacquisition, atomic collision-safe output receipts, truthful job states and errors.
- Deliver a single **Export Flight**: original-copy vs rendered master are unmistakable; PNG/JPEG/ICC 16-bit TIFF where proven, presets, crop/resize/watermark/text/opt-in metadata, fixed proof from same renderer, one-click destination, accurate full-size profiles. Never pass 8-bit JPEG preview off as a RAW editing master.
- Integrate contracts produced by other workers, coordinating ownership of shared App/PhotoEditor files. Feature must land in **user path**, not merely a library utility.
- Shipping acceptance: 500-source scenario, offline reopen + restart/retry, zero wrong-photo/no silent quality fallback, exported proof matches output; separate VERIFIED or NOT RUN labels.

### WORKSTREAM 2 — Kestrel imaging science / RAW quality lead
**Accountable outcome:** Beautiful, colour-faithful natural photographs throughout the real editor, not just in a raw benchmark command.
- Own sensor-source provenance and the real **continuous high-bit-depth working pipeline** through demosaic, WB, camera/input ICC, linear colour, highlight recovery, lens profiles, edits, masks, denoise/sharpen, output transform and ICC high-bit masters. Make previews and exports consistent. Prioritise Nikon Z8/Z5II including lossless and *legally supported* HE/HE*; no invented decoder success.
- Fix the known 8-bit JPEG intermediate in the normal editable RAW journey. No '16-bit TIFF' success just for packaging 8-bit data in 16-bit samples. Same pixel math across devices or explicit honest capability fallback.
- **TrueDetail**: physical/sensor-aware classical baselines; develop Kestrel-owned denoise/demosaic networks only against consented/licensed RAW pairs and calibrated camera/ISO noise. Preserve feather barbs, bokeh, skin, architecture, landscapes, night sky, fine text. Measure at 100% and final print/export resolution, blind compare against NX Studio, DxO and Adobe.
- Batch look-matching must use this same scene-referred renderer; define reversible per-photo tone/colour matching contract with UX worker.
- Legal stop: HE/HE* codec patents/commercial permission unresolved ⇒ no shipping claim, explicit support matrix; alternate truthful source if allowed, no surreptitious patent-risk decoder inclusion.
- Shipping acceptance: real-camera traces + independent visual/colour/ICC high bit tests and lens/ISO benchmark; test statuses truthful.

### WORKSTREAM 3 — Kestrel Select & understanding / culling lead
**Accountable outcome:** Fast, safe identification of the strongest photo and editable masks that respect the real scene.
- Build **Subject Detail inspector** contracts: subject/eye focus windows at true pixels, stable across A/B bursts; analyse eye/face/subject sharpness, motion vs background sharpness, poses/variety, duplicates and a clear 'needs review' class. Never autotrash uncertain keepers.
- Confidence-calibrated local subject detection across **wildlife, people/pets, aircraft, sport, landscapes, architecture and macro**; wildlife is primary benchmarking, not the only usable category. Separate species ID (often uncertainty) from generic subject segmentation; uncertain birds vs aircraft abstain.
- Deliver reliable accurate feather/leg/branch-aware reversible masks: subtract/add/intersect, feather, edge refinement, no hard leaks/halos; preview identical to high-bit export; light user correction rather than re-prompting the model endlessly.
- Maintain independent real-shoot labelled datasets and class-balanced negative examples; classify model confidence only when calibrated. Accept user corrections as *private opt-in training labels*, never automatically upload.
- Shipping acceptance: measured favourite-keeper recall/false rejection, pixel detail correctness, segmentation boundary scores and 500-photo foreground/background tests; abstention quality reported.

### WORKSTREAM 4 — Effortless excellence / UX and language lead
**Accountable outcome:** A beautiful, quiet, understandable **same workspace** that works on mouse, touchscreen and keyboard; sophisticated tools only when requested.
- Own shared interaction design: **Library → Review → Edit** one frame; consistent filmstrip/zoom/crop, editable/undockable/pinnable panels, user preferences, small restrained controls, plain British English, complete translations, accessibility, colourblind-safe cues, reduced motion; phone, tablet landscape and foldable layout parity.
- Design/integrate **Natural Auto** into a simple preview → Apply/Compare flow, with very short useful explanations and 'already good' abstention. No verbose internal model caveats or invented improvements; no silent change to manual edits.
- Build **Match This Look** as a coherent shoot-wide *reversible* recipe: copy visual intent from a confirmed reference while independently correcting tone/exposure/WB per photo, preview representative samples, exclusions/manual locks, strength slider, explicit undo. Use Kestrel-owned classical statistics first, optional local model later. Collaborate with imaging lead on core colour constraints and integration lead on batch.
- Build **Finish My Shoot**: one helpful queue of 'review uncertain picks / edit selects / fill metadata / export', without mandatory wizard/extra steps. Default sensible values and auto-skip single-choice UI; Advanced editing remains available.
- **Colour confidence**: exposure/clipping and neutral-colour hints, reference compare, accessible tones and understandable advanced tooltips; built-in beautiful restrained natural looks for diverse genres, no filters that falsify subjects.
- Shipping acceptance: new user's path from import to export, professional path with precision, A11y/translation/phone/tablet/desktop flows; no modal overflow, no forced repeated clicks.

### WORKSTREAM 5 — Kestrel-owned platform / architecture & release lead
**Accountable outcome:** An economical, safe, offline-native foundation for Free and Pro, local intelligence, provenance and installable releases.
- Own native runtime adapters and architecture: reliable local caches + source-folder recovery snapshots where writable; safe NAS/volume reconnect; encrypted OS-keychain BYO secrets; signed model update manifest, content-digest validation, version rollback, optional cloud sync only if explicitly chosen; no unannounced network use.
- Own local inference *adapters* (ONNX CPU/GPU/WebGPU, Core ML where supported, Android CPU/NNAPI where practical, deterministic non-ML fallback), memory/GPU budgets, model selection per device and signed package manifests; never claim inference providers/quality without real device testing.
- Own Kestrel model strategy and rights ledger: separate **Kestrel-owned model** experiments from third-party model evaluation; dataset provenance, subject/bird/perceptual diversity, consent, rights, retention/deletion, training/eval split, weight checksum, model card and quantised CPU fallback; create a reproducible training/evaluation pipeline, not a folder of hypothetical model names.
- Evaluate an **optional local text assistant** for answering natural-language edits (translate request into a bounded, reviewable slider/mask recipe; provide concise explanation); rules/classical engine before a heavyweight model; never generative photo manipulation, auto-execute untrusted text, or call the network without consent. On constrained devices, simple static help remains fully functional.
- Free/Pro signed entitlements per paid major version, offline grants and updates; prohibit always-online validation and lockout when licence service unavailable. Pro/Free have the same core photo fidelity and data portability. Low-cost cloud: static site/downloads, signed manifests, minimal licence/control plane; explicit unit cost budgets.
- Before promoting 'proprietary' rights, audit *existing public repository* and dependencies; a public repository makes source visible and existing third-party open licences persist. New proprietary modules/weights need correct rights, code permissions and suitable repository access.
- Optional conservation funding: propose transparent fixed donation per sale or audited share of net receipts with nominated eligible partners; no unapproved charity claims, payment/tax/legal counsel review before advertising.
- Shipping acceptance: reproducible signed packages, offline licences/restores, model provenance, keychain, resilience to disconnected cloud, documented cloud running costs and no unsafe telemetry.

## 3. What we build ourselves versus borrow, and in what order

**Tier A — own NOW:** edit recipe and rendering graph orchestration; user experience; metadata/identity/tasking; private culling/score aggregation logic; simple classical exposure/colour matching and local look profiles; scene-bound masking corrections and confidence thresholds; synthetic noise simulator and quality evaluation harness.

**Tier B — own progressively through experiments:** camera-aware demosaic/denoise, reversible tone and colour engines, proprietary compact subject/pose/mask models, lens/camera calibration datasets where legally collected. For each experiment use properly licensed own-captured RAW scenes with varied ISO/exposure, calibration targets, low/mixed light, moving subjects, fine feather/branch edges, portraits, landscapes, architecture, macro, night and known negatives. Publish internal reproducible benchmarks, never promise competitor parity.

**Tier C — temporarily integrate where lawful/practical:** platform RAW libraries and OS decode, ONNX inference runtime, image codecs, standards-based metadata/ICC and permissively licensed trained detection models *only* after licence and commercial/redistribution assessment. Track whether weights themselves have different terms from inference code and whether static/dynamic linking imposes obligations. Replace only where Kestrel-owned implementation clearly improves quality/control/cost or independence. Do not rebuild mature interoperability infrastructure merely to claim ownership.

**AI boundary:** *AI in development* is not *generative content in photographs*. Models may read/understand and select parameters; outputs to users are ordinary reversible image edits. Neural denoise and other learned reconstruction must be scrutinised for synthetic texture/hallucinations, particularly real-world wildlife documentary integrity. Report borderline techniques accurately; favour a conservative implementation.

**Training programme:** (1) acquire consented rights-cleared real RAW/ground truth and photographer-scored evaluation set; (2) baseline non-neural render/noise and camera-profile accuracy; (3) train small camera/ISO-aware residual/noise prediction model with faithful ground truth, architecture/model-data cards; (4) blind compare with no reference leakage across same burst/camera; (5) optimise quantisation, tiles, memory; (6) sign/version model pack and fallback; (7) broaden camera/genre coverage. Keep training compute separate from end-user app; never upload images by default. Paid tokens for research/training may accelerate work, **not** substitute for rights, verified data or good evaluations.

## 4. Edition and costs product decision (pending final owner pricing)
| Core capability | Free | Pro |
| --- | --- | --- |
| Offline JPEG/PNG/HEIC & supported RAW development with correct colour | Yes | Yes |
| Full-res ordinary JPEG/PNG and safe source export, originals/edits portable | Yes | Yes |
| Essential manual exposure/WB/tone, crop, reversible presets, baseline denoise/detail and masks | Yes | Yes |
| Local project, catalogue/recovery, privacy and accessibility | Yes | Yes |
| Advanced dynamic masks, batch intelligence, Match This Look across many images | Basic/manual when reasonable | Advanced/accelerated automation |
| Optional Kestrel premium TrueDetail local model, professional ICC/TIFF tools, advanced output templates and specialist culling | Some capability / honest limits | Full capabilities where evidenced |
| Offline usage without account or payments | Always | After one-time entitlement grant |
| Third-party online AI and optional BYO/NAS/cloud | Explicit opt-in/user-owned services | Explicit opt-in/user-owned services |

**Do not introduce paid subscriptions, extra paid tiers or an artificial image-count/export-resolution trap.** Commercial packaging and any donation pledge require owner approval and public terms. New major licence should be a paid upgrade, not a forced conversion; the owned prior major remains functional offline.

## 5. Evidence, QA and accountability (every worker, every run)

**Rule 1 — implement end-to-end vertical slices, not standalone utilities or micro-PRs.** Before editing: read latest main, this file, #418 and open PRs; claim own paths in #418 discussion; state 2–3 connected goals forming **one meaningful photographer outcome**. Where interfaces cross, agree TypeScript/Rust contracts and assign ONE shared-file editor (integration lead).

**Rule 2 — no open loop.** At end of each run, each worker:
- Inspect their own changes *and the whole current project* for new regressions, incomplete wiring, missing import/export path, cross-genre regression, offline dependency, licence risk, race/cancellation, data loss or obvious UI inconsistency.
- Fix discovered issues within their owned files when safe. Otherwise name a single responsible workstream and create/attach a bounded issue or #418 task and **explicit handoff**, not a vague to-do.
- Review relevant unmerged PRs for conflicts/duplication and main SHA; do not count merged code as installed proof.
- Report actual commit SHA/PR links, user-visible behaviour, code/test evidence (PASS/FAIL/NOT RUN), **remaining implementation**, **remaining validation**, and the highest-risk blocker. Avoid imagined percentages.
- Merge only with sufficient evidence and no known safety/quality blocker; if runner cannot execute, state untested, keep high-risk code unmerged. Billing-paused GitHub Actions are infrastructure-blocked, not green.
- Record implementation scope in docs/ROADMAP.md and concise #418 evidence; integration lead alone coordinates edits to #418 body.

**Rule 3 — shared acceptance:** one real 500-photo shoot + 2,000-photo stress path on Windows/macOS and representative mobile, including Z8/Z5II HE/HE* only where legally supported; daylight, high-ISO, feathers/skin/foliage/fine text, difficult masks, colour targets, 8/16/32GB machines. Collect build SHA, source/output digests, stage timings (p50/p95), CPU/GPU/RAM, colour/ICC/bit precision, keeper recall and false reject, export/render parity, crash/recovery. All unrun stages are NOT RUN and block public superiority claims.

## 6. Rolling sequence — the smallest number of big releases

**Programme A: Reliability foundation** (streams 1+2+5; UX and perception integrate): source→high-bit edit→faithful proof→durable final export, offline catalogue/relink, signed platform/model/license boundaries. **Exit:** no wrong/lost photo and no 8-bit RAW master disguised as quality; known unsupported formats clearly gated. This dominates feature work.

**Programme B: Photographer delight** (streams 3+4; streams 1+2 integration): integrated subject detail + keeper comparison + safe masks + Natural Auto + Match This Look + Finish My Shoot, across genres. **Exit:** 500-photo shoot can finish with fewer decisions and objectively good results; uncertainty visible but not jargon-heavy.

**Programme C: Sustainable ownership and market readiness** (stream 5 with all others): Kestrel-owned training pipeline and first rights-cleared model experiment, generous Free and durable Pro major entitlements, deployment/signing, installer/docs and cost/impact transparency. **Exit:** honest support and legal licences, predictable low operational costs, no online lock-in and clear public copy.

**Feature freeze:** defer optional HDR/stack/panorama, tethering, generative retouch, cosmetic UI embellishment and ambitious cloud services unless an evidenced existing journey is blocked. Close correctness and usability before adding breadth.

## 7. Initial audit / known unfinished outcomes (baseline, not 'complete')

- **P0 image fidelity:** native normal RAW editor described in latest repo audit as 8-bit JPEG intermediate; high bit through UI, Nikon HE/HE* decode/patent distribution, ICC/colour/true export not proven. Some checks exist only as authored tests.
- **P0 reliability:** full persistent restart-safe task queue, true source hashes and transactional NAS/cloud/relink/backup incomplete/unverified; 500 real photos and device offline recovery not signed off.
- **P0 editing UX:** cross-device complete coherent controls/independent dock tabs, export proof, accessibility and translations have implementation slices but not end-to-end installed evidence.
- **P1 intelligence:** real-model species uncertainty calibration, bird-eye score, mask precision/quality, robust cross-genre false-positive handling need code+real eval beyond rules-only modules.
- **P1 delight:** shoot-wide reference matching, Finish My Shoot, accessible natural presets and richer smart collections are proposed or partially implemented; do not mark delivered without an integrated user path.
- **P1 ownership:** rights-cleared training data/weights and maintained in-house inference/model provenance pipeline not established; offline local assistant is research/experiment until actually measured.
- **P0/P1 commerce and release:** Free/Pro product contract, major-version perpetual offline entitlements, provider credentials, code signing, real model-download/update and optional cloud-control plane are not release-verified.
- **Governance:** treat #418 checklist and live PRs as moving reality, never as automatic evidence. Each worker fixes cross-cutting issues or explicitly hands them to an owner before ending.

### 21 November kickoff assignment
1. **Integration:** deliver the uninterrupted, durable full shoot journey and renderer/export wiring.
2. **RAW:** deliver true editable high precision + camera colour and empirical natural denoise.
3. **Cull:** deliver a real subject-detail/burst/segmentation implementation, with cross-genre abstention.
4. **UX:** deliver one polished Natural Auto / Match Look / Finish Shoot interaction, shared across devices.
5. **Architecture:** deliver offline model+training rights, durable Free/Pro major licensing, signed builds and optional backend boundaries.

**Important:** none of the above are claims of completion. Implementation and evidence must be committed and reviewed in the repository before status changes.
