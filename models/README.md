# Models

Every model Kestrel uses lives in git, so a fresh clone on Windows, macOS or AI Studio already has them. All run on the device;
nothing is downloaded at run time except the opt-in species model in a browser tab.

| Model | File | Size | SHA-256 | Licence | Where it is used |
| --- | --- | --- | --- | --- | --- |
| YOLOX-Tiny (subject detector) | `src/assets/models/yolox_tiny.onnx` | 20.2 MB | `427cc366d34e27ff7a03e2899b5e3671425c262ea2291f88bb942bc1cc70b0f7` | Apache-2.0 | Culling: finds people, animals and vehicles |
| U2-Netp (subject mask) | `src/assets/models/u2netp.onnx` | 4.6 MB | see `src/core/subjectModel.ts` | Apache-2.0 | Masks and subject crops |
| BioCLIP (species) | `public/models/bioclip-image-int8.onnx` | 89.0 MB | `ea4095eb31a279643dc7ea89b90b2168b4807df0fce3c40b72a43a771caee8a2` | MIT, see `docs/notices/bioclip.txt` | Species suggestions (birds and mammals) |
| CLIP ViT-B/32 image encoder (category gate) | `public/models/clip-vit-b32-vision-uint8.onnx` | 88.6 MB | `b95448754a6ae56964ec80c570c80bb9863787ee85f51b664abed8c0e5f22a7a` (also in `src/core/categoryGate.ts`) | MIT, see `docs/notices/clip.txt` | The category gate before species suggestions (desktop app; off in browsers until it joins the opt-in download) |
| DINOv2 ViT-S/14 image embeddings (burst grouping) | `public/models/dinov2-small-fp16.onnx` | 44.9 MB | `31194260449c7916c6e08b87bb44b7a36950d7eab0dffc41ae1bdff33c950bc8` (also in `src/core/visualSimilarity.ts`) | Apache-2.0, see `docs/notices/dinov2.txt` | Splits bursts at scene changes and groups look-alike frames without capture times, on every platform |
| PP-OCRv5 mobile text finder and English recogniser (aircraft markings) | not in git: opt-in download, pinned in `src/providers/markingReader.ts` | 4.8 + 7.8 MB | `a4319856…` / `b5f833df…` | Apache-2.0, see `docs/notices/paddleocr.txt` | Reads registrations and military serials on aircraft only (Settings → Assistance) |
| CLIP tokenizer | `models/clip-tokenizer.json` | 2.2 MB | `f7f3b7af117d467b58374797691a6438d3e6b9e9cef800dfd5dced7f697a90cd` | MIT | Used by `tools/subject-router/make_category_vectors.py` |

Why the folders differ: anything in `public/` or `src/assets/models/` is packed into every installer. The category-gate model
moved next to the species model when the gate was wired in (19 Nov); this folder now holds only the tokenizer, which only a tool uses.

Not in git: the CLIP **text** model (64 MB). Only `tools/subject-router/make_category_vectors.py` needs it, and only when the category
list changes; the vectors it makes are already committed in `src/assets/subject/vectors.json`. To regenerate them, download
`onnx/text_model_int8.onnx` from `Xenova/clip-vit-base-patch32` into `tools/subject-router/models/`.

Do not replace a model without updating its checksum in the code and in this table. The app refuses a file that does not match.
