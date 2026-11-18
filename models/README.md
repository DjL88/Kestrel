# Models

Every model Kestrel uses lives in git, so a fresh clone on Windows, macOS or AI Studio already has them. All run on the device;
nothing is downloaded at run time except the opt-in species model in a browser tab.

| Model | File | Size | SHA-256 | Licence | Where it is used |
| --- | --- | --- | --- | --- | --- |
| YOLOX-Tiny (subject detector) | `src/assets/models/yolox_tiny.onnx` | 20.2 MB | `427cc366d34e27ff7a03e2899b5e3671425c262ea2291f88bb942bc1cc70b0f7` | Apache-2.0 | Culling: finds people, animals and vehicles |
| U2-Netp (subject mask) | `src/assets/models/u2netp.onnx` | 4.6 MB | see `src/core/subjectModel.ts` | Apache-2.0 | Masks and subject crops |
| BioCLIP (species) | `public/models/bioclip-image-int8.onnx` | 89.0 MB | `ea4095eb31a279643dc7ea89b90b2168b4807df0fce3c40b72a43a771caee8a2` | MIT, see `docs/notices/bioclip.txt` | Species suggestions (birds and mammals) |
| CLIP ViT-B/32 image encoder (category gate) | `models/clip-vit-b32-vision-uint8.onnx` | 88.6 MB | `b95448754a6ae56964ec80c570c80bb9863787ee85f51b664abed8c0e5f22a7a` | MIT, see `docs/notices/clip.txt` | The category gate (not wired into the app yet) |
| CLIP tokenizer | `models/clip-tokenizer.json` | 2.2 MB | `f7f3b7af117d467b58374797691a6438d3e6b9e9cef800dfd5dced7f697a90cd` | MIT | Used by `tools/subject-router/make_category_vectors.py` |

Why the folders differ: anything in `public/` or `src/assets/models/` is packed into every installer, so the category-gate model
sits in the top-level `models/` folder until the gate is wired in. Then it moves next to the species model.

Not in git: the CLIP **text** model (64 MB). Only `tools/subject-router/make_category_vectors.py` needs it, and only when the category
list changes; the vectors it makes are already committed in `src/assets/subject/vectors.json`. To regenerate them, download
`onnx/text_model_int8.onnx` from `Xenova/clip-vit-base-patch32` into `tools/subject-router/models/`.

Do not replace a model without updating its checksum in the code and in this table. The app refuses a file that does not match.
