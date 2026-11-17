# Kestrel RAW detail-quality experiment — phase 1

Goal: preserve real feather/eye structure at high ISO while avoiding invented
textures and sharpening artefacts. **This is a measurement tool, not a denoiser.**
No change to Kestrel's current RAW decoding or production exports is made here.

## Run an offline image-detail comparison

Export one **full-resolution, uncompressed, non-tiled 16-bit RGB TIFF** from
Nikon NX Studio and another from the candidate renderer. Match white balance,
colour space/embedded ICC profile, orientation and crop. Keep both TIFFs and
the original NEF locally; no photo is uploaded.

```sh
python -m pip install -r scripts/requirements-nikon-qa.txt
python scripts/benchmark_nikon_detail.py reference.tif candidate.tif \
  --region feathers 1000,800,400,400 \
  --region eye 1200,950,150,150 \
  --region sky 50,50,300,300
python -m unittest discover -s scripts -p 'test_*.py'
```

Coordinates above are examples only. Select the **same pixel positions** in
both files, well inside the photograph; record the crop coordinates in your
bench notes. Use at least one textured and one smooth region per photograph.

The JSON report records SHA-256 hashes, image dimensions, crop rectangles,
luminance statistics, mean and 95th-percentile adjacent-pixel differences,
clipping fractions, mean absolute RGB difference, and reference-aligned\nedge structure (shared, candidate-only and reference-only edge fractions plus\ndirectional agreement where both images contain an edge). These metrics are
**descriptive, not quality rankings**. Candidate-only edges may flag apparent added detail, but are not proof of\nhallucination. Central-gradient diagnostics can miss single-pixel alternating\npatterns and are sensitive to registration, tone and exposure differences.\nHigh gradients can indicate **noise,
haloes or false detail** rather than genuine feather structure; low gradients
can indicate oversmoothing or simply a natural smooth area. Crops should be
inspected blind at 100% and 200% against the same RAW and NX Studio reference.
This tool cannot prove authentic detail, absence of hallucination, or parity
with DxO DeepPRIME.

## Next engine work — not implemented by this PR

1. Confirm Z8/Z5II lossless/HE/HE* decoding against real files and NX Studio
   16-bit TIFFs across firmware/compression modes.
2. Design a separate linear 16-bit/high-bit-depth processing boundary before
   JPEG; Kestrel currently decodes RAW into 8-bit JPEG for the editor.
3. Benchmark a properly licensed joint demosaic/denoise model with
   conservative CPU fallback and strict memory/tiling controls.
4. Add bird-feather, eye, fine-text and smooth-sky benchmark scenes, matching
   output colour and exposure. Obtain blind reviewer scores; reject fabricated
   textures, inconsistent barbs, haloes and lost microdetail.
5. Integrate behind an opt-in, reversible setting only after native tests,
   full-resolution export checks and rights/licence review.

No Nikon SDK, external model weights, cloud resources or production pipeline
changes are included. The benchmark works offline.
