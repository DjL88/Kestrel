# Kestrel — product philosophy and contributor charter

> **Photography should feel like photography again.** Spend less time wrestling with software and moving files between applications, and more time enjoying, understanding and finishing the photographs you actually captured.

**Owner-approved direction · 20 November 2026. This document is normative for product decisions and contributions.** Read this before planning a feature, changing the imaging pipeline or opening a major PR. [The product specification](PRODUCT-SPEC.md) defines requirements; [the roadmap](ROADMAP.md) and [live #418 taskboard](https://github.com/DjL88/Kestrel/issues/418) define priorities and evidence.

## The promise

**One approachable, complete photographic workflow — from camera original to beautiful, authentic finished output.** A user must not need a separate application to develop RAW files, denoise, sharpen, edit colour, mask, resize/upscale, write metadata, add text/watermarks or export and share normal photographs.

We are **not** building a clone of Photoshop, Lightroom, Capture One or DxO. Those companies have years of experience, large teams and long-trained models. We should learn from them and benchmark fairly, without pretending to have reached parity before real tests demonstrate it. Kestrel succeeds by making the whole process coherent, by never being unacceptably poor at photography fundamentals, and by being excellent at our niches.

### Good everywhere; exceptional where it matters

- **Switching baseline, not feature-count parity.** Essential functions must work well enough that someone can leave their previous editor without having to return for basic photographic quality or a missing step. A missing fundamental is a switching blocker even when 30 new optional features have been added.
- **Excellent niches.** Wildlife and bird photography; faithful feather/eye detail and high-ISO denoise; trustworthy subject/burst intelligence and masks around feathers, feet and branches; simple, calm, inclusive and colour-blind-friendly editing; transparent recommendations instead of inscrutable automation.
- **Realistic restraint.** We do not have to beat every competitor in every benchmark. Capture objectively better results where possible, report limitations candidly, and keep working toward them.
- **End-to-end over isolated hero demos.** Finish real workflows and validate installable releases. Fewer features working brilliantly beat many features barely working.

## Non-negotiable photographic trust

1. **Original photographs are immutable.** Never overwrite or destroy originals. Save reversible adjustments, provenance, history and project data separately; recover after crashes, missing drives and restarts.
2. **Authenticity over invented pixels.** No generative replacement, added/removed objects, hallucinated feathers, synthetic scene detail or misleading subject alterations. Local intelligence may analyse, identify, rank, recommend edit parameters and create reversible masks. Ordinary denoising, demosaicing, correction, sharpening, resizing and evidence-preserving restoration are permitted, but must be tested for artefacts; reconstruction-based super-resolution is optional, explicitly labelled and must not fabricate perceptually deceptive details.
3. **An image cannot look worse merely by opening it.** Unedited JPEG, PNG, HEIC, TIFF and RAW should preserve the best trustworthy input rendering and colour management. If a high-precision RAW development is unavailable, make the preview/decoder provenance visible and block falsely labelled high-precision master exports instead of silently promoting an embedded 8-bit JPEG.
4. **Colour accuracy matters.** Camera-specific profiles, reliable white balance, natural hue/saturation and highlight roll-off, lens correction and colour-managed preview/export belong to the core pipeline. Protect plumage, low-key scenes and skin/neutral colours against unwanted shifts.
5. **Quality claims require evidence.** A 16-bit TIFF is not proof of 16-bit processing. Synthetic PSNR, a successful merge or a working UI is not proof of DxO/Lightroom parity. Use licensed real photos and record source SHA, mode, profiles, sample count, model/build SHA, platform, settings, blind comparisons, and PASS/FAIL/NOT RUN. Do not conceal losing cases.

## What Kestrel should do, start to finish

1. **Import:** all common photographic formats, including supported native RAW variants. For Nikon Z8 and Z5II, validate lossless/HE/HE* sensor decode. Preview each photo as it arrives while trustworthy high-fidelity development continues in a bounded background queue.
2. **Understand and select:** recognise subjects cautiously, cluster bursts/duplicates, suggest keepers and provide useful human explanations. *Unknown is better than confidently wrong.* Never auto-trash an uncertain potential keeper. Manual decisions take precedence.
3. **Develop:** automatically use the highest-quality **verified** decode and precision available; no RAW format/pipeline chooser in the normal editor and no external RAW converter required. The same colour and pixel pipeline should feed normal edit, comparison and master export, with honest platform fallbacks.
4. **Edit and enhance:** responsive, reversible colour/exposure/highlights/shadows, curves, crop/rotate, lens corrections, denoise, sharpening, and precise, feathered add/subtract/intersect masks. Natural Auto suggests sliders and masks, not recreated pixels. TrueDetail should pursue excellent wildlife detail without waxy textures, halos or fake feather structure.
5. **Size and upscale:** high-quality conventional resizing and destination-appropriate output sharpening within Kestrel. If model-based upscaling proves faithful, expose its limitations and allow opting out; no automatic invented fine structure.
6. **Finish:** readable inspection and export-only editing/hiding of appropriate EXIF, XMP and IPTC fields, captions, tags, copyright, subject, optional GPS exclusion, fonts and text overlays. Distinguish written metadata from text burned into image pixels. Originals retain their metadata.
7. **Export and share:** the fixed proof preview must represent the actual export renderer. Saveable presets, locally stored private watermarks with adaptive light/dark contrast, original/full-quality TIFF/JPEG/PNG/social, authentic before/after, and optionally tutorials from real edit history. Batch exports should queue durably in Task Manager, close the dialog once jobs are accepted, avoid overwrite and use sensible destination subfolders.
8. **Return:** reopen and continue offline; preserve decisions, edits, photo identity and original links; safely relink external disks/NAS and reuse presets without mandatory cloud accounts.

## An interface for actual humans

- **One workspace:** Library → Review → Edit share the same navigation, image, selection and controls, adding creative panels rather than changing how the app behaves. One Settings home.
- **Calm and discoverable:** human-language decisions, consistent sliders and tool affordances, clearly labelled copy/paste settings, simple Essential by default with depth available when wanted.
- **Inclusive by design:** colour-blind-safe information, high contrast, keyboard/touch/screen-reader support, reduced motion, remembered panel positions and left/right-handed layouts, truthful translations everywhere.
- **Fast without being reckless:** immediate usable individual photos, cancel/resume, background Task Manager, responsive sliders, bounded memory/CPU/GPU, visible progress and errors, no hidden failures.
- **Private and user-owned:** offline first. Originals and models remain local unless the user explicitly configures optional storage/assistants and consents to transfer. No compulsory subscription; optional paid capabilities must never hold original photographs hostage.

## Scope boundaries

**In scope:** a full photographic workflow, including RAW/colour/detail, denoise, masks, culling, resizing, metadata, batch export and sharing. Include straightforward tether/import later if it becomes useful, but it is **not a current blocker**.

**Outside the core promise:** sophisticated compositing, Photoshop-style graphic design, generative addition/removal/replacement, fictional scene manipulation. A user choosing those tasks may reasonably leave Kestrel; that is an intentional product boundary, not a flaw.

## How we decide what to build

For every proposed PR or feature, answer:

1. Does it remove an existing switching blocker, improve photographic truth or complete the end-to-end journey?
2. Does it improve our chosen niche while preserving the fundamentals?
3. Is it coherent with existing workflow, privacy, reversible editing, colour fidelity and supported platforms?
4. Can a real photographer test the complete outcome on an exact build with objective and human evidence?
5. Is it worth its complexity, support burden, memory budget and maintenance cost?

Prioritise **broken builds and data integrity → sensor-derived fidelity/colour/detail → complete import-to-export journey → accessible coherent interaction → competitive niche excellence → optional breadth**. The live taskboard may reorder inside those groups based on evidence, but must say why.

### Required release / contributor evidence

- Record the exact main/PR SHA and Windows/macOS/mobile test status separately; do not infer app installation or visual quality from CI.
- Test a representative 500-real-photo Z8/Z5II wildlife shoot (lossless, HE, HE*, daylight, white feathers, dark background, high ISO, rich colour), then a 2,000-photo stress case. Include JPEG/HEIC ordinary-image regression.
- Import progressively → cull/compare → develop/edit/denoise/mask → resize/upscale → edit metadata/mark → batch export → close/reopen/relink. The end-to-end test **fails** if ordinary photographic work requires another editor.
- Validate no original hash changes or wrong-file relinks; inspect preview/master ICC colour and precision, clipping, feather texture, halo/mask artefacts, output sizes and metadata privacy.
- Measure throughput, p50/p95 perceived delay, peak RAM/GPU/CPU, cancellation/recovery and mobile limits. Publish limitations plainly.
- Treat unmatched codec/model licences and unverified commercial JPEG XS/TicoRAW rights as release blockers, not documentation footnotes.

**The ultimate question:** Can a photographer take a real shoot from camera to beautiful final deliverables, happily and confidently, entirely inside Kestrel? And would a wildlife photographer *prefer* the experience? That's how we judge progress.
