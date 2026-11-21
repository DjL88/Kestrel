# Bundled models

## Finding the subject for Auto Cull: YOLOX-tiny
| | |
| --- | --- |
| File | `src/assets/models/yolox_tiny.onnx` |
| Size | 20,219,662 bytes |
| SHA-256 | `427cc366d34e27ff7a03e2899b5e3671425c262ea2291f88bb942bc1cc70b0f7` |
| Model and weights | YOLOX by Megvii, Apache-2.0 (github.com/Megvii-BaseDetection/YOLOX), trained on COCO |
| Source | The project's release `0.1.1rc0`, file `yolox_tiny.onnx`, downloaded 16 November 2026 |
| Runtime | onnxruntime-web (MIT), same as below |

It recognises people, animals and vehicles (including aeroplanes) from any camera. Big photos are searched in tiles so a distant subject is not lost. It decides which photos have a subject and how sharp it is; it is not a general scene classifier. A subject outside its 19 classes (a flower, a building) is not found, and Auto Cull then judges by overall detail.

## Subject detection: U²-Net-P
| | |
| --- | --- |
| File | `src/assets/models/u2netp.onnx` |
| Size | 4,574,861 bytes |
| SHA-256 | `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8` |
| Model and weights | U²-Net by Xuebin Qin et al., Apache-2.0 (github.com/xuebinqin/U-2-Net) |
| ONNX conversion | Downloaded from the rembg project's v0.0.0 release (github.com/danielgatis/rembg, MIT) |
| Runtime | onnxruntime-web (MIT), CPU WebAssembly build, one thread, so it needs no special browser headers |

The checksum is of the file as downloaded, and the app refuses to run a file that does not match it. There is no independent published checksum to compare against, so the file's origin rests on the rembg release page.

### What it is and is not
It finds the most prominent object in a photo (salient object detection). It was not trained on wildlife in particular, so it can miss fine detail such as whiskers, feathers or twigs, and can pick the wrong object when several compete. Kestrel therefore:
- states a confidence (high, medium or low) from how decisive the map is, and refuses to make a mask when nothing stands out or almost everything does;
- lets the user refine the result with Add and Remove brush strokes;
- warns when the crop or rotation changes after detection, because the mask was made for one framing.

### Measured on this Mac (Chromium in the Claude desktop app)
First run on a 1264 by 848 photo, including loading the model and runtime: about 2.1 seconds. It found a red fox cleanly, including tail and legs, and left the frosty plants out. This is one photo and not a benchmark. No wildlife test set has been run, so do not quote accuracy figures.

### Offline
The model ships inside the app. The 15 MB WebAssembly runtime is cached the first time subject detection is used, not at install, so the app stays quick to install and nothing is fetched from another site.

### Swapping the model
Update `SUBJECT_MODEL` in `src/core/subjectModel.ts` (file, size, checksum, input size) and check the new model's licence and output format first. Larger models such as IS-Net or BiRefNet cut fine detail better but are tens to hundreds of megabytes.

## Category gate: CLIP ViT-B/32 image encoder (desktop)
| | |
| --- | --- |
| File | `public/models/clip-vit-b32-vision-uint8.onnx` |
| Size | 88,648,915 bytes |
| SHA-256 | `b95448754a6ae56964ec80c570c80bb9863787ee85f51b664abed8c0e5f22a7a` |
| Model and weights | OpenAI CLIP, MIT; ONNX conversion and 8-bit quantisation by Xenova (MIT). Notice: `docs/notices/clip.txt` |
| Category vectors | `src/assets/subject/vectors.json`, made from `src/assets/subject/taxonomy.json` by `tools/subject-router/make_category_vectors.py` |

Before any species name is offered, the gate compares the picture with a wide list of subject categories (birds, mammals, aircraft, cars, buildings, scenes and more) and decides whether the species step may run (`src/core/subjectRouter.ts`, `src/core/categoryGate.ts`). A picture that is mostly not an animal gets no animal name; an unclassified picture that is clearly an animal becomes Wildlife. When unsure it says nothing. It runs on the desktop app, where the file ships in the installer; browsers leave it off until it is part of the opt-in download. Not yet measured on real shoots.

## Species suggestions model (bundled in desktop installers; optional in browsers)

**Windows, macOS and Linux installers** now include the pinned 89 MB model,
using `npm run desktop:build` or the Desktop app workflow. The build fetches
the public release asset, checks its exact size and SHA-256, and fails closed
if the verified file cannot be included. On desktop, Kestrel loads this
precompiled ONNX model locally on first use: no build-time compilation at
launch, no background model download and no photos uploaded.

A new desktop build/installer is needed for model updates; existing installed
EXEs cannot gain this embedded asset just by restarting. Web/mobile builds
continue to use the optional explicit download, preserving data and cost
controls. The original licensing notices remain shipped in `docs/notices`.

## Species suggestions model (optional, downloaded by the user)

Suggests what a photo shows ("Red kite · Milvus milvus · likely") from the image half of BioCLIP (MIT licence). It is not bundled: it is an 89 MB download the user chooses to make, kept on the device for offline use. See `SPECIES-TAGGING-SPIKE.md` for how it was made and measured.

| | |
| --- | --- |
| File | `image_int8.onnx` (image encoder only, int8 on the matrix layers) |
| Size | 89,041,951 bytes |
| SHA-256 | `ea4095eb31a279643dc7ea89b90b2168b4807df0fce3c40b72a43a771caee8a2` |
| Input | 1 × 3 × 224 × 224, centre square crop, normalised with the CLIP mean and standard deviation |
| Output | 512 numbers, normalised |

**Hosting: the same site as the app.** A web page can only download the file from its own site or from a host that sends CORS headers. GitHub release files send none (checked 15 Nov 2026), so the model is stored as a release asset (`species-model-1`) and copied next to the app at build time. The app then downloads it from its own address.

1. It is already in git at `public/models/` (see models/README.md). The script below only re-fetches it if the file is missing or damaged, and checks it against the SHA-256 above:

   ```
   npm run model:species
   ```

2. Build or run the app pointing at that address:

   ```
   VITE_SPECIES_MODEL_URL=/models/bioclip-image-int8.onnx npm run build
   ```

   For local use put the same line in `.env.local` and restart `npm run dev`.

3. In any deployment, run step 1 before step 2 so the file is in the published site. The app only shows the suggestions feature when it is built with that address. Without it nothing changes.

The app's offline cache does not pre-install this file for every visitor. A person downloads it when they choose to, and it is then kept on their device. The release also carries `bioclip.txt`, the MIT licence notice the model needs (a copy is in `docs/notices/`). A different file needs `VITE_SPECIES_MODEL_SHA256` and `VITE_SPECIES_MODEL_BYTES` as well.

**Making the model file and the names.** `tools/species/` has what is needed, using a Python with `torch`, `open_clip_torch`, `onnx` and `onnxruntime`:

- Export the image half to ONNX (opset 17) and quantise only `MatMul` and `Gemm` to int8. Quantising the first (convolution) layer breaks the browser runtime, and half precision gave invalid numbers.
- `make_labels.py` turns `species-uk.csv` into `src/assets/species/uk.json`: one small vector per name, so no text model ships. Add a species by adding a row and running it again.
- `make_stand_in.py` makes a tiny stand-in model for tests that always "sees" one species.

**What it learns.** The model never retrains. Names a person accepts are counted on the device and rise a little in the order next time, up to a small cap, so a clear match always wins.


## Experimental offline photographic vision lab (not yet in Kestrel's editor)

Reproducible **Python-only** evaluation harnesses live in `tools/vision-lab/`, with pinned
acquisition and verified checksums in `scripts/models/manifest.json` and
`scripts/models/acquire.py`. The exact checkpoint licences and revision URLs
are recorded in the manifest, with notices written beside downloaded weights.
No model weights, photographs, signing secrets or training datasets are committed.

Candidate roles include SmolVLM2-500M for context and Florence-2 for region
grounding and text reading. The reported six acquisition tests and checksum-verified
downloads passed in Claude's development checkout; the actual on-device TypeScript
runtime, signed activation through the updater, resource limits and calibration
are **NOT IMPLEMENTED OR VERIFIED** by these files. The preliminary helicopter
type classifier scored 0/12 and must not be offered as reliable identification.
OCR/bird-ring observations remain suggestions requiring human confirmation.

Run the Python test harness using `python3 -m unittest discover -s scripts/models`
where its dependencies are installed. See each script's header for model and
optional dependency requirements. These are developer tools, not a background
download started by the photographer's app. Large packs require explicit consent.

## On-device photo check: SmolVLM2-256M (installed on request, runs inside the editor)

| | |
| --- | --- |
| Model and weights | SmolVLM2-256M-Video-Instruct by Hugging Face (HuggingFaceTB), **Apache-2.0**. Notice: `docs/notices/smolvlm2.txt` |
| Revision | `9cda5c165b28c68a52e9bb542d2b89f0f6963709` (pinned in `src/core/photoCheckPack.ts`) |
| Files (8-bit ONNX) | `onnx/vision_encoder_int8.onnx` 94,247,884 B `39f0efae…963d`; `onnx/embed_tokens_int8.onnx` 28,385,824 B `e2cdc3ba…710a`; `onnx/decoder_model_merged_int8.onnx` 137,553,254 B `03304ea9…37c1`; `tokenizer.json` 3,548,256 B `5ece781d…331a` (full digests in the pack file). About 264 MB in all |
| Runtime | The app's own `onnxruntime-web` (CPU WebAssembly, one thread). No second runtime, no Python, no server |
| Install | Only when the photographer chooses **Install photo check**; size and "nothing is uploaded" are shown first. Each file is a pinned asset in the existing verified store (`activateApprovedAsset`: digest check, immutable slot, read-back, atomic activation, cancellation). Weights are not in Git |

**What it does.** It writes one short description of the edited preview. Kestrel searches that text for a few fixed keywords (subject kind, golden / low-key / high-key / cool light, sky, foliage) in `src/core/photoCheck.ts`. The description is never shown as advice and never treated as an instruction. The facts can only make the measured advisor *more cautious* (a deliberate silhouette is not "underexposed", golden light is not a "cast"); they never raise confidence or authorise an automatic change. Fly Solo never runs it unasked.

**What did not work (so it is not used).** Scoring fixed answers by next-token probability (exposure, light, subject, "is there a person / sky / animal?") was **not reliable** on this model, with or without option rotation and capitalisation: a pure black frame and a pure white frame were both called "good" exposure, a cat scored as a "person", and a blank frame scored as containing sky. "Is the light backlit?" gave false positives on ordinary portraits. The model also **hallucinates on blank frames** (it described pure black as "a man's face"). Exposure is therefore measured from pixels, not asked. Speed-up by reusing the image prefix failed: this exported decoder only accepts one new token at a time once it has a cache.

**Limits.** 256M is small: descriptions were right for a cat, a portrait and a coffee cup, but nothing here shows it can judge colour accuracy, skin tone or mask edges. Those need measured evidence from Kestrel's own checks, with the model only saying what the picture is. 500M (`smolvlm2-500m`, about 511 MB 8-bit) gave no better closed-answer behaviour in the same tests.
