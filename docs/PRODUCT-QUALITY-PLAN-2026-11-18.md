# Kestrel quality and authenticity plan — 18 Nov 2026

**North star:** Import 500 authentic RAW/JPEG photographs -> safely narrow to 20 great keepers -> produce natural, detailed, faithfully developed masters and social exports -> reopen offline with every decision intact.

## Binding product contract

- **No generative image content.** Models can classify, localise subjects and eyes, rank, select, produce bounded masks, and propose slider/crop/denoise/sharpening parameters. Models must not supply replacement image buffers, hallucinated feathers, backgrounds or repaired content. Output must be derived from original recorded pixels by deterministic conventional processing.
- **Immutable originals and offline operation.** Import, cull, edit, export, undo, relink and local catalogue backup cannot require cloud or an account.
- **No false certainty.** Unknown species remain unknown, aircraft must not be labelled as birds, an in-focus background is not proof of a sharp eye, and an unsupported RAW mode cannot silently use an embedded preview as a full-quality export.
- **One calm workflow.** Import -> Select -> Perfect -> Export, with one next action and advanced depth only on request. Accessibility is baseline: consistent controls, reduced motion, text plus icons, keyboard use, colour-vision supports and a softer default theme.
- **Desktop means native.** Windows and Mac menus act on catalogue/selection commands, not DOM text or button labels. Selection scopes include virtualised filtered frames, not every record across unrelated projects. One Settings/Preferences home.

## Current evidence, not promised capability

Reviewed `main` on 18 Nov 2026; latest sampled SHA `c6d80c83`. Tauri Windows/Mac shell, IndexedDB catalogue, linked-original safeguards, culling, auto exposure/colour heuristics, masks and export foundation exist. The default native RAW path still demosaics then writes an **8-bit quality-95 JPEG before editing**. A separate 16-bit TIFF experiment is not the editor's working raster. Model thresholds have not been calibrated on sufficient real bird/aircraft data; Lightroom/DxO image quality parity is not measured.

See `src-tauri/src/raw.rs`, `src-tauri/src/raw_precision.rs`, `src/core/autoEnhance.ts`, `src/core/subjectRouter.ts`, `src/core/autoCull.ts`, `docs/RAW-QUALITY-PLAN.md`, and the uploaded 18 Nov handover.

## Delivery order (one isolated branch/slice at a time)

| Priority | Outcome | Acceptance evidence |
|---|---|---|
| P0-01 | Semantic native desktop command bridge | Cmd/Ctrl+A selects actual photo records, file-field text selection preserved, native Export exports 1/20/500 chosen photos, no button-label search; Windows/Mac manual verification |
| P0-02 | Durable catalogue/original identity | Real 500 then 2,000 files, NAS/unplug/relink, close/reopen, zero wrongly associated originals or lost edits |
| P0-03 | High-precision RAW pipeline | Actual Z8/Z5II NEF mode fixtures, working 16-bit or float RAW from decoder through masks/tone and export, ICC, independent NX Studio references |
| P0-04 | Reliable subject-first culling | Keep-worthiness recall >=99% on labelled bird evaluation set; false wildlife classification <=0.5% on hard aircraft/vehicle negatives; uncertain shots review-only |
| P1-01 | Non-generative Auto Develop | Models output only typed bounded parameters; before/after colour/clipping guards, preserves low-key/golden-hour intent, undo, no pixel synthesis |
| P1-02 | Calm accessible photo workflow | Beginners/wildlife photographers complete 500->20->export without coaching; users with relevant access needs test predictable navigation, keyboard and colour-vision tools |
| P1-03 | Genuine edge-aware natural detail | Deterministic chroma/luma denoise and sharpening controlled by subject/eye evidence; feather detail and false-pattern rejection tested on real shoots |
| P2-01 | TrueDetail and multi-export ready for claims | Blind >=100-image A/B against Lightroom/DxO, measured artifacts/colour/detail, verified output ICC/dimensions, reproducible batch output |

Targets above are release gates **not measured results**. Do not describe them as achieved without reproducible evidence.

## Engineering action started in this review

Branch `fix/native-photo-select-menu-20261118` changes native File > Export from a text-match click to a semantic `kestrel:desktop-export` app event using the live `exportSelection`. A Playwright regression test now checks native-style select all and batch export of synthetic photos. Existing main already had the native Select All/Deselect photo event mapping, so no duplication was necessary.

**Verification to run before merge:** `npm run lint`, `npm test`, `npx playwright test tests/native-desktop-photo-actions.spec.ts`, plus real Windows and macOS keyboard/menu/filtered-grid/editor-queue acceptance. This connector review cannot run local tests or native builds; no claims of PASS, no CI billing workaround and no unverified merge.

## Evidence and user feedback

The uploaded 18 Nov product handover remains the primary user specification. Qualitative photographer forums suggest that workflow overload, slow preview/culling, artificial-looking denoise and recurring subscriptions are worthwhile problems; these are not representative prevalence measures. See official Adobe RAW/Assisted Culling docs, DxO denoise artifacts FAQ, W3C Cognitive Accessibility and real photographer interviews before finalising copy and UX.
