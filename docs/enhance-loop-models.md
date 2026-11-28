# Enhance loop: models and licences (owner policy, 28 Nov 2026)

The loop may use only models that are openly licensed for commercial redistribution, **including their training data**. No weights
are in Git. Machine-readable copy: `src/core/enhanceModels.ts` (`loopMayUse`). **The licence record is `models/licences.json`** (verdicts from the 28 Nov 2026 audit; generated page `docs/notices/THIRD-PARTY-MODELS.md`). Where this table says `open` but the audit says AMBER or RED, the audit wins: CLIP and SmolVLM2 are AMBER (SmolVLM2 has the biggest training-data question); YOLOX, RF-DETR, DINOv2 and PP-OCRv5 are AMBER (low); U2-Netp, BiRefNet_lite, EfficientSAM-Ti and BioCLIP/BioCLIP 2 are RED; NAFNet-SIDD is AMBER. Licences below are as recorded in the repo
(`models/README.md`, `docs/notices/`, `src/core/optionalModels.ts`) plus the author's knowledge of the training sets; I could not
re-read upstream licence texts offline, so "verify" means the owner (or a licence check) must confirm before use.

| Model | Version / source | Code and weights licence | Training data | Status in the loop |
|---|---|---|---|---|
| SmolVLM2-256M-Video-Instruct (vision AI) | HuggingFaceTB, rev 9cda5c16… | Apache-2.0 | mixed open sets, per model card | **open** |
| YOLOX-Tiny (detector) | Megvii | Apache-2.0 | COCO | **open** |
| RF-DETR Nano (second detector) | Roboflow, rev 9f201577… | Apache-2.0 (Nano only) | COCO | **open** |
| DINOv2 ViT-S/14 (bursts) | facebook/dinov2-small | Apache-2.0 | LVD-142M | **open** |
| CLIP ViT-B/32 (category gate, text search) | OpenAI; ONNX by Xenova | MIT | not published | **open** |
| PP-OCRv5 mobile (markings) | PaddlePaddle | Apache-2.0 | n/a | **open**, not used for photo judgement |
| U2-Netp (subject mask) | xuebinqin/U-2-Net | Apache-2.0 | DUTS (academic terms) | **verify** |
| BiRefNet_lite (fine edges) | ZhengPeng7, rev aa62cd87… | MIT | DIS5K and others (academic) | **verify** |
| EfficientSAM-Ti (tap to select) | yformer/EfficientSAM | Apache-2.0 | SA-1B (research licence) | **verify** |
| NAFNet-SIDD-w32 (learned denoise) | megvii-research/NAFNet | MIT (code) | SIDD (terms not confirmed) | **verify** |
| BioCLIP / BioCLIP 2 (species) | imageomics | MIT (weights) | TreeOfLife (includes non-commercial images) | **verify** |
| Species names | IOC World Bird List | CC BY 4.0 | n/a | open |

**Verify = not used by the enhance loop** until confirmed. Today the loop itself loads no model: the vision critic is an injected
interface (the harness uses a labelled stand-in), and the Subject-focused option falls back to measured in-focus detail when
no subject mask is allowed. Consequence to decide: U2-Netp is what the editor's subject mask uses today, so with the strict rule
the loop would not use it either. The existing editor features that ship these models are unchanged by this work.

## Cloud
The per-photo loop never calls the cloud and has no cloud input. Cloud use belongs to bulk processing for paid Pro users (separate
work). Gemini is not in the per-photo critique path.

## Opt-in rules-maintenance channel (design only, nothing built)
Separate explicit consent, off by default. Shares only recipes, measured features and ratings (accepted, rejected, undone): no EXIF,
paths or identifiers; images only if the person opts in again per batch. A hosted model may review whether a rule's advice held up
across opted-in results, to help maintain `photographyKnowledge.ts`. Failure is silent and never blocks editing.
