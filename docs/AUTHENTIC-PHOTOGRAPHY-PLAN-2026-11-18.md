# Kestrel: Authentic Photography Delivery Plan
**Version:** 18 November 2026 | **Status:** Product plan; repository source review, not release certification.  
**Repository baseline:** `aaa578935a54f556debdc6a7a86dd1a344e74999` (main when this implementation branch was created).  
**North star:** Import 500 real photographs; retain the strongest 20 while preserving uncertain images; apply excellent natural edits; export native-resolution results; reopen offline with no lost edits.

## 1. Non-generative product contract
Kestrel is an offline-first, non-generative, nondestructive photography application. Intelligence models may recognize subjects, estimate uncertainty, find eyes/regions, sort photos, propose ordinary masks and crop positions, and choose numerical parameters for familiar sliders. The model must never generate, replace, inpaint, extend or fabricate photographic content. The rendering engine uses deterministic, documented signal-processing algorithms from the actual recorded pixels, and every adjustment is versioned/reversible. No background uploads or provider APIs by default.

Specifically: no generative feather reconstruction, hallucinated eyes, sky replacements, synthetic subject removal, text-to-edit pixel generation, or masked diffusion. A segmented area is permitted as a **selection**, not as a synthetic fill. Denoising/demosaicing may change rendered pixels through traditional image processing but must be bounded by and tested against real sensor signal. A plausible-looking feather pattern is not evidence of recovered detail.

## 2. Evidence and competitive position
### Photographer needs
- Wildlife/bird photography: bursts of 500–2,000+, eye sharpness, meaningful pose, wing position, composition, fear of deleting a unique moment. Source: https://www.reddit.com/r/BirdPhotography/comments/1rsp49i/how_do_you_select_the_best_photo_of_a_burst_series/ and https://www.reddit.com/r/wildlifephotography/comments/1rga3st/how_do_you_approach_culling_large_wildlife_bursts/
- Beginners: RAW sliders and workflows often feel overwhelming; help people reach a believable edited result without mastering a panel. Source: https://www.reddit.com/r/photography/comments/1u1kdsz/lightroom_lesson_and_editing/
- Workflow and cognitive accessibility: consistent navigation, less distraction, recovery from interruptions, plain language, visible progress; never presume one design fits every ADHD/autistic photographer. Source: https://www.w3.org/TR/coga-usable/
- Authenticity: photographers distinguish real photograph enhancement from generated replacements; user preference research is qualitative, not a population-wide survey.
- Colour-vision diversity: neutral reference, channel/histogram values, intelligible text/icon status; never force the user's art to match a 'normal' aesthetic.

### Baseline competitors as of November 2026
- Adobe Lightroom Classic 16: established high-bit-depth RAW, colour tools, masking, batch editing, Assisted Culling, AF points, eye-focus ratings for people, comprehensive catalogue. Source: https://helpx.adobe.com/lightroom-classic/desktop/introduction-to-lightroom-classic/whats-new.html . Kestrel should not claim first-in-market assisted culling.
- DxO PhotoLab 10: advanced lens/camera profiles, DeepPRIME 3/XD3 RAW denoising, depth masks and local noise processing. Source: https://www.dxo.com/en/dxo-photolab/features/ . Its learned pixel-level demosaicing/denoising does NOT satisfy Kestrel's restricted no-generation/model-as-advisor rule exactly; benchmark result quality without copying technology or making false parity claims.
- Nikon NX Studio: first-party Nikon colour/reference and supported-camera comparison target, not guaranteed perfect aesthetic ground truth.
- Kestrel opportunity: accurate subject-specific shortlisting, gentle trustworthy edits, honest uncertainty, no mandatory subscription or cloud, and a calm native app with a fast import-to-export path.

## 3. Repo source findings at branch creation
| Topic | Found | Missing evidence / risk |
| --- | --- | --- |
| Desktop | Tauri v2 Windows/macOS shell; native menu in `src-tauri/src/lib.rs` and webview bridge `src/providers/useDesktopMenu.ts` | Default Select All was OS/webview text selection, not photo records. Button-text matching fragile; native installed-app QA outstanding. |
| Library | Linked originals, projects, virtual copies, JSON backup and IndexedDB | Native SQLite/WAL durability, external NAS reconciliation, 500/2,000 real-shoot crash tests |
| RAW | `raw.rs` converts decoded RAW to quality-95 8-bit JPEG; `raw_precision.rs` experimental true 16-bit TIFF | Normal editor still low precision; real Z8/Z5II HE/HE* proof; ICC profiles/scene-linear pipeline |
| Detail | Basic reduction/edge logic, chroma prototype and `TRUEDETAIL` capability flags | Production TrueDetail NOT released; colour/detail benchmark, no artificial feathers |
| Auto | `autoEnhance.ts` rule-based preview pixel analysis, `autoQualityGate.ts` clipping/hue check, batch suggestions | Unattended art direction, focus-aware colour and feather conservation, real-scene effectiveness |
| Culling | `autoCull.ts` heuristics, detector influence, burst limits, review-only uncertain policy | Calibrated eye/subject focus, composition/pose and actual wildlife/aircraft accuracy |
| Identification | Closed UK species embeddings, user corrections and gating to positively classified wildlife | Automated open-world category recognition is not fully established end-to-end; unclassified photos cannot be blindly assigned species |
| UI | Calm theme, editor, info, virtualised grid, gestures and shortcuts | Native command registry, unified Settings, tested keyboard + accessibility, real user sessions |
| Quality assurance | Synthetic tests, Playwright cases and RAW benchmark harness | 500/2,000 real files and real Windows/macOS builds; GitHub CI jobs currently report zero steps while billing is blocked |

## 4. Ordered engineering deliveries
Each initiative has an outcome, smallest useful release, acceptance gate and safety condition. Work on bounded non-overlapping branches and do not merge when required CI is blocked.

### P0-A — Desktop semantics and source-of-truth consistency
1. Replace native Select All with "Select All Photos" and "Deselect Photos", dispatch structured application commands, select current filtered photo records including virtualised/offscreen tiles. Keep Cmd/Ctrl+A as select-text when a text input is focused. **First code slice in PR attached to this plan.**
2. Refactor `useDesktopMenu.ts` away from DOM-button text lookup to typed command bus. Make macOS Kestrel app menu and Windows File/Edit/View/Window/Help feel native; route File Import, Export, Copy/Paste Adjustments, Undo/Redo, Next/Previous, Zoom, View filter, Settings to actual app handlers. Disabled actions must genuinely be unavailable.
3. Test menu item -> app action -> correct photo selection, undo and restored state on native Windows/macOS. Test multiple open projects, filtered vs entire project, editor vs grid, keyboard-focus in text fields.
4. Verify Mac and Windows install artefacts reference identical main SHA/build timestamp; clean-install smoke tests with raw files and no stale service worker. Full-screen, file associations and OS file dialog semantics.
**Gate:** native commands never select arbitrary page text; every visible menu option works or is disabled. Real-device evidence on both OSes.

### P0-B — Genuine RAW colour and export
1. Validate Nikon Z8 and Z5II lossless, HE and HE* by camera firmware/OS/decoder; make unsupported mode error honest, never substitute thumbnail as full RAW.
2. Replace mandatory 8-bit JPEG editor intermediate with scene-linear high-precision buffer (16-bit integer or floating point), with colour profile detection, working-space and output ICC conversions. Keep 8-bit only for display.
3. Coordinate deterministic demosaic, lens/CA correction, colour/white balance, tone, mask, crop and export in a tile-safe shared pipeline. Avoid stitching seams and identity mismatches.
4. Export 16-bit TIFF masters plus sRGB JPEG/social variants with equal crop, mask and tone. Verify dimensions, EXIF/privacy options, ICC profile, source hashes, interruption/disk-full and crash recovery.
**Gate:** 45MP Z8 and Z5II reference RAWs have pixel-dimension/colour/provenance proof; high-bit-depth full-res export remains full resolution, with identical final recipe to editor. No false 16-bit derived from 8-bit data.

### P1-A — Trustworthy subject / species identification
1. Hierarchy: image type (photograph/screenshot etc.) -> open-world categories (bird/mammal/person/aircraft/landscape etc.) -> subject/eye region -> specialist ID (species/plane). Camera focus EXIF may corroborate but never override visual evidence.
2. Open-set rejection and explicit Unknown. Species must not run on helicopter, plane, car, sky, toy or unidentified scene. A closed species classifier's softmax alone is NEVER proof that a bird exists.
3. Calibrate model confidence against held-out real wildlife and hard negatives by camera/ISO/crop size. Protect small/in-flight bird/occlusion cases and image metadata privacy.
4. Store evidence separately: `subjectType`, `subjectBoxes`, `eyeBoxes`, `speciesCandidate`, `confidence`, `modelVersion`, `userCorrection`. Corrected labels must not be reintroduced.
**Gate:** target ≥99.5% avoidance of confidently wrong animal labels on a dedicated hard-negative set, ≥95% subject-category precision for accepted high-confidence predictions, recall reported separately; otherwise say Unknown. Targets are provisional quality gates, not measured achievements.

### P1-B — Culling that protects the moment
1. After import, group true bursts/near-duplicates; score subject-eye focus from full/native detail region rather than whole-frame contrast. Include camera focus information as an auxiliary hint.
2. Keep meaningful alternates: distinct poses, open wings, behaviour, lighting, framing; enforce user keeper target but never destructively delete uncertain photos. Compare synchronized 100% eye crops and whole images.
3. Explain selection in one sentence: "Sharp eye, clean pose, strongest in this burst"; "Needs your review" when uncertain.
**Gate:** on an independently labelled 500/2,000-photo mixed wildlife/aircraft shoot, preserve ≥99% of expert-marked must-keep frames in kept+review; zero accidental file deletion; record time saved vs manual culling. Do not use synthetic thumbnails as quality evidence.

### P1-C — Non-generative Auto Develop
1. Run on RAW/high-precision data, not thumbnail-only heuristics. Estimate exposure, highlight headroom, neutral white balance, subject/background luminance, colour relationships, scene intent, haze and low-key/mood.
2. Intelligence proposes bounded numerical global and subject-masked adjustments: exposure, highlight/shadow, white/black, contrast, temperature/tint, vibrance, local exposure, sharpening and denoise strengths. A fixed renderer implements them.
3. Preview before/after and use guarded unattended apply only when confidence and independent clipped-highlight, colour-shift and edge-mask checks pass. Preserve photographer edits; all results undoable.
4. Add personal, offline style adaptation based on multiple accepted/reverted recipes. No cloud images, no collective learning before separate consent.
**Gate:** blind photo-reviewers prefer Auto result over unedited baseline on a predeclared majority of test set; report per-scene failures; no critical clipping, false colour or mask seams; unavailable sources never yield false ready/export status.

### P2-A — TrueDetail authentic signal processing
1. Build deterministic high-quality demosaicing baseline (e.g. benchmark AHD/RCD/AMaZE class of methods where licensing allows), correct black/white level, CFA and chromatic aberration. Benchmark differing moire/fine-feather textures.
2. Camera/ISO-aware noise profile. Separate luminance/chroma denoise, edge-aware adaptive filtering, optional temporal same-burst corroboration only if registered and never synthesized; do not merge moments or fabricate features.
3. Use segmentation/edge/texture measures ONLY to set denoise/sharpen parameters. Keep backgrounds smooth but retain genuine eyes, barbules and microcontrast; control ringing/haloes.
4. Compare Nikon NX Studio, Lightroom and DxO on rights-cleared matched Z8/Z5II RAWs. Crop eye, feather, sky and foreground at 100/200%; use blind naturalness judgement and colour/false-texture artifact metrics.
**Gate:** disclose where Kestrel loses; ship TrueDetail Pro only when real-world human quality tests support it. Never sell experimental research as released.

### P2-B — Calm beginner and accessible workflow
- Primary navigation: Projects -> Select -> Improve -> Export. Single visible primary action per stage; don't make new users understand file systems or RAW internals before importing.
- Strong desktop keyboard/macro pad, one Settings home, back arrow, photo-info panel visible by default/hideable, dimmer default. No duplicated controls and no automated surprises.
- Clean labels ("Looks sharp", "Review this", "Improve photo", "Export full size"), easy Undo, before/after and next suggested action.
- Colour independent indicators and neutral quantitative colour checks; keyboard-only, 200% UI scaling, reduced motion, focus restoration and no hidden time limits.
- Measure tests with real beginners, ADHD/autistic people who opt in, colour-vision-diverse users and experienced bird photographers; avoid inferring individual needs from diagnosis.
**Gate:** 8–12 first-time participants complete import, selection, gentle improvement and export with no coaching; zero critical keyboard/screen-reader issues; subjective calmness and clarity captured and improvements documented.

### P3 — Release confidence and commercial work
- Native signed/notarised Windows and Mac; updates with rollback and verified artifact SHA; capacity and performance matrix on 500/2,000/5,000 photo shoots.
- Portable metadata-only backup, source identity checks and two-device conflict-safe restore. No original photo upload.
- Right-sized one-off licence and authentic-photography language. Publish only verified supported RAW formats and shipping features.

## 5. Sequence and ownership
- **Now:** desktop photo Select All/Deselect implementation and Playwright source test; leave branch/PR unmerged while CI unavailable.
- **Next:** native command registry and actions in separate focused PR; compare Windows and macOS installed builds, audit all menus.
- **In parallel:** RAW engineer prototypes scene-linear edit buffer without overlapping editor menu work; Culling engineer assembles licensed expert-labelled shots; UX engineer prototypes guided workflow and user tasks.
- **After measured RAW results:** TrueDetail algorithm bake-off and Auto parameter calibration on same high-precision engine.
- **Do not merge** only because no conflicts. Due to the reported GitHub billing hold, a workflow with zero steps is **INFRASTRUCTURE BLOCKED**, neither passed nor a code failure. Require local/native tests and later hosted checks before merging.
- **No background upload or generative image services.** Optional cloud model/provider should never be invoked automatically during import-to-export; review existing online-helper path for alignment with the default local-only policy.

## 6. Acceptance scenario and evidence ledger
A user installs an unsigned labelled alpha on Mac and Windows, imports 500 Nikon Z8/Z5II NEFs/JPEGs from external disk, runs automatic suggestions, reviews uncertain cases, makes ≤3 interventions on a typical keeper, exports original-size TIFF + JPEG, closes and reopens offline, safely relinks a moved volume. All edits/decisions survive, source hashes unchanged, no invented subject labels, no unexpected pixel generation, and desktop commands target real photos.

Evidence classes: **IMPLEMENTED IN SOURCE** / **TESTED SYNTHETICALLY** / **TESTED REAL RAW** / **TESTED NATIVE WINDOWS** / **TESTED NATIVE MAC** / **INFRASTRUCTURE BLOCKED** / **PLANNED**. Never collapse those labels.

## 7. Sources
- Adobe November 2026 Lightroom Classic: https://helpx.adobe.com/lightroom-classic/desktop/introduction-to-lightroom-classic/whats-new.html
- DxO PhotoLab 10: https://www.dxo.com/en/dxo-photolab/features/
- W3C cognitive accessibility: https://www.w3.org/TR/coga-usable/
- Bird photography culling: https://www.reddit.com/r/BirdPhotography/comments/1rsp49i/how_do_you_select_the_best_photo_of_a_burst_series/
- Wildlife culling: https://www.reddit.com/r/wildlifephotography/comments/1rga3st/how_do_you_approach_culling_large_wildlife_bursts/
- Beginner Lightroom concerns: https://www.reddit.com/r/photography/comments/1u1kdsz/lightroom_lesson_and_editing/
- Source files above and Kestrel's `docs/RAW-QUALITY-PLAN.md`, `docs/RELEASE-GAP-AUDIT-2026-11.md`, `docs/GUIDED-WORKFLOW-PLAN.md`, `docs/TRUEDETAIL-REAL-SHOOT-ALPHA.md`.
