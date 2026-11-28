# Third-party model licences and notices

<!-- Generated from models/licences.json by `npm run models:notices`. Do not edit by hand: the unit test fails when this page is out of date. -->

Owner policy, 28 Nov 2026: only openly licensed models may ship. A model passes only if its weights licence allows commercial redistribution AND is not undermined by non-commercial, research-only or unverified training-data terms. GREEN = clean. AMBER = explicit open licence but training data or weights terms not fully confirmed (listed in docs/notices/THIRD-PARTY-MODELS.md for the owner). RED = cannot show it is clean; must not ship by default (shipDefault false, out of the installer, off by default). Not legal advice. Source: licence audit of 28 Nov 2026 (nothing downloaded, no licence accepted).

Adding a model requires an entry in `models/licences.json` with a verdict. `src/core/modelLicences.test.ts` (run by `npm test` and so by CI) fails otherwise.

## Summary

| Model | Verdict | Where | In default build | Feature |
| --- | --- | --- | --- | --- |
| BioCLIP v1 (species, 8-bit image encoder) | **RED** | installer | yes | Species suggestions |
| BioCLIP 2 (species second opinion) | **RED** | download | no | Species second opinion pack |
| BiRefNet_lite (fine subject edges) | **RED** | installer | yes | Fine subject edges pack |
| EfficientSAM-Ti (tap to select) | **RED** | installer | yes | Tap to select pack |
| Species vector files made with BioCLIP | **RED** | installer | yes | Species suggestions (reference vectors) |
| U2-Netp (subject mask) | **RED** | installer | yes | Subject mask for masks and crops |
| CLIP ViT-B/32 (image + text encoders, category gate, text search) | **AMBER** | installer | yes | Category gate before species; Search by description |
| DINOv2 ViT-S/14 (burst grouping; RF-DETR backbone) | **AMBER** | installer | yes | Burst and similar-frame grouping |
| Florence-2-base (tooling only) | **AMBER** | tooling | no | Vision lab and model scripts only; not in the app |
| NAFNet-SIDD-w32 (learned noise reduction) | **AMBER** | installer | yes | Learned noise reduction pack |
| PP-OCRv5 mobile detector + English recogniser | **AMBER** | download | no | Aircraft markings reader (opt-in download) |
| RF-DETR Nano (second subject finder) | **AMBER** | installer | yes | Second subject finder pack |
| SmolVLM2 256M / 500M (photo check, vision critic) | **AMBER** | download | no | Photo check / vision critic |
| YOLOX-Tiny (subject detector) | **AMBER** | installer | yes | Culling subject detector |
| CLIP tokenizer | **GREEN** | tooling | no | Tool only (category vector generation) |
| Species names (IOC, Reptile Database, GBIF, Wikidata) | **GREEN** | data | yes | Species label files |

## RED: must not ship by default

| Model | Code licence | Weights licence | Training data | Why | Reviewed | Sources |
| --- | --- | --- | --- | --- | --- | --- |
| BioCLIP v1 (species, 8-bit image encoder) | MIT | MIT tag | TreeOfLife-10M: iNat21 (non-commercial research and education only), BIOSCAN-1M (CC BY-NC-SA), EOL (CC0 to CC BY-NC-SA); initialised from OpenAI CLIP | Training data includes non-commercial terms; no statement that weights may be used commercially. | 2026-11-28 | <https://huggingface.co/imageomics/bioclip> <https://github.com/visipedia/inat_comp/tree/master/2021> <https://huggingface.co/datasets/imageomics/TreeOfLife-10M> |
| BioCLIP 2 (species second opinion) | MIT | MIT tag | TreeOfLife-200M (iNaturalist/GBIF, observation.org, EOL, BIOSCAN; licensing prose not readable) plus 26M LAION-2B replay samples | Strict policy: cleanliness of the training sources cannot be shown. | 2026-11-28 | <https://huggingface.co/imageomics/bioclip-2> |
| BiRefNet_lite (fine subject edges) | MIT | MIT tag | DIS5K (non-commercial research and education only; commercial use prohibited without author permission), plus DUTS, HRSOD and others unconfirmed | Training set DIS5K terms (read first-hand) prohibit commercial use without permission; other sets unconfirmed. | 2026-11-28 | <https://huggingface.co/ZhengPeng7/BiRefNet_lite> <https://github.com/ZhengPeng7/BiRefNet> <https://raw.githubusercontent.com/xuebinqin/DIS/main/DIS5K-Dataset-Terms-of-Use.pdf> |
| EfficientSAM-Ti (tap to select) | Apache-2.0 | not stated | SA-1B (Meta: 'research purposes only'; licence text not readable) and ImageNet pretraining (from memory, not read) | Cannot show neither SA-1B nor ImageNet pretraining permits commercial use; no weights licence. | 2026-11-28 | <https://github.com/yformer/EfficientSAM> <https://ai.meta.com/datasets/segment-anything/> |
| Species vector files made with BioCLIP | n/a (data) | n/a | BioCLIP text embeddings of species names; the names themselves are CC BY 4.0 / CC0 | Inherits BioCLIP's verdict (embeddings are BioCLIP output). The name lists are clean. | 2026-11-28 | <https://huggingface.co/imageomics/bioclip> |
| U2-Netp (subject mask) | Apache-2.0 | not stated | DUTS (ImageNet-derived images; annotations 'all rights reserved by the original authors'; no commercial grant) | Weights trained on DUTS, which carries no commercial grant; weights licence not stated. | 2026-11-28 | <https://raw.githubusercontent.com/xuebinqin/U-2-Net/master/LICENSE> <http://saliencydetection.net/duts/> |

## AMBER: for the owner to review

| Model | Code licence | Weights licence | Training data | Why | Reviewed | Sources |
| --- | --- | --- | --- | --- | --- | --- |
| CLIP ViT-B/32 (image + text encoders, category gate, text search) | MIT | MIT tag (Xenova ONNX copy) | Undisclosed web-crawled image-caption pairs | MIT is explicit, but OpenAI's model card says any deployed use, commercial or not, is out of scope, and the data is undisclosed. Leaning RED; a policy call for the owner. Whether the three vectors.json files were built with CLIP text was not verified. | 2026-11-28 | <https://github.com/openai/CLIP/blob/main/model-card.md> <https://huggingface.co/Xenova/clip-vit-base-patch32> |
| DINOv2 ViT-S/14 (burst grouping; RF-DETR backbone) | Apache-2.0 | Apache-2.0 (README and HF tag) | LVD-142M: described only as curated images; terms not confirmed | Explicit Apache grant; training-data terms unconfirmed. Low risk. | 2026-11-28 | <https://github.com/facebookresearch/dinov2> <https://huggingface.co/facebook/dinov2-small> |
| Florence-2-base (tooling only) | MIT | MIT tag | FLD-5B; terms not confirmed | Appears only in scripts/models/manifest.json and tools/vision-lab. Confirm before it ever ships. | 2026-11-28 | <https://huggingface.co/microsoft/Florence-2-base> |
| NAFNet-SIDD-w32 (learned noise reduction) | MIT (plus Apache-2.0 for BasicSR) | not stated (Google Drive / Baidu only) | SIDD train; dataset authors state MIT, nothing on rights in the photographed scenes | Dataset owners state MIT, but there is no weights licence and scene rights are unstated. Email Megvii and the SIDD authors to upgrade. | 2026-11-28 | <https://github.com/megvii-research/NAFNet> <https://abdokamel.github.io/sidd/> |
| PP-OCRv5 mobile detector + English recogniser | Apache-2.0 | Apache-2.0 (repo and HF tags) | Not described anywhere read | Explicit Apache grant; training data undescribed. Low risk. | 2026-11-28 | <https://github.com/PaddlePaddle/PaddleOCR/blob/main/LICENSE> <https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det> |
| RF-DETR Nano (second subject finder) | Apache-2.0 | Apache-2.0 for Nano only (larger sizes are PML, not ours) | COCO; DINOv2 backbone inherits its caveats | Apache confirmed for Nano; inherits DINOv2 and COCO caveats. Low risk. | 2026-11-28 | <https://github.com/roboflow/rf-detr/blob/develop/LICENSE> <https://huggingface.co/Roboflow/rf-detr-nano> |
| SmolVLM2 256M / 500M (photo check, vision critic) | Apache-2.0 | Apache-2.0 tag | Ten fine-tune sets, at least one academic-research-only (LLaVA-Video-178K, to verify); FineVideo and M4-Instruct carry caveats; six sets unchecked; SigLIP encoder on WebLI (terms not stated) | Apache licence, but at least one stated training source is academic-only. Biggest open question of the AMBER set. Email HuggingFaceTB. | 2026-11-28 | <https://huggingface.co/HuggingFaceTB/SmolVLM2-256M-Video-Instruct> <https://huggingface.co/HuggingFaceTB/SmolVLM2-500M-Video-Instruct> |
| YOLOX-Tiny (subject detector) | Apache-2.0 | not stated (release downloads) | COCO (annotations CC BY 4.0 from memory; images mixed Flickr licences; terms page returned no text) | Apache code, weights licence not stated, COCO terms not confirmed. Widely shipped commercially. Low risk. | 2026-11-28 | <https://github.com/Megvii-BaseDetection/YOLOX> <https://cocodataset.org/#termsofuse> |

## Notices and attribution required

| Model | Code licence | Weights licence | What must ship | Notice file |
| --- | --- | --- | --- | --- |
| BioCLIP v1 (species, 8-bit image encoder) | MIT | MIT tag | MIT text; docs/notices/bioclip.txt | `docs/notices/bioclip.txt` |
| BioCLIP 2 (species second opinion) | MIT | MIT tag | MIT text if kept | none yet |
| BiRefNet_lite (fine subject edges) | MIT | MIT tag | MIT text if kept | none yet |
| EfficientSAM-Ti (tap to select) | Apache-2.0 | not stated | Apache-2.0 text if kept | none yet |
| Species vector files made with BioCLIP | n/a (data) | n/a | IOC / GBIF / Wikidata attribution (NOTICE.md) | none yet |
| U2-Netp (subject mask) | Apache-2.0 | not stated | Apache-2.0 text if kept | none yet |
| CLIP ViT-B/32 (image + text encoders, category gate, text search) | MIT | MIT tag (Xenova ONNX copy) | MIT text; docs/notices/clip.txt | `docs/notices/clip.txt` |
| DINOv2 ViT-S/14 (burst grouping; RF-DETR backbone) | Apache-2.0 | Apache-2.0 (README and HF tag) | Apache-2.0 text; docs/notices/dinov2.txt | `docs/notices/dinov2.txt` |
| Florence-2-base (tooling only) | MIT | MIT tag | MIT text if it ever ships | none yet |
| NAFNet-SIDD-w32 (learned noise reduction) | MIT (plus Apache-2.0 for BasicSR) | not stated (Google Drive / Baidu only) | MIT notice for NAFNet and for BasicSR (Apache-2.0) must ship | none yet |
| PP-OCRv5 mobile detector + English recogniser | Apache-2.0 | Apache-2.0 (repo and HF tags) | Apache-2.0 text; docs/notices/paddleocr.txt | `docs/notices/paddleocr.txt` |
| RF-DETR Nano (second subject finder) | Apache-2.0 | Apache-2.0 for Nano only (larger sizes are PML, not ours) | Apache-2.0 text | none yet |
| SmolVLM2 256M / 500M (photo check, vision critic) | Apache-2.0 | Apache-2.0 tag | Apache-2.0 text; docs/notices/smolvlm2.txt | `docs/notices/smolvlm2.txt` |
| YOLOX-Tiny (subject detector) | Apache-2.0 | not stated (release downloads) | Apache-2.0 text | none yet |
| CLIP tokenizer | MIT | n/a | MIT text | none yet |
| Species names (IOC, Reptile Database, GBIF, Wikidata) | n/a (data) | n/a | Attribution in NOTICE.md | none yet |

Apache-2.0 and MIT both require the licence text and copyright notice to travel with the weights or code. Where "none yet" is shown for a model that ships, add the notice file before release.
