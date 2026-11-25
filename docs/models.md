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

## Local photo check prototype — SmolVLM2-256M

The opt-in prototype uses **SmolVLM2-256M-Video-Instruct** (HuggingFaceTB, Apache-2.0, revision `9cda5c165b28c68a52e9bb542d2b89f0f6963709`) in Kestrel's existing `onnxruntime-web/wasm`. The four pinned 8-bit ONNX/tokenizer files total about 264 MB. Exact sizes and SHA-256s live in `src/core/photoCheckPack.ts`; the Apache notice lives in `docs/notices/smolvlm2.txt`. Weights and photos are **not** in Git. Installation requires a user's explicit consent; local editing works without the pack.

The files are pinned by the app and activated through its verified immutable IndexedDB store: large assets are stored in atomic 16 MiB records, verified against their SHA-256 before activation and each use, with existing active/previous pointers. This is **not** a second auto-updater. A corrupt or incomplete pack reverts to the Install state; no photos are uploaded. The inference backend runs local CPU WASM and creates/reclaims sessions when checking.

**Reliability guard.** Claude's experiments showed the 256M/500M model can confidently misidentify subjects, blank photos and closed-choice options. Its text is treated as untrusted hypotheses. Only broad lighting intent supported by the actual displayed pixel distribution may *suppress* a conventional suggestion; it never supplies identity or increases confidence. Exposure/clipping corrections come from Kestrel's measured histogram and ordinary reversible sliders, not invented VLM values. Solo is opt-in; Glide offers proposals; Soar makes only bounded, objective changes.

**Proof status.** The original Claude browser E2E **failed** at the IndexedDB single-value limit on the 137.5 MB decoder, before local inference. #709 addresses that limit; a fresh live browser/installed test **has not run** here. In the recovered implementation branch, the test `tests/photo-check.spec.ts` requires `KESTREL_MODEL_DIR` with the four pinned files and `KESTREL_TEST_PHOTO` containing a rights-cleared photograph. It asserts explicit installation, actual local model completion, a normal slider edit, undo, reopen, and no outgoing network activity in the offline phase. CPU/RAM, photo genres, initial loading, visual accuracy and installed-device evidence remain acceptance gates. Do not call the model production-ready without those checks.

## Reading text in a photo: registrations and bird rings (21 Nov 2026)

**Status: policy written and unit-tested, then parked, because OCR is deliberately after the Photo Check slice and unwired code does not merge.** The code and its 9 tests are in git history (commit `2220a6d8`, on `claude/nice-maxwell-f6hjzj` before this PR) and were built against real recorded Florence-2 output (`tools/vision-lab/fixtures/two-pass-real.json`).

**The reader should be SmolVLM2, which the Photo Check already runs, so no second model is needed to read.** Same synthetic frames, nine crops each (three paddings x three zoom sizes), `tools/vision-lab/try_smolvlm_text.py`:

| Text | SmolVLM2-500M (int8) | Florence-2-base (int8) |
| --- | --- | --- |
| `G-OKES` | 9 of 9 exact | 8 of 9 |
| `EB 74918` | 9 of 9 exact | 8 of 9 (a single zoom read it wrongly twice) |
| `N738PA` | 9 of 9 exact | 4 of 9 (5 read as `N738PAA`) |

Clean, flat, synthetic text only. Real photos (blur, angle, glare, tiny rings on a moving leg) are untested, so every result stays a suggestion to confirm.

**What the policy does.** Read once in the background; when the person interacts with the photo, read again zoomed on just that text; if the two disagree or the reader is doubtful, a bounded tie-break (at most 6 reads, different crops) and a vote among **format-valid** readings (UK, US N-number, other civil, ring-like). A clear majority is `agreed`; otherwise `needs-review` keeps every candidate and picks none. Nothing is written to metadata until the person confirms, like a confirmed subject tag.

**What is still missing: finding where the text is.** Whole-frame reading fails on small text (the reader sees a 512 to 768 px view), and tiling a whole frame was slow and invented text on blank tiles. Florence-2's `<OCR_WITH_REGION>` located the text well, but SmolVLM2 does not give boxes. Options, in order of preference: restrict the search to the subject's box and the likely area (tail and fuselage for aircraft, legs for birds) with the existing detectors; or keep Florence-2 (about 0.3 GB) only as the locator. Decide after measuring on real photos, because a second model costs storage and memory on every device.

## Photo Check measured on real photos (21 Nov 2026, Claude)

**Executed:** the full browser journey passed (`tests/photo-check.spec.ts`, consented install of the pinned SmolVLM2-256M, real WASM inference in the editor, apply, undo, reopen, repeat offline, no outside requests). First inference after idle 9.6 s including load; Chromium about 2.05 GB across processes; CPU only. Recipe for the fixture photo (CC0 cat, bright but unclipped): `(a ** 0.3) * 245`.

**Why the editor says "Scene: Not sure yet":** `supportedSceneFacts` (src/core/photoCheck.ts) deliberately discards the model's subject, sky and foliage words, because a word in a small model's answer is not independent evidence; only lighting intent with pixel support passes. So today the model's subject reading is never shown.

**How good is that discarded reading?** `tools/vision-lab/photo_check_replica.py` replicates the app's check (same pinned 256M int8 files, letterbox on grey at 512 px, same question and 28-token limit) and `eval_photo_check.py` / `eval_raw_facts.mts` score it. Data: `lakhaniabhi/european-birds-50` test split (declared CC0 by the uploader, provenance unverified, never committed), 100 photos at 2 per species with a fixed seed, plus 12 helicopters and 12 not-helicopters from `dcskycam/helicopter-classification` (CC-BY-4.0), plus 4 scikit-image samples. Mean 0.54 s per photo natively.

| Photos | Model's description names | |
| --- | --- | --- |
| 100 European birds | a bird 86, another subject 3, nothing the app's word list knows 11 | ~10 of the 11 are real birds called seagull, goose, puffin or penguin: a vocabulary gap in `SUBJECTS`, not a recognition failure |
| 12 helicopters | an aircraft 11, a bird **0** | |
| 100 birds | an aircraft **0** | |

**What this supports:** the model is a useful second witness for "bird or aircraft", which is the roadmap's known failure. **What it does not show:** the photos are clean subject portraits from one dataset; distant, small, in-flight or poor-light field photos, other subjects and any independent benchmark are untested; n is small.

**Proposed next step (not built):** corroborate instead of discard. Show a scene or subject only when the model and the existing detector (YOLOX / category gate) agree; on a bird-versus-aircraft disagreement, abstain and flag the photo for review (never auto-reject). Needs the Photo Check owner, because it touches PhotoAdvice and the detector hand-off. Also extend the subject vocabulary (seagull, goose, puffin and similar) and add an aircraft kind.

### Subject corroboration is now in the Photo Check (21 Nov 2026)
`src/core/subjectCorroboration.ts` combines the scene reading with the existing object detector (`findSubject`, run on the same frozen preview). The subject appears in the Scene line only when both name the same kind; a disagreement (bird against aircraft first) shows one quiet "check the subject" note and asserts nothing; one witness alone shows nothing new; a detector that cannot run is no witness. No model, AI or runtime wording is user-facing. Executed: `tests/photo-check.spec.ts` with the real model and detector passes, and the cat fixture now reads "Scene: Animal" where it read "Not sure yet" before (first inference 10.6 s including load, about 2.25 GB Chromium memory, CPU only). Measured on the recorded descriptions: 96 of 100 bird photos read as a bird (86 before the word list was widened), 0 as an aircraft; 11 of 12 helicopters as an aircraft. Not shown: field photos, other detectors' agreement rates on a labelled set, and what a bird-versus-aircraft conflict does downstream (species naming and cull are not yet gated by it).

## Optional model packs (opt-in downloads)

Upgrades the owner approved on 25 Nov 2026. None is in git or in an installer. Each is pinned in `src/core/optionalModels.ts`
(address, bytes, SHA-256), fetched only when the photographer chooses, checked as it arrives and again when read back
(`src/providers/optionalModels.ts`), and kept on the device for offline use. The existing model keeps working as the fallback.
A build offers a pack only when its address is set, for example `VITE_RFDETR_MODEL_URL=/models/rfdetr-nano-fp16.onnx`
with the file placed in `public/models/` (never committed) or on the models bucket. The scripts that made and checked
each file live beside the weights, outside the repo, in the `Kestrel-models` folder next to the checkout.

### RF-DETR Nano (subject detection, in tandem with YOLOX-tiny)
| | |
| --- | --- |
| File | `rfdetr-nano-fp16.onnx` |
| Size | 54,560,489 bytes |
| SHA-256 | `e83b810bff55423a019564fcc3cd0bc188fd15d88f2f39dea287abb61f707002` |
| Model and weights | RF-DETR Nano by Roboflow, Apache-2.0 (Nano, S and M only; larger sizes are not Apache-2.0) |
| Source | https://huggingface.co/Roboflow/rf-detr-nano, revision `9f201577d9415f0378084748d27e68586e6b3600`: `model.safetensors`, 121,926,336 bytes, SHA-256 `497b1dbcc8f9d115b806fb82d140d7e22e5b5c3fba45abefef39dd4f99c1f737` |
| Conversion | transformers 5.24.1 `RfDetrForObjectDetection` → `torch.onnx.export` (opset 17, fixed 1×3×384×384) → fp16 weights with `onnxruntime.transformers.float16`, keeping TopK, Sigmoid, Exp, Log, Softmax, ReduceMax, GatherElements, GridSample, Div, Pow, Sqrt and ReduceMean in fp32. At 384 px the eager model uses its position embeddings unresized, and the export takes the same branch. |
| Input / output | `pixel_values` float32 [1,3,384,384]: a plain resize, RGB/255, ImageNet mean and std. `logits` [1,300,91]: sigmoid scores over COCO ids, id 0 unused. `pred_boxes` [1,300,4]: cx, cy, w, h in 0..1 |
| Runtime | onnxruntime-web WASM, the same as the other models |

**Parity (25 Nov 2026, Windows laptop, CPU).** Compared against the PyTorch model on 9 images: 4 scikit-image samples (CC0 or public domain: astronaut, chelsea, coffee, rocket), 2 synthetic scenes, and composites with two cats and five people. Gate: every reference detection at ≥ 0.35 matched by class with score within 0.03 and IoU ≥ 0.95, and no extra detection at ≥ 0.40.

| Variant | Size | Gate | Worst score diff | Worst IoU | Median CPU ms (onnxruntime 1.32) |
| --- | --- | --- | --- | --- | --- |
| fp32 ONNX | 108.4 MB | PASS | 0.0000 | 1.000 | 257 |
| **fp16 (shipped)** | 54.6 MB | PASS | 0.0017 | 0.990 | 308 |
| int8 dynamic (MatMul) | 34.5 MB | FAIL | 0.117 | 0.943 | 396 |

onnxruntime-web 1.31.1 in Node (single thread): load 2.2 s, one 384 px tile 3.5 s, 432 MB RSS. It returns the same detections as PyTorch on the five-people composite: 5 separate people, scores within 0.005, boxes within 0.001. **Not measured:** accuracy on real wildlife or aviation shoots, phone timings, and whether it beats YOLOX on distant subjects. Until that is measured it only runs beside YOLOX, never in place of it.
