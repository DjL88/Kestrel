# TrueDetail RGB16 TIFF prototype (desktop native code)

This experimental module is in `src-tauri/src/raw_precision.rs`.
It is **not** a production editor feature, not exported through Tauri IPC,
and not available to Free or Pro users. It does not alter the existing
8-bit JPEG RAW development path.

## What this prototype actually does

- Attempts RAW decode/development through the existing `rawler` backend.
- **Refuses** an 8-bit intermediate rather than pretending an expanded
  16-bit image contains more captured detail.
- Accepts 16-bit channel intermediates, applies camera orientation and
  encodes an uncompressed RGB16 TIFF without JPEG conversion.
- Includes native regression tests for exact 16-bit sample preservation,
  orientation, 8-bit rejection and invalid source bytes.
- Operates offline on synthetic test data; no Nikon samples, proprietary SDK,
  AI model weights, cloud services or licence keys are bundled.

## Gaps before production or DxO comparisons

1. Verify that rawler actually exposes a genuine 16-bit intermediate for
   relevant Nikon Z8/Z5II compression settings. This module will correctly
   decline if only an 8-bit intermediate is available.
2. Embed a correct output ICC profile, validate tone and white balance.
   **Current TIFFs have no embedded ICC and cannot pass the strict Nikon
   reference comparison harness.**
3. Benchmark allocated memory for full Z8 NEFs (8256×5504 pixels). The
   current implementation holds an RGB16 image, a second RGB byte buffer and
   TIFF output in memory, which is unsuitable for routine batch processing.
   Switch to bounded/streaming rows or an isolated native export worker.
4. Support the known Nikon HE/HE* gap on Windows only after checking a
   licensed and legally redistributable decoder on real footage.
5. Integrate with an **actual** high-bit-depth nondestructive editing and
   full-resolution export pipeline. Avoid presenting an in-editor 8-bit
   canvas as though editing operates at 16-bit.
6. Test on real rights-cleared NEFs and independently check true
   sensor-derived detail against Nikon NX Studio and DxO PhotoLab outputs.

This experiment proves the *encoding boundary* when genuine RGB16 is present.
It does not implement neural denoising or establish DeepPRIME parity.
