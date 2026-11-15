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

## Spike steps still to do

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
