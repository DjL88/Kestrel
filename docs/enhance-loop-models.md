# Enhance loop: models and licences (owner policy, 28 Nov 2026)

The loop may use only models that are openly licensed for commercial redistribution, **including their training data**. No weights
are in Git. Machine-readable copy: `src/core/enhanceModels.ts` (`loopMayUse`). Licences below are as recorded in the repo
(`models/README.md`, `docs/notices/`, `src/core/optionalModels.ts`) plus the author's knowledge of the training sets; I could not
re-read upstream licence texts offline, so "verify" means the owner (or a licence check) must confirm before use.

| Model | Version / revision | Code licence | Weights licence | Training data | Source URL | Loop status |
|---|---|---|---|---|---|---|
| SmolVLM2-256M-Video-Instruct (vision AI) | rev 9cda5c16… | Apache-2.0 | Apache-2.0 | mixed open sets (model card) | huggingface.co/HuggingFaceTB/SmolVLM2-256M-Video-Instruct | **open** |
| YOLOX-Tiny (detector) | as in `models/README.md` | Apache-2.0 | Apache-2.0 | COCO | github.com/Megvii-BaseDetection/YOLOX | **open** |
| RF-DETR Nano (second detector) | rev 9f201577… | Apache-2.0 | Apache-2.0 (Nano only) | COCO | huggingface.co/Roboflow/rf-detr-nano | **open** |
| DINOv2 ViT-S/14 (bursts) | facebook/dinov2-small | Apache-2.0 | Apache-2.0 | LVD-142M | huggingface.co/facebook/dinov2-small | **open** |
| CLIP ViT-B/32 (category gate, text search) | OpenAI; ONNX by Xenova | MIT | MIT | not published | huggingface.co/Xenova/clip-vit-base-patch32 | **open** |
| PP-OCRv5 mobile (markings) | pinned in `markingReader.ts` | Apache-2.0 | Apache-2.0 | n/a | github.com/PaddlePaddle/PaddleOCR | **open**, not used for photo judgement |
| U2-Netp (subject mask) | `src/assets/models/u2netp.onnx` | Apache-2.0 | Apache-2.0 as recorded | DUTS (academic terms) | github.com/xuebinqin/U-2-Net | **verify: off in the loop** |
| BiRefNet_lite (fine edges) | rev aa62cd87… | MIT | MIT | DIS5K and other academic sets | huggingface.co/ZhengPeng7/BiRefNet_lite | **verify: off** |
| EfficientSAM-Ti (tap to select) | commit d525f622… | Apache-2.0 | Apache-2.0 as recorded | SA-1B (research licence) | github.com/yformer/EfficientSAM | **verify: off** |
| NAFNet-SIDD-w32 (learned denoise) | commit 2b4af71e… | MIT | MIT as recorded | SIDD (terms not confirmed) | github.com/megvii-research/NAFNet | **verify: off** |
| BioCLIP (species) | imageomics/bioclip | MIT | MIT | TreeOfLife-10M (includes non-commercial images) | huggingface.co/imageomics/bioclip | **verify: off** |
| BioCLIP 2 (species second opinion) | rev 2957b322… | MIT | MIT | TreeOfLife-200M (includes non-commercial images) | huggingface.co/imageomics/bioclip-2 | **verify: off** |
| Species names | IOC World Bird List | CC BY 4.0 | n/a | n/a | worldbirdnames.org | open |
| Enlarger | none: upscaling is the deterministic resampler, no model | n/a | n/a | n/a | n/a | not part of the loop |

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
