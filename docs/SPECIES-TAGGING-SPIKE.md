# Species tagging: spike findings

Goal: tag photos on the device ("Red Kite", "Bird of Prey") so projects can be searched by what is in them.
Tags are suggestions the user can edit. They never change a photo. The app works without them.

## What was checked (15 Nov 2026)

| Option | Licence | Shape | Fit |
| --- | --- | --- | --- |
| BioCLIP (imageomics/bioclip) | MIT (model card) | ViT-B/16 image encoder, CLIP style, trained on TreeOfLife-10M, over 450K taxa (model card) | Best fit. Matches a photo to a list of names, so the list can be limited to species the user shoots. |
| BioCLIP 2 | Not checked | Community ONNX export with int8 quantisation exists, aimed at Python on CPU | Candidate upgrade once licence is checked. |
| WingCLIP (community, bird-only) | Not checked | 38.7M parameter bird encoder distilled from BioCLIP 2, fp32 and int8 ONNX, reported small enough for a browser tab | Useful reference for export and quantising. Check licence and accuracy before relying on it. |
| SpeciesNet (Google) | Apache-2.0 (repo) | EfficientNet V2 M, Python and PyTorch, described as for motion-triggered wildlife cameras | Poor fit for close-up photography. Nothing stated about ONNX or on-device use. Keep for trail-camera projects later. |
| BirdNET (Cornell) | Not rechecked | Audio only | Not applicable to photos. |
| Merlin | Not open | Models are not published | Not usable. |

Not stated by the sources, so unknown until tried: BioCLIP's weight file size, any official ONNX export, speed in a browser.
My estimate, to verify: a ViT-B image encoder is roughly 330 MB at full precision and roughly 85 to 90 MB at int8.

## Measured (15 Nov 2026)

The BioCLIP image encoder (ViT-B/16, MIT) was exported to ONNX on a laptop and shrunk. Nothing was added to the app.

| Version | Size | Time per photo (laptop CPU, Python) | Notes |
| --- | --- | --- | --- |
| Full precision | 345 MB | about 165 ms | Reference. |
| int8 (matrix layers only) | **89 MB** | about 120 ms | The one to use. |
| Half precision | 173 MB | about 200 ms | Produced invalid numbers (NaN), so rejected. |

- **int8 must leave the first (image patch) layer alone.** Quantising everything turns it into a `ConvInteger` operation that neither the desktop runtime nor the browser runtime supports. Quantising only the `MatMul` and `Gemm` layers works and holds nearly all the weight.
- **Names, not a text model, ship with the app.** The text half is run once, offline, to make one 512-number vector per species name. 50 names is about 100 KB, so a few hundred is well under 1 MB.
- **Quick accuracy check:** 16 photos of common UK species (an encyclopedia lead image each) against 50 candidate names including look-alikes (red kite and black kite, buzzard and rough-legged buzzard, several owls and tits). Full precision and int8 both got 16 of 16 first-choice right with each of three name styles, and int8 matched full precision on all 16.
- **How much to trust that:** not very far. These are clean, typical pictures that may well have been in the training data. Photos of small birds in flight, at a distance, or half hidden will be harder. The real test is the user's own photos, and a wrong first choice should always be easy to correct.
- **Speed and size were measured on a laptop in Python.** Browser (WebAssembly) and phone speed are not measured yet. 89 MB is a one-off download, kept for offline use.

## Design this points to

1. **Image encoder only on the device.** Text names are turned into vectors once, ahead of time, and shipped as a small file
   (one vector per species). The photo is encoded and compared to those vectors. No text model is needed in the browser.
2. **A short, regional name list.** Start with a few hundred birds and mammals (UK and Europe first, user can add more).
   Fewer names means better accuracy and a smaller file. Each name maps to a plain label and a group ("Red Kite", "Bird of Prey").
3. **Downloaded on opt-in, not bundled.** Too large to ship in every install. Offer "Download species recognition (about N MB)",
   cache it for offline use, and keep working without it. The existing subject detector stays bundled.
4. **Always a suggestion.** Show the top choices with a confidence word, never a percentage alone. One tap accepts, edits or removes.
   Low confidence shows nothing rather than a wrong name.
5. **Same pipeline as the subject detector.** Lazy import, one retry, friendly failure message, runs off the main thread.
6. **Optional hidden helper later.** A server-side adapter (any provider) can fill gaps. The app never depends on it.

## Spike steps still to do (steps 1 to 2 and part of 4 are done, see Measured)

1. Export BioCLIP's image encoder to ONNX (opset 17 or higher) and quantise to int8. Record file size.
2. Build the name list and its text vectors once, offline, with the original model.
3. Run both through `onnxruntime-web` in a test page. Record load time and time per photo on a laptop and a phone.
4. Measure accuracy on 30 to 50 of the user's own bird photos, with known names. Compare against WingCLIP if its licence allows.
5. Decide go or no-go, then build: worker, download and cache, tag review UI, search (search already reads `tags`).

## What is needed from the user

- 30 to 50 bird and animal photos with their correct names, as JPEG exports. Any genre mix is useful.
- The region and species they most often shoot, to seed the name list.

## Risks

- Accuracy on small birds in flight is unknown until tested.
- Model size on a phone over mobile data. Download only on Wi-Fi by default.
- Licences of derived and community models must be read before use. BioCLIP's MIT licence covers the original only.
